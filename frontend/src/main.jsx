import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import './styles/tokens.css';
import './styles/global.css';
import './styles/scroll.css';

try {
  localStorage.removeItem('ff-theme');
  document.documentElement.removeAttribute('data-theme');
} catch {}

const root = document.getElementById('root');

createRoot(root).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);

// A crash should never leave a blank white screen with no explanation.
window.addEventListener('error', (e) => {
  if (root.childElementCount === 0) {
    root.innerHTML =
      '<div style="font-family:system-ui;padding:40px;max-width:640px;margin:auto;color:var(--text,#0b1220)">' +
      '<h1 style="font-size:1.4rem">FitForge hit an error</h1>' +
      '<p style="color:var(--muted,#64748b);margin-top:8px">' + (e.message || 'Unknown error') + '</p>' +
      '<button onclick="location.reload()" style="margin-top:16px;padding:10px 18px;border-radius:999px;border:0;background:var(--ember,#e85d04);color:#fff;cursor:pointer;font-weight:600">Reload</button>' +
      '</div>';
  }
});
