import { useEffect, useState } from 'react';
import { useRoute } from './lib/router';
import { fetchMap, isCloudEnabled } from './lib/supabase';
import { startAutoSync } from './lib/sync';
import { isDemo, demoRows } from './lib/demo';
import type { Cluster } from './lib/types';

import Nav from './components/Nav';
import Footer from './components/Footer';
import Home from './pages/Home';
import Explore from './pages/Explore';
import PhotoReport from './pages/PhotoReport';
import DriveApp from './DriveApp';
import AdminShell from './pages/admin/AdminShell';

export default function App() {
  const route = useRoute();
  const [rows, setRows] = useState<Cluster[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    // The queue drains from every page, so a report made offline still uploads
    // once the visitor regains signal — even if they never open the drive screen.
    const stop = startAutoSync();
    if (isDemo()) { setRows(demoRows()); setLoading(false); return stop; }
    if (!isCloudEnabled()) { setLoading(false); return stop; }
    fetchMap()
      .then(d => setRows(d as Cluster[]))
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
    return stop;
  }, []);

  // Driving mode is its own full-screen world: dark, landscape, no site chrome.
  // Mixing it with the marketing nav would waste the vertical space the card
  // grid needs, and a light header beside a dark screen looks broken.
  if (route === '/conduire') return <DriveApp />;

  // The back office is its own world: no marketing nav, no footer, and it
  // manages its own authentication gate.
  if (route.startsWith('/admin')) return <AdminShell route={route} />;

  return (
    <>
      <Nav route={route} />
      <main className="pad-nav">
        {route === '/carte'    ? <Explore rows={rows} loading={loading} />
       : route === '/signaler' ? <PhotoReport />
       : <Home rows={rows} loading={loading} />}
      </main>
      {route !== '/carte' && <Footer />}

      {err && (
        <div className="note bad" style={{
          position: 'fixed', left: 16, right: 16, bottom: 16, zIndex: 999, maxWidth: 460,
        }}>
          <span>✕</span><span>Carte indisponible : {err}</span>
        </div>
      )}
    </>
  );
}
