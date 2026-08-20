import MapView from '../components/MapView';
import type { Cluster } from '../lib/types';

export default function Explore({ rows, loading }: { rows: Cluster[]; loading: boolean }) {
  return (
    <div style={{ position: 'relative' }}>
      <MapView rows={rows} height="tall" showFilters showStats={!loading} />
      {loading && (
        <div className="map-panel" style={{
          left: '50%', top: 24, transform: 'translateX(-50%)', padding: '10px 16px',
        }}>
          <div className="row"><span className="spin" />Chargement de la carte…</div>
        </div>
      )}
    </div>
  );
}
