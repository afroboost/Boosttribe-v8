/**
 * 🎬 LA SCÈNE DU LIVE — ce qui passe EN GRAND. Pur : aucun React, aucun DOM.
 *
 * Trois contenus peuvent occuper la grande scène du Live Visio :
 *   - 'film'   : le média partagé (SharedMediaPlayer — l'UNIQUE lecteur, synchronisé
 *                chez les participants par VIDEO_SYNC ; rien n'est publié) ;
 *   - 'ecran'  : l'écran partagé (piste LiveKit ScreenShare, locale ou distante) ;
 *   - 'camera' : la personne à l'image (comportement historique).
 *
 * PRIORITÉ si film ET écran sont actifs : le FILM reste en grand, l'écran passe en
 * vignette (déplaçable). Raison : le film est un lecteur à ÉTAT (position, lecture,
 * seul émetteur VIDEO_SYNC, ⏮ ▶ ⏭) — le réduire à une vignette rend ses commandes
 * inutilisables, et le changer de place le remonterait (retour à 0 chez tout le monde).
 * L'écran, lui, n'est qu'un flux : il reste lisible en vignette, et fermer le film
 * (ou arrêter le partage) rend la scène à l'autre contenu sans rien perdre.
 *
 * La disposition du partage est un choix LOCAL (chaque spectateur choisit sur son
 * écran) : rien ne passe par le compositeur ni par le réseau.
 */
// Mêmes valeurs que l'incrustation du studio (studioScenes : PIP_TAILLE / PIP_MARGE) — le banc
// sceneLive les compare. Recopiées : les modules purs sont compilés un par un (esbuild sans
// bundle) et un import de VALEUR entre eux ne se résoudrait pas sous node.
const PIP_TAILLE = 0.28;
const PIP_MARGE = 0.02;

export type ContenuScene = 'film' | 'ecran' | 'camera';

/**
 * screen_full  : l'écran seul en grand (personnes en vignettes sous la scène) ;
 * screen_coach : l'écran en grand, la caméra en vignette déplaçable ;
 * coach_screen : la caméra en grand, l'écran en vignette déplaçable ;
 * screen_split : l'écran et la caméra côte à côte.
 */
export type DispositionPartage = 'screen_full' | 'screen_coach' | 'coach_screen' | 'screen_split';

export const DISPOSITION_DEFAUT: DispositionPartage = 'screen_coach';

export interface EntreeScene {
  /** La personne principale a une image (sinon la tuile dirait « Caméra coupée »). */
  cameraActive: boolean;
  filmActif: boolean;
  partageActif: boolean;
  disposition?: DispositionPartage | null;
}

export interface ArbitrageScene {
  principal: ContenuScene;
  /** Moitié droite en « côte à côte ». */
  cote: ContenuScene | null;
  /** Vignette déplaçable posée SUR la scène. */
  incrustation: ContenuScene | null;
  /** Tout ce qui est montré en petit (incrustation + bande de vignettes). */
  vignettes: ContenuScene[];
  /** Disposition réellement appliquée (null hors partage). */
  disposition: DispositionPartage | null;
}

/** Dispositions possibles : sans caméra, seul l'écran plein cadre a un sens. */
export function dispositionsPartage(e: { camera: boolean }): DispositionPartage[] {
  return e.camera ? ['screen_full', 'screen_coach', 'coach_screen', 'screen_split'] : ['screen_full'];
}

export function contenuScenePrincipale(e: EntreeScene): ArbitrageScene {
  const cam = e.cameraActive;
  if (e.filmActif) {
    const vignettes: ContenuScene[] = [];
    if (e.partageActif) vignettes.push('ecran');
    if (cam) vignettes.push('camera');
    return { principal: 'film', cote: null, incrustation: e.partageActif ? 'ecran' : null, vignettes, disposition: null };
  }
  if (e.partageActif) {
    const permises = dispositionsPartage({ camera: cam });
    const d: DispositionPartage = e.disposition && permises.includes(e.disposition)
      ? e.disposition
      : (cam ? DISPOSITION_DEFAUT : 'screen_full');
    switch (d) {
      case 'screen_coach':
        return { principal: 'ecran', cote: null, incrustation: 'camera', vignettes: ['camera'], disposition: d };
      case 'coach_screen':
        return { principal: 'camera', cote: null, incrustation: 'ecran', vignettes: ['ecran'], disposition: d };
      case 'screen_split':
        return { principal: 'ecran', cote: 'camera', incrustation: null, vignettes: [], disposition: d };
      default:
        return { principal: 'ecran', cote: null, incrustation: null, vignettes: cam ? ['camera'] : [], disposition: 'screen_full' };
    }
  }
  return { principal: 'camera', cote: null, incrustation: null, vignettes: [], disposition: null };
}

