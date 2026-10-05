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

/**
 * Options de la caméra publiée. Ordinateur : 1080p / 30 i/s demandés (contraintes « idéales » :
 * une caméra qui ne sait pas faire donne ce qu'elle peut), préréglage 1080p de LiveKit
 * (3 Mbit/s) et couches 360p + 720p pour les petits écrans. Téléphone : réglage LiveKit
 * inchangé (720p) — ni la batterie, ni l'encodeur, ni le réseau mobile ne sont sacrifiés.
 */
export function optionsCameraLive({ mobile }: { mobile: boolean }): {
  capture: VideoCaptureOptions;
  publication: TrackPublishOptions | undefined;
} {
  if (mobile) return { capture: {}, publication: undefined };
  return {
    capture: { resolution: { width: 1920, height: 1080, frameRate: 30 } },
    publication: {
      simulcast: true,
      videoEncoding: { maxBitrate: VideoPresets.h1080.encoding.maxBitrate, maxFramerate: 30 },
      videoSimulcastLayers: [VideoPresets.h360, VideoPresets.h720],
    },
  };
}
