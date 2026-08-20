// Scroll-triggered entry animation.
//
// Fires ONCE and then unobserves. Elements that re-animate every time they
// re-enter the viewport make a page feel restless and, on a long scroll, faintly
// nauseating — the motion should lead the eye downward, then get out of the way.

import { useEffect, useRef, useState, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  className?: string;
  delay?: 0 | 1 | 2 | 3 | 4 | 5;
  as?: 'div' | 'section' | 'li';
}

export default function Reveal({ children, className = '', delay = 0, as = 'div' }: Props) {
  const ref = useRef<HTMLElement>(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Anything already on screen at mount should not fade in — that would delay
    // the first paint of content the user is already looking at.
    if (el.getBoundingClientRect().top < window.innerHeight) { setSeen(true); return; }

    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setSeen(true); io.disconnect(); }
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });

    io.observe(el);
    return () => io.disconnect();
  }, []);

  const Tag = as as any;
  return (
    <Tag ref={ref} className={`reveal${delay ? ' d' + delay : ''}${seen ? ' in' : ''} ${className}`}>
      {children}
    </Tag>
  );
}
