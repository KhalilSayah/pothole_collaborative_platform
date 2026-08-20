// TRAINING MODE prompt — multi-class labelling.
//
// The binary "was it a pothole?" question tells a model only that something was
// not a pothole. Naming what it actually WAS is far more informative: the hard
// cases are speed bumps and heavy braking, which look similar to a pothole in
// peak magnitude and differ in shape. A classifier can only learn that boundary
// if the training labels draw it.

import { useEffect, useState } from 'react';
import type { AccelEvent } from '../lib/types';
import { LABELS, type AccelLabel } from '../lib/labels';

interface Props {
  event: AccelEvent;
  onAnswer: (label: AccelLabel | 'dismissed', latency_ms: number) => void;
  timeoutMs?: number;
}

export default function TrainingPrompt({ event, onAnswer, timeoutMs = 15000 }: Props) {
  const [shownAt] = useState(() => Date.now());
  const [left, setLeft] = useState(timeoutMs);

  useEffect(() => {
    const iv = setInterval(() => {
      const rem = timeoutMs - (Date.now() - shownAt);
      setLeft(rem);
      if (rem <= 0) onAnswer('dismissed', Date.now() - shownAt);
    }, 100);
    return () => clearInterval(iv);
  }, [shownAt, timeoutMs, onAnswer]);

  return (
    <div className="prompt-back">
      <div className="prompt train">
        <div className="train-head">
          <h3>Qu’est-ce que c’était&nbsp;?</h3>
          <p className="muted">
            {Math.abs(event.peak_g).toFixed(2)} g · {event.duration_ms} ms
            {event.axle_confirmed ? ' · roue arrière' : ''}
            {' · '}{event.leading_sign < 0 ? 'creux d’abord' : 'bosse d’abord'}
          </p>
          <div className="meter" style={{ marginTop: 8 }}>
            <i style={{ width: `${Math.max(0, (left / timeoutMs) * 100)}%` }} />
          </div>
        </div>

        <div className="train-grid">
          {LABELS.map(o => (
            <button
              key={o.label}
              className="tcard"
              style={{ borderColor: o.color + '66' }}
              onClick={() => onAnswer(o.label, Date.now() - shownAt)}
            >
              <span className="ic">{o.icon}</span>
              <span className="tx">{o.text}</span>
              <span className="hint" lang="ar" dir="rtl">{o.ar}</span>
            </button>
          ))}
        </div>

        <button
          className="btn ghost" style={{ marginTop: 8 }}
          onClick={() => onAnswer('unsure', Date.now() - shownAt)}
        >Je ne sais pas</button>
      </div>
    </div>
  );
}
