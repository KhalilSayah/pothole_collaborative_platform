import { useEffect, useState } from 'react';

const LINKS = [
  ['#/', 'Accueil'],
  ['#/carte', 'Carte'],
  ['#/signaler', 'Signaler'],
  ['#/conduire', 'Mode conduite'],
];

export default function Nav({ route, overlay = false }: { route: string; overlay?: boolean }) {
  const [stuck, setStuck] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const f = () => setStuck(window.scrollY > 8);
    f();
    window.addEventListener('scroll', f, { passive: true });
    return () => window.removeEventListener('scroll', f);
  }, []);

  // Close the mobile menu on navigation, otherwise it hangs over the new page.
  useEffect(() => setOpen(false), [route]);

  return (
    <nav className={'nav' + (stuck ? ' stuck' : '') + (overlay && !stuck ? ' over' : '')}>
      <div className="wrap nav-in">
        <a className="logo" href="#/">
          <span className="mark">◎</span>
          Route Tlemcen
        </a>

        <button className="burger" onClick={() => setOpen(o => !o)}
                aria-label="Menu" aria-expanded={open}>
          {open ? '✕' : '☰'}
        </button>

        <div className="nav-links" hidden={!open && window.innerWidth <= 860}>
          {LINKS.map(([href, label]) => (
            <a key={href} href={href} className={route === href.slice(1) ? 'on' : ''}>
              {label}
            </a>
          ))}
          <a className="btn" href="#/signaler" style={{ marginLeft: 8 }}>Contribuer</a>
        </div>
      </div>
    </nav>
  );
}
