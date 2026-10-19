import React, { useEffect, useRef, useState } from 'react';
import { nf, pct } from '../lib/format.js';

export const Card = ({ children, className = '', solid = false, pad = '', hover = false, ...rest }) => (
  <div className={`card ${solid ? 'card-solid' : ''} ${pad} ${hover ? 'card-hover' : ''} ${className}`} {...rest}>
    {children}
  </div>
);

export const CardHead = ({ title, subtitle, right, eyebrow }) => (
  <div className="card-head">
    <div className="flex-1">
      {eyebrow && <div className="eyebrow" style={{ marginBottom: 4 }}>{eyebrow}</div>}
      {title && <div className="card-title">{title}</div>}
      {subtitle && <div className="small muted" style={{ marginTop: 3 }}>{subtitle}</div>}
    </div>
    {right}
  </div>
);

export const Button = ({
  children, variant = 'primary', size = '', block = false, loading = false, icon, disabled, className = '', ...rest
}) => {
  const cls = {
    primary: 'btn', ember: 'btn btn-ember', ghost: 'btn btn-ghost',
    soft: 'btn btn-soft', danger: 'btn btn-danger', icon: 'btn btn-ghost btn-icon',
  }[variant] || 'btn';
  const fullClass = [cls, size ? `btn-${size}` : '', block ? 'btn-block' : '', className].filter(Boolean).join(' ');
  return (
    <button
      className={fullClass}
      disabled={disabled || loading}
      aria-busy={loading ? 'true' : undefined}
      {...rest}
    >
      {loading && <Spinner />}
      {!loading && icon}
      {children}
    </button>
  );
};

export const Spinner = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ animation: 'spin 0.9s linear infinite' }}>
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" fill="none" />
    <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" />
    <style>{'@keyframes spin{to{transform:rotate(360deg)}}'}</style>
  </svg>
);

export const Chip = ({ children, tone = '', active = false, onClick, className = '', ...rest }) => (
  <span
    role={onClick ? 'button' : undefined}
    tabIndex={onClick ? 0 : undefined}
    aria-pressed={onClick ? active : undefined}
    onKeyDown={onClick ? (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onClick(e);
      }
    } : undefined}
    className={`chip ${tone ? `chip-${tone}` : ''} ${active ? 'chip-active' : ''} ${onClick ? 'chip-btn' : ''} ${className}`}
    onClick={onClick}
    {...rest}
  >
    {children}
  </span>
);

export const Field = ({ label, hint, children, className = '' }) => (
  <label className={`field ${className}`}>
    {label && <span className="label">{label}</span>}
    {children}
    {hint && <span className="hint">{hint}</span>}
  </label>
);

export const Input = ({ className = '', ...rest }) => <input className={`input ${className}`} {...rest} />;

export const Select = ({ className = '', children, ...rest }) => (
  <select className={`select ${className}`} {...rest}>{children}</select>
);

export const Textarea = ({ className = '', ...rest }) => <textarea className={`textarea ${className}`} {...rest} />;

export const Segmented = ({ options, value, onChange, size = '' }) => (
  <div className="tab-bar" role="tablist">
    {options.map((o) => (
      <button
        key={o.value}
        role="tab"
        aria-selected={value === o.value}
        className={`tab ${value === o.value ? 'tab-active' : ''}`}
        onClick={() => onChange(o.value)}
        style={size === 'sm' ? { padding: '5px 11px', fontSize: '0.8rem' } : undefined}
      >
        {o.label}
      </button>
    ))}
  </div>
);

export const Stat = ({ label, value, unit, sub, tone = '', icon, children }) => (
  <Card hover className="stack gap-8" style={{ padding: 18 }}>
    <div className="row-between">
      <span className="eyebrow">{label}</span>
      {icon}
    </div>
    <div className="row gap-6" style={{ alignItems: 'baseline' }}>
      <span className="num-hero" style={tone === 'ember' ? { color: 'var(--ember)' } : tone === 'teal' ? { color: 'var(--teal)' } : tone === 'ok' ? { color: 'var(--ok)' } : undefined}>
        {value}
      </span>
      {unit && <span className="small muted strong">{unit}</span>}
    </div>
    {sub && <div className="tiny muted">{sub}</div>}
    {children}
  </Card>
);

