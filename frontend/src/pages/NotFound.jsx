import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Button, Icon } from '../components/ui.jsx';

/** Friendly dead end: explains, then offers the three most likely exits. */
export default function NotFound() {
  useEffect(() => { document.title = 'Page not found · FitForge'; }, []);
  return (
    <div className="shell" style={{ paddingTop: 'calc(var(--nav-h) + 80px)', minHeight: '80vh' }}>
      <div className="wrap-narrow center stack gap-16" style={{ alignItems: 'center' }}>
        <div className="mono" style={{ fontSize: '4rem', fontWeight: 720, color: 'var(--ember)', letterSpacing: '-0.04em' }}>404</div>
        <h1 style={{ fontSize: 'clamp(1.6rem,4vw,2.4rem)' }}>This page skipped training.</h1>
        <p className="muted small" style={{ maxWidth: '46ch' }}>
          The address doesn’t match anything in FitForge. It may have moved, or the link
          was typed by someone mid-set.
        </p>
        <div className="row gap-10" style={{ flexWrap: 'wrap', justifyContent: 'center' }}>
          <Link to="/"><Button variant="ember"><Icon name="grid" size={15} /> Go home</Button></Link>
          <Link to="/features"><Button variant="ghost">See features</Button></Link>
          <Button variant="ghost" onClick={() => window.history.back()}>Go back</Button>
        </div>
      </div>
    </div>
  );
}
