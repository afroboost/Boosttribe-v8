/**
 * 🔴 TERMINER LE LIVE — l'ordre des opérations, et pourquoi il est écrit ici.
 *
 * CE QUI SE PASSAIT AVANT (mesuré en production le 23/09/2026). « Quitter le live »
 * faisait UNE chose : `setLiveMode(false)`. Il fermait l'écran. La caméra continuait,
 * la room LiveKit restait ouverte, un enregistrement en cours n'était pas finalisé,
 * les participants n'étaient prévenus de rien, et surtout le serveur continuait
 * d'annoncer « EN DIRECT » sur la page d'accueil — jusqu'à TROIS HEURES, le temps que
 * le garde-fou d'Afroboost expire. Un live fantôme, visible de tous les visiteurs.
 *
 * L'ORDRE COMPTE, et c'est tout l'objet de ce module. Finaliser l'enregistrement AVANT
 * de couper les pistes : l'inverse ferme un fichier sur des pistes déjà mortes, et on
 * a déjà payé ce prix une fois (le MP4 de 0 octet du 17/09). Prévenir les participants
 * AVANT de quitter la room : après, le canal est fermé et personne n'apprend rien.
 * Annoncer la fin en DERNIER, quand tout est réellement arrêté — pas avant, sinon on
 * déclare terminé un live qui diffuse encore.
 *
 * Ce module ne fait rien lui-même : il décrit la séquence, pour qu'elle soit lisible
 * et vérifiable sans navigateur.
 */

export type EtapeFin =
  | 'finaliser-enregistrement'
  | 'prevenir-participants'
  | 'couper-camera'
  | 'couper-ecran'
  | 'couper-micro'
  | 'quitter-room'
  | 'annoncer-fin'
  | 'retour-ecran';

export interface EtatAvantFin {
  enregistrementEnCours: boolean;
  partageEcranActif: boolean;
  cameraActive: boolean;
  microActif: boolean;
  /** L'hôte est-il celui qui anime ? Un spectateur ne « termine » rien. */
  estHote: boolean;
}

/**
 * La séquence à jouer. Une étape inutile n'est pas listée : couper une caméra déjà
 * éteinte n'a pas de sens, et une étape qui ne sert à rien est une étape qu'on
 * oublie de tester.
 */
export function sequenceFinDuLive(e: EtatAvantFin): EtapeFin[] {
  const etapes: EtapeFin[] = [];
  if (e.enregistrementEnCours) etapes.push('finaliser-enregistrement');
  if (e.estHote) etapes.push('prevenir-participants');
  if (e.cameraActive) etapes.push('couper-camera');
  if (e.partageEcranActif) etapes.push('couper-ecran');
  if (e.microActif) etapes.push('couper-micro');
  etapes.push('quitter-room');
  if (e.estHote) etapes.push('annoncer-fin');
  etapes.push('retour-ecran');
  return etapes;
}

/** Événement Realtime : l'hôte a terminé. Les participants l'apprennent par là. */
export const EVENEMENT_LIVE_TERMINE = 'LIVE_ENDED';

/** Faut-il annoncer la fin lors de ce départ ? Oui seulement si un live tournait. */
export function departDoitAnnoncer(estHote: boolean, liveDemarre: boolean): boolean {
  return !!(estHote && liveDemarre);
}
