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
  /** Heure d'arrivée (ms epoch) — affichée HH:MM dans l'onglet Questions. */
  ts?: number;
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
  /**
   * À QUOI RÉPOND LA SUGGESTION EN ATTENTE : un thème, ou la question sélectionnée.
   * Sans ce champ, sélectionner une question pendant qu'une proposition de THÈME
   * attendait la transformait en « réponse » — et l'afficher enterrait le thème.
   */
  origineSuggestion: SourcePrompteur | null;
  /**
   * Identifiants de questions DÉJÀ reçues (bornés). La page relit toute la liste des
   * messages à chaque rendu : sans cette mémoire, une question traitée puis retirée
   * reviendrait dans la file à la relecture suivante.
   */
  questionsVues: string[];
}

export const ETAT_INITIAL: EtatPrompteur = {
  brouillon: '', affiche: '', sourceAffichee: null, suggestion: null,
  questionActive: null, file: [], repriseTexte: null, repriseSource: null,
  origineBrouillon: 'manuel', origineSuggestion: null, questionsVues: [],
};

/**
 * Le script DÉJÀ sauvegardé par `usePrompteur` (localStorage) devient l'état de départ :
 * brouillon ET texte affiché. Avant, l'état partait vide et l'effet de la page
 * (`prompteur.setScript(etat.affiche)`) écrasait au montage le script de la veille.
 */
export function etatInitialDepuisScript(script: string | null | undefined): EtatPrompteur {
  const t = typeof script === 'string' ? script : '';
  if (!t.trim()) return ETAT_INITIAL;
  return { ...ETAT_INITIAL, brouillon: t, affiche: t, sourceAffichee: 'manuel', origineBrouillon: 'manuel' };
}

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
  // Une proposition de THÈME ne désélectionne pas la question choisie par l'hôte.
  return {
    ...e,
    suggestion: texte,
    questionActive: question || e.questionActive,
    origineSuggestion: question ? 'question' : 'theme',
  };
}

/**
 * 05/10 — Suggestion préparée AUTOMATIQUEMENT pour une question du chat. Plus prudente que
 * `recevoirSuggestion` (geste de l'hôte) :
 *  - une proposition déjà en attente n'est JAMAIS remplacée (l'hôte la lit peut-être) ;
 *  - la question a disparu entre-temps (modération, déjà traitée) → la réponse est jetée ;
 *  - ni le brouillon ni le texte affiché ne bougent.
 */
export function recevoirSuggestionAuto(e: EtatPrompteur, texte: string, q: QuestionEnAttente): EtatPrompteur {
  if (e.suggestion || !String(texte || '').trim()) return e;
  const dansFile = e.file.some((x) => x.id === q.id);
  const active = !!e.questionActive && e.questionActive.id === q.id;
  if (!dansFile && !active) return e;
  const base = dansFile ? selectionnerQuestion(e, q.id) : e;
  return recevoirSuggestion(base, texte, active ? e.questionActive : q);
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
    origineBrouillon: e.origineSuggestion === 'question' ? 'question' : 'theme',
    origineSuggestion: null,
  };
}

/** « Ignorer » : la proposition disparaît, et la question qu'elle visait avec elle. */
export function ignorerSuggestion(e: EtatPrompteur): EtatPrompteur {
  return {
    ...e,
    suggestion: null,
    origineSuggestion: null,
    questionActive: e.origineSuggestion === 'question' ? null : e.questionActive,
  };
}

/**
 * Une question arrive pendant le direct. Elle va dans la file — JAMAIS à l'écran.
 * Le seul effet visible autorisé est un compteur discret.
 */
export function recevoirQuestion(e: EtatPrompteur, q: QuestionEnAttente): EtatPrompteur {
  const vues = e.questionsVues || [];
  if (vues.includes(q.id) || e.file.some((x) => x.id === q.id)
      || (e.questionActive && e.questionActive.id === q.id)) return e;
  return { ...e, file: [...e.file, q].slice(-10), questionsVues: [...vues, q.id].slice(-MEMOIRE_VUES) };
}