/** Coin bas-droit, comme l'incrustation du studio. */
export const VIGNETTE_DEFAUT = { x: 1 - PIP_TAILLE - PIP_MARGE, y: 1 - PIP_TAILLE - PIP_MARGE };

/**
 * Position normalisée 0..1 (coin haut-gauche) d'une vignette glissée, bornée au cadre
 * avec la marge du studio. `reserveDroite` (fraction de la largeur) recule la borne
 * droite : en plein écran la barre verticale est posée sur l'image.
 */
export function bornerVignette(
  p: { x: number; y: number },
  o: { taille?: number; hauteur?: number; marge?: number; reserveDroite?: number } = {},
): { x: number; y: number } {
  const taille = o.taille ?? PIP_TAILLE;
  const hauteur = o.hauteur ?? taille;
  const marge = o.marge ?? PIP_MARGE;
  const reserve = Math.max(0, o.reserveDroite ?? 0);
  const borne = (v: number, min: number, max: number, repli: number) =>
    (Number.isFinite(v) ? Math.min(Math.max(v, min), Math.max(min, max)) : repli);
  return {
    x: borne(p.x, marge, 1 - taille - marge - reserve, VIGNETTE_DEFAUT.x),
    y: borne(p.y, marge, 1 - hauteur - marge, VIGNETTE_DEFAUT.y),
  };
}

/* ───────────── Vignette en PIXELS, toujours DANS la scène ───────────── */

/** Marge (px) entre la vignette et les bords (ou les réserves) de la scène. */
export const MARGE_VIGNETTE_PX = 8;
/** Plancher de largeur (px) — sauf scène minuscule : 45 % de sa largeur. */
export const VIGNETTE_MIN_PX = 140;
/** Plancher absolu de la vignette caméra (banc réel 28/09 : 111 px à 360 px, trop petit). */
export const VIGNETTE_PLANCHER_ABSOLU_PX = 124; // 120 px d’IMAGE visibles + bordure 2 × 1 px (+ marge)
/** Plafond de largeur : 40 % de la scène. */
export const VIGNETTE_MAX = 0.4;

export interface EntreePlacement {
  largeurScene: number;
  hauteurScene: number;
  /** Bande réservée à droite (barre verticale posée sur l'image), en px. */
  reserveDroitePx?: number;
  /** Bande réservée en bas (champ commentaire), en px. */
  reserveBasPx?: number;
  /** Coin haut-gauche choisi au glisser, en FRACTION de la scène (0..1) ; absent = coin bas-droit. */
  position?: { x: number; y: number } | null;
  /** Largeur visée, en fraction de la scène (défaut : celle du studio, 28 %). */
  taille?: number;
  /** Plafond de largeur (fraction) — défaut VIGNETTE_MAX (40 %). Les vignettes redimensionnables
   *  des participants (plein écran) montent jusqu'à VIGNETTE_MAX_REDIM. */
  tailleMax?: number;
}

/** Plafond des vignettes que l'hôte REDIMENSIONNE à la main (poignée) : 60 % de la scène. */
export const VIGNETTE_MAX_REDIM = 0.6;

/** Poignée de redimensionnement : la nouvelle largeur (fraction de la scène) depuis le bord gauche
 *  de la vignette jusqu'au doigt / curseur. Le bornage (plancher, plafond, ratio 16:9, scène,
 *  barre, champ) reste celui de `placementVignette`. */
export function tailleDepuisPoignee(e: { largeurScene: number; gaucheVignettePx: number; pointeurPx: number }): number {
  const L = e.largeurScene;
  if (!(L > 0)) return PIP_TAILLE;
  return Math.max(0.05, Math.min(1, (e.pointeurPx - e.gaucheVignettePx) / L));
}

export interface PlacementVignette { x: number; y: number; largeur: number; hauteur: number }

/**
 * 📷 Où poser la vignette (caméra ou écran) — en PIXELS, recalculé à chaque rendu et à chaque
 * redimensionnement de la scène. Mesuré en prod : placée en pourcentages (left/top 70 %,
 * largeur 28 %, 16:9), elle sortait par le bas d'une scène plus large que 16:9 et passait
 * sous la barre verticale ; en panneau latéral elle tombait à 83 px de large.
 *
 * Règles : largeur = 28 % bornée [min(140 px, 45 %) ; 40 %], hauteur = largeur × 9/16 ;
 * elle tient TOUJOURS dans la scène (quitte à rapetisser) ; elle évite la barre
 * (`reserveDroitePx`) et le champ (`reserveBasPx`) tant que la place le permet sans passer
 * sous son plancher — sinon la réserve cède, jamais le cadre. Par défaut : coin bas-droit.
 */
