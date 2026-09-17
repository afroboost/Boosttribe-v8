/**
 * ✨ EMBELLIR LE VISAGE — la logique PURE (aucun DOM, aucun WebGL ici).
 *
 * Ce fichier est transpilé par `yarn test` (esbuild) et exécuté tel quel par les bancs
 * `tests/beaute*.test.mjs`. Tout ce qui décide vit ici :
 *   - les niveaux (off / léger / moyen) et les paramètres du shader qu'ils impliquent ;
 *   - la persistance du réglage (localStorage `bt_beaute`) ;
 *   - la résolution de traitement plafonnée (mobile) ;
 *   - la garde de performance (< 20 fps pendant 3 s → on coupe, retour à la piste brute).
 *
 * Rendu voulu : humain, propre, flatteur — jamais plastique. D'où des intensités modestes,
 * un lissage limité aux tons peau et un mélange avec l'image d'origine (grain conservé).
 */

export type NiveauBeaute = 'off' | 'leger' | 'moyen';

export const NIVEAUX_BEAUTE: readonly NiveauBeaute[] = ['off', 'leger', 'moyen'] as const;
export const CLE_STOCKAGE_BEAUTE = 'bt_beaute';

export const LIBELLES_BEAUTE: Record<NiveauBeaute, string> = {
  off: 'Désactivé',
  leger: 'Léger',
  moyen: 'Moyen',
};

/** Paramètres consommés par le shader (uniforms) et par le pipeline. */
export interface ParametresBeaute {
  /** Part de l'image lissée mélangée à l'original, sur la peau (0 = brut, 1 = tout lissé). */
  lissage: number;
  /** Rayon d'échantillonnage du flou bilatéral, en pixels de la résolution de traitement. */
  rayon: number;
  /** Tolérance de couleur du filtre bilatéral (0..1) — petite = rides/pores atténués, contours préservés. */
  tolerance: number;
  /** Léger éclaircissement (additif, 0..1). */
  eclaircissement: number;
  /** Contraste (1 = inchangé). */
  contraste: number;
}

const PARAMETRES: Record<NiveauBeaute, ParametresBeaute> = {
  off: { lissage: 0, rayon: 0, tolerance: 0, eclaircissement: 0, contraste: 1 },
  // Léger : les petites imperfections s'estompent, la texture de peau reste visible.
  leger: { lissage: 0.35, rayon: 2, tolerance: 0.10, eclaircissement: 0.015, contraste: 0.99 },
  // Moyen : rides fines atténuées, encore naturel (mélange à 50 % max, jamais plus).
  moyen: { lissage: 0.5, rayon: 3, tolerance: 0.13, eclaircissement: 0.025, contraste: 0.985 },
};

/** Le lissage ne dépasse JAMAIS cette valeur : au-delà, l'effet devient « plastique ». */
export const LISSAGE_MAX = 0.5;

export function parametresBeaute(niveau: NiveauBeaute): ParametresBeaute {
  const p = PARAMETRES[niveau] ?? PARAMETRES.off;
  return { ...p, lissage: Math.min(LISSAGE_MAX, p.lissage) };
}

export function estNiveauBeaute(v: unknown): v is NiveauBeaute {
  return typeof v === 'string' && (NIVEAUX_BEAUTE as readonly string[]).includes(v);
}

/** Lecture tolérante : toute valeur inconnue/absente vaut `off` (jamais activé par surprise). */
export function lireNiveauBeaute(stockage: { getItem(k: string): string | null } | null | undefined): NiveauBeaute {
  try {
    const v = stockage?.getItem(CLE_STOCKAGE_BEAUTE);
    return estNiveauBeaute(v) ? v : 'off';
  } catch {
    return 'off';
  }
}

export function ecrireNiveauBeaute(
  stockage: { setItem(k: string, v: string): void; removeItem(k: string): void } | null | undefined,
  niveau: NiveauBeaute,
): void {
  try {
    if (niveau === 'off') stockage?.removeItem(CLE_STOCKAGE_BEAUTE);
    else stockage?.setItem(CLE_STOCKAGE_BEAUTE, niveau);
  } catch { /* mode privé : le réglage vaut pour la session */ }
}

