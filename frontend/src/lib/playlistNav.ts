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