export function placementVignette(e: EntreePlacement): PlacementVignette {
  const L = Number.isFinite(e.largeurScene) ? Math.max(0, e.largeurScene) : 0;
  const H = Number.isFinite(e.hauteurScene) ? Math.max(0, e.hauteurScene) : 0;
  if (L <= 0 || H <= 0) return { x: 0, y: 0, largeur: 0, hauteur: 0 };
  const m = Math.min(MARGE_VIGNETTE_PX, L / 10, H / 10);
  const rd = Math.max(0, Number.isFinite(e.reserveDroitePx) ? (e.reserveDroitePx as number) : 0);
  const rb = Math.max(0, Number.isFinite(e.reserveBasPx) ? (e.reserveBasPx as number) : 0);
  const taille = e.taille && e.taille > 0 ? e.taille : PIP_TAILLE;
  const plancher = Math.min(VIGNETTE_MIN_PX, Math.max(VIGNETTE_PLANCHER_ABSOLU_PX, 0.45 * L)); // banc réel : jamais sous 124 px de cadre (360 px → scène 250 px)
  const plafond = e.tailleMax && e.tailleMax > 0 ? Math.min(e.tailleMax, 1) : VIGNETTE_MAX;
  let largeur = Math.max(Math.min(taille * L, plafond * L), plancher);
  // 1) Jamais plus grande que la scène elle-même.
  largeur = Math.min(largeur, L - 2 * m, ((H - 2 * m) * 16) / 9);
  // 2) Hors barre et hors champ, tant que ça ne l'écrase pas sous son plancher.
  const horsReserves = Math.min(L - rd - 2 * m, ((H - rb - 2 * m) * 16) / 9);
  if (horsReserves >= Math.min(largeur, plancher)) largeur = Math.min(largeur, horsReserves);
  largeur = Math.max(0, largeur);
  const hauteur = (largeur * 9) / 16;
  // Réserves effectives : elles cèdent (partiellement) si la vignette ne tient pas autrement.
  const rdE = Math.max(0, Math.min(rd, L - 2 * m - largeur));
  const rbE = Math.max(0, Math.min(rb, H - 2 * m - hauteur));
  const xMax = Math.max(m, L - rdE - m - largeur);
  const yMax = Math.max(m, H - rbE - m - hauteur);
  const borne = (v: number, max: number) => Math.min(Math.max(v, m), max);
  const p = e.position;
  const x = p && Number.isFinite(p.x) ? borne(p.x * L, xMax) : xMax;
  const y = p && Number.isFinite(p.y) ? borne(p.y * H, yMax) : yMax;
  return { x, y, largeur, hauteur };
}

/**
 * « Côte à côte » : 50/50 en paysage ; sur une scène PORTRAIT (téléphone en plein écran),
 * deux moitiés de 180 px de large ne montrent rien → empilé (écran en haut, caméra en bas).
 */
export function decoupeCoteACote(e: { largeur: number; hauteur: number }): 'horizontal' | 'vertical' {
  return e.hauteur > e.largeur && e.largeur > 0 ? 'vertical' : 'horizontal';
}

/**
 * 🪞 Anti-miroir. L'HÔTE qui partage l'onglet (ou l'écran entier) où tourne l'application
 * verrait son aperçu local s'afficher dans lui-même, à l'infini. Dans ce cas SEULEMENT, son
 * aperçu local devient un placeholder sobre ; ce qui est publié ne change pas (les
 * participants voient le vrai écran). Surface inconnue (Safari / Firefox) : aucune hypothèse.
 * Ne concerne que l'ÉCRAN — la caméra locale n'est jamais masquée par cette règle.
 */
export function apercuEcranLocal(e: { ecranLocal: boolean; displaySurface?: string | null }): 'flux' | 'placeholder' {
  return e.ecranLocal && (e.displaySurface === 'browser' || e.displaySurface === 'monitor') ? 'placeholder' : 'flux';
}

/* ───────────── Déplacer l'UNIQUE lecteur sans le couper ───────────── */

/** Un média du lecteur (<video>, <audio>) — juste ce qu'il faut pour le relancer. */
interface MediaLecteur { paused: boolean; play: () => unknown }
/** Le conteneur du lecteur (nœud DOM créé une fois). */
export interface NoeudDeplacable { parentNode: unknown; querySelectorAll?: (sel: string) => ArrayLike<MediaLecteur> }
/** L'emplacement d'arrivée (scène du Live, place d'origine, parking). */
export interface CibleDeplacement {
  appendChild: (n: never) => unknown;
  /** DOM « atomic move » (Chrome 133+) : ni l'iframe ne se recharge, ni la vidéo ne s'arrête. */
  moveBefore?: (n: never, ref: null) => unknown;
}

