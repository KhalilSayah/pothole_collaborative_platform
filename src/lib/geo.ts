const R = 6371000;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export function haversine(lat1: number, lon1: number, lat2: number, lon2: number) {
  const dp = rad(lat2 - lat1), dl = rad(lon2 - lon1);
  const a = Math.sin(dp / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function bearing(lat1: number, lon1: number, lat2: number, lon2: number) {
  const p1 = rad(lat1), p2 = rad(lat2), dl = rad(lon2 - lon1);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** Move a point by `forward_m` along `heading_deg` (negative goes backwards). */
export function offset(lat: number, lon: number, heading_deg: number, forward_m: number) {
  const h = rad(heading_deg);
  const dn = forward_m * Math.cos(h);
  const de = forward_m * Math.sin(h);
  return {
    lat: lat + deg(dn / R),
    lon: lon + deg(de / (R * Math.cos(rad(lat)))),
  };
}

/**
 * Correct a manual report for human reaction time.
 *
 * The driver taps the card AFTER the car has already passed the pothole, so the
 * GPS position at tap time is downstream of the real defect. At 50 km/h a 1.4 s
 * reaction puts the report ~19 m past the hole — larger than GPS error itself,
 * and the single biggest source of position error in manual reporting.
 *
 * So we walk BACKWARDS along the heading by (lag x speed). Where a recent track
 * history exists we follow the actual path instead, which is more accurate on a
 * bend than projecting along an instantaneous heading.
 */
export function reactionCorrect(
  lat: number, lon: number,
  heading_deg: number | null,
  speed_mps: number | null,
  lag_s: number,
  track?: { lat: number; lon: number; t: number }[],
  now?: number,
) {
  const v = speed_mps ?? 0;
  const back = v * lag_s;
  if (back < 2) return { lat, lon, correction_m: 0 };   // too slow to matter

  if (track && track.length > 1 && now != null) {
    // Follow the recorded path back in time — correct through corners.
    const target = now - lag_s * 1000;
    for (let i = track.length - 1; i > 0; i--) {
      if (track[i].t <= target) {
        const p = track[i];
        return { lat: p.lat, lon: p.lon, correction_m: haversine(lat, lon, p.lat, p.lon) };
      }
    }
  }

  if (heading_deg == null) return { lat, lon, correction_m: 0 };
  const p = offset(lat, lon, heading_deg, -back);
  return { ...p, correction_m: back };
}

/** Great-circle midpoint set — used for the local pre-upload dedup. */
export function withinMeters(
  a: { lat: number; lon: number }, b: { lat: number; lon: number }, m: number,
) {
  return haversine(a.lat, a.lon, b.lat, b.lon) <= m;
}
