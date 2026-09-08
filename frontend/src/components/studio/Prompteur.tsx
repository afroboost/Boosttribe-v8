import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import { pasDefilement, finAtteinte, DT_MAX_MS } from '@/lib/studioLogic';

/**
 * 📜 Prompteur — le texte qui défile, à lire face caméra.
 *
 * PERFORMANCE (contrainte de tête) : le défilement ne passe JAMAIS par un état React.
 * La boucle `requestAnimationFrame` écrit directement dans `scrollTop` du conteneur.
 * Un `setState` à 60 Hz ferait re-rendre la page entière à chaque image et ferait
 * chuter le rendu du <video> — exactement ce qu'on veut éviter. Conséquence : la
 * vitesse et la taille sont lues dans des REFS, si bien qu'on peut les changer EN
 * COURS de défilement sans jamais relancer la boucle.
 *
 * CONFIDENTIALITÉ : ce composant n'émet rien. Le texte reste dans le navigateur du
 * présentateur — pas de requête, pas de socket, pas de piste WebRTC, pas de log.
 */

export interface PrompteurHandle {
  /** Ramène le texte au début. */
  reset: () => void;
}

export interface PrompteurProps {
  texte: string;
  /** Taille de police en pixels. */
  tailleTexte: number;
  /** Multiplicateur de vitesse (0.5 → 2). */
  vitesse: number;
  enLecture: boolean;
  /** Appelé quand le bas du texte est atteint. */
  onFin?: () => void;
  className?: string;
}

export const Prompteur = forwardRef<PrompteurHandle, PrompteurProps>(function Prompteur(
  { texte, tailleTexte, vitesse, enLecture, onFin, className = '' },
  ref,
) {
  const conteneurRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const dernierTempsRef = useRef<number>(0);
  // Reliquat sous-pixel : sans lui, `scrollTop` étant entier, une vitesse lente
  // serait arrondie à 0 à chaque image et le texte ne bougerait jamais.
  const resteRef = useRef<number>(0);

  const vitesseRef = useRef(vitesse);
  const tailleRef = useRef(tailleTexte);
  const onFinRef = useRef(onFin);
  vitesseRef.current = vitesse;
  tailleRef.current = tailleTexte;
  onFinRef.current = onFin;

  const reset = useCallback(() => {
    const el = conteneurRef.current;
    resteRef.current = 0;
    if (el) el.scrollTop = 0;
  }, []);

  useImperativeHandle(ref, () => ({ reset }), [reset]);

  useEffect(() => {
    if (!enLecture) return;
    const el = conteneurRef.current;
    if (!el) return;

    dernierTempsRef.current = 0;
    void DT_MAX_MS;   // le plafond vit dans studioLogic, où il est testé
    const pas = (t: number) => {
      if (!dernierTempsRef.current) dernierTempsRef.current = t;
      const dtMs = t - dernierTempsRef.current;   // borné dans `pasDefilement` (DT_MAX_MS)
      dernierTempsRef.current = t;

      const { pixels, reste } = pasDefilement(dtMs, tailleRef.current, vitesseRef.current, resteRef.current);
      resteRef.current = reste;
      if (pixels > 0) el.scrollTop += pixels;

      if (finAtteinte(el.scrollTop, el.clientHeight, el.scrollHeight)) {
        rafRef.current = null;
        onFinRef.current?.();
        return;
      }
      rafRef.current = requestAnimationFrame(pas);
    };

    rafRef.current = requestAnimationFrame(pas);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [enLecture]);

  const vide = texte.trim().length === 0;

  return (
    <div
      ref={conteneurRef}
      tabIndex={0}
      role="region"
      aria-label="Texte du prompteur"
      data-testid="prompteur-zone"
      className={`overflow-y-auto overscroll-contain ${className}`}
      style={{
        // Dégradé haut/bas : la ligne en cours reste au centre du regard.
        maskImage: 'linear-gradient(to bottom, transparent 0, #000 12%, #000 88%, transparent 100%)',
        WebkitMaskImage: 'linear-gradient(to bottom, transparent 0, #000 12%, #000 88%, transparent 100%)',
        scrollbarWidth: 'none',
      }}
    >
      {vide ? (
        <p className="text-white/40 text-center px-4 py-10" style={{ fontSize: Math.max(14, tailleTexte / 3) }}>
          Écris ou colle ton texte ci-dessous, puis appuie sur Démarrer.
        </p>
      ) : (
        <p
          data-testid="prompteur-texte"
          className="text-white text-center font-medium whitespace-pre-wrap break-words px-4"
          style={{ fontSize: `${tailleTexte}px`, lineHeight: 1.45, paddingTop: '45%', paddingBottom: '55%' }}
        >
          {texte}
        </p>
      )}
    </div>
  );
});

export default Prompteur;
