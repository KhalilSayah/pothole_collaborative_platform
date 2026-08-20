// The calibration question.
//
// When the detector fires and the driver did NOT report anything, we ask
// whether it was real. That answer is a labelled example tied to a stored
// waveform, and it is the only way to turn the threshold from a guess into a
// measured value. It auto-dismisses so it can never distract for long.

import { useEffect, useState } from 'react';
import type { AccelEvent } from '../lib/types';
import type { AccelLabel } from '../lib/labels';

interface Props {
  event: AccelEvent;
  onAnswer: (a: AccelLabel | 'dismissed', latency_ms: number) => void;
  timeoutMs?: number;
}

export default function AccelPrompt({ event, onAnswer, timeoutMs = 9000 }: Props) {
  const [shownAt] = useState(() => Date.now());
  const [left, setLeft] = useState(timeoutMs);

  useEffect(() => {
    const iv = setInterval(() => {
      const rem = timeoutMs - (Date.now() - shownAt);
      setLeft(rem);
      // No answer is not the same as "no" — it is missing data, and recording
      // it as a negative would poison the training set.
      if (rem <= 0) onAnswer('dismissed', Date.now() - shownAt);
    }, 100);
    return () => clearInterval(iv);
  }, [shownAt, timeoutMs, onAnswer]);

  // Yes maps to 'pothole', No to 'road_vibration' — the same vocabulary the
  // training prompt uses, so both modes feed one consistent dataset.
  const answer = (a: AccelLabel) => onAnswer(a, Date.now() - shownAt);

  return (
    <div className="prompt-back">
      <div className="prompt">
        <div className="head">
          <h3>Un choc a été détecté</h3>
          <p className="muted">
            Intensité {Math.abs(event.peak_g).toFixed(2)} g
            {event.axle_confirmed ? ' · confirmé par la roue arrière' : ''}
            {' · '}{event.leading_sign < 0 ? 'creux' : 'bosse'}
          </p>
          <p className="muted" style={{ marginTop: 4 }}>
            Est-ce un vrai défaut de la chaussée&nbsp;?
          </p>
          <div className="meter" style={{ marginTop: 10 }}>
            <i style={{ width: `${Math.max(0, (left / timeoutMs) * 100)}%` }} />
          </div>
        </div>
        <div className="row">
          <button className="btn" onClick={() => answer('pothole')}>Oui</button>
          <button className="btn ghost" onClick={() => answer('road_vibration')}>Non</button>
        </div>
      </div>
    </div>
  );
}
