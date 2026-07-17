import { useEffect, useState } from 'react';

/**
 * 🖥️ Cible de portail selon le plein écran.
 *
 * L'API Fullscreen n'affiche QUE l'élément mis en plein écran et ses descendants. Un overlay
 * `position: fixed` rendu ailleurs (ex. dans document.body) devient INVISIBLE tant qu'un élément
 * est en plein écran. Ce hook renvoie l'élément dans lequel porter (`createPortal`) un overlay :
 *   - l'élément plein écran courant s'il existe (le minuteur/modale s'affiche alors PAR-DESSUS la scène),
 *   - sinon `document.body` (comportement historique, inchangé).
 *
 * Se met à jour sur `fullscreenchange` / `webkitfullscreenchange` (préfixe iOS Safari).
 */
type FsDoc = Document & { webkitFullscreenElement?: Element | null };

function currentTarget(): HTMLElement {
  if (typeof document === 'undefined') return null as unknown as HTMLElement;
  const d = document as FsDoc;
  return (d.fullscreenElement as HTMLElement | null)
    || (d.webkitFullscreenElement as HTMLElement | null)
    || document.body;
}

export function useFullscreenPortalTarget(): HTMLElement {
  const [target, setTarget] = useState<HTMLElement>(() => currentTarget());

  useEffect(() => {
    const update = () => setTarget(currentTarget());
    update(); // resynchronise au montage (ex. déjà en plein écran)
    document.addEventListener('fullscreenchange', update);
    document.addEventListener('webkitfullscreenchange', update);
    return () => {
      document.removeEventListener('fullscreenchange', update);
      document.removeEventListener('webkitfullscreenchange', update);
    };
  }, []);

  return target;
}

export default useFullscreenPortalTarget;
