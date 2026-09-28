/**
 * 🎛️ Règles PURES de la barre de commandes Live unique (LiveControls) et de la couche
 * de calques posée sur la vidéo (chat, réactions, champ commentaire).
 *
 * Aucune dépendance au DOM : des tailles et des listes, testables sous node --test.
 * Le composant mesure la largeur réelle de la zone caméra et demande ici :
 *  - quelles commandes tiennent dans la barre, lesquelles passent dans le menu ⋮ ;
 *  - quelle place laisser au flux de commentaires sans recouvrir les personnes filmées.
 *
 * Ordre de priorité de l'écran (du plus au moins important) :
 *   1) les personnes en vidéo  2) les commandes  3) le chat  4) les réactions.
 */

/** Identifiants des commandes « principales » (celles qui peuvent vivre dans la barre). */
export type CommandeId =
  | 'micro'
  | 'camera'        // hôte/co-hôte : allumer/couper ; spectateur sur scène : descendre
  | 'scene'         // spectateur : demander à monter (ou demande en attente)
  | 'partage'       // partage d'écran
  | 'record'        // enregistrement direct (démarrer / arrêter)
  | 'prompteur'
  | 'diffusion'     // diffuser en direct (multistream)
  | 'demandes'      // demandes de scène en attente (hôte) — n'apparaît que s'il y en a
  | 'lecture'       // lire / mettre en pause LA musique (seulement si une musique est chargée)
  | 'terminer'      // terminer le Live pour tous (hôte seulement)
  | 'reduire';      // sortir du plein écran caméra

/** Cible tactile minimale (WCAG 2.5.5 / Apple HIG) : 44 px. */
export const TAILLE_BOUTON = 44;
/** Espace entre deux boutons de la barre en rangée (gap-2). */
export const ESPACE_BOUTONS = 8;
/** Espace entre deux boutons de la barre en COLONNE (gap-3) — même formule, autre gap. */
export const ESPACE_COLONNE = 12;
/** Marge intérieure totale de la barre dans son axe (px-2 × 2 en rangée, py-2 × 2 en colonne). */
export const MARGE_BARRE = 16;
/** Largeur d'une pilule texte du spectateur (« Demander à monter en vidéo »). */
export const LARGEUR_PILULE = 212;

/**
 * Ordre de PRIORITÉ : quand la place manque, on garde d'abord le début de la liste.
 * « Terminer » et la caméra passent avant tout : une action irréversible et la
 * commande qui fait exister le coach à l'écran ne se cherchent pas dans un menu.
 * 28/09 (Bassi) : Terminer, Caméra, Micro, Scène, puis PLAY (s'il y a un média — sinon
 * il n'est pas candidat et ne prend aucune place), puis le partage d'écran. Prompteur,
 * demandes, diffusion, enregistrer, réduire descendent dans ⋮ quand la hauteur manque.
 * Panneau compact (284 px = 4 places) : Terminer, Caméra, Micro, Play.
 */
export const PRIORITE_COMMANDES: readonly CommandeId[] = [
  'terminer', 'camera', 'micro', 'scene', 'lecture', 'partage', 'record', 'reduire', 'prompteur', 'demandes', 'diffusion',
];

/** Toujours devant tout le reste, même devant une commande active. */
const VITALES: readonly CommandeId[] = ['terminer', 'camera', 'micro', 'scene', 'lecture'];

/** Ordre d'AFFICHAGE, de gauche à droite (ou de haut en bas en colonne). */
export const ORDRE_COMMANDES: readonly CommandeId[] = [
  'micro', 'camera', 'scene', 'partage', 'record', 'prompteur', 'lecture', 'diffusion', 'demandes', 'terminer', 'reduire',
];

export interface Repartition {
  /** Commandes rendues dans la barre, dans l'ordre d'affichage. */
  barre: CommandeId[];
  /** Commandes qui débordent dans le menu ⋮, dans l'ordre d'affichage. */
  menu: CommandeId[];
}

/**
 * Répartit les commandes disponibles entre la barre et le menu ⋮ selon la place dans
 * l'AXE de la barre (largeur en rangée, hauteur en colonne). Le bouton ⋮ est TOUJOURS
 * réservé (il porte au moins « Quitter »). Jamais de débordement : ce qui ne tient pas
 * descend dans le menu. Formule : MARGE + ⋮ + n × (bouton + espace) ≤ place.
 *
 * @param candidats commandes réellement disponibles pour cet utilisateur
 * @param largeur   place utile dans l'axe (px) ; `Infinity` = pas de contrainte
 * @param largeurs  taille propre d'une commande si elle n'est pas un bouton rond
 * @param espace    gap entre boutons : ESPACE_BOUTONS (rangée, gap-2) ou ESPACE_COLONNE (gap-3)
 * @param actives   commandes EN COURS (enregistrement, partage) : elles passent juste après
 *                  les vitales (Terminer, Caméra, Micro, Scène, Play) — jamais devant Play.
 */
