import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 🔍 Plein écran réutilisable (Fullscreen API + repli overlay CSS iOS Safari).
 *
 * Même mécanique que SharedMediaPlayer (requestFullscreen/webkitRequestFullscreen sur un conteneur, repli
 * `fullscreen` CSS quand l'API n'est pas dispo), factorisée SANS modifier SharedMediaPlayer. On demande le
 * plein écran sur le CONTENEUR (pas sur la <video>) → les enfants (bande de vignettes, boutons) restent
 * visibles PAR-DESSUS.
 *
 * @param targetRef  ref du conteneur à passer en plein écran.
 * @param opts.lockLandscape  verrouiller l'orientation paysage (défaut: false → orientation AUTO : la
 *   caméra suit le téléphone, portrait comme paysage, sans rotation forcée).
 *
 * Retourne `{ fullscreen, enter, exit, toggle }`. `fullscreen` est vrai que l'on soit en plein écran natif
 * OU en repli overlay CSS (à styler par l'appelant : ex. `fixed inset-0 z-[100] bg-black`).
 */
export function useFullscreen(
  targetRef: React.RefObject<HTMLElement | null>,
  opts?: { lockLandscape?: boolean },
): { fullscreen: boolean; enter: () => void; exit: () => void; toggle: () => void } {
  const [fullscreen, setFullscreen] = useState(false);
  const fullscreenRef = useRef(false);
  fullscreenRef.current = fullscreen;
  const wantLandscape = !!opts?.lockLandscape;

  const lockLandscape = useCallback(() => {
    if (!wantLandscape) return;
    try { (screen.orientation as unknown as { lock?: (o: string) => Promise<void> })?.lock?.('landscape').catch(() => { /* non supporté */ }); } catch { /* ignore */ }
  }, [wantLandscape]);

  const unlockOrientation = useCallback(() => {
    try { (screen.orientation as unknown as { unlock?: () => void })?.unlock?.(); } catch { /* ignore */ }
  }, []);

  const enter = useCallback(() => {
    setFullscreen(true);
    const el = targetRef.current as (HTMLElement & { webkitRequestFullscreen?: () => void }) | null;
    try {
      if (el?.requestFullscreen) {
        el.requestFullscreen().then(lockLandscape).catch(lockLandscape);
      } else if (el?.webkitRequestFullscreen) {
        el.webkitRequestFullscreen();
        lockLandscape();
      } else {
        lockLandscape(); // pas de Fullscreen API (iOS Safari) → overlay CSS géré par l'appelant
      }
    } catch { /* ignore */ }
  }, [targetRef, lockLandscape]);

  const exit = useCallback(() => {
    unlockOrientation();
    const d = document as Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void };
    if (d.fullscreenElement || d.webkitFullscreenElement) {
      try { (d.exitFullscreen?.() || d.webkitExitFullscreen?.()); } catch { /* ignore */ }
    } else {
      setFullscreen(false); // repli overlay CSS : simple fermeture
    }
  }, [unlockOrientation]);

  const toggle = useCallback(() => { (fullscreenRef.current ? exit() : enter()); }, [enter, exit]);

  // Sortie du plein écran natif (Échap, geste retour, bouton natif) → refermer aussi le repli overlay.
  useEffect(() => {
    const onFsChange = () => {
      const fsEl = document.fullscreenElement || (document as unknown as { webkitFullscreenElement?: Element }).webkitFullscreenElement;
      if (!fsEl) {
        unlockOrientation();
        if (fullscreenRef.current) setFullscreen(false);
      }
    };
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange as EventListener);
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      document.removeEventListener('webkitfullscreenchange', onFsChange as EventListener);
    };
  }, [unlockOrientation]);

  return { fullscreen, enter, exit, toggle };
}

export default useFullscreen;
