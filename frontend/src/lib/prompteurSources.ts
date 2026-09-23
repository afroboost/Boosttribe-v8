/**
 * 📝 LE PROMPTEUR DE L'HÔTE — trois sources, un seul écran de lecture.
 *
 * LA RÈGLE QUI COMMANDE TOUT LE RESTE : **l'IA propose, l'hôte décide.** Rien de ce
 * que produit l'assistant ne devient visible sans un clic. C'est la raison d'être de ce
 * module : séparer strictement des états qu'il serait tentant de mélanger, parce qu'un
 * mélange coûte cher en direct — on ne fait pas disparaître le texte qu'un coach est en
 * train de lire face caméra parce qu'un participant vient d'écrire dans le chat.
 *
 * TROIS SOURCES, jamais fusionnées automatiquement :
 *   1. MON TEXTE    — ce que l'hôte écrit lui-même. Fonctionne sans IA, toujours.
 *   2. THÈME IA     — l'assistant aide à formuler une idée ; le résultat reste éditable.
 *   3. QUESTIONS    — une question du chat et la réponse proposée, à lire à voix haute.
 *
 * QUATRE ÉTATS, jamais confondus :
 *   - `brouillon`  : ce que l'hôte est en train d'écrire ou de retoucher ;
 *   - `affiche`    : ce qu'il lit RÉELLEMENT en ce moment sur le prompteur ;
 *   - `suggestion` : une proposition de l'IA, en attente d'un clic — invisible tant
 *                    que l'hôte ne l'a pas prise ;
 *   - `file`       : les questions arrivées pendant qu'il lisait, mises de côté.
 *
 * ET UNE MÉMOIRE : `repriseTexte` garde le texte affiché avant qu'on bascule sur une
 * question, pour que « Reprendre mon thème » rende EXACTEMENT ce qui était là.
 */

export type SourcePrompteur = 'manuel' | 'theme' | 'question';

export interface QuestionEnAttente {
  id: string;
  auteur: string;
  texte: string;
}

export interface EtatPrompteur {
  /** Texte en cours d'édition par l'hôte (jamais affiché tant qu'il n'a pas cliqué). */
  brouillon: string;
  /** Texte RÉELLEMENT lu en ce moment. '' = le prompteur est vide. */
  affiche: string;
  /** D'où vient le texte affiché — sert à savoir s'il faut proposer « Reprendre mon thème ». */
  sourceAffichee: SourcePrompteur | null;
  /** Proposition de l'IA en attente d'un clic. `null` = aucune. */
  suggestion: string | null;
  /** La question à laquelle se rapporte la suggestion. */
  questionActive: QuestionEnAttente | null;
  /** Questions reçues et pas encore consultées. */
  file: QuestionEnAttente[];
  /** Texte à restaurer par « Reprendre mon thème » (null = rien à reprendre). */
  repriseTexte: string | null;
  repriseSource: SourcePrompteur | null;
  /**
   * D'OÙ VIENT LE BROUILLON. Sans ce champ, le prompteur ne pouvait pas savoir qu'un
   * texte en cours d'édition est une RÉPONSE : l'hôte prenait la proposition, elle
   * atterrissait dans « Mon texte », et « Afficher » écrasait le thème comme s'il
   * l'avait tapé lui-même — « Reprendre mon thème » n'apparaissait jamais. Détecté
   * au test en navigateur réel, pas au banc.
   */
  origineBrouillon: SourcePrompteur;
}

export const ETAT_INITIAL: EtatPrompteur = {
  brouillon: '', affiche: '', sourceAffichee: null, suggestion: null,
  questionActive: null, file: [], repriseTexte: null, repriseSource: null,
  origineBrouillon: 'manuel',
};

/**
 * L'hôte écrit. C'est le seul chemin qui modifie le brouillon sans clic explicite.
 * Retoucher une réponse la laisse être une réponse ; VIDER le champ, en revanche, est
 * un départ à zéro : le texte redevient celui de l'hôte.
 */
export function ecrire(e: EtatPrompteur, texte: string): EtatPrompteur {
  return { ...e, brouillon: texte, origineBrouillon: texte.trim() ? e.origineBrouillon : 'manuel' };
}

/**
 * Afficher le brouillon. Si un THÈME était à l'antenne et qu'on part sur une question,
 * on mémorise le thème pour pouvoir y revenir exactement.
 */
