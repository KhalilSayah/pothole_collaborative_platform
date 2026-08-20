// METHOD 3 — one-tap reporting. The screen a driver actually looks at.

import { useState } from 'react';
import { CARDS } from '../lib/damage';
import type { DamageType } from '../lib/types';

interface Props {
  active: boolean;
  onReport: (t: DamageType) => Promise<boolean>;
}

export default function Report({ active, onReport }: Props) {
  // Which cards are flashing their confirmation, keyed by type.
  const [hits, setHits] = useState<Record<string, number>>({});

  async function tap(type: DamageType) {
    // Confirm instantly and optimistically. The driver has already looked back
    // at the road; a spinner they never see would be worse than useless, and
    // the report is queued locally so it cannot be lost anyway.
    setHits(h => ({ ...h, [type]: Date.now() }));
    if (navigator.vibrate) navigator.vibrate(35);
    setTimeout(() => setHits(h => {
      const n = { ...h };
      delete n[type];
      return n;
    }), 700);
    await onReport(type);
  }

  if (!active) {
    return (
      <div className="report-off">
        <div>
          <div style={{ fontSize: 40, marginBottom: 10 }}>🅿️</div>
          <b style={{ color: 'var(--text)', fontSize: 17 }}>Trajet non démarré</b>
          <p className="muted" style={{ marginTop: 6 }}>
            Fixez le téléphone sur son support, puis démarrez le trajet
            depuis l’onglet Trajet.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="report">
      {CARDS.map(c => (
        <button
          key={c.type}
          className={'dcard' + (hits[c.type] ? ' hit' : '')}
          style={hits[c.type] ? undefined : { borderColor: c.color + '55' }}
          onClick={() => tap(c.type)}
        >
          <span className="icon">{hits[c.type] ? '✓' : c.icon}</span>
          <span className="label">{hits[c.type] ? 'Signalé' : c.label}</span>
          <span className="sub">{c.sub}</span>
        </button>
      ))}
    </div>
  );
}
