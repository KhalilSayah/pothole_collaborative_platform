// Detail panel for a single pothole, opened by clicking its marker.
//
// The photo is the point: a coloured dot asserts that damage exists, the
// picture lets someone judge it for themselves. Everything else on the card is
// there to answer "should I believe this?" — how many independent passes saw
// it, by which methods, and how sure the system is.

import { useEffect, useState } from 'react';
import type { Cluster } from '../lib/types';
import { publicPhotoUrl } from '../lib/supabase';
import { cardFor, SEVERITY_LABEL } from '../lib/damage';

const SEV: Record<string, string> = {
  high: '#ef4444', medium: '#f59e0b', low: '#10b981', unknown: '#94a3b8',
};

const METHOD_LABEL: Record<string, string> = {
  photo: 'Photo piéton',
  manual: 'Signalement au volant',
  accel: 'Détection automatique',
  camera: 'Caméra embarquée',
};

function when(iso?: string) {
  if (!iso) return null;
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days === 0) return "aujourd'hui";
  if (days === 1) return 'hier';
  if (days < 30) return `il y a ${days} jours`;
  return d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
}

export default function FocusCard({ item, onClose }: { item: Cluster; onClose: () => void }) {
  const [imgState, setImgState] = useState<'load' | 'ok' | 'fail'>('load');
  const url = item.image_path ? publicPhotoUrl(item.image_path) : null;
  const card = cardFor(item.damage_type ?? 'other');
  const colour = SEV[item.severity ?? 'unknown'];

  // Escape closes. A panel over a map with no keyboard exit is a trap.
  useEffect(() => {
    const f = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, [onClose]);

  useEffect(() => { setImgState(url ? 'load' : 'fail'); }, [url]);

  return (
    <div className="focus">
      <button className="focus-x" onClick={onClose} aria-label="Fermer">✕</button>

      <div className="focus-photo" style={{ background: url ? undefined : '#f1f5f9' }}>
        {url && (
          <img
            src={url} alt={card?.label ?? 'Défaut signalé'}
            onLoad={() => setImgState('ok')}
            onError={() => setImgState('fail')}
            style={{ opacity: imgState === 'ok' ? 1 : 0 }}
          />
        )}
        {imgState !== 'ok' && (
          <div className="focus-nophoto">
            <span style={{ fontSize: 30 }}>{imgState === 'load' ? '' : card?.icon ?? '🕳️'}</span>
            {imgState === 'load'
              ? <span className="spin" />
              : <span className="small muted">
                  {url ? 'Photo indisponible' : 'Pas de photo — signalé par capteur'}
                </span>}
          </div>
        )}
        <span className="focus-sev" style={{ background: colour }}>
          {SEVERITY_LABEL[item.severity ?? 'low'] ?? '—'}
        </span>
      </div>

      <div className="focus-body">
        <h3>{card?.label ?? 'Défaut de chaussée'}</h3>
        <p className="small muted" style={{ marginTop: 2 }}>
          {item.road_name ?? 'Route non nommée'}
          {when(item.last_seen) ? ` · vu ${when(item.last_seen)}` : ''}
        </p>

        <div className="focus-conf">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="small" style={{ fontWeight: 600 }}>Fiabilité</span>
            <span className="small muted">{Math.round(item.confidence * 100)}%</span>
          </div>
          <div className="meter" style={{ marginTop: 6 }}>
            <i style={{ width: `${item.confidence * 100}%`, background: colour }} />
          </div>
          <p className="small muted" style={{ marginTop: 8 }}>
            {item.status === 'confirmed'
              ? `Confirmé par ${item.n_rides} passages indépendants.`
              : 'Signalé une seule fois — pas encore recoupé.'}
          </p>
        </div>

        <div className="focus-meta">
          <div><b>{item.n_observations}</b><span>observation{item.n_observations > 1 ? 's' : ''}</span></div>
          <div><b>{item.n_rides}</b><span>trajet{item.n_rides > 1 ? 's' : ''}</span></div>
        </div>

        <div className="focus-methods">
          {(item.method_mix ?? []).map(m => (
            <span key={m} className="pill" style={{ fontSize: '.72rem' }}>
              {METHOD_LABEL[m] ?? m}
            </span>
          ))}
        </div>

        <p className="small muted" style={{ marginTop: 12 }}>
          {item.lat.toFixed(5)}, {item.lon.toFixed(5)}
        </p>
      </div>
    </div>
  );
}
