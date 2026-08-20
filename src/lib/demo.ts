import type { Cluster } from './types';

/**
 * Synthetic reports for design review, enabled only by an explicit `?demo` in
 * the URL. Never loaded otherwise: fake potholes on a civic map would be
 * indistinguishable from real ones, so this cannot be allowed to switch itself on.
 */
export function isDemo() {
  return typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).has('demo');
}

const STREETS = ['RN 2', 'RN 7', 'Bd Colonel Lotfi', 'Rue de Mansourah',
                 'Av. Khedim Ali', 'Rue Ibn Khaldoun', 'Bd Pasteur'];

export function demoRows(n = 220): Cluster[] {
  // Deterministic, so the layout does not reshuffle on every reload.
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;

  // Clumped around a few centres, because real damage follows traffic corridors
  // rather than scattering uniformly across a bounding box.
  const hubs: [number, number][] = [
    [34.8828, -1.3167], [34.8760, -1.3300], [34.8900, -1.3050],
    [34.8690, -1.3210], [34.8950, -1.3350], [34.8800, -1.2900],
  ];

  return Array.from({ length: n }, (_, i) => {
    const h = hubs[Math.floor(rnd() * hubs.length)];
    const spread = 0.004 + rnd() * 0.012;
    const sev = rnd() < 0.22 ? 'high' : rnd() < 0.55 ? 'medium' : 'low';
    const rides = 1 + Math.floor(rnd() * 4);
    return {
      id: `demo-${i}`,
      lat: h[0] + (rnd() - 0.5) * spread,
      lon: h[1] + (rnd() - 0.5) * spread,
      road_name: STREETS[Math.floor(rnd() * STREETS.length)],
      severity: sev as Cluster['severity'],
      damage_type: (rnd() < 0.7 ? 'pothole' : 'depression') as Cluster['damage_type'],
      confidence: 0.25 + rnd() * 0.7,
      n_observations: rides + Math.floor(rnd() * 4),
      n_rides: rides,
      method_mix: rides > 1 ? ['accel', 'manual'] : ['manual'],
      status: (rides > 1 ? 'confirmed' : 'candidate') as Cluster['status'],
      // No path: the focus card then exercises its "sensor report, no photo"
      // branch, which is the common case for accelerometer detections.
      image_path: null,
      last_seen: new Date().toISOString(),
    };
  });
}
