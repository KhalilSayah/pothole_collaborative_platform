// ============================================================================
//  The map.
//
//  Clustering is done here rather than with a plugin because the bubbles need to
//  carry meaning: each one is coloured by the WORST defect it contains, so a
//  cluster hiding a severe pothole never looks harmless when collapsed.
//
//  Grid-based clustering in screen space (not geographic space) keeps bubbles
//  visually evenly spaced at every zoom, which is what actually reads well.
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, CircleMarker, Marker, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import type { Cluster } from '../lib/types';
import { cardFor, SEVERITY_LABEL } from '../lib/damage';

export const TLEMCEN: [number, number] = [34.8828, -1.3167];

export const SEV: Record<string, string> = {
  high: '#ef4444', medium: '#f59e0b', low: '#10b981', unknown: '#94a3b8',
};
const RANK: Record<string, number> = { low: 1, medium: 2, high: 3 };

interface Bubble {
  key: string;
  lat: number;
  lon: number;
  items: Cluster[];
  worst: string;
}

/** Collapse nearby points into bubbles, working in pixels at the current zoom. */
function makeBubbles(rows: Cluster[], map: L.Map, cell = 58): Bubble[] {
  const buckets = new Map<string, Cluster[]>();
  for (const r of rows) {
    const p = map.latLngToLayerPoint([r.lat, r.lon]);
    const k = `${Math.floor(p.x / cell)}:${Math.floor(p.y / cell)}`;
    (buckets.get(k) ?? buckets.set(k, []).get(k)!).push(r);
  }
  return [...buckets.entries()].map(([key, items]) => {
    const worst = items.reduce(
      (w, i) => (RANK[i.severity ?? 'low'] ?? 0) > (RANK[w] ?? 0) ? (i.severity ?? 'low') : w, 'low');
    return {
      key,
      lat: items.reduce((a, b) => a + b.lat, 0) / items.length,
      lon: items.reduce((a, b) => a + b.lon, 0) / items.length,
      items, worst,
    };
  });
}

function Bubbles({
  rows, onHover, onPick,
}: {
  rows: Cluster[];
  onHover: (b: Bubble | null, px?: { x: number; y: number }) => void;
  onPick: (b: Bubble) => void;
}) {
  const map = useMap();
  const [, tick] = useState(0);
  useMapEvents({ zoomend: () => tick(n => n + 1), moveend: () => tick(n => n + 1) });

  const bubbles = useMemo(() => makeBubbles(rows, map), [rows, map, tick]);

  return (
    <>
      {bubbles.map(b => {
        const n = b.items.length;
        // A single point stays a plain dot; only real groups become bubbles, so
        // the map does not imply density that is not there.
        if (n === 1) {
          const c = b.items[0];
          return (
            <CircleMarker
              key={b.key}
              center={[b.lat, b.lon]}
              radius={6 + Math.min(c.n_rides, 4)}
              pathOptions={{
                color: '#fff', weight: 2.5,
                fillColor: SEV[c.severity ?? 'unknown'],
                fillOpacity: c.status === 'confirmed' ? 0.95 : 0.45,
              }}
              eventHandlers={{
                mouseover: e => onHover(b, map.latLngToContainerPoint(e.latlng)),
                mouseout: () => onHover(null),
                click: () => onPick(b),
              }}
            />
          );
        }
        const size = n < 10 ? 's' : n < 40 ? 'm' : 'l';
        const icon = L.divIcon({
          html: `<div class="cl ${size}" style="background:${SEV[b.worst]}">${n}</div>`,
          className: '', iconSize: [0, 0],
        });
        return (
          <Marker
            key={b.key} position={[b.lat, b.lon]} icon={icon}
            eventHandlers={{
              mouseover: e => onHover(b, map.latLngToContainerPoint(e.latlng)),
              mouseout: () => onHover(null),
              click: () => { onHover(null); map.flyTo([b.lat, b.lon], map.getZoom() + 2, { duration: .6 }); },
            }}
          />
        );
      })}
    </>
  );
}

function FitAll({ rows }: { rows: Cluster[] }) {
  const map = useMap();
  const done = useRef(false);
  useEffect(() => {
    if (done.current || !rows.length) return;
    done.current = true;
    const b = L.latLngBounds(rows.map(r => [r.lat, r.lon] as [number, number]));
    map.fitBounds(b.pad(0.22), { animate: true, duration: 0.8 });
  }, [rows, map]);
  return null;
}

interface Props {
  rows: Cluster[];
  height?: 'hero' | 'tall';
  showFilters?: boolean;
  showStats?: boolean;
  interactive?: boolean;
}

