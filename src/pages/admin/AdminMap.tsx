// Back-office map: the list and the map are one view, not two.
//
// Selecting in either drives the other, because a maintenance decision needs
// both the attributes (severity, age, priority) and the geography (is this on
// the same street as four others we could fix in one pass).

import { useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, CircleMarker, useMap } from 'react-leaflet';
import { fetchClusters, markFixed, reopen, type AdminCluster } from '../../lib/admin';
import { sevColor } from '../../lib/viz';
import { cardFor, SEVERITY_LABEL } from '../../lib/damage';
import { publicPhotoUrl } from '../../lib/supabase';
import { TLEMCEN_BOUNDS } from '../../components/MapView';

type Filter = 'open' | 'high' | 'repaired' | 'all';

function ageDays(iso: string) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

function Focus({ item }: { item: AdminCluster | null }) {
  const map = useMap();
  useEffect(() => {
    if (item) map.flyTo([item.lat, item.lon], Math.max(map.getZoom(), 17), { duration: .6 });
  }, [item, map]);
  return null;
}

function Fit({ ready }: { ready: boolean }) {
  const map = useMap();
  useEffect(() => {
    if (ready) map.fitBounds(TLEMCEN_BOUNDS, { animate: false, padding: [20, 20] });
    setTimeout(() => map.invalidateSize({ animate: false }), 60);
  }, [ready, map]);
  return null;
}

export default function AdminMap() {
  const [rows, setRows] = useState<AdminCluster[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('open');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<AdminCluster | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const load = () => {
    setLoading(true);
    fetchClusters()
      .then(setRows).catch(e => setErr(e.message)).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const view = useMemo(() => {
    const t = q.trim().toLowerCase();
    return rows.filter(r => {
      if (filter === 'open' && r.repaired_at) return false;
      if (filter === 'high' && (r.repaired_at || r.severity !== 'high')) return false;
      if (filter === 'repaired' && !r.repaired_at) return false;
      if (t && !(r.road_name ?? '').toLowerCase().includes(t)) return false;
      return true;
    });
  }, [rows, filter, q]);

  async function act(fn: (id: string, n?: string) => Promise<void>) {
    if (!sel) return;
    setBusy(true);
    try {
      await fn(sel.id, note.trim() || undefined);
      setNote('');
      setSel(null);
      load();
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  const counts = useMemo(() => ({
    open: rows.filter(r => !r.repaired_at).length,
    high: rows.filter(r => !r.repaired_at && r.severity === 'high').length,
    repaired: rows.filter(r => r.repaired_at).length,
    all: rows.length,
  }), [rows]);

  return (
    <div className="ops">
      {/* ------------------------------------------------------- list */}
      <aside className="ops-side">
        <div className="ops-filters">
          {(['open', 'high', 'repaired', 'all'] as Filter[]).map(f => (
            <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
              {{ open: 'Ouverts', high: 'Graves', repaired: 'Réparés', all: 'Tous' }[f]}
              <span>{counts[f]}</span>
            </button>
          ))}
        </div>

        <input className="ops-search" placeholder="Filtrer par rue…"
               value={q} onChange={e => setQ(e.target.value)} />

        <div className="ops-count">
          {loading ? 'Chargement…' : `${view.length} affiché${view.length > 1 ? 's' : ''}`}
        </div>

        <div className="ops-list">
          {view.slice(0, 300).map(r => {
            const card = cardFor(r.damage_type ?? 'other');
            const age = ageDays(r.first_seen ?? r.last_seen);
            return (
              <button key={r.id}
                      className={'ops-item' + (sel?.id === r.id ? ' on' : '')}
                      onClick={() => setSel(r)}>
                <span className="ops-bar" style={{ background: sevColor(r.severity) }} />
                <div className="grow">
                  <div className="ops-top">
                    <b>{card?.label ?? 'Défaut'}</b>
                    {r.repaired_at
                      ? <span className="tag ok">Réparé</span>
                      : <span className="tag">{Math.round(r.priority ?? 0)}</span>}
                  </div>
                  <div className="ops-meta">
                    {r.road_name ?? 'rue non nommée'} · {SEVERITY_LABEL[r.severity ?? 'low']}
                  </div>
                  <div className="ops-meta">
                    {r.n_rides} passage{r.n_rides > 1 ? 's' : ''} · {age} j
                  </div>
                </div>
              </button>
            );
          })}
          {!loading && !view.length && (
            <p className="small muted" style={{ padding: 16 }}>Aucun signalement ne correspond.</p>
          )}
        </div>
      </aside>

      {/* -------------------------------------------------------- map */}
      <div className="ops-map">
        <MapContainer center={[34.8828, -1.3167]} zoom={13} zoomControl={false}
                      style={{ height: '100%', width: '100%' }}>
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
            attribution="&copy; OpenStreetMap &copy; CARTO" maxZoom={20} />
          <Fit ready={!loading} />
          <Focus item={sel} />
          {view.map(r => (
            <CircleMarker key={r.id} center={[r.lat, r.lon]}
              radius={sel?.id === r.id ? 11 : 6 + Math.min(r.n_rides, 4)}
              pathOptions={{
                color: r.repaired_at ? '#94a3b8' : sevColor(r.severity),
                weight: sel?.id === r.id ? 3 : 2,
                fillColor: r.repaired_at ? '#cbd5e1' : sevColor(r.severity),
                fillOpacity: r.repaired_at ? 0.35 : 0.85,
              }}
              eventHandlers={{ click: () => setSel(r) }} />
          ))}
        </MapContainer>

        {err && <div className="note bad ops-err"><span>✕</span><span>{err}</span></div>}

        {/* ---------------------------------------------------- detail */}
        {sel && (
          <div className="ops-detail">
            <button className="focus-x" onClick={() => setSel(null)}>✕</button>
            {sel.image_path && (
              <img className="ops-photo" src={publicPhotoUrl(sel.image_path) ?? ''} alt="" />
            )}
            <div className="ops-detail-b">
              <h3>{cardFor(sel.damage_type ?? 'other')?.label ?? 'Défaut'}</h3>
              <p className="small muted">{sel.road_name ?? 'rue non nommée'}</p>

              <div className="ops-kv">
                <div><span>Priorité</span><b>{Math.round(sel.priority ?? 0)}</b></div>
                <div><span>Gravité</span><b>{SEVERITY_LABEL[sel.severity ?? 'low']}</b></div>
                <div><span>Passages</span><b>{sel.n_rides}</b></div>
                <div><span>Âge</span><b>{ageDays(sel.first_seen ?? sel.last_seen)} j</b></div>
              </div>

              {sel.repaired_at ? (
                <>
                  <div className="note ok" style={{ marginTop: 14 }}>
                    <span>✓</span>
                    <span>Réparé le {new Date(sel.repaired_at).toLocaleDateString('fr-FR')}
                      {sel.repair_note ? ` — ${sel.repair_note}` : ''}</span>
                  </div>
                  <button className="btn ghost block" style={{ marginTop: 12 }}
                          disabled={busy} onClick={() => act(reopen)}>
                    Rouvrir
                  </button>
                </>
              ) : (
                <>
                  <input className="ops-note" placeholder="Note (facultatif)"
                         value={note} onChange={e => setNote(e.target.value)} />
                  <button className="btn block" style={{ marginTop: 10 }}
                          disabled={busy} onClick={() => act(markFixed)}>
                    {busy && <span className="spin" />}Marquer comme réparé
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
