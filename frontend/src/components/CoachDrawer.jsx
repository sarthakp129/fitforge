import React, { useEffect, useRef, useState } from 'react';
import CoachPanel from './CoachPanel.jsx';
import useStore from '../store/useStore.js';
import api from '../lib/api.js';
import { Button, Chip, Icon } from './ui.jsx';

/**
 * Floating circular coach button + slide-in panel (bottom sheet on phones).
 * The coach is a tool you reach for mid-set, not a page you travel to, so it
 * lives above every authenticated screen and never grows the sitemap.
 *
 * Accessibility: the panel is a modal dialog (ESC closes, click-outside
 * closes, focus moves to the composer on open and returns to the button on
 * close, body scroll locks while open).
 */
export default function CoachDrawer() {
  const { handleError, toast, coachOpen, setCoachOpen } = useStore();
  const open = coachOpen;
  const setOpen = setCoachOpen;
  const [voiceReplies, setVoiceReplies] = useState(false);
  const fabRef = useRef(null);
  const panelRef = useRef(null);

  // Global Cmd+J / Ctrl+J listener to toggle coach
  useEffect(() => {
    const handleGlobalKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', handleGlobalKey);
    return () => window.removeEventListener('keydown', handleGlobalKey);
  }, [setOpen]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    const onDown = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)
        && fabRef.current && !fabRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    document.body.style.overflow = 'hidden';
    // move focus into the conversation
    const t = setTimeout(() => panelRef.current?.querySelector('input[aria-label="Message"]')?.focus(), 60);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
      document.body.style.overflow = '';
      clearTimeout(t);
      fabRef.current?.focus();
    };
  }, [open]);

  const clear = async () => {
    if (!window.confirm('Clear the whole conversation?')) return;
    try {
      await api.ai.clearChat();
      toast('Conversation cleared.', 'info', 2200);
      setOpen(false);
      setTimeout(() => setOpen(true), 50); // remount the panel to reload history
    } catch (err) {
      handleError(err);
    }
  };


  return (
    <>
      <button
        type="button"
        ref={fabRef}
        className={`fab ${open ? 'fab-open listening' : ''}`}
        aria-label={open ? 'Close coach (shortcut: Command J or Control J)' : 'Ask FitForge Coach (shortcut: Command J or Control J)'}
        aria-expanded={open}
        title={open ? 'Close coach (Esc or ⌘J)' : 'Ask FitForge Coach (⌘J)'}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name={open ? 'close' : 'spark'} size={22} />
        {!open && <span className="fab-pulse" aria-hidden="true" />}
      </button>

      {open && (
        <>
          <div className="coach-pop" role="dialog" aria-modal="false" aria-label="Coach" ref={panelRef}>
            <div className="coach-pop-head">
              <span className="brand-mark" style={{ width: 28, height: 28, background: 'var(--ember-soft)' }}>
                <Icon name="spark" size={14} style={{ color: 'var(--ember)' }} />
              </span>
              <div className="flex-1">
                <div className="row gap-6" style={{ alignItems: 'center' }}>
                  <span className="strong small">Coach</span>
                  <span className="kbd" style={{ fontSize: '0.68rem', padding: '1px 5px' }}>⌘J</span>
                </div>
                <div className="tiny muted">Answers use your numbers.</div>
              </div>
              <Button
                variant={voiceReplies ? 'ember' : 'ghost'}
                size="sm"
                onClick={() => setVoiceReplies((v) => !v)}
                aria-label={voiceReplies ? 'Spoken replies on' : 'Spoken replies off'}
                aria-pressed={voiceReplies}
                title="Speak coach replies aloud (uses the daily voice allowance)"
              >
                <Icon name="speaker" size={15} />
              </Button>
              <Button variant="icon" size="sm" onClick={clear} aria-label="Clear conversation" title="Clear conversation">
                <Icon name="trash" size={14} />
              </Button>
              <Button variant="icon" size="sm" onClick={() => setOpen(false)} aria-label="Close coach" title="Close coach">
                <Icon name="close" size={15} />
              </Button>
            </div>
            <div className="coach-pop-body">
              <CoachPanel
                voiceReplies={voiceReplies}
                onVoiceFail={(err) => {
                  setVoiceReplies(false);
                  toast(err?.message || 'Voice replies unavailable right now — text only.', 'warn', 6000);
                }}
              />
            </div>
          </div>
        </>
      )}
    </>
  );
}
