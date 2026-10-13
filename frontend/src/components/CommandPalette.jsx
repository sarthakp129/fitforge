import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useStore from '../store/useStore.js';
import { useTheme } from '../hooks/useTheme.js';
import { Icon } from './ui.jsx';
import { api } from '../lib/api.js';

export default function CommandPalette() {
  const navigate = useNavigate();
  const { cmdOpen, setCmdOpen, setCoachOpen } = useStore();
  const { resolvedTheme, toggleTheme } = useTheme();

  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [exercises, setExercises] = useState([]);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const onClose = () => setCmdOpen(false);

  // Global Cmd+K / Ctrl+K listener
  useEffect(() => {
    const handleGlobalKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCmdOpen(!cmdOpen);
      }
    };
    window.addEventListener('keydown', handleGlobalKey);
    return () => window.removeEventListener('keydown', handleGlobalKey);
  }, [cmdOpen, setCmdOpen]);

  // Focus input when opened
  useEffect(() => {
    if (cmdOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 40);
    }
  }, [cmdOpen]);

  // Fetch exercises matching search query
  useEffect(() => {
    if (!cmdOpen || !query.trim()) {
      setExercises([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      api.training.exercises({ q: query.trim() })
        .then((res) => {
          if (!cancelled) setExercises((res?.exercises || []).slice(0, 6));
        })
        .catch(() => {});
    }, 140);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, cmdOpen]);

  // Static commands list
  const baseCommands = useMemo(() => [
    // Navigation
    { id: 'nav-dash', group: 'Navigation', label: 'Go to Dashboard', icon: 'grid', action: () => navigate('/dashboard') },
    { id: 'nav-train', group: 'Navigation', label: 'Go to Training & Workouts', icon: 'dumbbell', action: () => navigate('/training') },
    { id: 'nav-nutr', group: 'Navigation', label: 'Go to Nutrition Tracker', icon: 'flame', action: () => navigate('/nutrition') },
    { id: 'nav-prog', group: 'Navigation', label: 'Go to Progress & Analytics', icon: 'chart', action: () => navigate('/progress') },
    { id: 'nav-set', group: 'Navigation', label: 'Go to Settings', icon: 'settings', action: () => navigate('/settings') },

    // Quick Actions
    {
      id: 'act-coach',
      group: 'Quick Actions',
      label: 'Ask AI Coach',
      icon: 'spark',
      badge: 'Coach',
      action: () => setCoachOpen(true),
    },
    {
      id: 'act-theme',
      group: 'Quick Actions',
      label: `Switch to ${resolvedTheme === 'dark' ? 'Light' : 'Dark'} Mode`,
      icon: resolvedTheme === 'dark' ? 'sun' : 'moon',
      badge: 'Theme',
      action: () => toggleTheme(),
    },
    {
      id: 'act-workout',
      group: 'Quick Actions',
      label: 'Start Today’s Workout Session',
      icon: 'play',
      badge: 'Training',
      action: () => navigate('/training'),
    },
    {
      id: 'act-food',
      group: 'Quick Actions',
      label: 'Log Food or Meal',
      icon: 'plus',
      badge: 'Nutrition',
      action: () => navigate('/nutrition'),
    },
  ], [navigate, setCoachOpen, resolvedTheme, toggleTheme]);

  // Filter commands and merge with exercise matches
  const items = useMemo(() => {
    const q = query.toLowerCase().trim();
    const filteredBase = q
      ? baseCommands.filter((c) => c.label.toLowerCase().includes(q) || c.group.toLowerCase().includes(q))
      : baseCommands;

    const exerciseItems = exercises.map((e) => ({
      id: `ex-${e.id}`,
      group: 'Exercises Library',
      label: e.name,
      sublabel: `${e.target_muscle || e.muscle || ''} · ${e.equipment || ''}`,
      icon: 'dumbbell',
      badge: e.category || 'exercise',
      action: () => navigate('/training'),
    }));

    return [...filteredBase, ...exerciseItems];
  }, [baseCommands, exercises, query, navigate]);

  // Reset selected index when items change
  useEffect(() => {
    setSelectedIndex((prev) => (items.length ? Math.min(prev, items.length - 1) : 0));
  }, [items]);

  // Keyboard navigation
  useEffect(() => {
    if (!cmdOpen) return;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => (items.length ? (i + 1) % items.length : 0));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => (items.length ? (i - 1 + items.length) % items.length : 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (items[selectedIndex]) {
          items[selectedIndex].action();
          onClose();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cmdOpen, items, selectedIndex, onClose]);

  // Auto-scroll selected item into view
  useEffect(() => {
    const listEl = listRef.current;
    if (!listEl) return;
    const activeEl = listEl.querySelector(`[data-index="${selectedIndex}"]`);
    if (activeEl) {
      activeEl.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  if (!cmdOpen) return null;

  return (
    <div className="cmd-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label="Command Palette">
      <div className="cmd-modal" onClick={(e) => e.stopPropagation()}>
        <div className="cmd-header">
          <Icon name="search" size={18} className="cmd-search-icon" />
          <input
            ref={inputRef}
            type="text"
            className="cmd-input"
            placeholder="Type a command or search exercises..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <kbd className="cmd-kbd">ESC</kbd>
        </div>

        <div className="cmd-list" ref={listRef} role="listbox">
          {items.length === 0 ? (
            <div className="cmd-empty">No matching commands or exercises found.</div>
          ) : (
            items.map((item, idx) => {
              const isSelected = idx === selectedIndex;
              const isFirstOfGroup = idx === 0 || items[idx - 1].group !== item.group;

              return (
                <React.Fragment key={item.id}>
                  {isFirstOfGroup && (
                    <div className="cmd-group-title">{item.group}</div>
                  )}
                  <div
                    data-index={idx}
                    role="option"
                    aria-selected={isSelected}
                    className={`cmd-item ${isSelected ? 'cmd-item-selected' : ''}`}
                    onClick={() => {
                      item.action();
                      onClose();
                    }}
                    onMouseEnter={() => setSelectedIndex(idx)}
                  >
                    <div className="cmd-item-icon">
                      <Icon name={item.icon} size={15} />
                    </div>
                    <div className="cmd-item-content">
                      <div className="cmd-item-label">{item.label}</div>
                      {item.sublabel && <div className="cmd-item-sublabel">{item.sublabel}</div>}
                    </div>
                    {item.badge && <span className="cmd-badge">{item.badge}</span>}
                  </div>
                </React.Fragment>
              );
            })
          )}
        </div>

        <div className="cmd-footer">
          <span className="row gap-6">
            <kbd className="cmd-key">↑</kbd>
            <kbd className="cmd-key">↓</kbd>
            <span>to navigate</span>
          </span>
          <span className="row gap-6">
            <kbd className="cmd-key">↵</kbd>
            <span>to select</span>
          </span>
          <span className="row gap-6">
            <kbd className="cmd-key">ESC</kbd>
            <span>to close</span>
          </span>
        </div>
      </div>
    </div>
  );
}
