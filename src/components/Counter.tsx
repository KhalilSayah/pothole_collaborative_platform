// Count-up figure. Eases out, so the number lands rather than stopping dead.

import { useEffect, useRef, useState } from 'react';

export default function Counter({ to, dur = 1400, suffix = '' }: {
  to: number; dur?: number; suffix?: string;
}) {
  const [n, setN] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const ran = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const start = () => {
      if (ran.current) return;
      ran.current = true;
      const t0 = performance.now();
      const step = (t: number) => {
        const p = Math.min(1, (t - t0) / dur);
        setN(Math.round(to * (1 - Math.pow(1 - p, 3))));   // ease-out cubic
        if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    };
    if (el.getBoundingClientRect().top < window.innerHeight) { start(); return; }
    const io = new IntersectionObserver(([e]) => e.isIntersecting && (start(), io.disconnect()));
    io.observe(el);
    return () => io.disconnect();
  }, [to, dur]);

  return <span ref={ref}>{n.toLocaleString('fr-FR')}{suffix}</span>;
}
