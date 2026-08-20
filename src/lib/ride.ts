// ============================================================================
//  Ride controller — owns GPS, the detector, the observation log and the queue.
//
//  Anonymity: a ride id is a random UUID generated on the device and never
//  linked to anything persistent. Two rides by the same driver are, by
//  construction, not connectable to each other.
// ============================================================================

import { PotholeDetector, type DetectorConfig, type CalibrationState } from './accel';
import type { AccelEvent, DamageType, Observation, Severity } from './types';
import { haversine, reactionCorrect } from './geo';
import { enqueue } from './queue';
import { NON_DEFECT, labelFor, type AccelLabel } from './labels';

export const APP_VERSION = '1.0.0';

/** Median human reaction: notice the impact, find the card, tap it. */
export const DEFAULT_REACTION_LAG_S = 1.4;

function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function platform() {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'other';
}

export interface RideStats {
  distance_m: number;
  duration_s: number;
  n_manual: number;
  n_accel: number;
  speed_kmh: number;
  gps_accuracy_m: number | null;
  fixes: number;
}

export class RideController {
  id = uuid();
  startedAt = 0;
  running = false;

  detector: PotholeDetector;
  reaction_lag_s = DEFAULT_REACTION_LAG_S;

  /** Training mode collects labelled waveforms instead of just reporting. */
  get trainingMode() { return this.detector.trainingMode; }
  set trainingMode(v: boolean) { this.detector.trainingMode = v; }

  private watchId: number | null = null;
  private motionHandler: ((e: DeviceMotionEvent) => void) | null = null;

  last: GeolocationCoordinates | null = null;
  lastFixAt = 0;
  track: { lat: number; lon: number; t: number }[] = [];

  stats: RideStats = {
    distance_m: 0, duration_s: 0, n_manual: 0, n_accel: 0,
    speed_kmh: 0, gps_accuracy_m: null, fixes: 0,
  };

  observations: Observation[] = [];

  onStats: ((s: RideStats) => void) | null = null;
  onAccelEvent: ((e: AccelEvent, obsId: string) => void) | null = null;
  onDetectorState: ((s: CalibrationState, detail?: string) => void) | null = null;
  onGpsError: ((msg: string) => void) | null = null;

  constructor(cfg: Partial<DetectorConfig> = {}) {
    this.detector = new PotholeDetector(cfg);
    this.detector.onState = (s, d) => this.onDetectorState?.(s, d);
    this.detector.onEvent = e => this.handleAccelEvent(e);
  }

  // -------------------------------------------------------------- sensors
  attachMotion() {
    if (this.motionHandler) return;
    this.motionHandler = (e: DeviceMotionEvent) => {
      const a = e.accelerationIncludingGravity;
      if (!a || a.x == null || a.y == null || a.z == null) return;
      this.detector.push(a.x, a.y, a.z, Date.now());
    };
    window.addEventListener('devicemotion', this.motionHandler);
  }

  detachMotion() {
    if (this.motionHandler) {
      window.removeEventListener('devicemotion', this.motionHandler);
      this.motionHandler = null;
    }
  }