/** Plafond de la résolution de traitement (grand côté), pour que le mobile suive. */
export const COTE_MAX_TRAITEMENT = 720;

/**
 * Taille du canvas de traitement : la vidéo est réduite si son grand côté dépasse le plafond,
 * proportions conservées, dimensions paires (encodeurs vidéo).
 */
export function resolutionTraitement(largeur: number, hauteur: number, coteMax = COTE_MAX_TRAITEMENT): { largeur: number; hauteur: number } {
  const w = Math.max(2, Math.floor(largeur || 0));
  const h = Math.max(2, Math.floor(hauteur || 0));
  const grand = Math.max(w, h);
  const k = grand > coteMax ? coteMax / grand : 1;
  const pair = (n: number) => Math.max(2, Math.round((n * k) / 2) * 2);
  return { largeur: pair(w), hauteur: pair(h) };
}

/** Sous ce débit d'images, le traitement est jugé trop lourd pour l'appareil. */
export const FPS_MINIMUM = 20;
/** Durée continue sous le minimum avant de couper. */
export const DUREE_TOLERANCE_MS = 3000;

/**
 * Garde de performance : on lui donne l'horodatage de chaque image traitée ; elle répond
 * `true` UNE fois lorsque le débit est resté sous `FPS_MINIMUM` pendant `DUREE_TOLERANCE_MS`
 * d'affilée. Un retour au-dessus du seuil remet le compteur à zéro. Les premières images
 * (échauffement) ne comptent pas : on attend d'avoir une seconde de mesure.
 */
export class GardePerformance {
  private fenetre: number[] = [];
  private sousSeuilDepuis: number | null = null;
  private declenchee = false;

  constructor(private readonly fpsMin = FPS_MINIMUM, private readonly toleranceMs = DUREE_TOLERANCE_MS) {}

  /** Débit instantané sur la dernière seconde (0 tant qu'on n'a pas une seconde de recul). */
  fps(maintenant: number): number {
    const debut = maintenant - 1000;
    this.fenetre = this.fenetre.filter((t) => t > debut);
    if (this.fenetre.length < 2) return 0;
    const duree = this.fenetre[this.fenetre.length - 1] - this.fenetre[0];
    return duree > 0 ? ((this.fenetre.length - 1) * 1000) / duree : 0;
  }

  /** À appeler à chaque image traitée. Renvoie `true` quand il faut couper. */
  enregistrer(maintenant: number): boolean {
    if (this.declenchee) return false;
    this.fenetre.push(maintenant);
    const premiere = this.fenetre[0];
    if (maintenant - premiere < 1000) return false;      // échauffement : pas de verdict
    const fps = this.fps(maintenant);
    if (fps >= this.fpsMin) { this.sousSeuilDepuis = null; return false; }
    if (this.sousSeuilDepuis === null) this.sousSeuilDepuis = maintenant;
    if (maintenant - this.sousSeuilDepuis >= this.toleranceMs) { this.declenchee = true; return true; }
    return false;
  }

  reinitialiser(): void { this.fenetre = []; this.sousSeuilDepuis = null; this.declenchee = false; }
}

/** Capacités minimales requises : un canvas capturable et WebGL. Sinon, l'option n'est pas proposée. */
export function supportBeaute(env: {
  captureStream?: boolean;
  webgl?: boolean;
} | null | undefined): boolean {
  return !!env && env.captureStream === true && env.webgl === true;
}

/**
 * Prochain niveau au clic sur un bouton unique (off → léger → moyen → off). Le toggle
 * propose aussi les trois choix explicitement ; cette rotation sert au raccourci.
 */
export function niveauSuivant(niveau: NiveauBeaute): NiveauBeaute {
  const i = NIVEAUX_BEAUTE.indexOf(niveau);
  return NIVEAUX_BEAUTE[(i + 1) % NIVEAUX_BEAUTE.length];
}
