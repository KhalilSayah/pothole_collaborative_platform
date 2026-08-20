import { useEffect, useState } from 'react';

/**
 * Hash routing, deliberately.
 *
 * A static host serves one file; hash routes never hit the server, so a deep
 * link or a hard refresh cannot 404 regardless of hosting config. History-API
 * routing would need a rewrite rule to be correct, and would break the moment
 * the app is opened from a file:// URL or a preview host.
 */
export function useRoute() {
  const read = () => window.location.hash.replace(/^#/, '') || '/';
  const [route, setRoute] = useState(read);

  useEffect(() => {
    const f = () => {
      setRoute(read());
      window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    };
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);

  return route;
}