export function repartirCommandes(
  candidats: readonly CommandeId[],
  largeur: number,
  largeurs: Partial<Record<CommandeId, number>> = {},
  espace: number = ESPACE_BOUTONS,
  actives: readonly CommandeId[] = [],
): Repartition {
  const uniques = ORDRE_COMMANDES.filter((c) => candidats.includes(c));
  const place = (Number.isFinite(largeur) ? Math.max(0, largeur) : Number.MAX_SAFE_INTEGER)
    - MARGE_BARRE - TAILLE_BOUTON; // le bouton ⋮
  let utilise = 0;
  const gardees = new Set<CommandeId>();
  const priorite = [
    ...VITALES,
    ...actives.filter((c) => !VITALES.includes(c)),
    ...PRIORITE_COMMANDES.filter((c) => !VITALES.includes(c) && !actives.includes(c)),
  ];
  for (const c of priorite) {
    if (!uniques.includes(c)) continue;
    const l = (largeurs[c] ?? TAILLE_BOUTON) + espace;
    if (utilise + l <= place) { gardees.add(c); utilise += l; }
  }
  return {
    barre: uniques.filter((c) => gardees.has(c)),
    menu: uniques.filter((c) => !gardees.has(c)),
  };
}

/**
 * Plein écran : zone réellement libre. En plein écran NATIF (Fullscreen API), la scène est
 * dans la couche supérieure du navigateur : tout l'écran. En REPLI CSS (API refusée, iOS,
 * iframe), la scène `fixed` reste sous l'en-tête sticky de la page (contexte d'empilement
 * de <main>) : elle commence donc SOUS son bord bas réel — la barre et le champ se calent
 * sur ce qui est vraiment visible, au lieu de passer sous l'en-tête.
 */
export function zoneLibrePleinEcran(e: { viewportH: number; enteteBas: number; natif: boolean }): { haut: number; hauteur: number } {
  const h = Number.isFinite(e.viewportH) ? Math.max(0, e.viewportH) : 0;
  if (e.natif) return { haut: 0, hauteur: h };
  const haut = Math.min(Math.max(0, Math.round(Number.isFinite(e.enteteBas) ? e.enteteBas : 0)), h);
  return { haut, hauteur: h - haut };
}

/** Largeur sous laquelle on applique la mise en page « téléphone » (= breakpoint sm). */
export const SEUIL_MOBILE = 640;

export interface DispositionBarre {
  orientation: 'verticale';
  cote: 'droite';
  /**
   * Largeur réservée à droite pour la colonne : 0,75 rem de marge au bord + 2,75 rem de
   * bouton (44 px) + 0,25 rem d'air = 3,75 rem (60 px). Le chat, le champ et les
   * vignettes s'arrêtent là : rien ne passe sous la barre.
   */
  reserveDroite: string;
}

/** Colonne réservée à droite pour la barre verticale (voir DispositionBarre). */
export const RESERVE_DROITE = '3.75rem';

/**
 * 🎛️ Barre v2 (28/09) : la barre du Live est une COLONNE À DROITE de la vidéo, sur
 * téléphone comme sur ordinateur, en vue normale comme en plein écran. En bas, elle
 * disputait la place au chat et au champ, et poussait tout vers le haut (sur la vidéo).
 * À droite, elle ne prend qu'une bande de 60 px ; la hauteur mesurée décide de ce qui
 * tient, le reste va dans ⋮. Même réponse pour toutes les tailles : une seule règle.
 */
export function dispositionBarre(_e: { largeur: number; hauteur: number; pleinEcran: boolean }): DispositionBarre {
  return { orientation: 'verticale', cote: 'droite', reserveDroite: RESERVE_DROITE };
}

/**
 * Bord gauche de l'IMAGE réelle d'une vidéo `object-contain` centrée dans la scène
 * (plein écran). Sur un grand écran, une image portrait (téléphone de l'hôte) ou 4:3 laisse
 * des bandes noires : le chat et le champ, plaqués au bord de la scène, y tombaient.
 * On les ancre au bord de l'image. Ratio inconnu (0 / NaN) : aucune hypothèse, bord de scène.
 */
export function ancrageImage(e: { largeur: number; hauteur: number; ratio: number }): { gauche: number } {
  const { largeur, hauteur, ratio } = e;
  if (!(ratio > 0) || !(largeur > 0) || !(hauteur > 0)) return { gauche: 0 };
  return { gauche: Math.max(0, Math.round((largeur - hauteur * ratio) / 2)) };
}

export interface EntreeZone {
  /** Largeur mesurée de la zone caméra (px). */
  largeur: number;
  /** Caméras actives (invités sur scène compris). */
  camerasActives: number;
  pleinEcran: boolean;
  /** Plein écran : une rangée de vignettes d'invités est affichée. */
  vignettes?: boolean;
  /** Au moins un calque (chat, réactions, champ) est fourni par la page. */
  avecCalques?: boolean;
  /** Le panneau Prompteur est ouvert DANS la zone caméra. */
  prompteurOuvert?: boolean;
}

