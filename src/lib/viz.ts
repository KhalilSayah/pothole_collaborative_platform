// ============================================================================
//  Chart palette — validated, not chosen by eye.
//
//  Every set below was run through the data-viz validator against the actual
//  white card surface. Two results changed the design:
//
//    teal + cyan FAILED (normal-vision ΔE 6.9, below the 15 floor) — the pair
//    an eye would have picked first, and two readers in ten could not have
//    told the lines apart.
//
//    The severity trio passes but sits under 3:1 contrast on white, which
//    obliges visible labels rather than relying on the fill alone. Every
//    severity mark in this dashboard carries its value.
// ============================================================================

/** Ordered severity. Matches the public map exactly — one visual language. */
export const SEV = {
  low:    '#10b981',
  medium: '#f59e0b',
  high:   '#ef4444',
  unknown:'#94a3b8',
} as const;

/**
 * Categorical series. Fixed order, never cycled: colour follows the entity, so
 * hiding a series must not repaint the survivors.
 *   1 teal   — repairs, the outgoing flow
 *   2 violet — reports, the incoming flow
 *   3 orange — reserved for a third series
 * Validated all-pairs: worst CVD ΔE 13.7, normal-vision 27.1, all ≥ 3:1.
 */
export const SERIES = ['#0d9488', '#7c3aed', '#c2410c'] as const;

/**
 * Ordinal ramp for age. One hue, monotone lightness, light end clears 2:1 on
 * white. Four steps because a fifth could not clear that floor.
 */
export const AGE_RAMP = ['#14b8a6', '#0d9488', '#0f766e', '#134e4a'] as const;

export const INK = {
  primary:   '#0b1220',
  secondary: '#334155',
  muted:     '#64748b',
  grid:      '#e2e8f0',
  axis:      '#cbd5e1',
} as const;

export const sevColor = (s?: string | null) => SEV[(s ?? 'unknown') as keyof typeof SEV] ?? SEV.unknown;

export function niceMax(v: number): number {
  if (v <= 5) return 5;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  return Math.ceil(v / mag) * mag;
}

export const fmt = (n: number) => n.toLocaleString('fr-FR');
