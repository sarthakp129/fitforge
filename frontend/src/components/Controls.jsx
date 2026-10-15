import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon, Input } from './ui.jsx';

/**
 * Labelled range slider with a live value chip.
 * Fast, typo-proof entry for body stats and session settings; the paired
 * number is always visible so the value is never a guess.
 *
 * @param {object} p
 * @param {string} p.label visible label
 * @param {number} p.value current value
 * @param {(n:number)=>void} p.onChange
 * @param {number} p.min @param {number} p.max @param {number} [p.step]
 * @param {string} [p.unit] suffix shown in the chip (kg, cm, min…)
 * @param {string} [p.hint] helper line under the slider
 */
export function SliderField({ label, value, onChange, min, max, step = 1, unit = '', hint }) {
  return (
    <div className="field slider-row">
      <div className="row-between">
        <span className="label">{label}</span>
        <span className="chip mono">{value}{unit}</span>
      </div>
      <input
        type="range"
        className="slider"
        min={min}
        max={max}
        step={step}
        value={value ?? min}
        aria-label={label}
        aria-valuetext={`${value}${unit}`}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <div className="row-between tiny muted" aria-hidden="true">
        <span>{min}{unit}</span>
        {hint ? <span>{hint}</span> : <span />}
        <span>{max}{unit}</span>
      </div>
    </div>
  );
}

const ITEM_H = 36;      // must match .wheel-item height in global.css
const VISIBLE = 5;      // rows shown; the middle one is the value

const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/**
 * iOS-style scrolling number wheel.
 *
 * Implementation notes (the parts that are easy to get wrong):
 *  - every row is a FULL-WIDTH button, otherwise the column collapses to the
 *    widest label and the highlight pill lands next to the numbers;
 *  - the initial scroll position is set in useIsomorphicLayoutEffect with a guard so
 *    the programmatic scroll cannot feed back through onScroll and move the
 *    value before the user touches anything;
 *  - commits are debounced ~120 ms so flicking the wheel settles first;
 *  - clicking any row smooth-scrolls it to the middle and commits it.
 *
 * @param {object} p
 * @param {number} p.value @param {number} p.min @param {number} p.max
 * @param {(n:number)=>void} p.onChange @param {string} [p.unit]
 */
export function WheelPicker({ value, min, max, onChange, unit = '' }) {
  const ref = useRef(null);
  const guard = useRef(false);
  const timer = useRef(0);
  const latest = useRef(onChange);
  latest.current = onChange;

  useIsomorphicLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    guard.current = true;
    el.scrollTop = (value - min) * ITEM_H;
    // release the guard after the browser has applied the scroll
    const t = setTimeout(() => { guard.current = false; }, 60);
    return () => clearTimeout(t);
    // re-position only when the value changes from OUTSIDE (not from scrolling)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value === undefined]);

  const onScroll = () => {
    if (guard.current) return;
    const el = ref.current;
    if (!el) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const idx = Math.min(max, Math.max(min, Math.round(el.scrollTop / ITEM_H) + min));
      latest.current?.(idx);
    }, 120);
  };

  const jump = (n) => {
    guard.current = true;
    ref.current?.scrollTo({ top: (n - min) * ITEM_H, behavior: 'smooth' });
    setTimeout(() => { guard.current = false; }, 350);
    latest.current?.(n);
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (value > min) jump(value - 1);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (value < max) jump(value + 1);
    }
  };

  const items = [];
  for (let n = min; n <= max; n++) items.push(n);

  return (
    <div className="wheel-frame">
      <div
        className="wheel"
        ref={ref}
        onScroll={onScroll}
        onKeyDown={onKeyDown}
        style={{ height: ITEM_H * VISIBLE }}
        role="listbox"
        aria-label={`Value picker, ${min} to ${max}${unit}`}
      >
        <div className="wheel-pad" style={{ height: ITEM_H * ((VISIBLE - 1) / 2) }} aria-hidden="true" />
        {items.map((n) => (
          <button
            key={n}
            type="button"
            role="option"
            aria-selected={n === value}
            aria-pressed={n === value}
            className="wheel-item"
            onClick={() => jump(n)}
            tabIndex={n === value ? 0 : -1}
          >
            {n}{unit}
          </button>
        ))}
        <div className="wheel-pad" style={{ height: ITEM_H * ((VISIBLE - 1) / 2) }} aria-hidden="true" />
      </div>
    </div>
  );
}

