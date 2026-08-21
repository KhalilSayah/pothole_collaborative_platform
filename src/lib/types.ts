// Unified data format. Mirrors supabase/schema.sql exactly — every collection
// method produces this same shape, which is what makes fusion possible.

export type CollectionMethod = 'camera' | 'accel' | 'manual' | 'photo';

export type DamageType =
  | 'pothole' | 'crack' | 'depression' | 'bump'
  | 'manhole' | 'broken_surface' | 'debris' | 'other';

export type Severity = 'low' | 'medium' | 'high';

export interface GpsSample {
  lat: number;
  lon: number;
  accuracy_m: number | null;
  speed_mps: number | null;
  heading_deg: number | null;
  t: number;                 // epoch ms
}

/** One signal, from one method, at one moment. Append-only, never edited. */
export interface Observation {
  id: string;
  ride_id: string;
  method: CollectionMethod;

  observed_at: string;       // ISO
  t_offset_ms: number;       // since ride start — authoritative within-ride clock

  lat: number;
  lon: number;
  gps_accuracy_m: number | null;
  speed_mps: number | null;
  heading_deg: number | null;

  // Back-projected true position (see reactionCorrect in geo.ts).
  corrected_lat: number | null;
  corrected_lon: number | null;
  position_correction_m: number | null;

  damage_type: DamageType | null;
  severity: Severity | null;
  confidence: number;        // 0..1

  payload: Record<string, unknown>;
  image_path?: string | null;
  /** Photo reports arrive 'pending' and are kept off the map until checked. */
  verification_status?: 'pending' | 'verified' | 'rejected' | 'review';
  note?: string | null;
}

export interface Ride {
  id: string;
  started_at: string;
  ended_at: string | null;
  platform: string;
  app_version: string;
  detector_config: Record<string, unknown>;
  distance_m?: number;
  duration_s?: number;
  n_observations?: number;
}

/** Fused public map entity — one row per physical pothole. */
export interface Cluster {
  id: string;
  lat: number;
  lon: number;
  road_name: string | null;
  severity: Severity | null;
  damage_type: DamageType | null;
  confidence: number;
  n_observations: number;
  n_rides: number;
  method_mix: string[];
  status: 'candidate' | 'confirmed' | 'repaired';
  last_seen: string;
  first_seen?: string;
  road_type?: string | null;
  /** False when road_name is a proximity description, not the street's name. */
  road_exact?: boolean;
  /** Representative photo, chosen from the cluster's verified observations. */
  image_path?: string | null;
}

export interface AccelEvent {
  t: number;                 // epoch ms of the peak
  peak_g: number;            // vertical, gravity removed
  z_score: number;           // how far above this road's own noise floor
  baseline_g: number;
  sigma_g: number;
  leading_sign: -1 | 1;      // -1 = dropped first (pothole), +1 = rose first (bump)
  axle_confirmed: boolean;   // rear wheel hit the same spot
  duration_ms: number;
  waveform: number[];        // vertical accel around the peak, in g
  sample_hz: number;
  severity: Severity;
  severity_index: number;    // speed-normalised
  speed_mps: number | null;
  guessed_type: DamageType;
  /** True when captured as a periodic negative rather than by a trigger. */
  forced_sample?: boolean;
}
