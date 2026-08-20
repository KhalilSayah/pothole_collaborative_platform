// The ride lifecycle, including the mandatory mount-stabilisation step.
//
// Recording cannot begin until the phone is fixed in its holder and the sensor
// frame has been measured. This is a hard gate on purpose: without a correct
// gravity reference every severity number would be wrong, and wrong in a way
// that looks perfectly plausible in the data.

import { useEffect, useRef, useState } from 'react';
import type { RideController, RideStats } from '../lib/ride';
import type { CalibrationState, CalibrationResult } from '../lib/accel';
import { PotholeDetector } from '../lib/accel';

interface Props {
  ride: RideController;
  stats: RideStats;
  detState: CalibrationState;
  detDetail?: string;
  running: boolean;
  onStart: () => void;
  onStop: () => void;
  accelEnabled: boolean;
  setAccelEnabled: (v: boolean) => void;
  training: boolean;
  setTraining: (v: boolean) => void;
}

const STEPS = [
  'Placez le téléphone sur son support, bien fixé.',
  'Écran vers vous, véhicule à l’arrêt.',
  'Ne touchez pas le téléphone pendant la mesure.',
];

export default function Ride({
  ride, stats, detState, detDetail, running, onStart, onStop,
  accelEnabled, setAccelEnabled, training, setTraining,
}: Props) {
  const [calib, setCalib] = useState<CalibrationResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [snap, setSnap] = useState(ride.detector.snapshot());
  const timer = useRef<number | null>(null);

  useEffect(() => {
    const iv = setInterval(() => setSnap(ride.detector.snapshot()), 500);
    return () => clearInterval(iv);
  }, [ride]);

  async function calibrate() {
    setErr(null);
    setBusy(true);
    setProgress(0);
    try {
      const ok = await PotholeDetector.requestPermission();
      if (!ok) {
        throw new Error(
          "Accès aux capteurs refusé. Sur iPhone : Réglages → Safari → Mouvement et orientation.");
      }
      ride.attachMotion();

      const DUR = 4000;
      const t0 = Date.now();
      timer.current = window.setInterval(
        () => setProgress(Math.min(1, (Date.now() - t0) / DUR)), 80);

      const res = await ride.detector.startCalibration(DUR);
      setCalib(res);
    } catch (e: any) {
      setErr(e.message ?? String(e));
      setCalib(null);
    } finally {
      if (timer.current) clearInterval(timer.current);
      setBusy(false);
      setProgress(1);
    }
  }

  const ready = detState === 'ready' || detState === 'recording';
  const canStart = !accelEnabled || ready;

  return (
    <>
      {detState === 'mount_lost' && (
        <div className="banner bad">
          <b>Le téléphone a bougé.</b> {detDetail} Les mesures d’intensité ne sont
          plus fiables — refaites la calibration à l’arrêt.
        </div>
      )}

      {/* ---------------- ride state ---------------- */}
      <div className="card">
        <div className="grid3">
          <div className="stat"><b>{(stats.distance_m / 1000).toFixed(1)}</b><span>km</span></div>
          <div className="stat"><b>{Math.floor(stats.duration_s / 60)}:{String(Math.floor(stats.duration_s % 60)).padStart(2, '0')}</b><span>durée</span></div>
          <div className="stat"><b>{Math.round(stats.speed_kmh)}</b><span>km/h</span></div>
        </div>
        <div className="grid2" style={{ marginTop: 12 }}>
          <div className="stat"><b>{stats.n_manual}</b><span>signalés</span></div>
          <div className="stat"><b>{stats.n_accel}</b><span>détectés</span></div>
        </div>
      </div>

      {!running ? (
        <button className="btn big" disabled={!canStart} onClick={onStart}>
          ▶︎ Démarrer le trajet
        </button>
      ) : (
        <button className="btn big danger" onClick={onStop}>■ Terminer le trajet</button>
      )}
      {!canStart && (
        <p className="muted" style={{ textAlign: 'center', marginTop: 10 }}>
          Calibrez le capteur avant de démarrer, ou désactivez la détection automatique.
        </p>
      )}

      {/* ---------------- methods ---------------- */}
      <h2 style={{ fontSize: 15, margin: '20px 0 10px' }}>Méthodes de collecte</h2>

      <div className="method-row">
        <span className="ic">👆</span>
        <div className="grow">
          <b>Signalement manuel</b>
          <div className="muted">Vous appuyez sur une carte en passant</div>
        </div>
        <span className="badge" style={{ color: 'var(--ok)' }}>Actif</span>
      </div>

      <div className={'method-row' + (accelEnabled ? '' : ' disabled')}>
        <span className="ic">📳</span>
        <div className="grow">
          <b>Détection automatique</b>
          <div className="muted">
            {accelEnabled
              ? 'L’accéléromètre détecte les chocs en arrière-plan'
              : 'Désactivée'}
          </div>
        </div>
        <input
          type="checkbox" checked={accelEnabled}
          onChange={e => setAccelEnabled(e.target.checked)}
          style={{ width: 24, height: 24 }}
        />
      </div>

      {accelEnabled && (
        <div className={'method-row' + (training ? '' : ' disabled')}
             style={training ? { borderColor: 'var(--warn)' } : undefined}>
          <span className="ic">🎓</span>
          <div className="grow">
            <b>Mode entraînement</b>
            <div className="muted">
              {training
                ? 'Seuil abaissé — vous étiquetez chaque choc détecté'
                : 'Collecte de données étiquetées pour améliorer la détection'}
            </div>
          </div>
          <input
            type="checkbox" checked={training}
            onChange={e => setTraining(e.target.checked)}
            style={{ width: 24, height: 24 }}
          />
        </div>
      )}

      {training && (
        <div className="banner">
          <b>Mode entraînement actif.</b> L’application détecte beaucoup plus
          largement et vous demande de nommer chaque événement&nbsp;: nid-de-poule,
          dos d’âne, freinage ou route normale. Elle enregistre aussi
          régulièrement des extraits de route normale, indispensables pour savoir
          à quoi ressemble l’absence de défaut. À utiliser sur un trajet connu,
          idéalement avec un passager pour répondre.
        </div>
      )}

      <div className="method-row disabled">
        <span className="ic">📷</span>
        <div className="grow">
          <b>Caméra + GPS</b>
          <div className="muted">
            Nécessite un traitement vidéo lourd — réservé aux utilisateurs avancés
          </div>
        </div>
        <span className="badge">Avancé</span>
      </div>

      {/* ---------------- calibration ---------------- */}
      {accelEnabled && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2>Calibration du capteur</h2>

          {!calib && !busy && (
            <>
              <p className="muted" style={{ marginBottom: 10 }}>
                Le téléphone doit être <b>fixé et immobile</b> avant la mesure. La
                calibration détermine la verticale : sans elle, l’intensité des chocs
                serait fausse.
              </p>
              <ol className="muted" style={{ margin: '0 0 14px 18px', padding: 0 }}>
                {STEPS.map(s => <li key={s} style={{ marginBottom: 4 }}>{s}</li>)}
              </ol>
            </>
          )}

          {busy && (
            <>
              <p className="muted">Mesure en cours — ne touchez pas le téléphone…</p>
              <div className="meter" style={{ marginTop: 10 }}>
                <i style={{ width: `${progress * 100}%` }} />
              </div>
            </>
          )}

          {err && <div className="banner bad" style={{ marginTop: 12 }}>{err}</div>}

          {calib && (
            <>
              <div className="banner ok">
                Calibration réussie — stabilité {calib.wobble_deg.toFixed(1)}°
              </div>
              <div className="grid3">
                <div className="stat">
                  <b>{(calib.noise_floor_g * 1000).toFixed(0)}</b><span>bruit mg</span>
                </div>
                <div className="stat">
                  <b>{snap.threshold_g.toFixed(2)}</b><span>seuil g</span>
                </div>
                <div className="stat">
                  <b>{calib.sample_hz.toFixed(0)}</b><span>Hz</span>
                </div>
              </div>
              <p className="muted" style={{ marginTop: 10 }}>
                Le seuil s’adapte en continu à la rugosité de la route. Inclinaison
                actuelle&nbsp;: {snap.tilt_deg.toFixed(1)}° par rapport à la référence.
              </p>
            </>
          )}

          <button
            className="btn ghost" style={{ marginTop: 12 }}
            onClick={calibrate} disabled={busy}
          >
            {calib ? 'Recalibrer' : 'Calibrer le capteur'}
          </button>
        </div>
      )}
    </>
  );
}