export const Bar = ({ value, max, tone = 'ember', height = 8, label }) => {
  const width = Math.max(0, Math.min(100, pct(value, max)));
  return (
    <div className="stack gap-6">
      {label && <div className="row-between tiny"><span className="muted">{label}</span><span className="mono strong">{nf(value)} / {nf(max)}</span></div>}
      <div
        className="bar"
        style={{ height }}
        role="progressbar"
        aria-valuenow={Math.round(value || 0)}
        aria-valuemin={0}
        aria-valuemax={Math.round(max || 100)}
        aria-label={label || 'Progress'}
      >
        <div className={`bar-fill bar-${tone}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
};

/**
 * One progress ring with a roomy centre hole for the value label.
 * (Four concentric rings looked clever but squeezed the number into the
 * innermost track — a single ring plus macro bars reads better and stays
 * legible at 360 px.)
 *
 * @param {object} p
 * @param {number} p.value current value
 * @param {number} p.max target value
 * @param {number} [p.size] outer diameter in px
 * @param {number} [p.thickness] stroke width in px
 * @param {string} [p.color] any CSS colour, typically a --macro-* token
 * @param {React.ReactNode} [p.center] label rendered in the hole
 */
export const SingleRing = ({ value, max, size = 168, thickness = 12, color = 'var(--macro-calories)', center }) => {
  const r = size / 2 - thickness / 2;
  const c = 2 * Math.PI * r;
  const ratio = Math.max(0, Math.min(1, max ? value / max : 0));
  return (
    <div className="ring-wrap" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img"
        aria-label={`${Math.round(ratio * 100)} percent of target`}>
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" className="ring-track" strokeWidth={thickness} />
          <circle
            cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={thickness} strokeLinecap="round"
            strokeDasharray={c} strokeDashoffset={c * (1 - ratio)} style={{ stroke: color, transition: 'stroke-dashoffset .9s cubic-bezier(.22,1,.36,1)' }}
          />
        </g>
      </svg>
      {center && <div className="ring-center">{center}</div>}
    </div>
  );
};

export const Modal = ({ open, onClose, title, subtitle, children, wide = false, footer }) => {
  const modalRef = useRef(null);
  const prevFocusRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    prevFocusRef.current = document.activeElement;
    const modalEl = modalRef.current;
    if (modalEl) {
      const auto = modalEl.querySelector('[autofocus]');
      if (auto) {
        auto.focus();
      } else {
        const firstInput = modalEl.querySelector('input:not([type="hidden"]), select, textarea');
        if (firstInput) {
          firstInput.focus();
        } else {
          const focusable = modalEl.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
          if (focusable.length > 0) focusable[0].focus();
        }
      }
    }
    const onKey = (e) => {
      if (e.key === 'Escape') {
        onClose?.();
      } else if (e.key === 'Tab' && modalRef.current) {
        const focusable = modalRef.current.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      if (prevFocusRef.current?.focus) prevFocusRef.current.focus();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        ref={modalRef}
        className={`modal ${wide ? 'modal-wide' : ''}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="row-between" style={{ marginBottom: 18 }}>
          <div>
            {title && <h3>{title}</h3>}
            {subtitle && <div className="small muted" style={{ marginTop: 4 }}>{subtitle}</div>}
          </div>
          <Button variant="icon" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </Button>
        </div>
        {children}
        {footer && <div className="row gap-10" style={{ marginTop: 22, justifyContent: 'flex-end' }}>{footer}</div>}
      </div>
    </div>
  );
};

export const Empty = ({ icon = 'spark', title, children, action }) => (
  <div className="empty stack gap-8" style={{ alignItems: 'center' }}>
    <div className="empty-icon">
      {typeof icon === 'string' && PATHS[icon] ? <Icon name={icon} size={28} /> : icon}
    </div>
    {title && <div className="strong">{title}</div>}
    {children && <div className="small muted" style={{ maxWidth: '46ch' }}>{children}</div>}
    {action}
  </div>
);

export const Skeleton = ({ h = 16, w = '100%', r = 8 }) => (
  <div className="skeleton" style={{ height: h, width: w, borderRadius: r }} />
);

export const Toaster = ({ toasts, onDismiss }) => (
  <div className="toasts" role="status" aria-live="polite">
    {toasts.map((t) => (
      <div
        key={t.id}
        role="button"
        tabIndex={0}
        aria-label={`Notification: ${t.message}. Click to dismiss.`}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onDismiss(t.id); } }}
        className={`toast ${t.kind === 'ok' ? 'toast-ok' : t.kind === 'err' ? 'toast-err' : t.kind === 'warn' ? 'toast-warn' : ''}`}
        onClick={() => onDismiss(t.id)}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', opacity: 0.9 }}>
          {t.kind === 'ok' ? <Icon name="check" size={15} /> : t.kind === 'err' ? <Icon name="close" size={15} /> : t.kind === 'warn' ? <Icon name="bolt" size={15} /> : <Icon name="info" size={15} />}
        </span>
        <span className="flex-1">{t.message}</span>
      </div>
    ))}
  </div>
);

