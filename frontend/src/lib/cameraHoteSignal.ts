/**
 * 🎥 « L'HÔTE EST EN CAMÉRA » — le signal qui manquait.
 *
 * CONSTAT (audit du 22/09/2026). Le serveur vidéo (LiveKit) est sain : jeton accepté,
 * jonction anonyme autorisée en lecture. Ce qui manquait n'était pas un transport, c'était
 * une PHRASE : rien ne disait aux participants que l'hôte venait d'allumer sa caméra. Ils
 * restaient donc hors de la room (`active` du hook vidéo reste faux) et ne pouvaient RIEN
 * recevoir. Le même problème avait déjà été résolu pour le PARTAGE D'ÉCRAN, avec un simple
 * message Supabase Realtime `SCREEN_SHARE_STATE` + un battement toutes les 4 s pour ceux qui
 * arrivent en retard. On reprend ce mécanisme à l'identique : aucun transport nouveau,
 * aucun backend temps réel, aucune dépendance de plus.
 *
 * Ce module ne contient que la logique PURE (registre des publieurs, péremption, droits),
 * pour qu'elle soit vérifiable sans navigateur.
 */

/** Nom de l'événement Realtime — voisin de `SCREEN_SHARE_STATE`, jamais son remplaçant. */
export const EVENEMENT_CAMERA_HOTE = 'HOST_CAMERA_STATE';

/** Cadence du battement, identique à celle du partage d'écran (late-join). */
export const BATTEMENT_CAMERA_MS = 4000;

/**
 * Au-delà de ce silence, on considère qu'un publieur n'est plus là. Trois battements plus
 * une marge : un onglet fermé brutalement n'envoie jamais son « off », et laisser le
 * registre se vider tout seul évite d'y croire indéfiniment.
 */
export const PEREMPTION_CAMERA_MS = 13000;

export interface SignalCameraHote {
  active?: boolean;
  userId?: string;
}

/**
 * Applique un signal reçu au registre `userId → dernier signe de vie`.
 * Renvoie `true` si le registre a CHANGÉ — l'appelant ne déclenche un rendu que dans ce cas
 * (règle du dépôt : jamais de `setState` qui ne change rien, sous peine de boucle d'effets).
 */
export function appliquerSignalCamera(
  registre: Map<string, number>,
  signal: SignalCameraHote | null | undefined,
  moi: string,
  maintenant: number,
): boolean {
  const qui = String(signal?.userId || '').trim();
  if (!qui || qui === moi) return false;          // mon propre écho n'est pas une caméra distante
  if (signal?.active) {
    const avant = registre.size;
    registre.set(qui, maintenant);
    return registre.size !== avant;               // rafraîchir un battement ne change rien
  }
  return registre.delete(qui);
}

/** Retire les publieurs silencieux depuis trop longtemps. `true` si le registre a changé. */
export function purgerCamerasPerimees(registre: Map<string, number>, maintenant: number): boolean {
  let change = false;
  for (const [qui, vu] of registre) {
    if (maintenant - vu > PEREMPTION_CAMERA_MS) { registre.delete(qui); change = true; }
  }
  return change;
}

/**
 * Les raisons, déjà calculées ailleurs dans la page, pour lesquelles une personne n'a PAS
 * le droit de recevoir la vidéo de cette session. Le signal caméra n'ouvre aucune porte :
 * il ne fait qu'allumer l'écran de quelqu'un qui avait déjà le droit d'entrer.
 */
export interface DroitsVisio {
  /** `access_mode = 'guest'` → écoute/lecture seule : règle existante, inchangée. */
  lectureSeule: boolean;
  /** Paywall « crédits » du mode Ouverte (`creditsBlocked`). */
  paywallCredits: boolean;
  /** Mode Payante : billet non acheté (`hasTicket === false`). */
  billetManquant: boolean;
  /** Mode Payante : paiement fait, inscription à finaliser. */
  attenteInscription: boolean;
  /** Refusé par l'hôte (salle d'attente). */
  refuse: boolean;
  /** Session privée : en attente d'admission. */
  enAttenteAdmission: boolean;
  /** Tant qu'on ne sait pas qui c'est, on ne connecte rien. */
  pseudoConnu: boolean;
}

/** Vrai si cette personne peut REGARDER la vidéo (publier reste décidé par le serveur). */
export function peutRecevoirLaVideo(d: DroitsVisio): boolean {
  return d.pseudoConnu
    && !d.lectureSeule
    && !d.paywallCredits
    && !d.billetManquant
    && !d.attenteInscription
    && !d.refuse
    && !d.enAttenteAdmission;
}

/**
 * La raison — UNE seule, la première qui ferme la porte — pour laquelle la vidéo n'est pas
 * accessible. Un message générique (« procurez-vous des crédits ») envoyait acheter quelque
 * chose à des gens que rien ne bloquait côté paiement : un invité d'un live gratuit, ou
 * quelqu'un simplement en attente d'admission. Dire laquelle des règles s'applique coûte
 * une ligne et évite un faux problème.
 */
export function raisonVisioFermee(d: DroitsVisio): string {
  if (!d.pseudoConnu) return 'Indique ton nom pour rejoindre la vidéo.';
  if (d.refuse) return "L'hôte a refusé ton entrée dans cette session.";
  if (d.enAttenteAdmission) return "Session privée : l'hôte doit t'admettre avant la vidéo.";
  if (d.lectureSeule) return 'Cette session est en écoute/lecture seule : pas de vidéo ni de chat.';
  if (d.billetManquant) return 'Session payante : ton billet donne accès à la vidéo.';
  if (d.attenteInscription) return 'Finalise ton inscription pour accéder à la vidéo.';
  if (d.paywallCredits) return "Cette session « Ouverte » demande 1 crédit d'accès.";
  return '';
}
