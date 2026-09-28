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
