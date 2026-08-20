// ============================================================================
//  Pothole detection from a phone accelerometer.
//
//  THE CORE PROBLEM
//  A phone in a car mount sits at an arbitrary angle, so its Z axis is NOT
//  vertical. Raw axis readings are therefore meaningless on their own. We must
//  first learn which direction is "down", then measure acceleration along it.
//
//  That is why recording cannot start until the phone is mounted and still:
//  the calibration step measures the gravity vector, and everything downstream
//  depends on it. A phone held in the hand, or re-seated mid-ride, invalidates
//  the reference frame — which the detector watches for and reports.
//
//  THE SECOND PROBLEM
//  A fixed threshold cannot work. A smooth asphalt road, a cobbled street, an
//  old Peugeot and a new SUV all have wildly different vibration floors. So the
//  trigger is ADAPTIVE: it continuously estimates the current road's own noise
//  level and fires only on excursions far outside it. The detector calibrates
//  itself to whatever surface it is on.
// ============================================================================

import type { AccelEvent, DamageType, Severity } from './types';

const G = 9.80665;

export interface DetectorConfig {
  /** Trigger at this many standard deviations above the current road's noise. */
  k_sigma: number;
  /** Absolute floor in g. Stops the detector firing on a glass-smooth road. */
  min_peak_g: number;
  /** Below this speed, ignore everything: door slams and handling dominate. */
  min_speed_mps: number;
  /** Suppression after a peak, to avoid re-triggering on the same impact. */
  refractory_ms: number;
  /** Half-width of the waveform saved with each event. */
  window_ms: number;
  /** Typical car wheelbase, for rear-axle confirmation. */
  wheelbase_m: number;

  /**
   * Trigger threshold while TRAINING. Deliberately far lower than production.
   *
   * A model trained only on events that already passed a strict 4.5-sigma gate
   * learns nothing about the boundary it is supposed to draw — every example is
   * an easy one. Dropping to ~2.5 sigma surfaces the marginal, genuinely
   * ambiguous jolts, which are the only ones that carry information.
   */
  training_k_sigma: number;

  /**
   * In training mode, capture a quiet stretch of road this often even when
   * nothing triggered.
   *
   * Without this the dataset would contain only jolts, and a classifier trained
   * on it would have never seen ordinary road. Those forced samples become the
   * 'road_vibration' negatives that define what NORMAL looks like.
   */
  training_negative_interval_ms: number;
}

export const DEFAULT_CONFIG: DetectorConfig = {
  // 4.5σ is deliberately conservative: on a Gaussian noise floor this fires on
  // roughly 1 sample in 300,000, so almost every trigger is a genuine transient
  // rather than ordinary road roughness. Tune from real Yes/No feedback.
  k_sigma: 4.5,
  min_peak_g: 0.18,
  min_speed_mps: 3.0,      // ~11 km/h
  refractory_ms: 450,
  window_ms: 1200,
  wheelbase_m: 2.6,
  training_k_sigma: 2.5,
  training_negative_interval_ms: 40000,
};

export type CalibrationState =
  | 'idle'
  | 'waiting_permission'
  | 'calibrating'
  | 'unstable'      // phone is being handled — cannot establish a reference
  | 'ready'
  | 'recording'
  | 'mount_lost';   // orientation changed mid-ride

export interface CalibrationResult {
  gravity: [number, number, number];
  gravity_magnitude: number;
  /** RMS of vertical noise while stationary — the engine/idle vibration floor. */
  noise_floor_g: number;
  /** Worst angular wobble seen during calibration, in degrees. */
  wobble_deg: number;
  sample_hz: number;
}

interface Sample { t: number; x: number; y: number; z: number; }

