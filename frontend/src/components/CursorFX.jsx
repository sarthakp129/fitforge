import { useEffect, useRef } from 'react';

/**
 * CursorFX — an ember glow that trails the pointer plus a short spark trail.
 *
 * Design intent: on a dark glass UI the cursor becomes a light source, which
 * makes the surface feel physical without adding chrome. One fixed canvas,
 * one rAF loop, transform/free drawing only; it is disabled entirely for
 * touch devices and reduced-motion users, and pauses with the tab.
 */
export default function CursorFX() {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return undefined;
    const coarse = window.matchMedia?.('(pointer: coarse)')?.matches;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    if (coarse || reduced) { canvas.remove(); return undefined; }

    const ctx = canvas.getContext('2d');
    if (!ctx) { canvas.remove(); return undefined; }

    let w = 0, h = 0, dpr = 1;
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth; h = window.innerHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const glow = { x: w / 2, y: h / 2, tx: w / 2, ty: h / 2 };
    const sparks = [];
    let last = { x: 0, y: 0, t: 0 };
    let raf = 0;
    let running = true;

    const isDark = () => {
      const t = document.documentElement.getAttribute('data-theme');
      return t === 'dark' || (!t && !!window.matchMedia?.('(prefers-color-scheme: dark)')?.matches);
    };

    const onMove = (e) => {
      if (!isDark()) return;
      glow.tx = e.clientX; glow.ty = e.clientY;
      const now = performance.now();
      const moved = Math.hypot(e.clientX - last.x, e.clientY - last.y);
      // spawn a spark only on real movement, rate-limited
      if (moved > 14 && now - last.t > 28) {
        sparks.push({ x: e.clientX, y: e.clientY, life: 1, r: 1.6 + Math.random() * 1.8 });
        if (sparks.length > 26) sparks.shift();
        last = { x: e.clientX, y: e.clientY, t: now };
      }
    };
    const onVisibility = () => {
      running = !document.hidden;
      if (running) raf = requestAnimationFrame(tick);
      else cancelAnimationFrame(raf);
    };

    const tick = () => {
      if (!running) return;
      if (!isDark()) {
        ctx.clearRect(0, 0, w, h);
        raf = requestAnimationFrame(tick);
        return;
      }
      ctx.clearRect(0, 0, w, h);

      // lagging light source (lerp = cheap inertia)
      glow.x += (glow.tx - glow.x) * 0.16;
      glow.y += (glow.ty - glow.y) * 0.16;
      const g = ctx.createRadialGradient(glow.x, glow.y, 0, glow.x, glow.y, 130);
      g.addColorStop(0, 'rgba(232, 72, 31, 0.12)');
      g.addColorStop(0.5, 'rgba(232, 72, 31, 0.05)');
      g.addColorStop(1, 'rgba(255, 91, 46, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(glow.x - 130, glow.y - 130, 260, 260);

      // spark trail
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        s.life -= 0.045;
        if (s.life <= 0) { sparks.splice(i, 1); continue; }
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r * s.life, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 138, 92, ${0.5 * s.life})`;
        ctx.fill();
      }
      raf = requestAnimationFrame(tick);
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', onVisibility);
    raf = requestAnimationFrame(tick);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return <canvas ref={ref} className="cursor-fx" aria-hidden="true" />;
}
