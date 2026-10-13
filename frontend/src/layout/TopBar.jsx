import React, { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import UserMenu from './UserMenu.jsx';
import ScrollProgress from './ScrollProgress.jsx';
import { Icon, Chip } from '../components/ui.jsx';
import { nf } from '../lib/format.js';
import useStore from '../store/useStore.js';
import { useTheme } from '../hooks/useTheme.js';

const LINKS = [
  { to: '/dashboard', label: 'Dashboard', icon: 'grid' },
  { to: '/training', label: 'Training', icon: 'dumbbell' },
  { to: '/nutrition', label: 'Nutrition', icon: 'flame' },
  { to: '/progress', label: 'Progress', icon: 'chart' },
];

/** Slim glass top bar for the logged-in app. NavLink gives us active states
 *  and real URLs (Back button, deep links) for free. */
export default function TopBar() {
  const navigate = useNavigate();
  const { setCmdOpen } = useStore();
  const { resolvedTheme, toggleTheme } = useTheme();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);


  return (
    <>
      <ScrollProgress />
      <a className="skip-link" href="#main">Skip to content</a>
      <nav className={`nav ${scrolled ? 'nav-scrolled' : ''}`} aria-label="Primary">
        <div className="nav-inner">
          <button
            type="button"
            className="brand"
            onClick={() => navigate('/dashboard')}
            aria-label="FitForge dashboard"
            style={{ background: 'transparent', border: 0, cursor: 'pointer', padding: 0 }}
          >
            <span className="brand-mark"><Icon name="dumbbell" size={16} style={{ color: 'var(--ember)' }} /></span>
            FitForge
          </button>

          <div className="nav-links">
            {LINKS.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                className={({ isActive }) => `nav-link ${isActive ? 'nav-link-active' : ''}`}
              >
                <Icon name={l.icon} size={16} className="nav-icon" />
                {l.label}
              </NavLink>
            ))}
          </div>

          <div className="row gap-8 hide-mobile">
            <button
              type="button"
              className="nav-tool-btn"
              onClick={() => setCmdOpen(true)}
              aria-label="Command Palette (Ctrl+K)"
              title="Command Palette (Ctrl+K)"
            >
              <Icon name="search" size={16} />
            </button>
            <button
              type="button"
              className="nav-tool-btn"
              onClick={toggleTheme}
              aria-label={`Toggle theme (currently ${resolvedTheme})`}
              title={`Switch to ${resolvedTheme === 'dark' ? 'light' : 'dark'} mode`}
            >
              <Icon name={resolvedTheme === 'dark' ? 'sun' : 'moon'} size={16} />
            </button>
            <UserMenu />
          </div>

          {/* mobile: quick search + theme + avatar */}
          <div className="row gap-8 show-mobile">
            <button
              type="button"
              className="nav-tool-btn"
              onClick={() => setCmdOpen(true)}
              aria-label="Search"
            >
              <Icon name="search" size={16} />
            </button>
            <button
              type="button"
              className="nav-tool-btn"
              onClick={toggleTheme}
              aria-label="Toggle theme"
            >
              <Icon name={resolvedTheme === 'dark' ? 'sun' : 'moon'} size={16} />
            </button>
            <UserMenu />
          </div>
        </div>
      </nav>
      <style>{`
        @media (min-width: 901px) {
          .nav-link .nav-icon { display: none; }
          .show-mobile { display: none !important; }
          .chip-label { display: none; }
        }
        @media (max-width: 900px) {
          .nav-link { display: flex; align-items: center; gap: 3px; }
          .nav-link .nav-icon { display: block; }
          .hide-mobile { display: none !important; }
        }
        @media (min-width: 1280px) {
          .chip-label { display: inline; font-weight: 560; opacity: .8; }
        }
      `}</style>
    </>
  );
}
