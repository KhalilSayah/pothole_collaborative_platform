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
import 'leaflet.heat';
import type { Cluster } from '../lib/types';
import { cardFor, SEVERITY_LABEL } from '../lib/damage';
import FocusCard from './FocusCard';

export const TLEMCEN: [number, number] = [34.8828, -1.3167];

/** The whole municipality, so the default view shows all of Tlemcen at once. */
export const TLEMCEN_BOUNDS = L.latLngBounds([34.83, -1.40], [34.94, -1.24]);

/**
 * Below this zoom the map shows a heat surface, above it individual reports.
 *
 * Zoomed out, hundreds of separate markers collapse into an unreadable smear
 * and imply a precision the data does not have. Density is the honest thing to
 * show at city scale; individual positions only become meaningful once a street
 * is legible underneath them.
 */
export const HEAT_MAX_ZOOM = 15;

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

/** Widest gap between a bubble's points, in metres. */
function spreadMeters(items: Cluster[]): number {
  if (items.length < 2) return 0;
  const lat = items.reduce((a, b) => a + b.lat, 0) / items.length;
  const kx = Math.cos((lat * Math.PI) / 180) * 111320;
  const ky = 110540;
  let max = 0;
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      max = Math.max(max, Math.hypot(
        (items[i].lon - items[j].lon) * kx,
        (items[i].lat - items[j].lat) * ky));
    }
  }
  return max;
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
                color: SEV[c.severity ?? 'unknown'],
                weight: 2.5,
                fillColor: SEV[c.severity ?? 'unknown'],
                // Confirmed points are solid; unconfirmed stay as hollow rings,
                // so certainty is legible without reading a legend.
                fillOpacity: c.status === 'confirmed' ? 0.9 : 0.12,
              }}
              eventHandlers={{
                mouseover: e => onHover(b, map.latLngToContainerPoint(e.latlng)),
                mouseout: () => onHover(null),
                click: () => { onHover(null); onPick(b); },
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
              click: () => {
                onHover(null);
                // Zooming only helps if the points would actually separate.
                // Reports at the same spot stay merged at every zoom level, so
                // clicking would look broken; open them instead.
                if (spreadMeters(b.items) > 12 && map.getZoom() < 18) {
                  map.flyTo([b.lat, b.lon], map.getZoom() + 2, { duration: .6 });
                } else {
                  onPick(b);
                }
              },
            }}
          />
        );
      })}
    </>
  );
}

function Heat({ rows }: { rows: Cluster[] }) {
  const map = useMap();
  useEffect(() => {
    if (!rows.length) return;
    // Severity drives intensity, so a single severe pothole still shows up
    // against a cluster of minor ones rather than being averaged away.
    const pts = rows.map(r => [
      r.lat, r.lon,
      (RANK[r.severity ?? 'low'] ?? 1) / 3,
    ] as [number, number, number]);

    // `max` is the intensity that maps to the top of the gradient. Left at the
    // default of 1 it saturates almost immediately — every cluster of three
    // reports turns solid red and the scale stops carrying information. Scaling
    // it to the actual data keeps green and amber meaningful.
    const peak = Math.max(3, Math.sqrt(rows.length));

    const layer = (L as any).heatLayer(pts, {
      radius: 20,
      blur: 24,
      max: peak,
      maxZoom: HEAT_MAX_ZOOM,
      minOpacity: 0.28,
      gradient: { 0.25: '#10b981', 0.45: '#84cc16', 0.65: '#f59e0b', 0.85: '#ef4444' },
    }).addTo(map);

    return () => { map.removeLayer(layer); };
  }, [rows, map]);
  return null;
}

/**
 * Leaflet measures its container once, at construction. Inside a grid or a
 * reveal animation the final size is not known yet, so the map paints into a
 * stale box and leaves blank bands. Re-measure once laid out, and on resize.
 */
function Resizer() {
  const map = useMap();
  useEffect(() => {
    const fix = () => map.invalidateSize({ animate: false });
    const t = setTimeout(fix, 60);
    const ro = new ResizeObserver(fix);
    ro.observe(map.getContainer());
    return () => { clearTimeout(t); ro.disconnect(); };
  }, [map]);
  return null;
}

function FitAll({ rows }: { rows: Cluster[] }) {
  const map = useMap();
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    // Always frame the whole city first. Fitting tightly to the reports would
    // make three clustered points look like the entire problem, and the view
    // would jump around as new data arrives.
    map.fitBounds(TLEMCEN_BOUNDS, { animate: false, padding: [20, 20] });
  }, [rows, map]);
  return null;
}

/** Renders heat or points depending on how far in the user has zoomed. */
function ZoomSwitch({ rows, onHover, onPick }: {
  rows: Cluster[];
  onHover: (b: Bubble | null, px?: { x: number; y: number }) => void;
  onPick: (b: Bubble) => void;
}) {
  const map = useMap();
  const [zoom, setZoom] = useState(map.getZoom());
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) });

  return zoom < HEAT_MAX_ZOOM
    ? <Heat rows={rows} />
    : <Bubbles rows={rows} onHover={onHover} onPick={onPick} />;
}

interface Props {
  rows: Cluster[];
  height?: 'hero' | 'tall' | 'bleed';
  showFilters?: boolean;
  showStats?: boolean;
  interactive?: boolean;
  theme?: 'dark' | 'light';
  /** Hero use: no panels, no interaction, just the visual. */
  bare?: boolean;
  zoom?: number;
}

export default function MapView({
  rows, height = 'hero', showFilters = false, showStats = true,
  interactive = true, theme = 'light', bare = false, zoom = 12,
}: Props) {
  const [sev, setSev] = useState<string>('all');
  const [hover, setHover] = useState<{ b: Bubble; x: number; y: number } | null>(null);
  const [picked, setPicked] = useState<Cluster[] | null>(null);

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
    <div className={'map-card ' + height + ' ' + theme}>
      <MapContainer
        center={TLEMCEN} zoom={zoom} zoomControl={false}
        style={{ height: '100%', width: '100%' }}
        scrollWheelZoom={interactive} dragging={interactive}
        doubleClickZoom={interactive} touchZoom={interactive}
        attributionControl
      >
        {/* Positron: a muted light basemap, so the data is the loudest thing
            on screen rather than the streets. */}
        <TileLayer
          url={theme === 'dark'
            ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
            : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'}
          attribution='&copy; OpenStreetMap &copy; CARTO'
          maxZoom={20}
        />
        <ZoomSwitch
          rows={view}
          onHover={onHover}
          onPick={b => setPicked(b.items)}
        />
        <FitAll rows={rows} />
        <Resizer />
      </MapContainer>

      {!bare && showStats && (
        <div className="map-panel map-stat">
          <div><b>{counts.all}</b><span>signalements</span></div>
          <div><b style={{ color: SEV.high }}>{counts.high}</b><span>graves</span></div>
        </div>
      )}

      {!bare && showFilters && (
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

      {!bare && height === 'tall' && <div className="map-panel map-legend">
        {(['high', 'medium', 'low'] as const).map(k => (
          <div className="row" key={k}>
            <span className="sw" style={{ background: SEV[k] }} />
            {SEVERITY_LABEL[k]}
          </div>
        ))}
        <div className="row" style={{ marginTop: 10, opacity: .62, fontSize: '.72rem' }}>
          Cercle plein = confirmé
        </div>
      </div>}

      {hoverCard}

      {picked && <FocusCard items={picked} onClose={() => setPicked(null)} />}

    </div>
  );
}
