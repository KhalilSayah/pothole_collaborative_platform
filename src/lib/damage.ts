import type { DamageType } from './types';
import { TERMS, SEVERITY_TERMS } from './locale';

/**
 * The report cards.
 *
 * Wording lives in locale.ts so the Algerian terms can be corrected in one
 * place. Six cards, so the grid stays readable in landscape and every target
 * stays big enough to hit without looking away from the road for long.
 */
export interface DamageCard {
  type: DamageType;
  label: string;
  ar: string;
  dz: string;
  sub: string;
  icon: string;
  color: string;
}

const STYLE: Record<string, { icon: string; color: string }> = {
  pothole:        { icon: '🕳️', color: '#e5484d' },
  depression:     { icon: '🌊', color: '#f5a524' },
  bump:           { icon: '⛰️', color: '#a45cf5' },
  broken_surface: { icon: '🪨', color: '#8b949e' },
  manhole:        { icon: '⭕', color: '#2a6df4' },
  crack:          { icon: '⚡', color: '#3fb950' },
};

// Order matters: it is the order of the buttons a driver reaches for, so the
// commonest defect comes first.
const ORDER: DamageType[] = [
  'pothole', 'depression', 'bump', 'broken_surface', 'manhole', 'crack',
];

export const CARDS: DamageCard[] = ORDER.map(type => {
  const t = TERMS[type];
  const st = STYLE[type];
  return { type, label: t.fr, ar: t.ar, dz: t.dz, sub: t.hint, ...st };
});

export const SEVERITY_LABEL: Record<string, string> =
  Object.fromEntries(Object.entries(SEVERITY_TERMS).map(([k, v]) => [k, v.fr]));

export const SEVERITY_AR: Record<string, string> =
  Object.fromEntries(Object.entries(SEVERITY_TERMS).map(([k, v]) => [k, v.ar]));

export const cardFor = (t: DamageType) => CARDS.find(c => c.type === t);
