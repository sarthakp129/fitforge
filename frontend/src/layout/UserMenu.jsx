import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useStore from '../store/useStore.js';
import { Icon } from '../components/ui.jsx';

/**
 * Avatar menu: identity + theme + settings + sign out.
 * Closes on Escape and on click outside; returns focus to the trigger button
 * so keyboard users end up where they started.
 */
export default function UserMenu() {
  const { user, logout } = useStore();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const btnRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setOpen(false);
        btnRef.current?.focus();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const items = wrapRef.current?.querySelectorAll('[role="menuitem"]');
        if (!items || !items.length) return;
        e.preventDefault();
        const currentIndex = Array.from(items).indexOf(document.activeElement);
        if (currentIndex === -1) {
          items[0]?.focus();
        } else if (e.key === 'ArrowDown') {
          const nextIndex = (currentIndex + 1) % items.length;
          items[nextIndex]?.focus();
        } else {
          const prevIndex = (currentIndex - 1 + items.length) % items.length;
          items[prevIndex]?.focus();
        }
      }
    };
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [open]);

  const initial = (user?.name || 'A').trim().charAt(0).toUpperCase();

  const item = (label, icon, onClick) => (
    <button
      type="button"
      role="menuitem"
      className="menu-item"
      onClick={() => { setOpen(false); onClick(); }}
    >
      <Icon name={icon} size={15} /> {label}
    </button>
  );

  return (
    <div className="user-menu" ref={wrapRef}>
      <button
        type="button"
        ref={btnRef}
        className="avatar"
        aria-label="User menu"
        title={`User menu for ${user?.name || 'account'}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span aria-hidden="true">{initial}</span>
      </button>
      {open && (
        <div className="menu-pop card" role="menu" aria-label="User menu">
          <div className="menu-head">
            <div className="strong" style={{ fontSize: '0.92rem' }}>{user?.name}</div>
            <div className="tiny muted wrap-text">{user?.email}</div>
          </div>
          <div className="divider" role="separator" style={{ margin: '10px 0' }} />
          {item('Settings', 'settings', () => navigate('/settings'))}
          {item('Sign out', 'close', () => { logout(); navigate('/'); })}
        </div>
      )}
    </div>
  );
}
