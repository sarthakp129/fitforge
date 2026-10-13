import { useRef } from 'react';

/**
 * Pointer-driven 3D tilt for hero panels and showcase cards.
 * Rotates the element a few degrees toward the cursor (the parent supplies
 * `perspective` in CSS). Pointer events only — never a scroll listener — and
 * a no-op for reduced-motion users, where motion would be noise.
 *
 * Usage:
 *   const tilt = useTilt();
 *   <div style={{ perspective: 900 }}>
 *     <div ref={tilt.ref} onMouseMove={tilt.onMouseMove} onMouseLeave={tilt.onMouseLeave}>…</div>
 *   </div>
 *
 * @param {{max?: number}} opts max tilt in degrees per axis
 * @returns {{ref: object, onMouseMove: function, onMouseLeave: function}}
 */
export function useTilt({ max = 7 } = {}) {
  const ref = useRef(null);
  const reduced = typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

  const onMouseMove = (e) => {
    const el = ref.current;
    if (!el || reduced) return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    el.style.transform = `rotateY(${(x * max).toFixed(2)}deg) rotateX(${(-y * max).toFixed(2)}deg)`;
  };

  const onMouseLeave = () => {
    const el = ref.current;
    if (el) el.style.transform = 'rotateY(0deg) rotateX(0deg)';
  };

  return { ref, onMouseMove, onMouseLeave };
}

export default useTilt;
