import React, { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import TopBar from './TopBar.jsx';
import BottomNav from './BottomNav.jsx';
import CoachDrawer from '../components/CoachDrawer.jsx';
import CommandPalette from '../components/CommandPalette.jsx';
import { TITLES } from '../lib/titles.js';

/**
 * Chrome for every logged-in page: top bar, bottom tabs, <main> landmark,
 * per-route document.title, and scroll restoration semantics:
 *  - PUSH/REPLACE (clicking a link) scrolls to top,
 *  - POP (browser Back) leaves the scroll position alone so Back feels like
 *    going back, not starting over.
 */
export default function AppLayout() {
  const { pathname } = useLocation();

  useEffect(() => {
    document.title = TITLES[pathname] || 'FitForge';
  }, [pathname]);

  return (
    <>
      <TopBar />
      {/* nested routes (the pages) render here */}
      <main id="main"><Outlet /></main>
      <BottomNav />
      <CoachDrawer />
      <CommandPalette />
    </>
  );
}
