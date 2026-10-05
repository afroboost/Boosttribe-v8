/**
 * 🎥 Qualité vidéo du Live — réglages de caméra et branchement des flux LiveKit.
 *
 * Mesuré sur un banc LiveKit 1.13.7 local (05/10/2026), deux pertes cumulées :
 *  1. RÉCEPTION — la Room est en `adaptiveStream`, mais les flux étaient posés en `srcObject`
 *     sans `track.attach()`. LiveKit ne voyait aucun élément vidéo : il ne demandait que la
 *     couche basse, et Dynacast coupait les autres chez l'hôte. Le spectateur recevait du
 *     320×180 affiché en plein écran (`qualityLimitationReason: none` : ni réseau ni CPU).
 *  2. CAPTURE — aucune résolution demandée : défaut LiveKit 1280×720, plafond 1,7 Mbit/s.
 *
 * `brancherVideo` passe par `attach()` pour les flux LiveKit : LiveKit mesure alors la taille
 * RÉELLE de chaque élément et choisit la couche adaptée (1080p en grand, 360p en vignette).
 * Un flux local (aperçu, scène) garde `srcObject`, exactement comme avant.
 */
import { VideoPresets, type TrackPublishOptions, type VideoCaptureOptions } from 'livekit-client';

/** Ce que l'on sait d'une piste LiveKit pour la brancher : attach / detach. */
export interface PisteAttachable {
  attach: (el: HTMLMediaElement) => HTMLMediaElement;
  detach: (el: HTMLMediaElement) => HTMLMediaElement;
}

const pistesParFlux = new WeakMap<MediaStream, PisteAttachable>();

/** Mémorise la piste LiveKit qui alimente ce flux (appelé à l'abonnement). */
export function associerPisteVideo(flux: MediaStream, piste: PisteAttachable): void {
  pistesParFlux.set(flux, piste);
}

/**
 * Branche un flux sur une balise vidéo et renvoie le débranchement (à appeler au démontage
 * ou au changement de flux). Flux LiveKit → attach/detach ; sinon srcObject (inchangé).
 */
export function brancherVideo(el: HTMLMediaElement, flux: MediaStream): () => void {
  const piste = pistesParFlux.get(flux);
  if (piste) {
    piste.attach(el);
    return () => { try { piste.detach(el); } catch { /* piste déjà terminée */ } };
  }
  if (el.srcObject !== flux) el.srcObject = flux;
  return () => { /* flux local : le composant gère lui-même son srcObject */ };
}

/** Hauteurs cibles, de la meilleure à la plus modeste (16:9). */
export const HAUTEURS_CIBLES = [2160, 1440, 1080, 720] as const;

/**
 * 🎥 Phase caméra 2 — la meilleure hauteur que la caméra ANNONCE, plafonnée à 4K.
 * Capacités inconnues (Safari ne les expose pas) : 1080p, le comportement d'avant.
 * La demande reste « idéale » : une caméra qui ne sait pas faire donne ce qu'elle peut,
 * et `getSettings()` dit ensuite la vérité (journalisée à la publication).
 */
export function cibleCamera(hauteurMax: number | null | undefined): number {
  if (!hauteurMax || !Number.isFinite(hauteurMax)) return 1080;
  return HAUTEURS_CIBLES.find((h) => h <= hauteurMax) ?? 720;
}

/** Hauteur max annoncée par une caméra SANS l'ouvrir (`InputDeviceInfo.getCapabilities`, Chrome). */
export function hauteurMaxCamera(appareil: { getCapabilities?: () => MediaTrackCapabilities } | null | undefined): number | null {
  try {
    const max = appareil?.getCapabilities?.()?.height?.max;
    return typeof max === 'number' && max > 0 ? max : null;
  } catch { return null; }
}

/** Couches simulcast sous la cible : vignette + écran moyen ; jamais une couche égale à la source. */
export function couchesPour(hauteur: number) {
  if (hauteur >= 1440) return [VideoPresets.h360, VideoPresets.h1080];
  if (hauteur >= 1080) return [VideoPresets.h360, VideoPresets.h720];
  return [VideoPresets.h180, VideoPresets.h360];
}

const DEBITS: Array<[number, number]> = [
  [180, VideoPresets.h180.encoding.maxBitrate], [216, VideoPresets.h216.encoding.maxBitrate],
  [360, VideoPresets.h360.encoding.maxBitrate], [540, VideoPresets.h540.encoding.maxBitrate],
  [720, VideoPresets.h720.encoding.maxBitrate], [1080, VideoPresets.h1080.encoding.maxBitrate],
  [1440, VideoPresets.h1440.encoding.maxBitrate], [2160, VideoPresets.h2160.encoding.maxBitrate],
];

/** Débit des préréglages LiveKit pour une hauteur donnée (le palier qui la couvre). */
export function debitPourHauteur(hauteur: number): number {
  const p = DEBITS.find(([h]) => hauteur <= h + 1);
  return (p ?? DEBITS[DEBITS.length - 1])[1];
}

/**
 * Changement de caméra en direct : les couches gardent leur rid et leur échelle, mais chaque
 * débit est recalculé pour la NOUVELLE résolution (sinon une 4K resterait plafonnée au débit
 * d'une 1080p). PURE : la page applique le résultat avec `sender.setParameters`.
 */
export function encodagesAjustes<T extends { rid?: string; scaleResolutionDownBy?: number; maxBitrate?: number }>(
  encodages: T[], largeur: number, hauteur: number,
): T[] {
  const petit = Math.min(largeur, hauteur);
  return encodages.map((e) => ({ ...e, maxBitrate: debitPourHauteur(Math.round(petit / (e.scaleResolutionDownBy || 1))) }));
}

/**
 * Surcharge processeur mesurée par le navigateur (`qualityLimitationReason === 'cpu'` trois
 * fois de suite sur la couche haute) : on descend PROPREMENT d'un palier, jamais sous 1080p
 * par ce mécanisme, et on dit pourquoi. Le réseau (`bandwidth`) reste géré par LiveKit.
 */
export function decisionQualiteCpu(historique: Array<{ limite?: string }>, hauteurActuelle: number): { cible: number; raison: string } | null {
  const derniers = historique.slice(-3);
  if (derniers.length < 3 || !derniers.every((x) => x.limite === 'cpu')) return null;
  const suivante = HAUTEURS_CIBLES.find((h) => h < hauteurActuelle && h >= 1080);
  return suivante ? { cible: suivante, raison: 'processeur saturé (encodage vidéo)' } : null;
}

/**
 * Options de la caméra publiée. Ordinateur : la MEILLEURE hauteur annoncée par la caméra (jusqu'à
 * 4K), 30 i/s, couches simulcast adaptées ; AUCUN débit imposé — LiveKit le déduit de la
 * résolution RÉELLEMENT capturée (8 Mbit/s en 4K, 5 en 1440p, 3 en 1080p, 1,7 en 720p).
 * Téléphone : réglage LiveKit inchangé (720p) — stabilité, batterie et réseau mobile d'abord.
 */
export function optionsCameraLive({ mobile, hauteurMax }: { mobile: boolean; hauteurMax?: number | null }): {
  capture: VideoCaptureOptions;
  publication: TrackPublishOptions | undefined;
} {
  if (mobile) return { capture: {}, publication: undefined };
  const h = cibleCamera(hauteurMax);
  return {
    capture: { resolution: { width: Math.round((h * 16) / 9), height: h, frameRate: 30 } },
    publication: { simulcast: true, videoSimulcastLayers: couchesPour(h) },
  };
}