/**
 * Déplace le conteneur du lecteur vers `cible` SANS le remonter : le composant React reste
 * le même (portail), seul son nœud DOM change de parent. `moveBefore` conserve tout (iframe
 * YouTube / Vimeo comprises) ; sinon `appendChild`, et un média qui JOUAIT et s'est arrêté au
 * passage est relancé — à sa position : aucune position fausse n'est émise.
 */
export function deplacerSansCouper(noeud: NoeudDeplacable, cible: CibleDeplacement): 'deja' | 'moveBefore' | 'appendChild' {
  if (noeud.parentNode === cible) return 'deja';
  const medias = Array.from(noeud.querySelectorAll?.('video, audio') ?? []);
  const enLecture = medias.filter((m) => !m.paused);
  let voie: 'moveBefore' | 'appendChild' = 'appendChild';
  let deplace = false;
  if (typeof cible.moveBefore === 'function') {
    try { cible.moveBefore(noeud as never, null); voie = 'moveBefore'; deplace = true; } catch { /* nœud hors document : repli */ }
  }
  if (!deplace) cible.appendChild(noeud as never);
  for (const m of enLecture) {
    if (m.paused) { try { const r = m.play() as Promise<void> | undefined; r?.catch?.(() => { /* geste requis */ }); } catch { /* ignore */ } }
  }
  return voie;
}


// ─── 📣 01/10 — PROMO DIFFUSÉE déplaçable / redimensionnable par l'hôte ───────────────────────
export const PROMO_LARGEUR_MIN_PX = 220;   // en dessous, titre + « Découvrir » deviennent illisibles
export const PROMO_LARGEUR_MAX = 0.9;      // jamais plus large que 90 % de la scène
export interface LayoutPromo { x: number; y: number; w: number }
export interface PlacementPromo { x: number; y: number; largeur: number; hauteur: number }

/**
 * Où poser la promo (pixels de la scène). Mêmes règles que la vignette (`placementVignette`) —
 * dans la scène, hors barre à droite, hors champ commentaire en bas, réserves qui cèdent avant le
 * cadre — mais SANS ratio imposé : la largeur vient du geste, la HAUTEUR du contenu mesuré.
 */
export function placementPromo(e: {
  largeurScene: number; hauteurScene: number; reserveDroitePx?: number; reserveBasPx?: number;
  layout: LayoutPromo; hauteurContenuPx: number;
}): PlacementPromo {
  const L = Number.isFinite(e.largeurScene) ? Math.max(0, e.largeurScene) : 0;
  const H = Number.isFinite(e.hauteurScene) ? Math.max(0, e.hauteurScene) : 0;
  if (L <= 0 || H <= 0) return { x: 0, y: 0, largeur: 0, hauteur: 0 };
  const m = Math.min(MARGE_VIGNETTE_PX, L / 10, H / 10);
  const rd = Math.max(0, Number.isFinite(e.reserveDroitePx) ? (e.reserveDroitePx as number) : 0);
  const rb = Math.max(0, Number.isFinite(e.reserveBasPx) ? (e.reserveBasPx as number) : 0);
  const plancher = Math.min(PROMO_LARGEUR_MIN_PX, L - 2 * m);
  const dispo = L - rd - 2 * m >= plancher ? L - rd - 2 * m : L - 2 * m;       // la réserve cède avant le cadre
  const w = Number.isFinite(e.layout?.w) ? e.layout.w : 0.4;
  const largeur = Math.max(0, Math.min(Math.max(w * L, plancher), PROMO_LARGEUR_MAX * L, dispo));
  const hauteur = Math.max(0, Math.min(Number.isFinite(e.hauteurContenuPx) ? e.hauteurContenuPx : 0, H - 2 * m));
  const rdE = Math.max(0, Math.min(rd, L - 2 * m - largeur));
  const rbE = Math.max(0, Math.min(rb, H - 2 * m - hauteur));
  const xMax = Math.max(m, L - rdE - m - largeur);
  const yMax = Math.max(m, H - rbE - m - hauteur);
  const borne = (v: number, max: number) => Math.min(Math.max(v, m), max);
  return {
    x: borne(Number.isFinite(e.layout?.x) ? e.layout.x * L : xMax, xMax),
    y: borne(Number.isFinite(e.layout?.y) ? e.layout.y * H : yMax, yMax),
    largeur, hauteur,
  };
}
