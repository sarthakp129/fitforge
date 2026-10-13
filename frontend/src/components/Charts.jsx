import React, { useId, useMemo, useState } from 'react';
import { nf, compact, fmtDate } from '../lib/format.js';

/* ------------------------------- line chart ------------------------------ */

/**
 * Responsive SVG line/area chart. Uses preserveAspectRatio="none" with
 * non-scaling strokes so it fills any container without distorting lines;
 * axis labels are rendered as HTML so text is never stretched.
 */
export function LineChart({
  data, height = 190, color = 'var(--ember)', unit = '', yDigits = 0,
  valueKey = 'value', labelKey = 'label', area = true, targetLine = null, emptyLabel = 'No data yet',
}) {
  const gid = useId().replace(/:/g, '');
  const [hover, setHover] = useState(null);

  const pts = (data || [])
    .map((d, i) => ({ i, x: d[labelKey], y: Number(d[valueKey]) || 0, raw: d }))
    .filter((p) => Number.isFinite(p.y));

  const { path, areaPath, min, max, coords } = useMemo(() => {
    if (pts.length < 2) return { path: '', areaPath: '', min: 0, max: 1, coords: [] };
    const ys = pts.map((p) => p.y);
    let lo = Math.min(...ys);
    let hi = Math.max(...ys);
    if (targetLine != null) { lo = Math.min(lo, targetLine); hi = Math.max(hi, targetLine); }
    const pad = (hi - lo) * 0.18 || Math.max(1, hi * 0.1);
    lo -= pad; hi += pad;
    const W = 600;
    const H = height;
    const coords = pts.map((p, idx) => ({
      ...p,
      cx: (idx / (pts.length - 1)) * W,
      cy: H - ((p.y - lo) / (hi - lo || 1)) * H,
    }));
    // monotone-ish smoothing via midpoints keeps it clean without overshooting
    let d = `M ${coords[0].cx} ${coords[0].cy}`;
    for (let i = 1; i < coords.length; i++) {
      const prev = coords[i - 1];
      const cur = coords[i];
      const mx = (prev.cx + cur.cx) / 2;
      d += ` C ${mx} ${prev.cy}, ${mx} ${cur.cy}, ${cur.cx} ${cur.cy}`;
    }
    return { path: d, areaPath: `${d} L ${W} ${H} L 0 ${H} Z`, min: lo, max: hi, coords };
  }, [pts, height, targetLine]);

  if (pts.length < 2) {
    return <div className="empty small" style={{ height }}>{emptyLabel}</div>;
  }

  const active = hover != null ? coords[hover] : null;
  const targetY = targetLine != null && coords.length
    ? height - ((targetLine - min) / (max - min || 1)) * height
    : null;

  return (
    <div className="stack gap-8">
      <div style={{ position: 'relative' }}>
        <svg
          width="100%" height={height} viewBox={`0 0 600 ${height}`}
          preserveAspectRatio="none" style={{ display: 'block', overflow: 'visible' }}
          onPointerMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = (e.clientX - rect.left) / rect.width;
            setHover(Math.max(0, Math.min(coords.length - 1, Math.round(ratio * (coords.length - 1)))));
          }}
          onPointerLeave={() => setHover(null)}
        >
          <defs>
            <linearGradient id={`g-${gid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.26" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0.25, 0.5, 0.75].map((f) => (
            <line key={f} x1="0" x2="600" y1={height * f} y2={height * f}
              stroke="rgba(11,18,32,0.06)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          ))}
          {targetY != null && (
            <line x1="0" x2="600" y1={targetY} y2={targetY} stroke="rgba(14,165,164,0.55)"
              strokeWidth="1.5" strokeDasharray="5 5" vectorEffect="non-scaling-stroke" />
          )}
          {area && <path d={areaPath} fill={`url(#g-${gid})`} />}
          <path d={path} fill="none" strokeWidth="2.4" strokeLinecap="round"
            strokeLinejoin="round" vectorEffect="non-scaling-stroke" style={{ stroke: color }} />
          {active && (
            <>
              <line x1={active.cx} x2={active.cx} y1="0" y2={height} stroke="rgba(11,18,32,0.16)"
                strokeWidth="1" vectorEffect="non-scaling-stroke" />
              <circle cx={active.cx} cy={active.cy} r="5.5" strokeWidth="2.6"
                vectorEffect="non-scaling-stroke" style={{ stroke: color, fill: 'var(--solid)' }} />
            </>
          )}
        </svg>
        {active && (
          <div
            className="card card-solid"
            style={{
              position: 'absolute', top: 6, padding: '7px 11px', pointerEvents: 'none',
              left: `clamp(0px, ${(active.cx / 600) * 100}% - 56px, calc(100% - 124px))`,
              boxShadow: 'var(--shadow-sm)', borderRadius: 12, fontSize: '0.78rem', whiteSpace: 'nowrap',
            }}
          >
            <div className="strong mono">{nf(active.y, yDigits)}{unit && <span className="muted"> {unit}</span>}</div>
            <div className="muted tiny">{active.raw.date ? fmtDate(active.raw.date) : active.x}</div>
          </div>
        )}
      </div>
      <div className="row-between tiny muted mono">
        <span>{pts[0].raw.date ? fmtDate(pts[0].raw.date) : pts[0].x}</span>
        <span style={{ color: 'var(--muted-2)' }}>
          peak {compact(max)} · low {compact(min)}
        </span>
        <span>{pts[pts.length - 1].raw.date ? fmtDate(pts[pts.length - 1].raw.date) : pts[pts.length - 1].x}</span>
      </div>
    </div>
  );
}