/** L'hôte ouvre une question de la file : elle devient active, la file se réduit. */
export function ouvrirQuestion(e: EtatPrompteur, id: string): EtatPrompteur {
  const q = e.file.find((x) => x.id === id);
  if (!q) return e;
  return { ...e, questionActive: q, file: e.file.filter((x) => x.id !== id) };
}

/** Combien d'identifiants de questions déjà vues on garde en mémoire. */
export const MEMOIRE_VUES = 300;

/** Longueur maximale d'une question gardée pour le prompteur. */
export const LONGUEUR_MAX_QUESTION = 500;

/** Forme minimale d'un message de chat lu par le prompteur. */
export interface MessagePourQuestion {
  id?: string;
  name?: string;
  text?: string;
  userId?: string;
  ts?: number;
  /** Posé par le spectateur qui a choisi « Poser une question ». Seul signal retenu. */
  question?: unknown;
}

/**
 * Un message du chat devient-il une question pour l'hôte ?
 *
 * AVANT : tout message d'un autre participant entrait dans la file — « bravo », « 🔥 »,
 * « on m'entend ? ». Du bruit, en direct. MAINTENANT : un message MARQUÉ
 * `question: true` (le booléen, pas une chaîne) en devient une ; 05/10 : une VRAIE question
 * non marquée aussi (`ressembleAQuestion`), jamais le bruit (`estBruit`). Jamais les miens,
 * jamais un texte vide ; texte borné ; seuls id, auteur, texte et heure sortent.
 */
export function messageVersQuestion(
  m: MessagePourQuestion | null | undefined,
  meUserId: string | null | undefined,
): QuestionEnAttente | null {
  if (!m || (m.question !== true && !ressembleAQuestion(m.text))) return null;
  if (meUserId && m.userId === meUserId) return null;
  const texte = String(m.text || '').trim().slice(0, LONGUEUR_MAX_QUESTION);
  if (!texte) return null;
  const auteur = String(m.name || '').trim().slice(0, 40) || 'Participant';
  const ts = typeof m.ts === 'number' && Number.isFinite(m.ts) ? m.ts : undefined;
  const id = String(m.id || `${m.userId || auteur}-${ts ?? ''}-${texte}`);
  return ts === undefined ? { id, auteur, texte } : { id, auteur, texte, ts };
}

/**
 * 05/10 — LE FILTRE DE PERTINENCE (coût IA). Deux questions distinctes :
 *
 *  - `estBruit` : politesse, réaction, vérification du son, emoji. « bonjour », « merci coach ! »,
 *    « 🔥🔥 », « on m'entend ? », « ça va ? ». Ces messages ne valent JAMAIS un appel à l'IA,
 *    même envoyés avec le bouton « ? ».
 *  - `ressembleAQuestion` : une VRAIE question, même sans le bouton « ? » — un point
 *    d'interrogation dans une phrase d'au moins trois mots, ou un mot interrogatif CLAIR en tête
 *    (« Est-ce que… », « Comment… », « Combien… »). « Quel… » / « Que… » sans « ? » sont exclus :
 *    en français ce sont souvent des exclamations (« Quelle belle séance »).
 *
 * `estQuestionPertinente` = ce qui autorise une demande AUTOMATIQUE de suggestion.
 */