/**
 * Grid of selectable tiles — a friendlier radio group for choices people
 * recognise by name (goal, experience, diet, equipment, activity).
 *
 * @param {object} p
 * @param {{value:string,label:string,desc?:string}[]} p.options
 * @param {string} p.value @param {(v:string)=>void} p.onChange
 * @param {number} [p.cols] minimum column width hint
 */
export function TileGroup({ options, value, onChange, cols = 3 }) {
  return (
    <div
      className="tiles"
      role="radiogroup"
      style={{ gridTemplateColumns: `repeat(auto-fit, minmax(${cols === 3 ? 150 : 190}px, 1fr))` }}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className="tile"
          onClick={() => onChange(o.value)}
        >
          <span className="row gap-6" style={{ width: '100%' }}>
            <span className="strong small flex-1" style={{ textAlign: 'left' }}>{o.label}</span>
            {value === o.value && <Icon name="check" size={14} style={{ color: 'var(--ember)' }} />}
          </span>
          {o.desc && <span className="tiny" style={{ textAlign: 'left' }}>{o.desc}</span>}
        </button>
      ))}
    </div>
  );
}

/**
 * Custom dropdown (listbox) to replace native <select>, whose OS-styled popup
 * cannot be themed. A button + popover list: keyboard opens/closes (Enter,
 * Space, Escape), clicks outside close, selected row is marked.
 *
 * @param {object} p
 * @param {string} [p.label] placeholder when nothing selected
 * @param {string} p.value @param {{value:string,label:string}[]} p.options
 * @param {(v:string)=>void} p.onChange @param {string} [p.className]
 */
export function SelectMenu({ label = 'Choose…', value, options, onChange, className = '', width = 170 }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const current = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setOpen(false);
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const items = ref.current?.querySelectorAll('[role="option"]');
        if (!items || !items.length) return;
        e.preventDefault();
        const currentIndex = Array.from(items).indexOf(document.activeElement);
        if (currentIndex === -1) {
          items[0]?.focus();
        } else if (e.key === 'ArrowDown') {
          const nextIndex = (currentIndex + 1) % items.length;
          items[nextIndex]?.focus();
        } else {
          const prevIndex = (currentIndex - 1 + items.length) % items.length;
          items[prevIndex]?.focus();
        }
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className={`smenu ${className}`} ref={ref} style={{ width }}>
      <button
        type="button"
        className="smenu-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if ((e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className="flex-1" style={{ textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {current?.label || label}
        </span>
        <Icon name="chev" size={14} style={{ opacity: .7, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 160ms' }} />
      </button>
      {open && (
        <div className="smenu-pop" role="listbox" aria-label={label}>
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={o.value === value}
              className="smenu-item"
              onClick={() => { onChange(o.value); setOpen(false); }}
            >
              <span>{o.label}</span>
              {o.value === value && <Icon name="check" size={13} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Password field with a real show/hide eye.
 * The toggle is a flat ghost pebble inside the inset well (a raised button
 * inside a well would read as a foreign object), and it is announced to
 * screen readers with aria-pressed.
 *
 * @param {object} p standard input props (value, onChange, placeholder, …)
 */
export function PasswordInput({ value, onChange, placeholder = '••••••••', autoComplete = 'current-password', ariaInvalid, ...rest }) {
  const [show, setShow] = useState(false);
  return (
    <div className="pw-wrap">
      <Input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        autoComplete={autoComplete}
        aria-invalid={ariaInvalid}
        {...rest}
      />
      <button
        type="button"
        className="btn btn-ghost btn-icon pw-eye"
        aria-label={show ? 'Hide password' : 'Show password'}
        aria-pressed={show}
        onClick={() => setShow((v) => !v)}
      >
        <Icon name={show ? 'eyeoff' : 'eye'} size={16} />
      </button>
    </div>
  );
}