export default function MapView({
  rows, height = 'hero', showFilters = false, showStats = true, interactive = true,
}: Props) {
  const [sev, setSev] = useState<string>('all');
  const [hover, setHover] = useState<{ b: Bubble; x: number; y: number } | null>(null);
  const [picked, setPicked] = useState<Cluster | null>(null);

  const view = useMemo(
    () => sev === 'all' ? rows : rows.filter(r => r.severity === sev),
    [rows, sev]);

  const onHover = useCallback((b: Bubble | null, px?: { x: number; y: number }) => {
    setHover(b && px ? { b, x: px.x, y: px.y } : null);
  }, []);

  const counts = useMemo(() => ({
    all: rows.length,
    high: rows.filter(r => r.severity === 'high').length,
    medium: rows.filter(r => r.severity === 'medium').length,
    low: rows.filter(r => r.severity === 'low').length,
  }), [rows]);

  const hoverCard = hover && (() => {
    const { b, x, y } = hover;
    const c = b.items[0];
    const many = b.items.length > 1;
    const card = cardFor(c.damage_type ?? 'other');
    return (
      <div className="hovercard" style={{
        left: Math.max(8, Math.min(x - 116, 9999)), top: Math.max(8, y - 150),
      }}>
        <div className="bd">
          <div className="tt">
            <span style={{
              width: 9, height: 9, borderRadius: 9, background: SEV[b.worst], flex: '0 0 auto',
            }} />
            {many ? `${b.items.length} signalements` : (card?.label ?? 'Défaut')}
          </div>
          <div className="mt">
            {many
              ? `Gravité max : ${SEVERITY_LABEL[b.worst] ?? b.worst}`
              : `${SEVERITY_LABEL[c.severity ?? 'low']} · ${c.road_name ?? 'route non nommée'}`}
          </div>
          {!many && (
            <div className="mt">
              {c.n_rides} trajet{c.n_rides > 1 ? 's' : ''} · fiabilité {(c.confidence * 100).toFixed(0)}%
            </div>
          )}
          <div className="bar">
            {[0, 1, 2, 3].map(i => (
              <i key={i} style={{
                background: i < Math.round((many ? 1 : c.confidence) * 4) ? SEV[b.worst] : undefined,
              }} />
            ))}
          </div>
        </div>
      </div>
    );
  })();

  return (
    <div className={'map-card ' + height}>
      <MapContainer
        center={TLEMCEN} zoom={13} zoomControl={false}
        scrollWheelZoom={interactive} dragging={interactive}
        doubleClickZoom={interactive} touchZoom={interactive}
        attributionControl
      >
        {/* Positron: a muted light basemap, so the data is the loudest thing
            on screen rather than the streets. */}
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; OpenStreetMap &copy; CARTO'
          maxZoom={20}
        />
        <Bubbles rows={view} onHover={onHover} onPick={b => setPicked(b.items[0])} />
        <FitAll rows={rows} />
      </MapContainer>

      {showStats && (
        <div className="map-panel map-stat">
          <div><b>{counts.all}</b><span>signalements</span></div>
          <div><b style={{ color: SEV.high }}>{counts.high}</b><span>graves</span></div>
        </div>
      )}

      {showFilters && (
        <div className="map-panel map-filters">
          <div className="seg">
            {(['all', 'high', 'medium', 'low'] as const).map(k => (
              <button key={k} className={sev === k ? 'on' : ''} onClick={() => setSev(k)}>
                {k === 'all' ? 'Tous' : SEVERITY_LABEL[k]}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="map-panel map-legend">
        {(['high', 'medium', 'low'] as const).map(k => (
          <div className="row" key={k}>
            <span className="sw" style={{ background: SEV[k] }} />
            {SEVERITY_LABEL[k]}
          </div>
        ))}
        <div className="row" style={{ marginTop: 10, color: 'var(--ink-3)', fontSize: '.72rem' }}>
          Cercle plein = confirmé
        </div>
      </div>

      {hoverCard}

      {picked && (
        <div className="map-panel" style={{ right: 14, bottom: 14, padding: 16, width: 250 }}>
          <div className="row" style={{ marginBottom: 6 }}>
            <b className="grow">{cardFor(picked.damage_type ?? 'other')?.label ?? 'Défaut'}</b>
            <button onClick={() => setPicked(null)} style={{ color: 'var(--ink-3)' }}>✕</button>
          </div>
          <div className="small muted">{picked.road_name ?? 'Route non nommée'}</div>
          <div className="small" style={{ marginTop: 8 }}>
            {SEVERITY_LABEL[picked.severity ?? 'low']} · {picked.n_observations} observation(s)
            · {picked.n_rides} trajet(s)
          </div>
          <div className="small muted" style={{ marginTop: 4 }}>
            Méthodes : {picked.method_mix?.join(', ') || '—'}
          </div>
        </div>
      )}
    </div>
  );
}
