import type { DamageType } from './types';

/**
 * The report cards.
 *
 * Labels are French, the working language for drivers in Tlemcen. Change them
 * here and the whole UI follows — nothing else hard-codes them.
 *
 * Kept to six so the grid stays readable in landscape and each target stays
 * large enough to hit without looking away from the road for long.
 */
export interface DamageCard {
  type: DamageType;
  label: string;
  sub: string;
  icon: string;
  color: string;
}

export const CARDS: DamageCard[] = [
  { type: 'pothole',        label: 'Nid-de-poule', sub: 'Trou dans la chaussée', icon: '🕳️', color: '#e5484d' },
  { type: 'depression',     label: 'Affaissement', sub: 'Chaussée enfoncée',     icon: '🌊', color: '#f5a524' },
  { type: 'bump',           label: 'Dos d’âne',  sub: 'Bosse, ralentisseur',   icon: '⛰️', color: '#a45cf5' },
  { type: 'broken_surface', label: 'Chaussée dégradée', sub: 'Gravier, revêtement usé', icon: '🪨', color: '#8b949e' },
  { type: 'manhole',        label: 'Regard',       sub: 'Plaque d’égout',      icon: '⭕', color: '#2a6df4' },
  { type: 'crack',          label: 'Fissure',      sub: 'Craquelure, faïençage',  icon: '⚡', color: '#3fb950' },
];

export const SEVERITY_LABEL: Record<string, string> = {
  low: 'Léger', medium: 'Moyen', high: 'Grave',
};

export const cardFor = (t: DamageType) => CARDS.find(c => c.type === t);
