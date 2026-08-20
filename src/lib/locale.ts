// ============================================================================
//  Vocabulaire — un seul endroit à corriger.
//
//  Les libellés visent l'usage réel à Tlemcen, pas la traduction littérale. Un
//  conducteur qui roule doit reconnaître le mot du premier coup d'œil : c'est
//  celui qu'il emploie, pas celui du dictionnaire.
//
//  NIVEAU DE CONFIANCE (à relire par quelqu'un d'ici) :
//    sûr        حفرة / hofra, بالوعة / balou3a
//    plausible  كاسور / kassour, شقوق / chqouq
//    à vérifier هبوط, طريق متدهورة — corrects en arabe standard, mais ce
//               n'est peut-être pas ce qu'on dit sur place.
//
//  `ar` s'affiche sous le libellé français. Mettre une chaîne vide masque la
//  ligne sans rien casser.
// ============================================================================

export interface Term {
  fr: string;
  ar: string;
  /** Transliteration, pour les lecteurs qui ne lisent pas l'arabe. */
  dz: string;
  hint: string;
}

export const TERMS: Record<string, Term> = {
  pothole: {
    fr: 'Nid-de-poule',
    ar: 'حفرة',
    dz: 'Hofra',
    hint: 'Trou dans la chaussée',
  },
  depression: {
    fr: 'Affaissement',
    ar: 'هبوط',
    dz: 'Hboutt',
    hint: 'Chaussée enfoncée',
  },
  bump: {
    fr: 'Dos d’âne',
    ar: 'كاسور',
    dz: 'Kassour',
    hint: 'Ralentisseur, bosse',
  },
  broken_surface: {
    fr: 'Route dégradée',
    ar: 'طريق متدهورة',
    dz: 'Triq mahlouka',
    hint: 'Gravier, revêtement usé',
  },
  manhole: {
    fr: 'Regard',
    ar: 'بالوعة',
    dz: 'Balou3a',
    hint: 'Plaque d’égout',
  },
  crack: {
    fr: 'Fissure',
    ar: 'شقوق',
    dz: 'Chqouq',
    hint: 'Craquelure, faïençage',
  },
};

export const SEVERITY_TERMS: Record<string, Term> = {
  low:    { fr: 'Léger',  ar: 'خفيف',  dz: 'Khfif',  hint: '' },
  medium: { fr: 'Moyen',  ar: 'متوسط', dz: 'Moutawassit', hint: '' },
  high:   { fr: 'Grave',  ar: 'خطير',  dz: 'Khatir', hint: '' },
};