/** Scroll-reveal wrapper. */
export const Reveal = ({ children, delay = 0, className = '', as: Tag = 'div' }) => {
  const ref = useRef(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    if (typeof IntersectionObserver === 'undefined') { setShown(true); return undefined; }
    const io = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setShown(true); io.disconnect(); } },
      { threshold: 0.08, rootMargin: '0px 0px -40px 0px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <Tag ref={ref} className={`reveal ${shown ? 'reveal-in' : ''} ${className}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </Tag>
  );
};

/* --------------------------------- icons -------------------------------- */

const PATHS = {
  dumbbell: 'M6.5 6.5v11M3.5 9v6M17.5 6.5v11M20.5 9v6M6.5 12h11',
  flame: 'M12 3s4.5 4 4.5 8a4.5 4.5 0 1 1-9 0c0-1.6.8-3 .8-3S6 10.5 6 13a6 6 0 0 0 12 0c0-5-6-10-6-10z',
  chart: 'M4 19V9M10 19V5M16 19v-7M22 19H2',
  spark: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  close: 'M18 6 6 18M6 6l12 12',
  plus: 'M12 5v14M5 12h14',
  check: 'M20 6 9 17l-5-5',
  bolt: 'M13 2 3 14h8l-1 8 10-12h-8l1-8z',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  arrowRight: 'M5 12h14M13 6l6 6-6 6',
  download: 'M12 3v12M7 11l5 5 5-5M4 21h16',
  refresh: 'M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6',
  settings: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-3-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.3 7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 2.9-1.2V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.2a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.6 1z',
  trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  play: 'M7 4l12 8-12 8V4z',
  pause: 'M8 4h3v16H8zM13 4h3v16h-3z',
  send: 'M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z',
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  chev: 'M6 9l6 6 6-6',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  eyeoff: 'M17.9 17.9A10.7 10.7 0 0 1 12 19C5.5 19 2 12 2 12a18.6 18.6 0 0 1 5.1-5.9M9.9 4.2A10.6 10.6 0 0 1 12 5c6.5 0 10 7 10 7a18.7 18.7 0 0 1-2.2 3.2M14.1 14.1a3 3 0 1 1-4.2-4.2M3 3l18 18',
  mic: 'M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3zM19 11v1a7 7 0 0 1-14 0v-1M12 19v3M9 22h6',
  upload: 'M12 16V4M6 10l6-6 6 6M4 20h16',
  speaker: 'M11 5 6 9H2v6h4l5 4V5zM15.5 8.5a5 5 0 0 1 0 7M18.4 5.6a9 9 0 0 1 0 12.8',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35',
  star: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z',
  copy: 'M8 4v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7.2a2 2 0 0 0-.6-1.4L16.1 2.6A2 2 0 0 0 14.7 2H10a2 2 0 0 0-2 2zM16 18v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h2',
  info: 'M12 16v-4M12 8h.01M22 12A10 10 0 1 1 2 12a10 10 0 0 1 20 0z',
  filter: 'M22 3H2l8 9.46V19l4 2v-8.54L22 3z',
  droplet: 'M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z',
  leaf: 'M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12',
};

export const Icon = ({ name, size = 18, strokeWidth = 1.9, style, ...rest }) => {
  const d = PATHS[name];
  if (!d) return null;
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
      style={{ flex: 'none', ...style }} aria-hidden="true" {...rest}
    >
      <path d={d} />
    </svg>
  );
};