const LETTRES = /[^\p{L}\p{N}'’-]+/gu;
const POLITESSE = /^(bonjour|bonsoir|salut|slt|coucou|hello|hi|hey|yo|wesh|merci|mercii+|thanks|thank|bravo|super|top|génial|genial|trop|magnifique|incroyable|énorme|enorme|ok|okay|d'accord|d’accord|oui|ouais|lol|mdr|ptdr|haha+|hihi+|bisous|bises|bye|ciao|bonne|yes|cool|parfait|waouh|wow|ouf)$/;
const VERIF_SON = /(m['’]?entend|nous entend|vous entend|me voi[st]|nous voi[st]|on voit|on entend|le son|du son|pas de son|ça marche|ca marche|ça fonctionne|ça va|ca va|sa va|quoi de neuf|vous allez bien|tu vas bien|comment (vas|allez)[- ](tu|vous))/;
const INTERROGATIFS = /^(est[- ]ce|comment|pourquoi|quand|combien|o[uù] |à quelle|a quelle|de quelle|peut[- ]on|peux[- ]tu|pouvez[- ]vous|puis[- ]je|je peux|on peut|faut[- ]il|y a[- ]t[- ]il|est[- ]il possible|c['’]est (quand|combien|o[uù]|quoi)|what|how|when|where|why|can i|can you|is there|do you)\b/;

function motsDe(texte: string): string[] {
  return texte.toLowerCase().replace(LETTRES, ' ').trim().split(/\s+/).filter(Boolean);
}

export function estBruit(texte: string | null | undefined): boolean {
  const s = String(texte || '').trim().toLowerCase();
  const mots = motsDe(s);
  const lettres = mots.join('');
  if (lettres.length < 3) return true;                               // emoji, « ? », « ok »
  if (POLITESSE.test(mots[0]) && mots.length <= 4) return true;       // « merci coach ! », « bonjour à tous »
  if (mots.length <= 6 && VERIF_SON.test(s)) return true;            // « on m'entend ? », « ça va ? »
  return false;
}

export function ressembleAQuestion(texte: string | null | undefined): boolean {
  const s = String(texte || '').trim().toLowerCase();
  if (estBruit(s)) return false;
  const mots = motsDe(s);
  if (mots.length < 3) return false;
  if (s.includes('?')) return true;
  if (/!\s*$/.test(s)) return false;                                 // une exclamation n'est pas une question
  return INTERROGATIFS.test(s);
}

/** Une question mérite-t-elle une demande AUTOMATIQUE à l'IA ? (jamais pour du bruit) */
export function estQuestionPertinente(texte: string | null | undefined): boolean {
  const s = String(texte || '').trim().toLowerCase();
  if (estBruit(s) || motsDe(s).length < 3) return false;
  if (ressembleAQuestion(s)) return true;
  // Marquée « ? » sans en avoir l'air : une exclamation (« Quelle belle séance ! », « Que c'est
  // beau ») ne vaut pas un appel ; une affirmation interrogative (« Tu fais des cours le samedi »), si.
  return !/!\s*$/.test(s) && !EXCLAMATIF.test(s);
}
const EXCLAMATIF = /^(quel|quelle|quels|quelles|que|qu['’]|comme|trop|tellement|vraiment)\b/;

/**
 * Toute la liste des messages, pas seulement le dernier : une rafale ne perd plus de
 * question. Rien de nouveau → le MÊME objet est rendu (aucun rendu, aucune boucle).
 */
export function recevoirMessages(
  e: EtatPrompteur,
  messages: MessagePourQuestion[] | null | undefined,
  meUserId: string | null | undefined,
): EtatPrompteur {
  let r = e;
  for (const m of messages || []) {
    const q = messageVersQuestion(m, meUserId);
    if (q) r = recevoirQuestion(r, q);
  }
  return r;
}

/**
 * Le message a été supprimé du chat (modération) : la question disparaît de la file,
 * et si c'était la question sélectionnée, la réponse qui la visait part avec elle.
 * Le texte affiché et « Mon texte » ne bougent pas. Son id reste « vu ».
 */
export function retirerQuestion(e: EtatPrompteur, id: string): EtatPrompteur {
  const dansFile = e.file.some((x) => x.id === id);
  const active = !!e.questionActive && e.questionActive.id === id;
  if (!dansFile && !active) return e;
  const suggestionVisee = active && e.origineSuggestion === 'question';
  return {
    ...e,
    file: dansFile ? e.file.filter((x) => x.id !== id) : e.file,
    questionActive: active ? null : e.questionActive,
    suggestion: suggestionVisee ? null : e.suggestion,
    origineSuggestion: suggestionVisee ? null : e.origineSuggestion,
  };
}

/**
 * Sélectionner une question SANS appeler l'IA. L'ancienne question sélectionnée
 * retourne en tête de file (elle n'est pas perdue) ; une réponse préparée pour ELLE
 * est retirée (elle ne répondrait plus à la bonne question). Une suggestion de THÈME,
 * le brouillon et le texte affiché ne bougent pas.
 */
export function selectionnerQuestion(e: EtatPrompteur, id: string): EtatPrompteur {
  const q = e.file.find((x) => x.id === id);
  if (!q) return e;
  const prec = e.questionActive;
  const reste = e.file.filter((x) => x.id !== id);
  const suggestionVisee = !!prec && e.origineSuggestion === 'question';
  return {
    ...e,
    questionActive: q,
    file: prec && prec.id !== id ? [prec, ...reste].slice(-10) : reste,
    suggestion: suggestionVisee ? null : e.suggestion,
    origineSuggestion: suggestionVisee ? null : e.origineSuggestion,
  };
}

/**
 * « Afficher sur le prompteur » la QUESTION sélectionnée, pour la lire à voix haute.
 * L'écran change ; « Mon texte » (le brouillon), jamais. Le thème affiché est mis de
 * côté pour « Reprendre mon thème », exactement comme pour une réponse.
 */
export function afficherQuestion(e: EtatPrompteur): EtatPrompteur {
  const q = e.questionActive;
  if (!q) return e;
  const memoriser = !!e.affiche && e.sourceAffichee !== 'question';
  return {
    ...e,
    affiche: `${q.auteur} demande :\n${q.texte}`,
    sourceAffichee: 'question',
    repriseTexte: memoriser ? e.affiche : e.repriseTexte,
    repriseSource: memoriser ? e.sourceAffichee : e.repriseSource,
  };
}

/** Heure d'une question, « HH:MM » en heure locale ; '' si inconnue. */
export function heureQuestion(ts: number | null | undefined): string {
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return '';
  const d = new Date(ts);
  const deux = (n: number) => String(n).padStart(2, '0');
  return `${deux(d.getHours())}:${deux(d.getMinutes())}`;
}

/** Les quatre onglets du panneau unique, dans l'ordre d'affichage. */
export const ONGLETS_PROMPTEUR = [
  { cle: 'texte', libelle: 'Mon texte' },
  { cle: 'theme', libelle: 'Thème IA' },
  { cle: 'questions', libelle: 'Questions' },
  { cle: 'assistant', libelle: 'Assistant IA' },
] as const;

export type OngletPrompteur = (typeof ONGLETS_PROMPTEUR)[number]['cle'];

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

/**
 * 🎙️ 05/10 — ENTRÉE TRANSCRIPTION (questions ORALES) — interface prête, AUCUN moteur branché.
 * Audit : aucune transcription en direct n'existe (seule la transcription de l'ENREGISTREMENT,
 * après coup, via gpt-4o-transcribe). Quand une brique speech-to-text temps réel sera validée,
 * chaque segment TEXTE reconnu arrivera ici et suivra le même chemin que le chat : file → suggestion.
 * Jamais d'audio vers le modèle de réponse : seulement le texte du segment.
 */
export interface SegmentTranscrit { id: string; auteur?: string; texte: string; ts?: number }
export function recevoirTranscription(e: EtatPrompteur, seg: SegmentTranscrit | null | undefined): EtatPrompteur {
  if (!seg || !seg.id || !ressembleAQuestion(seg.texte)) return e;
  const texte = String(seg.texte).trim().slice(0, LONGUEUR_MAX_QUESTION);
  const q: QuestionEnAttente = { id: `voix-${seg.id}`, auteur: String(seg.auteur || '').trim().slice(0, 40) || 'Participant (oral)', texte };
  return recevoirQuestion(e, typeof seg.ts === 'number' ? { ...q, ts: seg.ts } : q);
}