  startGps() {
    if (this.watchId != null) return;
    if (!navigator.geolocation) {
      this.onGpsError?.('This device has no geolocation.');
      return;
    }
    this.watchId = navigator.geolocation.watchPosition(
      pos => this.onFix(pos),
      err => this.onGpsError?.(err.message),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 },
    );
  }

  stopGps() {
    if (this.watchId != null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
  }

  private onFix(pos: GeolocationPosition) {
    const c = pos.coords;
    const t = pos.timestamp || Date.now();

    if (this.last && this.running) {
      const d = haversine(this.last.latitude, this.last.longitude, c.latitude, c.longitude);
      // Ignore sub-3 m jumps: stationary GPS wanders, and counting that drift
      // would inflate ride distance by kilometres over an hour parked.
      if (d > 3 && d < 200) this.stats.distance_m += d;
    }

    this.last = c;
    this.lastFixAt = t;
    this.stats.fixes += 1;
    this.stats.gps_accuracy_m = c.accuracy ?? null;
    this.stats.speed_kmh = c.speed != null ? Math.max(0, c.speed * 3.6) : 0;
    this.detector.speed_mps = c.speed ?? null;

    this.track.push({ lat: c.latitude, lon: c.longitude, t });
    // ~60 s of history is all the reaction correction can ever need.
    if (this.track.length > 300) this.track.shift();

    if (this.running) this.stats.duration_s = (Date.now() - this.startedAt) / 1000;
    this.onStats?.({ ...this.stats });
  }

  // -------------------------------------------------------------- lifecycle
  async start() {
    this.startedAt = Date.now();
    this.running = true;
    this.detector.startRecording();

    await enqueue('ride', {
      id: this.id,
      started_at: new Date(this.startedAt).toISOString(),
      platform: platform(),
      app_version: APP_VERSION,
      detector_config: { ...this.detector.cfg, reaction_lag_s: this.reaction_lag_s },
    });
  }

  async stop() {
    this.running = false;
    this.detector.stopRecording();
    this.stats.duration_s = (Date.now() - this.startedAt) / 1000;
    await enqueue('ride_close', {
      id: this.id,
      ended_at: new Date().toISOString(),
      distance_m: Math.round(this.stats.distance_m),
      duration_s: Math.round(this.stats.duration_s),
      n_observations: this.observations.length,
    });
  }

  // -------------------------------------------------------------- reporting
  private base() {
    const c = this.last;
    if (!c) return null;
    return {
      lat: c.latitude,
      lon: c.longitude,
      gps_accuracy_m: c.accuracy ?? null,
      speed_mps: c.speed ?? null,
      heading_deg: c.heading ?? null,
    };
  }

  /** Method 3 — driver tapped a card. */
  async reportManual(type: DamageType, severity: Severity = 'medium'): Promise<Observation | null> {
    const b = this.base();
    if (!b) return null;

    const corr = reactionCorrect(
      b.lat, b.lon, b.heading_deg, b.speed_mps,
      this.reaction_lag_s, this.track, Date.now(),
    );

    const obs: Observation = {
      id: uuid(),
      ride_id: this.id,
      method: 'manual',
      observed_at: new Date().toISOString(),
      t_offset_ms: Date.now() - this.startedAt,
      ...b,
      corrected_lat: corr.lat,
      corrected_lon: corr.lon,
      position_correction_m: +corr.correction_m.toFixed(1),
      damage_type: type,
      severity,
      // A human looked at it. Highest confidence any single source can carry.
      confidence: 0.95,
      payload: { reaction_lag_s: this.reaction_lag_s },
    };

    this.observations.push(obs);
    this.stats.n_manual += 1;
    await enqueue('observation', obs);
    this.onStats?.({ ...this.stats });
    return obs;
  }

  /** Method 2 — the detector fired. */
  private async handleAccelEvent(e: AccelEvent) {
    const b = this.base();
    if (!b) return;

    const obs: Observation = {
      id: uuid(),
      ride_id: this.id,
      method: 'accel',
      observed_at: new Date(e.t).toISOString(),
      t_offset_ms: e.t - this.startedAt,
      ...b,
      // An impact is felt at the instant it happens, so unlike a manual tap
      // there is no reaction lag to undo.
      corrected_lat: null,
      corrected_lon: null,
      position_correction_m: 0,
      damage_type: e.guessed_type,
      severity: e.severity,
      // Corroboration inside the event itself raises trust: a rear-axle echo at
      // the predicted delay is hard to produce by accident.
      confidence: Math.min(0.9, 0.35 + (e.axle_confirmed ? 0.2 : 0) +
                                 Math.min(e.z_score / 20, 0.35)),
      payload: {
        peak_g: e.peak_g, z_score: e.z_score,
        baseline_g: e.baseline_g, sigma_g: e.sigma_g,
        leading_sign: e.leading_sign, axle_confirmed: e.axle_confirmed,
        duration_ms: e.duration_ms, severity_index: e.severity_index,
        waveform: e.waveform, sample_hz: e.sample_hz,
      },
    };

    this.observations.push(obs);
    this.stats.n_accel += 1;
    await enqueue('observation', obs);
    this.onStats?.({ ...this.stats });
    this.onAccelEvent?.(e, obs.id);
  }

  /**
   * Record a label for a detected event.
   *
   * In training mode the driver names the class; the label also decides whether
   * the observation should count as a road defect at all. Labelling a jolt as
   * braking or normal vibration RETRACTS it from the public map — otherwise
   * every heavy brake would become a permanent fake pothole.
   */
  async sendLabel(observation_id: string, label: AccelLabel | 'dismissed', latency_ms: number) {
    await enqueue('feedback', {
      observation_id, label, latency_ms,
      training_mode: this.trainingMode,
    });

    const obs = this.observations.find(o => o.id === observation_id);
    if (obs && label !== 'dismissed') {
      const opt = labelFor(label as AccelLabel);
      obs.damage_type = opt?.damage ?? null;
      if (NON_DEFECT.includes(label as AccelLabel)) {
        // Not a road defect. Drop the confidence to zero so the fusion step
        // cannot promote it into a cluster.
        obs.confidence = 0;
        obs.severity = null;
      } else {
        obs.confidence = 0.95;   // a human named it
      }
      await enqueue('observation_patch', {
        id: observation_id,
        damage_type: obs.damage_type,
        severity: obs.severity,
        confidence: obs.confidence,
      });
    }
  }

  /**
   * Did the driver already report this by hand?
   *
   * If so, the calibration prompt must not appear — asking about a pothole the
   * driver just tapped is both annoying and useless as a label.
   */
  recentManualNear(t: number, windowMs = 6000) {
    return this.observations.some(
      o => o.method === 'manual' && Math.abs((o.t_offset_ms + this.startedAt) - t) < windowMs,
    );
  }
}
