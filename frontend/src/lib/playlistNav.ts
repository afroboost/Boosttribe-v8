/**
 * ⏭️ playlistNav — « quelle est la piste suivante ? », en une seule fonction.
 *
 * Sortie des composants pour UNE raison précise : le bouton « Morceau suivant » doit
 * être DÉSACTIVÉ exactement quand le clic ne ferait rien. Si la condition d'affichage
 * et la condition d'action vivent à deux endroits, elles divergent — c'est ce qui a
 * rendu le bouton invisible en production au premier essai. Ici, l'écran et le
 * gestionnaire posent la MÊME question à la MÊME fonction.
 */

export type ModeRepetition = 'none' | 'one' | 'all';

/**
 * Index de la piste suivante, ou `null` s'il n'y en a pas.
 *
 * La répétition « one » ne piège pas un clic MANUEL : demander « suivant » avance
 * d'une piste, comme dans tout lecteur ; la répétition s'appliquera au titre suivant.
 * Seule « all » reboucle de la dernière vers la première — jamais de boucle arbitraire.
 */
export function indexSuivant(nombre: number, index: number, repetition: ModeRepetition): number | null {
  if (!Number.isInteger(nombre) || nombre < 2) return null;   // 0 ou 1 piste : rien à enchaîner
  if (!Number.isInteger(index) || index < 0 || index >= nombre) return null;
  if (index < nombre - 1) return index + 1;
  return repetition === 'all' ? 0 : null;                     // dernière piste
}

/** Y a-t-il une piste suivante ? (ce qui pilote l'état activé/désactivé du bouton) */
export const aUnePisteSuivante = (nombre: number, index: number, repetition: ModeRepetition): boolean =>
  indexSuivant(nombre, index, repetition) !== null;

/**
 * ⏮️ Index de la piste PRÉCÉDENTE, ou `null` s'il n'y en a pas.
 *
 * Symétrique d'`indexSuivant`, et pour la même raison : l'écran et le gestionnaire
 * doivent poser la MÊME question à la MÊME fonction. La répétition « all » reboucle
 * de la première vers la dernière ; « one » ne piège pas un clic manuel.
 */
export function indexPrecedent(nombre: number, index: number, repetition: ModeRepetition): number | null {
  if (!Number.isInteger(nombre) || nombre < 2) return null;   // 0 ou 1 piste : rien avant
  if (!Number.isInteger(index) || index < 0 || index >= nombre) return null;
  if (index > 0) return index - 1;
  return repetition === 'all' ? nombre - 1 : null;            // première piste
}

/** Y a-t-il une piste précédente ? */
export const aUnePistePrecedente = (nombre: number, index: number, repetition: ModeRepetition): boolean =>
  indexPrecedent(nombre, index, repetition) !== null;

/**
 * Au-delà de ce nombre de secondes, « précédent » REDÉMARRE le titre en cours au lieu
 * de reculer. C'est la convention de tous les lecteurs, et elle évite le pire des
 * défauts : quitter par erreur un morceau qu'on écoutait depuis trois minutes.
 */
export const SEUIL_REDEMARRAGE_S = 3;

export type ActionPrecedent = 'redemarrer' | 'precedent' | 'rien';

/**
 * Que doit faire un clic sur ⏮ ? UNE seule réponse, donnée à l'écran (pour savoir s'il
 * faut activer le bouton) comme au gestionnaire (pour savoir quoi exécuter).
 *
 *  - au-delà du seuil            → redémarrer le titre en cours (toujours possible) ;
 *  - au tout début, avec un titre avant → charger le précédent ;
 *  - au tout début de la PREMIÈRE piste → rien, et le bouton doit le dire en étant
 *    désactivé plutôt qu'en ne faisant rien silencieusement.
 *
 * Une position illisible (NaN, négative, non finie) est traitée comme zéro : on ne
 * redémarre jamais « par accident » sur une valeur qu'on ne comprend pas.
 */
export function actionPrecedent(
  position: number,
  aUnePrecedente: boolean,
  seuil: number = SEUIL_REDEMARRAGE_S,
): ActionPrecedent {
  const p = Number.isFinite(position) && position > 0 ? position : 0;
  if (p > seuil) return 'redemarrer';
  if (aUnePrecedente) return 'precedent';
  return 'rien';
}