export interface ZoneCommentaires {
  mobile: boolean;
  /** Mode réduit : plusieurs personnes filmées → le chat se fait plus petit. */
  reduit: boolean;
  /** Largeur max du flux de chat (à gauche). */
  chatLargeurMax: string;
  /** Hauteur max du flux de chat, relative à la zone caméra. */
  chatHauteurMax: string;
  /** Largeur max du champ commentaire (pleine largeur sur mobile). */
  inputLargeurMax: string;
  /**
   * Le champ est CENTRÉ en bas de la scène (entre le bord gauche et la colonne de la barre) :
   * il remplace l'ancienne barre média ⏮ ▶ ⏭ et reste visible avec caméra, écran, film.
   */
  inputAlignement: 'centre';
  /** Largeur de la colonne des réactions (à droite). */
  reactionsLargeur: string;
  /** Hors plein écran : espace réservé sous les vignettes pour ne pas les recouvrir. */
  reserveBas: string;
  /** Colonne de la barre verticale, à droite : le chat et le champ s'arrêtent avant. */
  reserveDroite: string;
  /** Hors plein écran : hauteur minimale de la zone caméra (le chat a besoin de place). */
  hauteurMin?: string;
  /**
   * Hors plein écran, Prompteur ouvert : place AJOUTÉE sous les vignettes pour le panneau.
   * Mesuré (QA 28/09) : posé par-dessus, il recouvrait le visage de l'hôte (768 px) ou
   * toute la colonne desktop. En plein écran, c'est la moitié basse (voir LiveVisioPanel).
   */
  reservePrompteur: string;
}

/**
 * Place des calques (chat, champ, réactions) au-dessus de la vidéo.
 *
 * - Une seule caméra : le chat se superpose au bas de la vidéo, façon Live mobile
 *   (≤ 70 % de la largeur sur téléphone, ≤ 22 rem sur ordinateur, ≤ 38-40 % de haut).
 * - Deux caméras ou plus (ou des vignettes d'invités en plein écran) : le chat tombe
 *   à 25 % de haut et, hors plein écran, on réserve sous la grille la place de la
 *   barre + du champ + du chat : les invités ne sont jamais recouverts.
 */
export function zoneCommentaires(e: EntreeZone): ZoneCommentaires {
  const mobile = (e.largeur || 0) < SEUIL_MOBILE;
  const reduit = e.camerasActives >= 2 || !!e.vignettes;
  const avecCalques = e.avecCalques !== false;
  const chatLargeurMax = mobile ? (reduit ? '62%' : '70%') : '22rem';
  // Hors plein écran, le chat réduit a une hauteur FIXE : c'est elle que `reserveBas`
  // réserve sous la grille des caméras.
  const chatHauteurMax = reduit ? (e.pleinEcran ? '25%' : '7rem') : (e.pleinEcran ? '38%' : '40%');
  const inputLargeurMax = mobile ? '100%' : '36rem';
  const reactionsLargeur = mobile ? '3rem' : '3.5rem';
  // Barre v2 : la barre est à DROITE, elle ne réserve plus 4 rem en bas.
  // Champ + chat réduit ≈ 10 rem (hors plein écran, plusieurs caméras).
  const reserveBas = e.pleinEcran ? '0px' : (reduit && avecCalques ? '10rem' : '0px');
  const { reserveDroite } = dispositionBarre({ largeur: e.largeur, hauteur: 0, pleinEcran: e.pleinEcran });
  const hauteurMin = e.pleinEcran || !avecCalques ? undefined : (mobile ? '26rem' : '22rem');
  const reservePrompteur = !e.pleinEcran && e.prompteurOuvert ? '16rem' : '0px';
  return { mobile, reduit, chatLargeurMax, chatHauteurMax, inputLargeurMax, inputAlignement: 'centre', reactionsLargeur, reserveBas, reserveDroite, hauteurMin, reservePrompteur };
}

/**
 * Colonnes de la grille des caméras, selon la largeur de la ZONE (pas de l'écran).
 * Sur ordinateur le panneau vit dans une colonne de ~384 px : un breakpoint d'écran
 * (lg:grid-cols-3) y posait trois vignettes de 64 px de haut (mesuré, QA 28/09).
 * Deux personnes sur téléphone : empilées ; ≥ 480 px (ou ≥ 3 personnes) : 2 ; ≥ 900 px : 3.
 */
export function colonnesGrille(largeur: number, personnes: number): number {
  const n = Math.max(1, Math.floor(personnes || 0));
  const l = largeur || 0;
  // Trois personnes ou plus : 2 colonnes dès 300 px (empilées, 4 vignettes = 800 px de haut).
  const max = l >= 900 ? 3 : l >= 480 || (n >= 3 && l >= 300) ? 2 : 1;
  return Math.min(n, max);
}
