// The collaborative map. Reads only the fused public view — never raw rides.

import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet';
import { fetchMap, isCloudEnabled } from '../lib/supabase';
import { cardFor, SEVERITY_LABEL } from '../lib/damage';
import type { Cluster } from '../lib/types';

const TLEMCEN: [number, number] = [34.8828, -1.3167];

const SEV_COLOR: Record<string, string> = {
  high: '#e5484d', medium: '#f5a524', low: '#3fb950',
};

function Recenter({ pos }: { pos: [number, number] | null }) {
  const map = useMap();
  useEffect(() => { if (pos) map.setView(pos, 16); }, [pos, map]);
  return null;
}

export default function MapScreen({ here }: { here: [number, number] | null }) {
  const [rows, setRows] = useState<Cluster[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [follow, setFollow] = useState<[number, number] | null>(null);

  useEffect(() => {
    if (!isCloudEnabled()) return;
    fetchMap()
      .then(d => setRows(d as Cluster[]))
      .catch(e => setErr(e.message));
  }, []);

  return (
    <div className="mapwrap" style={{ position: 'relative' }}>
      <MapContainer center={here ?? TLEMCEN} zoom={14} zoomControl={false}>
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution="&copy; OpenStreetMap"
        />
        <Recenter pos={follow} />

        {here && (
          <CircleMarker center={here} radius={8} pathOptions={{
            color: '#fff', weight: 2, fillColor: '#2a6df4', fillOpacity: 1,
          }} />
        )}

        {rows.map(c => (
          <CircleMarker
            key={c.id}
            center={[c.lat, c.lon]}
            // Size encodes corroboration: a pothole confirmed by several
            // independent rides should be visually louder than a lone guess.
            radius={4 + Math.min(c.n_rides, 5) * 1.5}
            pathOptions={{
              color: SEV_COLOR[c.severity ?? 'low'] ?? '#8b949e',
              fillColor: SEV_COLOR[c.severity ?? 'low'] ?? '#8b949e',
              fillOpacity: c.status === 'confirmed' ? 0.85 : 0.25,
              weight: c.status === 'confirmed' ? 1 : 2,
              dashArray: c.status === 'confirmed' ? undefined : '3,3',
            }}
          >
            <Popup>
              <div style={{ minWidth: 150, color: '#111' }}>
                <b>{cardFor(c.damage_type ?? 'other')?.label ?? 'Défaut'}</b><br />
                {SEVERITY_LABEL[c.severity ?? 'low']} · {c.road_name ?? 'route inconnue'}<br />
                <small>
                  {c.n_rides} trajet(s) · {c.n_observations} obs. · {c.method_mix?.join(', ')}<br />
                  fiabilité {(c.confidence * 100).toFixed(0)}% · {c.status}
                </small>
              </div>
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>

      {here && (
        <button
          onClick={() => setFollow([...here] as [number, number])}
          style={{
            position: 'absolute', right: 12, bottom: 12, zIndex: 1000,
            background: 'var(--surface)', border: '1px solid var(--line)',
            borderRadius: 12, padding: '12px 14px', fontSize: 20,
          }}
        >◎</button>
      )}

      {!isCloudEnabled() && (
        <div style={{
          position: 'absolute', left: 12, right: 12, top: 12, zIndex: 1000,
        }} className="banner">
          Mode hors-ligne — la carte collaborative nécessite Supabase.
          Vos relevés sont enregistrés localement.
        </div>
      )}
      {err && (
        <div style={{ position: 'absolute', left: 12, right: 12, top: 12, zIndex: 1000 }}
             className="banner bad">{err}</div>
      )}
    </div>
  );
}
