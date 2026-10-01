/**
 * 🪟 Où rendre une fenêtre `fixed` du Live (menu ⋮, tiroir « Diffuser en direct »).
 *
 * CAUSE DE LA RÉGRESSION (barre verticale du 28/09) : la barre est centrée par
 * `-translate-y-1/2`. Un `transform` sur un ancêtre devient le REPÈRE d'un élément `fixed` :
 * le menu, positionné en coordonnées de FENÊTRE, était décalé à droite et coupé. Et un panneau
 * rendu hors de la zone caméra est INVISIBLE en plein écran natif (seul l'élément plein écran
 * s'affiche). On rend donc ces panneaux dans un portail : l'élément plein écran s'il y en a un,
 * sinon `document.body` — repère = la fenêtre, toujours.
 */
export function cibleSuperposition(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  return (document.fullscreenElement as HTMLElement | null) || document.body;
}

/** Position du menu ⋮ (coordonnées FENÊTRE) : au-dessus du bouton, aligné à droite, toujours visible. */
export function placerMenu(e: { largeurFenetre: number; hauteurFenetre: number; boutonHaut: number; boutonDroite: number; largeurMenu: number }): { bottom: number; right: number } {
  const bottom = Math.max(8, Math.round(e.hauteurFenetre - e.boutonHaut + 8));
  const right = Math.min(Math.max(8, Math.round(e.largeurFenetre - e.boutonDroite)), Math.max(8, e.largeurFenetre - e.largeurMenu - 8));
  return { bottom, right };
}
