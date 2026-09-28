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
  | 'terminer'      // terminer le Live pour tous (hôte seulement)
  | 'reduire';      // sortir du plein écran caméra

/** Cible tactile minimale (WCAG 2.5.5 / Apple HIG) : 44 px. */
export const TAILLE_BOUTON = 44;
/** Espace entre deux boutons de la barre (gap-2). */
export const ESPACE_BOUTONS = 8;
/** Marge intérieure horizontale totale de la barre (px-2 × 2). */
export const MARGE_BARRE = 16;
/** Largeur d'une pilule texte du spectateur (« Demander à monter en vidéo »). */
export const LARGEUR_PILULE = 212;

/**
 * Ordre de PRIORITÉ : quand la place manque, on garde d'abord le début de la liste.
 * « Terminer » et la caméra passent avant tout : une action irréversible et la
 * commande qui fait exister le coach à l'écran ne se cherchent pas dans un menu.
 */
export const PRIORITE_COMMANDES: readonly CommandeId[] = [
  'terminer', 'camera', 'scene', 'micro', 'reduire', 'record', 'prompteur', 'demandes', 'partage', 'diffusion',
];

/** Ordre d'AFFICHAGE, de gauche à droite (ou de haut en bas en colonne). */
export const ORDRE_COMMANDES: readonly CommandeId[] = [
  'micro', 'camera', 'scene', 'partage', 'record', 'prompteur', 'diffusion', 'demandes', 'terminer', 'reduire',
];

export interface Repartition {
  /** Commandes rendues dans la barre, dans l'ordre d'affichage. */
  barre: CommandeId[];
  /** Commandes qui débordent dans le menu ⋮, dans l'ordre d'affichage. */
  menu: CommandeId[];
}

/**
 * Répartit les commandes disponibles entre la barre et le menu ⋮ selon la largeur.
 * Le bouton ⋮ est TOUJOURS réservé (il porte au moins « Quitter »). Jamais de
 * débordement horizontal : ce qui ne tient pas descend dans le menu.
 *
 * @param candidats commandes réellement disponibles pour cet utilisateur
 * @param largeur   largeur utile de la zone (px) ; `Infinity` = pas de contrainte (colonne)
 * @param largeurs  largeur propre d'une commande si elle n'est pas un bouton rond
 */
export function repartirCommandes(
  candidats: readonly CommandeId[],
  largeur: number,
  largeurs: Partial<Record<CommandeId, number>> = {},
): Repartition {
  const uniques = ORDRE_COMMANDES.filter((c) => candidats.includes(c));
  const place = (Number.isFinite(largeur) ? Math.max(0, largeur) : Number.MAX_SAFE_INTEGER)
    - MARGE_BARRE - TAILLE_BOUTON; // le bouton ⋮
  let utilise = 0;
  const gardees = new Set<CommandeId>();
  for (const c of PRIORITE_COMMANDES) {
    if (!uniques.includes(c)) continue;
    const l = (largeurs[c] ?? TAILLE_BOUTON) + ESPACE_BOUTONS;
    if (utilise + l <= place) { gardees.add(c); utilise += l; }
  }
  return {
    barre: uniques.filter((c) => gardees.has(c)),
    menu: uniques.filter((c) => !gardees.has(c)),
  };
}

/** Largeur sous laquelle on applique la mise en page « téléphone » (= breakpoint sm). */
export const SEUIL_MOBILE = 640;

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
  /** Largeur de la colonne des réactions (à droite). */
  reactionsLargeur: string;
  /** Hors plein écran : espace réservé sous les vignettes pour ne pas les recouvrir. */
  reserveBas: string;
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
  const inputLargeurMax = mobile ? '100%' : '24rem';
  const reactionsLargeur = mobile ? '3rem' : '3.5rem';
  // Barre seule ≈ 4 rem ; barre + champ + chat réduit ≈ 14 rem.
  const reserveBas = e.pleinEcran ? '0px' : (reduit && avecCalques ? '14rem' : '4rem');
  const hauteurMin = e.pleinEcran || !avecCalques ? undefined : (mobile ? '26rem' : '22rem');
  const reservePrompteur = !e.pleinEcran && e.prompteurOuvert ? '16rem' : '0px';
  return { mobile, reduit, chatLargeurMax, chatHauteurMax, inputLargeurMax, reactionsLargeur, reserveBas, hauteurMin, reservePrompteur };
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
