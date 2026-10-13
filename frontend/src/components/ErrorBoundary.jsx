import React from 'react';
import { Button, Card, Icon } from './ui.jsx';

/**
 * A crash in one view must not blank the whole app. This boundary keeps the nav,
 * the 3D layer and every other tab usable, and offers a reload of just that view.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[fitforge] view crashed:', error, info?.componentStack?.split('\n')[1] || '');
  }

  componentDidUpdate(prev) {
    // recover automatically when the user navigates to another view
    if (prev.view !== this.props.view && this.state.error) this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="shell" style={{ paddingTop: 'calc(var(--nav-h) + 40px)' }}>
        <div className="wrap-narrow">
          <Card solid className="card-pad-lg stack gap-12">
            <div className="row gap-10">
              <span className="brand-mark" style={{ background: 'var(--ember-soft)', color: 'var(--ember)' }}>
                <Icon name="bolt" size={17} />
              </span>
              <div>
                <h2 style={{ fontSize: '1.3rem' }}>This view hit an error</h2>
                <p className="small muted" style={{ marginTop: 4 }}>
                  The rest of FitForge is still working. Your logged data is safe — it is stored on the server.
                </p>
              </div>
            </div>
            <pre
              className="mono tiny"
              style={{
                background: 'var(--surface-2)', padding: 12, borderRadius: 12, overflowX: 'auto',
                whiteSpace: 'pre-wrap', color: 'var(--muted)', margin: 0,
              }}
            >
              {String(error?.message || error)}
            </pre>
            <div className="row gap-10" style={{ flexWrap: 'wrap' }}>
              <Button variant="ember" onClick={() => this.setState({ error: null })}>
                <Icon name="refresh" size={15} /> Retry this view
              </Button>
              <Button variant="ghost" onClick={() => window.location.reload()}>Reload FitForge</Button>
            </div>
          </Card>
        </div>
      </div>
    );
  }
}
