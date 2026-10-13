import { useEffect, useState } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

/**
 * True when the user asked the OS for less motion. Every scroll effect and
 * celebration checks this and simply shows the final state instead.
 * @returns {boolean}
 */
export function useReducedMotion() {
  const [reduced, setReduced] = useState(
    () => window.matchMedia?.(QUERY).matches === true
  );
  useEffect(() => {
    const mq = window.matchMedia?.(QUERY);
    const onChange = (e) => setReduced(e.matches);
    mq?.addEventListener?.('change', onChange);
    return () => mq?.removeEventListener?.('change', onChange);
  }, []);
  return reduced;
}

export default useReducedMotion;
