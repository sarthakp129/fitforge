import React, { useEffect, useRef, useState } from 'react';
import useStore from '../store/useStore.js';
import { Button, Icon, Modal } from './ui.jsx';

/**
 * Google Sign-In button supporting Google Identity Services (GIS).
 * Seamlessly initializes Google's OAuth2 client if configured, and provides
 * authentic popup sign-in, fast simulated testing, and clear configuration instructions.
 */
export default function GoogleSignIn({
  onSuccess,
  onError,
  mode = 'signin',
  text = 'Continue with Google',
  disabled = false,
  block = true,
  size = 'lg',
}) {
  const { authConfig, googleAuth, toast } = useStore();
  const [loading, setLoading] = useState(false);
  const [setupModalOpen, setSetupModalOpen] = useState(false);
  const tokenClientRef = useRef(null);
  const clientId = authConfig?.google_client_id || import.meta.env.VITE_GOOGLE_CLIENT_ID;

  const handleAuthPayload = async (payload) => {
    setLoading(true);
    try {
      if (onSuccess) {
        await onSuccess(payload);
      } else {
        await googleAuth(payload);
      }
      setSetupModalOpen(false);
    } catch (err) {
      if (onError) onError(err);
      else toast(err.message || 'Google sign-in failed.', 'warn', 6000);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!clientId) return;

    let checkInterval = null;

    const setupClients = () => {
      // 1. Initialize GIS ID token client (for One Tap if available)
      if (window.google?.accounts?.id) {
        try {
          window.google.accounts.id.initialize({
            client_id: clientId,
            callback: (res) => {
              if (res?.credential) {
                handleAuthPayload({ credential: res.credential });
              }
            },
            auto_select: false,
            cancel_on_tap_outside: true,
          });
        } catch {
          // Ignore duplicate init
        }
      }

      // 2. Initialize GIS OAuth2 popup token client (triggers on custom button click)
      if (window.google?.accounts?.oauth2) {
        try {
          tokenClientRef.current = window.google.accounts.oauth2.initTokenClient({
            client_id: clientId,
            scope: 'openid email profile',
            callback: (res) => {
              if (res?.access_token) {
                handleAuthPayload({ access_token: res.access_token });
              } else if (res?.error) {
                toast(res.error_description || `Google authorization error: ${res.error}`, 'warn');
              }
            },
            error_callback: (err) => {
              console.warn('Google OAuth popup error:', err);
              if (err?.type === 'popup_closed') {
                toast('Sign-in popup closed.', 'info', 2000);
              } else {
                toast('Could not open Google sign-in window. If blocked, check popups or test account.', 'warn');
              }
            },
          });
        } catch (e) {
          console.warn('OAuth2 token client init notice:', e);
        }
      }
    };

    if (window.google?.accounts) {
      setupClients();
    } else {
      // Poll briefly for GIS script load if loaded via async/defer
      checkInterval = setInterval(() => {
        if (window.google?.accounts) {
          clearInterval(checkInterval);
          setupClients();
        }
      }, 200);

      // Timeout after 4s
      setTimeout(() => clearInterval(checkInterval), 4000);
    }

    return () => {
      if (checkInterval) clearInterval(checkInterval);
    };
  }, [clientId]);

  const handleClick = () => {
    if (!clientId || !authConfig?.google_configured) {
      setSetupModalOpen(true);
      return;
    }

    // A. Use OAuth2 popup client if available
    if (tokenClientRef.current) {
      try {
        tokenClientRef.current.requestAccessToken({ prompt: 'select_account' });
        return;
      } catch (err) {
        console.warn('Token client request error:', err);
      }
    }

    // B. Fallback to GIS prompt with notification handling
    if (window.google?.accounts?.id) {
      try {
        window.google.accounts.id.prompt((notification) => {
          if (notification.isNotDisplayed()) {
            const reason = notification.getNotDisplayedReason();
            console.warn('Google prompt not displayed:', reason);
            toast('Google prompt was suppressed by browser. Click to open setup & test account.', 'info');
            setSetupModalOpen(true);
          }
        });
        return;
      } catch {
        // Fallthrough to setup modal
      }
    }

    // C. Script not loaded yet or blocked
    toast('Google Identity service is loading… Opening test & setup helper.', 'info', 3000);
    setSetupModalOpen(true);
  };

  const handleTestLogin = () => {
    handleAuthPayload({
      credential: 'test-google-token:sub-google-demo:demo.athlete@gmail.com:Google Athlete:valid',
    });
  };

  return (
    <>
      <Button
        type="button"
        variant="soft"
        size={size}
        block={block}
        disabled={disabled || loading}
        loading={loading}
        onClick={handleClick}
        className="google-sign-in-btn"
        aria-label={text}
      >
        <svg className="google-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
          <path
            fill="#4285F4"
            d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.8-2.4 3.65v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.14z"
          />
          <path
            fill="#34A853"
            d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.35 24 12 24z"
          />
          <path
            fill="#FBBC05"
            d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.16 0 9.97 0 12s.45 3.84 1.25 5.42l4.03-3.15z"
          />
          <path
            fill="#EA4335"
            d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.35 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
          />
        </svg>
        <span>{text}</span>
      </Button>

      {setupModalOpen && (
        <Modal
          open={setupModalOpen}
          onClose={() => setSetupModalOpen(false)}
          title="Google Sign-In"
          subtitle="Real Google OAuth requires a Google Client ID authorized for localhost."
          footer={
            <div className="row gap-8" style={{ width: '100%', justifyContent: 'space-between' }}>
              <Button variant="ghost" onClick={() => setSetupModalOpen(false)}>
                Close
              </Button>
              <Button variant="ember" onClick={handleTestLogin} loading={loading}>
                <Icon name="bolt" size={15} /> Continue as Test Google Athlete
              </Button>
            </div>
          }
        >
          <div className="stack gap-16 small">
            <div style={{ padding: '14px 16px', background: 'var(--surface-2)', borderRadius: 'var(--radius)' }}>
              <div className="strong" style={{ marginBottom: 4 }}>Fast 1-Click Simulated Testing</div>
              <p className="muted" style={{ marginBottom: 12 }}>
                Instantly test the full Google Sign-In, onboarding, and dashboard experience:
              </p>
              <Button variant="soft" size="md" onClick={handleTestLogin} loading={loading} block>
                <Icon name="play" size={15} /> Test with Simulated Google Account
              </Button>
            </div>

            <div className="stack gap-8">
              <span className="strong">Configuring Real Google (Gmail) OAuth:</span>
              <ol className="stack gap-6 muted" style={{ paddingLeft: 20 }}>
                <li>Open <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer" style={{ color: 'var(--ember)', textDecoration: 'underline' }}>Google Cloud Console → Credentials</a>.</li>
                <li>Edit your <b>OAuth 2.0 Client ID</b> (Web application).</li>
                <li>Under <b>Authorized JavaScript origins</b>, make sure you have:
                  <div style={{ marginTop: 4, fontFamily: 'monospace', background: 'var(--surface-2)', padding: '6px 10px', borderRadius: 6 }}>
                    http://localhost:5173<br />
                    http://localhost:8081<br />
                    http://localhost:8080
                  </div>
                </li>
                <li>Set your Client ID in <code>backend/.env</code>:
                  <div style={{ marginTop: 4, fontFamily: 'monospace', background: 'var(--surface-2)', padding: '6px 10px', borderRadius: 6 }}>
                    GOOGLE_CLIENT_ID={clientId || 'your-client-id.apps.googleusercontent.com'}
                  </div>
                </li>
              </ol>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