/* -------------------------------- bar chart ------------------------------ */

export function BarChart({ data, height = 170, color = 'var(--teal)', valueKey = 'value', labelKey = 'label', unit = '' }) {
  const rows = (data || []).map((d) => ({ label: d[labelKey], value: Number(d[valueKey]) || 0, raw: d }));
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <div className="empty small" style={{ height }}>No data yet</div>;
  return (
    <div className="stack gap-8">
      <div className="row gap-6" style={{ alignItems: 'flex-end', height, gap: 6 }}>
        {rows.map((r, i) => (
          <div key={i} className="flex-1 stack gap-6" style={{ alignItems: 'center', height: '100%', justifyContent: 'flex-end' }} title={`${r.label}: ${nf(r.value)}${unit}`}>
            <div className="tiny mono muted" style={{ fontSize: '0.66rem' }}>{r.value ? compact(r.value) : ''}</div>
            <div
              style={{
                width: '100%', maxWidth: 46, borderRadius: '7px 7px 3px 3px',
                height: `${Math.max(2, (r.value / max) * (height - 34))}px`,
                background: `linear-gradient(180deg, color-mix(in srgb, ${color} 70%, white), ${color})`,
                transition: 'height 0.7s cubic-bezier(.22,1,.36,1)',
              }}
            />
          </div>
        ))}
      </div>
      <div className="row gap-6 tiny muted">
        {rows.map((r, i) => (
          <span key={i} className="flex-1 center" style={{ fontSize: '0.66rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {r.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/* --------------------------------- heatmap ------------------------------- */

export function Heatmap({ cells, weeks = 26 }) {
  const level = (c) => {
    if (c.sessions >= 2) return 4;
    if (c.sessions === 1) return c.minutes > 45 ? 3 : 2;
    if (c.meals_logged >= 3) return 1;
    return 0;
  };
  const sliced = (cells || []).slice(-weeks * 7);
  return (
    <div className="stack gap-8">
      <div className="heat" style={{ gridTemplateColumns: `repeat(${Math.ceil(sliced.length / 7)}, minmax(0,1fr))` }}>
        {sliced.map((c) => {
          const l = level(c);
          return (
            <div
              key={c.date}
              className={`heat-cell ${l ? `heat-${l}` : ''}`}
              title={`${fmtDate(c.date)} — ${c.sessions} session(s), ${c.minutes} min, ${c.meals_logged} food log(s)`}
            />
          );
        })}
      </div>
      <div className="row gap-8 tiny muted" style={{ justifyContent: 'flex-end' }}>
        <span>Less</span>
        {[0, 1, 2, 3, 4].map((l) => <div key={l} className={`heat-cell ${l ? `heat-${l}` : ''}`} style={{ width: 11, aspectRatio: '1' }} />)}
        <span>More</span>
      </div>
    </div>
  );
}

/* ------------------------------- muscle bars ----------------------------- */

export function MuscleBars({ muscles = [], max = 8 }) {
  if (!muscles.length) return <div className="empty small">Log a few sessions to see muscle-group volume.</div>;
  return (
    <div className="stack gap-10">
      {muscles.slice(0, max).map((m) => (
        <div key={m.muscle} className="stack gap-4">
          <div className="row-between tiny">
            <span className="strong" style={{ textTransform: 'capitalize' }}>{m.muscle}</span>
            <span className="mono muted">{compact(m.volume_kg)} kg · {m.sets} sets</span>
          </div>
          <div className="bar" style={{ height: 7 }}>
            <div className="bar-fill bar-violet" style={{ width: `${Math.max(3, m.pct)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------ budget gauge ----------------------------- */

export function BudgetGauge({ budget, size = 132 }) {
  if (!budget) return null;
  const ratio = budget.tokensPerMinute ? budget.tokensUsedThisMinute / budget.tokensPerMinute : 0;
  const color = ratio > 0.85 ? 'var(--rose)' : ratio > 0.6 ? 'var(--amber)' : 'var(--teal)';
  const C = 2 * Math.PI * 52;
  return (
    <div className="ring-wrap" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 132 132">
        <g transform="rotate(-90 66 66)">
          <circle cx="66" cy="66" r="52" fill="none" className="ring-track" strokeWidth="11" />
          <circle
            cx="66" cy="66" r="52" fill="none" strokeWidth="11" strokeLinecap="round"
            strokeDasharray={C} strokeDashoffset={C * (1 - Math.min(1, ratio))}
            style={{ stroke: color, transition: 'stroke-dashoffset 0.6s cubic-bezier(.22,1,.36,1), stroke 0.4s' }}
          />
        </g>
      </svg>
      <div className="ring-center">
        <div className="ring-value mono">{nf(budget.tokensRemaining)}</div>
        <div className="ring-label">tokens left</div>
      </div>
    </div>
  );
}

/* --------------------------------- sparkline ----------------------------- */

export function Sparkline({ values = [], color = 'var(--ember)', width = 92, height = 28 }) {
  const nums = values.filter((v) => Number.isFinite(Number(v))).map(Number);
  if (nums.length < 2) return <svg width={width} height={height} />;
  const lo = Math.min(...nums);
  const hi = Math.max(...nums);
  const pts = nums.map((v, i) => {
    const x = (i / (nums.length - 1)) * width;
    const y = height - ((v - lo) / (hi - lo || 1)) * (height - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg width={width} height={height} style={{ display: 'block', overflow: 'visible' }}>
      <polyline points={pts.join(' ')} fill="none" strokeWidth="1.8"
        strokeLinecap="round" strokeLinejoin="round" style={{ stroke: color }} />
    </svg>
  );
}