function norm(v: [number, number, number]) {
  return Math.hypot(v[0], v[1], v[2]);
}
function dot(a: [number, number, number], b: [number, number, number]) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Angle between two vectors, in degrees. */
function angleBetween(a: [number, number, number], b: [number, number, number]) {
  const c = dot(a, b) / (norm(a) * norm(b) || 1);
  return (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI;
}

export class PotholeDetector {
  cfg: DetectorConfig;
  state: CalibrationState = 'idle';

  /** Unit vector pointing "up" in device coordinates. Set by calibration. */
  private up: [number, number, number] = [0, 0, 1];
  private gravityMag = G;
  private calibUp: [number, number, number] = [0, 0, 1];

  // Adaptive noise model of the CURRENT road surface.
  private mean = 0;
  private variance = 0;
  private noiseReady = false;

  // Ring buffer of recent vertical acceleration, for waveform capture.
  private buf: { t: number; a: number }[] = [];
  private bufMs = 4000;

  private lastTrigger = 0;
  private sampleHz = 60;
  private lastT = 0;
  private intervals: number[] = [];

  // Pending peak awaiting its trailing window before it can be emitted.
  private pending: { t: number; peak: number; z: number; mu: number; sd: number } | null = null;

  private calibSamples: Sample[] = [];
  private calibStart = 0;

  onEvent: ((e: AccelEvent) => void) | null = null;
  onState: ((s: CalibrationState, detail?: string) => void) | null = null;

  /** Latest GPS speed, injected by the ride controller. */
  speed_mps: number | null = null;

  /** Training mode: lower threshold, plus forced negative sampling. */
  trainingMode = false;
  private lastNegativeAt = 0;

  constructor(cfg: Partial<DetectorConfig> = {}) {
    this.cfg = { ...DEFAULT_CONFIG, ...cfg };
  }

  private setState(s: CalibrationState, detail?: string) {
    if (this.state !== s) {
      this.state = s;
      this.onState?.(s, detail);
    }
  }

  // -------------------------------------------------------------- permission
  /** iOS 13+ requires an explicit user gesture before motion data is released. */
  static async requestPermission(): Promise<boolean> {
    const DME = (window as any).DeviceMotionEvent;
    if (!DME) return false;
    if (typeof DME.requestPermission !== 'function') return true; // Android
    try {
      return (await DME.requestPermission()) === 'granted';
    } catch {
      return false;
    }
  }

  static isSupported() {
    return typeof window !== 'undefined' && 'DeviceMotionEvent' in window;
  }

  // -------------------------------------------------------------- calibration
  /**
   * Learn the gravity direction while the phone sits mounted and still.
   *
   * This must happen AFTER the phone is fixed in its holder. It establishes the
   * vertical axis and the vehicle's idle vibration floor. If the phone moves
   * during this window the result is rejected, because a wrong "down" makes
   * every later measurement wrong in a way nothing downstream can detect.
   */
  startCalibration(durationMs = 4000) {
    this.calibSamples = [];
    this.calibStart = performance.now();
    this.setState('calibrating');

    return new Promise<CalibrationResult>((resolve, reject) => {
      const finish = () => {
        const s = this.calibSamples;
        if (s.length < 30) {
          this.setState('idle');
          return reject(new Error(
            'Not enough sensor data. Motion access may be blocked, or this device has no accelerometer.'));
        }

        const mean: [number, number, number] = [
          s.reduce((a, b) => a + b.x, 0) / s.length,
          s.reduce((a, b) => a + b.y, 0) / s.length,
          s.reduce((a, b) => a + b.z, 0) / s.length,
        ];
        const mag = norm(mean);

        // Sanity: a stationary phone must read ~1 g. Anything else means the
        // browser gave us linear acceleration, or the device was accelerating.
        if (Math.abs(mag - G) > 1.5) {
          this.setState('unstable');
          return reject(new Error(
            `Gravity reads ${(mag / G).toFixed(2)} g instead of 1.00 g — the vehicle is moving, or the sensor is unreliable. Stop the car and retry.`));
        }

        // Wobble: how much the gravity direction moved during the window. A
        // mounted phone barely moves; a handheld one swings several degrees.
        let wobble = 0;
        for (const q of s) wobble = Math.max(wobble, angleBetween(mean, [q.x, q.y, q.z]));

        const up: [number, number, number] = [mean[0] / mag, mean[1] / mag, mean[2] / mag];
        const vert = s.map(q => dot([q.x, q.y, q.z], up) - mag);
        const noise = Math.sqrt(vert.reduce((a, b) => a + b * b, 0) / vert.length) / G;

        const dt = (s[s.length - 1].t - s[0].t) / (s.length - 1);
        const hz = 1000 / Math.max(dt, 1);

        if (wobble > 6) {
          this.setState('unstable');
          return reject(new Error(
            `The phone moved ${wobble.toFixed(1)}° during calibration. Fix it firmly in the mount and try again.`));
        }

        this.up = up;
        this.calibUp = up;
        this.gravityMag = mag;
        this.mean = 0;
        this.variance = Math.max(noise, 0.004) ** 2;
        this.noiseReady = true;
        this.sampleHz = hz;

        this.setState('ready');
        resolve({ gravity: mean, gravity_magnitude: mag, noise_floor_g: noise, wobble_deg: wobble, sample_hz: hz });
      };

      const tick = () => {
        if (performance.now() - this.calibStart >= durationMs) finish();
        else setTimeout(tick, 200);
      };
      tick();
    });
  }

  // -------------------------------------------------------------- main loop
  /** Feed one raw devicemotion sample (accelerationIncludingGravity, m/s²). */
  push(x: number, y: number, z: number, t = Date.now()) {
    if (this.state === 'calibrating') {
      this.calibSamples.push({ t, x, y, z });
      return;
    }
    if (this.state !== 'recording') return;

    // Measured sample rate — Android varies widely, and every threshold that
    // depends on time needs the real value rather than an assumption.
    if (this.lastT) {
      this.intervals.push(t - this.lastT);
      if (this.intervals.length > 120) {
        this.intervals.shift();
        const med = [...this.intervals].sort((a, b) => a - b)[60];
        if (med > 0) this.sampleHz = 1000 / med;
      }
    }
    this.lastT = t;

    const raw: [number, number, number] = [x, y, z];
    const mag = norm(raw);

    // Track slow mount drift, but far too slowly to absorb an impact. A pothole
    // lasts ~100 ms; this filter has a ~2 s time constant, so impacts pass
    // through to the detector instead of being quietly averaged away.
    const alpha = 0.008;
    this.up = [
      this.up[0] * (1 - alpha) + (raw[0] / mag) * alpha,
      this.up[1] * (1 - alpha) + (raw[1] / mag) * alpha,
      this.up[2] * (1 - alpha) + (raw[2] / mag) * alpha,
    ];
    const un = norm(this.up);
    this.up = [this.up[0] / un, this.up[1] / un, this.up[2] / un];

    // If the phone's orientation has drifted far from the calibrated frame, the
    // mount has shifted or the phone was picked up. Severity numbers would be
    // wrong from here on, so say so rather than emitting bad data.
    if (angleBetween(this.up, this.calibUp) > 25) {
      this.setState('mount_lost', 'The phone has moved from its calibrated position.');
      return;
    }

    // Vertical dynamic acceleration, in g.
    const a = (dot(raw, this.up) - this.gravityMag) / G;

    this.buf.push({ t, a });
    const cut = t - this.bufMs;
    while (this.buf.length && this.buf[0].t < cut) this.buf.shift();

    // ---- adaptive noise floor -------------------------------------------
    // Frozen while a candidate event is in flight, so a violent impact cannot
    // inflate the baseline and mask the potholes right after it.
    const inEvent = this.pending !== null || (t - this.lastTrigger) < this.cfg.refractory_ms;
    if (!inEvent) {
      const b = 0.002;                       // ~8 s at 60 Hz
      this.mean = this.mean * (1 - b) + a * b;
      const d = a - this.mean;
      this.variance = this.variance * (1 - b) + d * d * b;
    }

    const sd = Math.sqrt(Math.max(this.variance, 1e-8));
    const zs = Math.abs(a - this.mean) / sd;

    // ---- trigger ---------------------------------------------------------
    const fast = (this.speed_mps ?? 0) >= this.cfg.min_speed_mps;
    const loud = Math.abs(a) >= this.cfg.min_peak_g;

    const kEff = this.trainingMode ? this.cfg.training_k_sigma : this.cfg.k_sigma;
    const loudEff = this.trainingMode
      ? Math.abs(a) >= this.cfg.min_peak_g * 0.5   // let marginal jolts through
      : loud;

    if (this.noiseReady && fast && loudEff && zs >= kEff &&
        t - this.lastTrigger > this.cfg.refractory_ms) {
      this.lastTrigger = t;
      this.pending = { t, peak: a, z: zs, mu: this.mean, sd };
    }

    // Grow the peak while the impact is still developing.
    if (this.pending && t - this.pending.t < this.cfg.refractory_ms) {
      if (Math.abs(a) > Math.abs(this.pending.peak)) {
        this.pending.peak = a;
        this.pending.z = zs;
      }
    }

    // Emit once enough trailing signal exists to cut a full window.
    if (this.pending && t - this.pending.t >= this.cfg.window_ms) {
      this.emit(this.pending, false);
      this.pending = null;
    }

    // Forced negative sample: a window of ordinary road, taken while nothing is
    // happening. Only while actually moving, so it captures driving vibration
    // rather than a parked engine.
    if (this.trainingMode && fast && !this.pending &&
        t - this.lastTrigger > 3000 &&
        t - this.lastNegativeAt > this.cfg.training_negative_interval_ms &&
        this.buf.length > 30) {
      this.lastNegativeAt = t;
      const mid = this.buf[this.buf.length - Math.floor(this.cfg.window_ms / (1000 / this.sampleHz))] ?? this.buf[0];
      this.emit({ t: mid.t, peak: mid.a, z: 0, mu: this.mean, sd }, true);
    }
  }

  // -------------------------------------------------------------- emit
  private emit(
    p: { t: number; peak: number; z: number; mu: number; sd: number },
    forcedSample = false,
  ) {
    const half = this.cfg.window_ms;
    const win = this.buf.filter(s => Math.abs(s.t - p.t) <= half);
    if (win.length < 5) return;

    // Leading sign: which way the body moved FIRST.
    //   A pothole drops the wheel  -> body falls  -> negative first.
    //   A speed bump lifts it      -> body rises  -> positive first.
    // Read just before the peak, where the response is still one-sided.
    // Take the FIRST clear excursion out of the noise floor, not the largest.
    // The largest swing is often the rebound as the wheel exits, which has the
    // opposite sign and would invert the verdict.
    const brk = Math.max(p.sd * 3, 0.04);
    const first = win.find(s => Math.abs(s.a - p.mu) > brk);
    const leading: -1 | 1 = first ? (first.a < p.mu ? -1 : 1) : (p.peak < 0 ? -1 : 1);

    // Rear-axle confirmation: the back wheel hits the same hole one wheelbase
    // later. Finding that second peak at exactly the predicted delay is strong
    // evidence of a real road defect rather than a one-off jolt.
    let axle = false;
    const v = this.speed_mps ?? 0;
    if (v > 2) {
      const lag = (this.cfg.wheelbase_m / v) * 1000;
      if (lag > 60 && lag < 900) {
        const lo = p.t + lag * 0.65, hi = p.t + lag * 1.45;
        axle = win.some(s => s.t >= lo && s.t <= hi && Math.abs(s.a - p.mu) > p.sd * 2.5);
      }
    }

    const thr = p.sd * 2;
    const over = win.filter(s => Math.abs(s.a - p.mu) > thr);
    const duration = over.length ? over[over.length - 1].t - over[0].t : 0;

    // Speed normalisation: the same hole hit at 60 km/h jolts far harder than at
    // 20 km/h. Normalising to 10 m/s makes severity comparable between rides —
    // without it, fast drivers would report every pothole as severe.
    const vClamped = Math.min(Math.max(v || 10, 4), 30);
    const severity_index = Math.abs(p.peak) / (vClamped / 10);

    // These cut points are a starting guess. They are exactly what the Yes/No
    // feedback loop exists to replace with measured values.
    const severity: Severity =
      severity_index > 0.55 ? 'high' : severity_index > 0.28 ? 'medium' : 'low';

    const guessed: DamageType = leading > 0 ? 'bump' : 'pothole';

    this.onEvent?.({
      t: p.t,
      peak_g: +p.peak.toFixed(4),
      z_score: +p.z.toFixed(2),
      baseline_g: +p.mu.toFixed(5),
      sigma_g: +p.sd.toFixed(5),
      leading_sign: leading,
      axle_confirmed: axle,
      duration_ms: Math.round(duration),
      // Downsample to ~50 Hz so the payload stays small enough to sync over a
      // mobile connection while remaining fine enough to re-tune thresholds.
      waveform: win.filter((_, i) => i % Math.max(1, Math.round(this.sampleHz / 50)) === 0)
                   .map(s => +s.a.toFixed(4)),
      sample_hz: Math.round(this.sampleHz),
      severity,
      severity_index: +severity_index.toFixed(3),
      speed_mps: this.speed_mps,
      guessed_type: guessed,
      forced_sample: forcedSample,
    });
  }

  startRecording() {
    if (this.state !== 'ready' && this.state !== 'mount_lost') {
      throw new Error('Calibrate before recording.');
    }
    this.lastTrigger = 0;
    this.pending = null;
    this.buf = [];
    this.setState('recording');
  }

  stopRecording() { this.setState('ready'); }

  /** Live signal quality, for the calibration UI. */
  snapshot() {
    const sd = Math.sqrt(Math.max(this.variance, 1e-8));
    return {
      noise_g: +sd.toFixed(4),
      threshold_g: +Math.max(this.cfg.min_peak_g, sd * this.cfg.k_sigma).toFixed(3),
      sample_hz: Math.round(this.sampleHz),
      tilt_deg: +angleBetween(this.up, this.calibUp).toFixed(1),
    };
  }
}
