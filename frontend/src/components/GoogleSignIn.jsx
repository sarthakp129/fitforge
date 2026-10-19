import React, { useEffect, useRef, useState } from 'react';
import useStore from '../store/useStore.js';
import { Button, Icon } from './ui.jsx';

/**
 * Google Sign-In button supporting Google Identity Services (GIS).
 * Seamlessly initializes Google's client if configured, and falls back
 * cleanly with user-friendly guidance when Google credentials are not yet set.
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
  const buttonRef = useRef(null);
  const clientId = authConfig?.google_client_id || import.meta.env.VITE_GOOGLE_CLIENT_ID;

  const handleCredentialResponse = async (response) => {
    if (!response?.credential) return;
    setLoading(true);
    try {
      if (onSuccess) {
        await onSuccess(response.credential);
      } else {
        await googleAuth(response.credential);
      }
    } catch (err) {
      if (onError) onError(err);
      else toast(err.message || 'Google sign-in failed.', 'warn', 5000);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!clientId) return;

    // Load GIS script if not already on page
    if (!window.google?.accounts?.id) {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.onload = () => initGis();
      document.body.appendChild(script);
    } else {
      initGis();
    }

    function initGis() {
      try {
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: handleCredentialResponse,
          auto_select: false,
          cancel_on_tap_outside: true,
        });
      } catch (e) {
        // Ignored if already initialized or restricted
      }
    }
  }, [clientId]);

  const handleClick = () => {
    if (!clientId || !authConfig?.google_configured) {
      toast('Google Sign-In is not configured. Set GOOGLE_CLIENT_ID in your backend .env.', 'warn', 4500);
      return;
    }

    if (window.google?.accounts?.id) {
      try {
        window.google.accounts.id.prompt();
      } catch {
        toast('Google prompt could not open. Please check browser popups.', 'warn');
      }
    } else {
      toast('Connecting to Google services…', 'info', 2000);
    }
  };

  return (
    <Button
      type="button"
      variant="soft"
      size={size}
      block={block}
      disabled={disabled || loading}
      loading={loading}
      onClick={handleClick}
      className="google-sign-in-btn"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        fontWeight: 600,
      }}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
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
  );
}
