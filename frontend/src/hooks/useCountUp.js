import { useEffect, useRef, useState } from 'react';
import useReducedMotion from './useReducedMotion.js';

/**
 * Animates a number from 0 to `target` over `ms` with an ease-out curve,
 * starting when `start` flips true (wire it to useInView).
 * Reduced-motion users get the final value immediately — the number is
 * information, not decoration.
 *
 * @param {number} target final value
 * @param {boolean} start begin when true
 * @returns {number} the value to render
 */
export function useCountUp(target, start, { ms = 600 } = {}) {
  const reduced = useReducedMotion();
  const [value, setValue] = useState(0);
  const frame = useRef(0);

  useEffect(() => {
    const to = Number(target) || 0;
    if (!start) return undefined;
    if (reduced) { setValue(to); return undefined; }
    const t0 = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / ms);
      const eased = 1 - (1 - p) ** 3;           // ease-out cubic
      setValue(to * eased);
      if (p < 1) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame.current);
  }, [target, start, ms, reduced]);

  return value;
}

export default useCountUp;
