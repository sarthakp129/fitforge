import React from 'react';
import { NavLink } from 'react-router-dom';
import { Icon } from '../components/ui.jsx';

const TABS = [
  { to: '/dashboard', label: 'Dashboard', icon: 'grid' },
  { to: '/training', label: 'Training', icon: 'dumbbell' },
  { to: '/nutrition', label: 'Nutrition', icon: 'flame' },
  { to: '/progress', label: 'Progress', icon: 'chart' },
];

/** Mobile-only glass tab bar. Settings lives in the user menu, per spec.
 *  Safe-area padding keeps it above iOS home indicators. */
export default function BottomNav() {
  return (
    <nav className="bottom-nav" aria-label="Primary mobile">
      {TABS.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          className={({ isActive }) => `bottom-tab ${isActive ? 'bottom-tab-active' : ''}`}
        >
          <Icon name={t.icon} size={19} />
          <span>{t.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
