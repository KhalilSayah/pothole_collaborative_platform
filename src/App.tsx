import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RideController, type RideStats } from './lib/ride';
import type { CalibrationState } from './lib/accel';
import type { AccelEvent, DamageType } from './lib/types';
import { startAutoSync, onSync, type SyncState } from './lib/sync';
import Report from './screens/Report';
import Ride from './screens/Ride';
import MapScreen from './screens/MapScreen';
import Settings from './screens/Settings';
import AccelPrompt from './components/AccelPrompt';
import TrainingPrompt from './components/TrainingPrompt';
import type { AccelLabel } from './lib/labels';

type Tab = 'report' | 'ride' | 'map' | 'settings';

export default function App() {
  const ride = useMemo(() => new RideController(), []);
  const [tab, setTab] = useState<Tab>('ride');
  const [running, setRunning] = useState(false);
  const [accelEnabled, setAccelEnabled] = useState(true);
  const [training, setTraining] = useState(false);

  const [stats, setStats] = useState<RideStats>(ride.stats);
  const [detState, setDetState] = useState<CalibrationState>('idle');
  const [detDetail, setDetDetail] = useState<string>();
  const [gpsErr, setGpsErr] = useState<string | null>(null);
  const [sync, setSync] = useState<SyncState>({ pending: 0, syncing: false, lastError: null, lastSyncAt: null });

  // The pending calibration question, if any.
  const [prompt, setPrompt] = useState<{ e: AccelEvent; obsId: string } | null>(null);
  const promptLock = useRef(false);

  // ---------------------------------------------------------------- wiring
  useEffect(() => {
    ride.onStats = setStats;
    ride.onDetectorState = (s, d) => { setDetState(s); setDetDetail(d); };
    ride.onGpsError = setGpsErr;

    ride.onAccelEvent = (e, obsId) => {
      if (promptLock.current) return;
      // Never ask about something the driver already reported by hand: it is
      // both irritating and worthless as a label.
      if (ride.recentManualNear(e.t)) return;
      promptLock.current = true;
      setPrompt({ e, obsId });
    };

    ride.startGps();
    const stopSync = startAutoSync();
    const offSync = onSync(setSync);
    return () => { stopSync(); offSync(); ride.stopGps(); ride.detachMotion(); };
  }, [ride]);

  // Keep the screen awake — a driver cannot unlock a phone mid-journey.
  useEffect(() => {
    let lock: any = null;
    const req = async () => {
      try {
        if (running && 'wakeLock' in navigator) {
          lock = await (navigator as any).wakeLock.request('screen');
        }
      } catch { /* not fatal */ }
    };
    req();
    const onVis = () => { if (document.visibilityState === 'visible' && running) req(); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      lock?.release?.().catch(() => {});
    };
  }, [running]);

  // ---------------------------------------------------------------- actions
  const start = useCallback(async () => {
    if (accelEnabled) ride.attachMotion();
    await ride.start();
    setRunning(true);
    setTab('report');   // straight to the screen used while driving
  }, [ride, accelEnabled]);

  const stop = useCallback(async () => {
    await ride.stop();
    setRunning(false);
    setTab('ride');
  }, [ride]);

  const report = useCallback(async (t: DamageType) => {
    const o = await ride.reportManual(t);
    if (!o) setGpsErr('Position GPS indisponible — signalement non enregistré.');
    return !!o;
  }, [ride]);

  const answer = useCallback(async (l: AccelLabel | 'dismissed', latency: number) => {
    if (prompt) await ride.sendLabel(prompt.obsId, l, latency);
    setPrompt(null);
    // Cool-down so a rough stretch cannot produce a burst of prompts. Shorter
    // in training mode, where collecting labels IS the task and the driver has
    // opted into being asked.
    setTimeout(() => { promptLock.current = false; }, training ? 4000 : 12000);
  }, [prompt, ride, training]);

  const setTrainingMode = useCallback((v: boolean) => {
    setTraining(v);
    ride.trainingMode = v;
  }, [ride]);

  const here: [number, number] | null =
    ride.last ? [ride.last.latitude, ride.last.longitude] : null;

  const gpsFresh = Date.now() - ride.lastFixAt < 10000;
  const gpsClass = !ride.last ? 'bad' : gpsFresh && (stats.gps_accuracy_m ?? 99) < 20 ? 'ok' : 'warn';

  return (
    <>
      <div className="topbar">
        <h1>Route Tlemcen</h1>
        {training && <span className="chip warn"><i className="dot" />Entraînement</span>}
        <div className="spacer" />
        <span className={'chip ' + gpsClass}>
          <i className={'dot' + (running ? ' pulse' : '')} />
          {ride.last ? `GPS ${Math.round(stats.gps_accuracy_m ?? 0)} m` : 'GPS…'}
        </span>
        {sync.pending > 0 && <span className="chip warn">↑ {sync.pending}</span>}
      </div>

      <div className={'content' + (tab === 'report' || tab === 'map' ? ' flush' : '')}>
        {tab === 'report' && <Report active={running} onReport={report} />}
        {tab === 'ride' && (
          <>
            {gpsErr && <div className="banner bad">{gpsErr}</div>}
            <Ride
              ride={ride} stats={stats} detState={detState} detDetail={detDetail}
              running={running} onStart={start} onStop={stop}
              accelEnabled={accelEnabled} setAccelEnabled={setAccelEnabled}
              training={training} setTraining={setTrainingMode}
            />
          </>
        )}
        {tab === 'map' && <MapScreen here={here} />}
        {tab === 'settings' && <Settings ride={ride} />}
      </div>

      <nav className="tabs">
        <button className={tab === 'report' ? 'active' : ''} onClick={() => setTab('report')}>
          <span className="i">👆</span>Signaler
        </button>
        <button className={tab === 'ride' ? 'active' : ''} onClick={() => setTab('ride')}>
          <span className="i">🚗</span>Trajet
        </button>
        <button className={tab === 'map' ? 'active' : ''} onClick={() => setTab('map')}>
          <span className="i">🗺️</span>Carte
        </button>
        <button className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}>
          <span className="i">⚙️</span>Réglages
        </button>
      </nav>

      {prompt && (training
        ? <TrainingPrompt event={prompt.e} onAnswer={answer} />
        : <AccelPrompt event={prompt.e} onAnswer={answer} />)}
    </>
  );
}
