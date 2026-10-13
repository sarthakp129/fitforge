import { useEffect, useState } from 'react';

/**
 * Scroll-spy: returns the id of the section currently in view.
 * One IntersectionObserver watches every section; the most-visible one wins.
 * Used by the sticky "how it works" story, Settings' section list and the
 * training day tabs.
 *
 * @param {string[]} ids element ids to watch
 * @returns {string} the active id
 */
export function useScrollSpy(ids, { rootMargin = '-40% 0px -55% 0px' } = {}) {
  const [active, setActive] = useState(ids[0] || '');

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(e.target.id);
      },
      { rootMargin }
    );
    const els = ids.map((id) => document.getElementById(id)).filter(Boolean);
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [ids.join('|'), rootMargin]);

  return active;
}

export default useScrollSpy;