export function afficher(e: EtatPrompteur, source: SourcePrompteur): EtatPrompteur {
  const memoriser = source === 'question' && e.affiche && e.sourceAffichee !== 'question';
  return {
    ...e,
    affiche: e.brouillon,
    sourceAffichee: source,
    repriseTexte: memoriser ? e.affiche : e.repriseTexte,
    repriseSource: memoriser ? e.sourceAffichee : e.repriseSource,
  };
}

/** Effacer : le prompteur redevient vide, proprement. Le brouillon n'est pas touché. */
export function effacer(e: EtatPrompteur): EtatPrompteur {
  return { ...e, affiche: '', sourceAffichee: null };
}


/**
 * Une suggestion arrive. Elle NE TOUCHE NI le brouillon NI le texte affiché — c'est
 * tout l'objet de ce module. Elle attend dans son coin.
 */
export function recevoirSuggestion(e: EtatPrompteur, texte: string, question: QuestionEnAttente | null): EtatPrompteur {
  return { ...e, suggestion: texte, questionActive: question };
}

/**
 * « Utiliser » : et SEULEMENT là, la suggestion devient le brouillon — donc éditable.
 * Elle ne passe jamais directement à l'écran : l'hôte doit encore cliquer « Afficher ».
 */
export function utiliserSuggestion(e: EtatPrompteur): EtatPrompteur {
  if (!e.suggestion) return e;
  return {
    ...e,
    brouillon: e.suggestion,
    suggestion: null,
    // Le brouillon garde sa provenance : c'est elle qui décide, à l'affichage, s'il
    // faut mettre le thème de côté pour pouvoir y revenir.
    origineBrouillon: e.questionActive ? 'question' : 'theme',
  };
}

/** « Ignorer » : la proposition disparaît, rien d'autre ne bouge. */
export function ignorerSuggestion(e: EtatPrompteur): EtatPrompteur {
  return { ...e, suggestion: null, questionActive: null };
}

/**
 * Une question arrive pendant le direct. Elle va dans la file — JAMAIS à l'écran.
 * Le seul effet visible autorisé est un compteur discret.
 */
export function recevoirQuestion(e: EtatPrompteur, q: QuestionEnAttente): EtatPrompteur {
  if (e.file.some((x) => x.id === q.id) || (e.questionActive && e.questionActive.id === q.id)) return e;
  return { ...e, file: [...e.file, q].slice(-10) };
}

/** L'hôte ouvre une question de la file : elle devient active, la file se réduit. */
export function ouvrirQuestion(e: EtatPrompteur, id: string): EtatPrompteur {
  const q = e.file.find((x) => x.id === id);
  if (!q) return e;
  return { ...e, questionActive: q, file: e.file.filter((x) => x.id !== id) };
}

/**
 * « Reprendre mon thème » : on rend EXACTEMENT le texte qui était à l'antenne avant la
 * question — pas une reconstitution, la chaîne mémorisée.
 */
export function reprendreTexte(e: EtatPrompteur): EtatPrompteur {
  if (e.repriseTexte === null) return e;
  return {
    ...e,
    affiche: e.repriseTexte,
    sourceAffichee: e.repriseSource,
    brouillon: e.repriseTexte,
    origineBrouillon: e.repriseSource || 'manuel',
    repriseTexte: null,
    repriseSource: null,
  };
}

/** Y a-t-il un thème à reprendre ? (sert à n'afficher le bouton que quand il sert) */
export const peutReprendre = (e: EtatPrompteur): boolean => e.repriseTexte !== null;

/** Compteur discret : « 2 questions · 1 suggestion prête ». '' = rien à signaler. */
export function libelleAttente(e: EtatPrompteur): string {
  const bouts: string[] = [];
  if (e.file.length) bouts.push(`${e.file.length} question${e.file.length > 1 ? 's' : ''}`);
  if (e.suggestion) bouts.push('1 suggestion prête');
  return bouts.join(' · ');
}

/** Les actions d'aide à la rédaction proposées sur le texte de l'hôte. */
export const ACTIONS_TEXTE = [
  { cle: 'theme', libelle: 'Rédiger ce thème' },
  { cle: 'continuer', libelle: 'Continuer' },
  { cle: 'raccourcir', libelle: 'Raccourcir' },
  { cle: 'developper', libelle: 'Développer' },
  { cle: 'naturel', libelle: 'Plus naturel' },
] as const;

export type ActionTexte = (typeof ACTIONS_TEXTE)[number]['cle'];
