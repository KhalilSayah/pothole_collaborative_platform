import type { DamageType } from './types';

/**
 * Target classes for the trained accelerometer model.
 *
 * These are chosen to be the things that actually get CONFUSED with each other
 * in raw vertical acceleration. A hard brake and a pothole can produce similar
 * peak magnitudes; what separates them is duration and the pitch signature, and
 * a model can only learn that if the labels distinguish them in the first place.
 */
export type AccelLabel =
  | 'pothole' | 'speed_bump' | 'hard_braking'
  | 'road_vibration' | 'manhole' | 'other' | 'unsure';

export interface LabelOption {
  label: AccelLabel;
  text: string;
  hint: string;
  icon: string;
  color: string;
  /** How this label maps onto the public map, if at all. */
  damage: DamageType | null;
}

export const LABELS: LabelOption[] = [
  { label: 'pothole',        text: 'Nid-de-poule',  hint: 'Trou, creux',            icon: '🕳️', color: '#e5484d', damage: 'pothole' },
  { label: 'speed_bump',     text: 'Dos d’âne',   hint: 'Ralentisseur, bosse',    icon: '⛰️', color: '#a45cf5', damage: 'bump' },
  { label: 'hard_braking',   text: 'Freinage',      hint: 'Freinage ou accélération', icon: '🛑', color: '#f5a524', damage: null },
  { label: 'road_vibration', text: 'Route normale', hint: 'Vibration, rugosité',    icon: '〰️', color: '#3fb950', damage: null },
  { label: 'manhole',        text: 'Plaque / joint',hint: 'Regard, joint de route', icon: '⭕', color: '#2a6df4', damage: 'manhole' },
  { label: 'other',          text: 'Autre',         hint: 'Rien de tout cela',      icon: '❓', color: '#8b949e', damage: 'other' },
];

/** Labels that should NOT create a public map entry. */
export const NON_DEFECT: AccelLabel[] = ['hard_braking', 'road_vibration', 'unsure'];

export const labelFor = (l: AccelLabel) => LABELS.find(o => o.label === l);
