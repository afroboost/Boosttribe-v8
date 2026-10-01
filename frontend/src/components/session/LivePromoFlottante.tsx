import React, { useEffect, useRef, useState } from 'react';
import { Move } from 'lucide-react';
import { placementPromo, tailleDepuisPoignee, type LayoutPromo } from '@/lib/sceneLive';

/**
 * 📣 01/10 — La promo DIFFUSÉE, déplaçable et redimensionnable par L'HÔTE.
 *
 * Mêmes mécaniques que `VignetteFlottante` (Pointer Events, `touch-none` sur les poignées, poignée
 * de taille en bas à droite via `tailleDepuisPoignee`, bornage dans la scène hors barre et hors
 * champ) — sans ratio imposé : la hauteur suit le contenu. Le geste ne part QUE des poignées :
 * « Découvrir » et « Arrêter » restent de simples clics, chez l'hôte comme chez le participant.
 *
 * Position = fractions de la scène, état CANONIQUE côté serveur (`onFin`, une écriture par geste,
 * au relâcher) : les participants la voient au même endroit, refresh compris. `layout === null` →
 * la promo reste dans la pile du bas (comportement d'avant, inchangé).
 */
export interface PromoPositionnable {
  /** Position en cours (geste local d'abord, sinon celle du serveur) ; null = défaut (en bas). */
  layout: LayoutPromo | null;
  cadreRef: React.RefObject<HTMLDivElement | null>;
  hauteurContenu: number;
  /** Démarre un geste depuis une poignée (null si l'utilisateur n'est pas l'hôte). */
  debut: ((e: React.PointerEvent, mode: 'deplacer' | 'taille') => void) | null;
}

export function usePromoPositionnable(o: {
  promoId: string | null | undefined;
  layoutServeur: LayoutPromo | null | undefined;
  sceneRef: React.RefObject<HTMLElement | null>;
  reserveDroitePx: number;
  reserveBasPx: number;
  /** Présent = l'utilisateur est l'HÔTE de la session (décidé par le serveur en amont). */
  onFin?: (l: LayoutPromo) => void;
}): PromoPositionnable {
  const cadreRef = useRef<HTMLDivElement | null>(null);
  const [local, setLocal] = useState<{ id: string; l: LayoutPromo } | null>(null);
  const localRef = useRef(local); localRef.current = local;
  const [hauteurContenu, setHauteurContenu] = useState(0);
  const oRef = useRef(o); oRef.current = o;

  // Hauteur réelle du contenu (ResizeObserver) — mise à jour seulement si elle change (primitive).
  useEffect(() => {
    const el = cadreRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => {
      const h = Math.round(el.getBoundingClientRect().height);
      setHauteurContenu((prev) => (prev === h ? prev : h));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [o.promoId, local !== null, o.layoutServeur != null]);

  const layout = o.promoId && local && local.id === o.promoId ? local.l : (o.layoutServeur ?? null);

  const debut = o.onFin && o.promoId ? (e: React.PointerEvent, mode: 'deplacer' | 'taille') => {
    const scene = oRef.current.sceneRef.current?.getBoundingClientRect();
    const cadre = cadreRef.current?.getBoundingClientRect();
    const id = oRef.current.promoId;
    if (!scene || !cadre || scene.width <= 0 || scene.height <= 0 || !id) return;
    e.preventDefault(); e.stopPropagation();
    const dx = e.clientX - cadre.left; const dy = e.clientY - cadre.top;
    const h = cadre.height;
    const borner = (brut: LayoutPromo): LayoutPromo => {
      const s = oRef.current.sceneRef.current?.getBoundingClientRect() || scene;
      const p = placementPromo({ largeurScene: s.width, hauteurScene: s.height, reserveDroitePx: oRef.current.reserveDroitePx,
        reserveBasPx: oRef.current.reserveBasPx, layout: brut, hauteurContenuPx: h });
      return { x: p.x / s.width, y: p.y / s.height, w: p.largeur / s.width };
    };
    // Point de départ = là où la promo EST (pile du bas ou position déjà choisie) : aucun saut.
    const depart = borner({ x: (cadre.left - scene.left) / scene.width, y: (cadre.top - scene.top) / scene.height, w: cadre.width / scene.width });
    setLocal({ id, l: depart });
    const bouger = (ev: PointerEvent) => {
      const s = oRef.current.sceneRef.current?.getBoundingClientRect() || scene;
      const cur = localRef.current?.l || depart;
      const brut = mode === 'taille'
        ? { ...cur, w: tailleDepuisPoignee({ largeurScene: s.width, gaucheVignettePx: s.left + cur.x * s.width, pointeurPx: ev.clientX }) }
        : { ...cur, x: (ev.clientX - dx - s.left) / s.width, y: (ev.clientY - dy - s.top) / s.height };
      setLocal({ id, l: borner(brut) });
    };
    const fin = () => {
      window.removeEventListener('pointermove', bouger);
      window.removeEventListener('pointerup', fin);
      window.removeEventListener('pointercancel', fin);
      const l = localRef.current?.l;
      if (l) oRef.current.onFin?.(l);          // UNE écriture serveur par geste (au relâcher)
    };
    window.addEventListener('pointermove', bouger);
    window.addEventListener('pointerup', fin);
    window.addEventListener('pointercancel', fin);
  } : null;

  return { layout, cadreRef, hauteurContenu, debut };
}

/** Poignées de l'HÔTE (rien chez un participant) : « Déplacer » en haut à gauche, taille en bas à droite. */
export function PoigneesPromo({ debut }: { debut: PromoPositionnable['debut'] }) {
  if (!debut) return null;
  return (
    <>
      <button
        type="button"
        onPointerDown={(e) => debut(e, 'deplacer')}
        className="absolute -top-3 left-3 z-10 inline-flex min-h-[28px] items-center gap-1 rounded-full border border-white/20 bg-black/80 px-2.5 text-[11px] font-semibold text-white/90 opacity-80 hover:opacity-100 cursor-grab active:cursor-grabbing touch-none select-none"
        aria-label="Déplacer la promo" title="Déplacer la promo"
        data-testid="live-promo-deplacer"
      >
        <Move className="h-3.5 w-3.5" aria-hidden="true" /> Déplacer
      </button>
      <span
        role="presentation"
        onPointerDown={(e) => debut(e, 'taille')}
        className="absolute bottom-0 right-0 z-10 h-7 w-7 cursor-nwse-resize touch-none rounded-br-2xl"
        style={{ background: 'linear-gradient(135deg, transparent 50%, rgba(255,255,255,0.7) 50%)' }}
        title="Agrandir / réduire la promo"
        data-testid="live-promo-taille"
      />
    </>
  );
}

/** Calque POSITIONNÉ (dans la scène) — seulement quand un layout existe. */
export function CalquePromoPlace({ pos, largeurScene, hauteurScene, reserveDroitePx, reserveBasPx, children }: {
  pos: PromoPositionnable; largeurScene: number; hauteurScene: number; reserveDroitePx: number; reserveBasPx: number; children: React.ReactNode;
}) {
  if (!pos.layout) return null;
  const p = placementPromo({ largeurScene, hauteurScene, reserveDroitePx, reserveBasPx, layout: pos.layout, hauteurContenuPx: pos.hauteurContenu });
  return (
    <div ref={pos.cadreRef} className="pointer-events-auto absolute z-[15]"
         style={{ left: p.x, top: p.y, width: p.largeur }} data-testid="visio-promo-placee">
      <PoigneesPromo debut={pos.debut} />
      {children}
    </div>
  );
}

export default CalquePromoPlace;
