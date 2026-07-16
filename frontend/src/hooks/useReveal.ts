import { useEffect, useRef } from 'react';

/**
 * Révélation au scroll (sobre, façon Apple) — PRÉSENTATION UNIQUEMENT.
 * Attache le ref retourné à un conteneur ; tous ses descendants portant la classe
 * `.reveal` reçoivent `.is-visible` quand ils entrent dans le viewport (une seule fois).
 * Respecte `prefers-reduced-motion` (affiche tout immédiatement) et dégrade proprement
 * si IntersectionObserver est indisponible.
 */
export function useReveal<T extends HTMLElement = HTMLDivElement>() {
  const rootRef = useRef<T>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const els = Array.from(root.querySelectorAll<HTMLElement>('.reveal'));
    if (els.length === 0) return;

    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // On pose un ATTRIBUT data-* (pas une classe) : React réécrit `className` à chaque
    // re-render et effacerait une classe ajoutée ici, mais laisse les data-* impératifs.
    if (reduce || typeof IntersectionObserver === 'undefined') {
      els.forEach((el) => el.setAttribute('data-revealed', ''));
      return;
    }

    const timers: number[] = [];
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const el = entry.target as HTMLElement;
            el.setAttribute('data-revealed', '');
            io.unobserve(el);
            // Filet de sécurité : si l'horloge d'animation est gelée (onglet en
            // arrière-plan / throttlé), un timer garantit la visibilité finale.
            timers.push(window.setTimeout(() => el.setAttribute('data-done', ''), 1200));
          }
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' }
    );

    els.forEach((el) => io.observe(el));
    return () => {
      io.disconnect();
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, []);

  return rootRef;
}

export default useReveal;
