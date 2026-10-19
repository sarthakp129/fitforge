import React, { useEffect, useRef, useState } from 'react';
import useStore from '../store/useStore.js';
import api from '../lib/api.js';
import { checkMic, micErrorMessage } from '../lib/mic.js';
import { supportsSpeech, startDictation, speechErrorMessage, sttServiceBroken, preferWhisper, rememberWhisper } from '../lib/speech.js';
import { fmtDateTime } from '../lib/format.js';
import { Button, Chip, Icon, Input, Empty, Spinner } from './ui.jsx';

/**
 * The coach conversation itself, without any page chrome.
 * Used inside CoachDrawer (the floating popup) so the coach is one tap away
 * from every screen instead of being a destination page.
 * Kept deliberately small: message list, composer, suggestion chips.
 */
export default function CoachPanel({ voiceReplies = false, onVoiceFail } = {}) {
  const { handleError, refreshAiStatus, toast } = useStore();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const recorderRef = useRef(null);
  const stopRef = useRef(null);
  const audioRef = useRef(null);

  // closing the popup (unmount) must silence any spoken reply in flight
  useEffect(() => () => { try { audioRef.current?.pause(); } catch { /* gone */ } }, []);
  const baseRef = useRef('');
  const scrollRef = useRef(null);
  const canMic = typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
  const speechOK = supportsSpeech();

  useEffect(() => {
    (async () => {
      try {
        const [chat, sug] = await Promise.all([
          api.ai.chat().catch(() => ({ messages: [] })),
          api.ai.suggestions().catch(() => ({ prompts: [] })),
        ]);
        setMessages(chat.messages || []);
        setSuggestions(sug.prompts || []);
      } catch (err) {
        handleError(err);
      }
      refreshAiStatus();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (typeof el.scrollTo === 'function') el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    else el.scrollTop = el.scrollHeight;
  }, [messages, busy]);

  const send = async (text) => {
    const message = (text ?? input).trim();
    if (!message || busy) return;
    setInput('');
    setMessages((m) => [...m, { role: 'user', content: message, optimistic: true }]);
    setBusy(true);
    try {
      const res = await api.ai.coach(message);
      setMessages((m) => [
        ...m.filter((x) => !x.optimistic),
        { role: 'user', content: message },
        { role: 'assistant', content: res.message, source: res.source, model: res.model, tokens: res.tokens },
      ]);
      refreshAiStatus();
      if (voiceReplies && res.source === 'ai') {
        // speak the reply; degrade silently to text if TTS is capped/absent
        api.ai.speak(res.message).then(async (blob) => {
          const url = URL.createObjectURL(blob);
          const audio = new Audio(url);
          audioRef.current = audio;
          audio.onended = () => { URL.revokeObjectURL(url); audioRef.current = null; };
          await audio.play().catch(() => {});
        }).catch((err) => onVoiceFail?.(err));
      }
      if (String(res.source).startsWith('engine')) {
        toast(res.source === 'engine:throttled'
          ? 'Token budget full — local coach answered.'
          : 'Local coach answered (no AI key).', 'warn', 4200);
      }
    } catch (err) {
      setMessages((m) => m.filter((x) => !x.optimistic));
      setInput(message);
      handleError(err, 'The coach could not answer.');
    } finally {
      setBusy(false);
    }
  };

  /** Record -> Whisper -> composer (editable before sending). */
  /** Whisper recorder path (works in any browser, needs a microphone). */
  const startWhisper = async () => {
    const pre = await checkMic();
    if (!pre.ok) { toast(pre.reason, 'warn', 6000); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const chunks = [];
      rec.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        setTranscribing(true);
        try {
          const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
          const out = await api.ai.transcribe(blob);
          if (!out.text) toast('Heard nothing usable — try again closer to the mic.', 'warn');
          else setInput((prev) => (prev ? `${prev} ${out.text}` : out.text));
        } catch (err) {
          handleError(err, 'Transcription failed.');
        } finally {
          setTranscribing(false);
        }
      };
      rec.start();
      recorderRef.current = rec;
      setRecording(true);
    } catch (err) {
      toast(micErrorMessage(err), 'warn', 5200);
    }
  };

  const toggleMic = async () => {
    if (recording) { stopRef.current?.(); recorderRef.current?.stop(); return; }

    // Preferred path: Chromium's built-in dictation — free, live interim text.
    // On builds where the speech service is missing (common on Linux Chromium)
    // we fall straight through to the Whisper recorder and remember that.
    if (speechOK && !preferWhisper()) {
      baseRef.current = input;
      setRecording(true);
      stopRef.current = startDictation({
        onInterim: (t) => setInput(baseRef.current ? `${baseRef.current} ${t}` : t),
        onFinal: (t) => {
          setRecording(false); stopRef.current = null;
          if (t) setInput(baseRef.current ? `${baseRef.current} ${t}`.trim() : t);
          else toast('Heard nothing — tap the mic and speak after the pulse starts.', 'warn');
        },
        onError: (e) => {
          setRecording(false); stopRef.current = null;
          if (sttServiceBroken(e)) {
            rememberWhisper();
            toast('Browser dictation is unavailable in this build — switching to on-server transcription. Speak after the pulse.', 'warn', 6000);
            startWhisper();
          } else {
            toast(speechErrorMessage(e), 'warn', 5200);
          }
        },
      });
      return;
    }

    await startWhisper();
  };

  return (
    <div className="stack gap-10" style={{ flex: 1, minHeight: 0 }}>
      <div className="chat-scroll" ref={scrollRef} style={{ flex: 1, maxHeight: 'none' }} aria-live="polite">
        {!messages.length && (
          <Empty icon="spark" title="Ask anything">
            Stalled lift, nagging joint, meal you can’t make work — the answer uses your numbers.
          </Empty>
        )}
        {messages.map((m, i) => (
          <div key={m.id || i} className={`bubble ${m.role === 'user' ? 'bubble-user' : 'bubble-ai'}`}>
            {m.content}
            {m.role === 'assistant' && m.source !== 'ai' && (
              <div className="bubble-meta"><span>offline answer</span></div>
            )}
          </div>
        ))}
        {busy && (
          <div className="bubble bubble-ai">
            <span className="typing" aria-label="Coach is thinking...">
              <span className="sr-only">Coach is thinking...</span>
              <i /><i /><i />
            </span>
          </div>
        )}
      </div>

      {suggestions.length > 0 && !input && (
        <div className="row gap-6 flex-wrap" style={{ padding: '2px 0' }}>
          {suggestions.slice(0, 2).map((s) => (
            <Chip key={s} tone="ghost" size="sm" onClick={() => send(s)} title={s}
              style={{ maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: '0.78rem', cursor: 'pointer' }}>
              <Icon name="spark" size={12} style={{ color: 'var(--ember)', marginRight: 4 }} />
              {s}
            </Chip>
          ))}
        </div>
      )}

      <form
        className="row gap-8"
        onSubmit={(e) => { e.preventDefault(); send(); }}
      >
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask the coach…"
          maxLength={1200}
          aria-label="Message"
        />
        {canMic && (
          <Button
            type="button"
            variant={recording ? 'danger' : 'soft'}
            className={recording ? 'rec-pulse' : ''}
            onClick={toggleMic}
            disabled={transcribing}
            aria-label={recording ? 'Stop dictation' : 'Dictate with voice'}
            title={recording ? 'Stop dictation' : speechOK ? 'Dictate (browser speech recognition)' : 'Record and transcribe with Whisper'}
          >
            {transcribing ? <Spinner size={15} /> : <Icon name="mic" size={16} />}
          </Button>
        )}
        <Button type="submit" variant="ember" disabled={busy || !input.trim()} aria-label="Send">
          {busy ? <Spinner size={15} /> : <Icon name="send" size={16} />}
        </Button>
      </form>
    </div>
  );
}
