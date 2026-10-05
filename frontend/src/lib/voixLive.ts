/**
 * 🎙️ Micros de PAROLE du Live — traitements navigateur et gains par défaut.
 *
 * Audit du 02/10/2026 : l'annulation d'écho (AEC), la réduction de bruit (NS) et le contrôle
 * de gain (AGC) étaient COUPÉS sur tous les micros, et chaque voix était amplifiée à
 * l'émission (×1,5) puis à l'écoute (×1,6 × sortie 1,25). La voix d'un participant sortait des
 * haut-parleurs de l'hôte, son micro la recaptait sans AEC et la renvoyait — écho, puis larsen.
 *
 * La MUSIQUE n'est pas concernée : elle ne passe jamais par ces micros (élément
 * `bt-music-audio` → mixeur), ses réglages restent les siens.
 */

/** Contraintes getUserMedia de TOUT micro de parole (hôte, participant, micro secondaire). */
export const TRAITEMENTS_PAROLE = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
} as const;

/**
 * Gains par défaut des voix : 1 = niveau naturel. L'AGC du navigateur règle le niveau à la
 * source ; tout gain automatique > 1 ré-amplifiait l'écho. Les curseurs manuels restent libres.
 */
export const GAINS_VOIX_DEFAUT = {
  /** voix d'un participant entendue par l'hôte */
  tribu: 1,
  /** voix d'un autre participant (relayée) entendue par un participant */
  relais: 1,
  /** voix de l'hôte entendue par les participants */
  voixHote: 1,
  /** sortie commune des voix (ancien « makeup » 1,25) */
  sortie: 1,
  /** micro de l'hôte à l'émission (ancien « makeup » 1,5) */
  micHote: 1,
  /** micro du participant à l'émission, en % (ancien initialVolume 150) */
  micParticipantPct: 100,
} as const;

export interface EtatTraitements {
  demande: { ec: unknown; ns: unknown; agc: unknown };
  reel: { ec: boolean | undefined; ns: boolean | undefined; agc: boolean | undefined };
  actifs: boolean;
}

/**
 * Ce que le navigateur a RÉELLEMENT appliqué (getSettings), pas seulement ce qu'on a demandé
 * (getConstraints). Journalisé une fois par capture : « [VOIX] traitements » dans la console.
 */
export function verifierTraitementsVoix(piste: MediaStreamTrack | null | undefined, origine: string): EtatTraitements | null {
  if (!piste) return null;
  let c: MediaTrackConstraints = {};
  let s: MediaTrackSettings = {};
  try { c = piste.getConstraints() || {}; } catch { /* navigateur ancien */ }
  try { s = piste.getSettings() || {}; } catch { /* navigateur ancien */ }
  const etat: EtatTraitements = {
    demande: { ec: c.echoCancellation, ns: c.noiseSuppression, agc: c.autoGainControl },
    reel: { ec: s.echoCancellation, ns: s.noiseSuppression, agc: s.autoGainControl },
    actifs: s.echoCancellation === true && s.noiseSuppression === true && s.autoGainControl === true,
  };
  try {
    (etat.actifs ? console.info : console.warn)('[VOIX] traitements', origine, JSON.stringify(etat));
  } catch { /* console indisponible */ }
  return etat;
}
