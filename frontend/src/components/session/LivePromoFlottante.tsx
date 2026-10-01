import React, { useEffect, useRef, useState } from 'react';
import { placementPromo, tailleImagePromo, type LayoutPromo } from '@/lib/sceneLive';

/**
 * 📣 La promo DIFFUSÉE, déplaçable et redimensionnable par L'HÔTE — comme une fenêtre flottante.
 *
 * 01/10 (retours du test réel) :
 *  - plus de bouton « Déplacer » : on fait glisser LA FENÊTRE elle-même. Le geste ne démarre
 *    qu'au-delà de SEUIL_GESTE_PX : un simple toucher / clic reste un clic (« Découvrir » s'ouvre,
 *    rien ne bouge) ; liens et boutons ne déclenchent jamais de déplacement ;
 *  - la poignée en bas à droite agit en LARGEUR ET en HAUTEUR (comme la caméra d'un participant) ;
 *    la hauteur ne descend jamais sous celle du contenu (rien n'est coupé) et le visuel grandit
 *    avec la fenêtre (tailleImagePromo) ;
 *  - bornage pur `placementPromo` : dans la scène, hors barre à droite, hors champ en bas.
 *
 * Position = fractions de la scène {x, y, w, h}, état CANONIQUE côté serveur (`onFin`, une écriture
 * par geste, au relâcher) : tous les participants la voient au même endroit, refresh compris.
 * `layout === null` → la promo reste dans la pile du bas (comportement d'avant).
 * Rien ici ne touche à la durée, au statut ni au paiement de la promo.
 */
export const SEUIL_GESTE_PX = 6;

export interface PromoPositionnable {
  /** Position en cours (geste local d'abord, sinon celle du serveur) ; null = défaut (en bas). */
  layout: LayoutPromo | null;
  cadreRef: React.RefObject<HTMLDivElement | null>;
  /** Colonne texte de la bannière (sa hauteur naturelle = minimum de la fenêtre). */
  texteRef: React.RefObject<HTMLDivElement | null>;
  hauteurContenu: number;
  hauteurTexte: number;
  /** Démarre un geste (null si l'utilisateur n'est pas l'hôte). */
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
  const texteRef = useRef<HTMLDivElement | null>(null);
  const [local, setLocal] = useState<{ id: string; l: LayoutPromo } | null>(null);
  const localRef = useRef(local); localRef.current = local;
  const [hauteurContenu, setHauteurContenu] = useState(0);
  const [hauteurTexte, setHauteurTexte] = useState(0);
  const oRef = useRef(o); oRef.current = o;

  // Hauteurs réelles (ResizeObserver) — mises à jour seulement si elles changent (primitives).
  useEffect(() => {
    const cadre = cadreRef.current; const texte = texteRef.current;
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => {
      if (cadre) { const h = Math.round(cadre.getBoundingClientRect().height); setHauteurContenu((p) => (p === h ? p : h)); }
      if (texte) { const h = Math.round(texte.scrollHeight); setHauteurTexte((p) => (p === h ? p : h)); }
    });
    if (cadre) ro.observe(cadre);
    if (texte) ro.observe(texte);
    return () => ro.disconnect();
  }, [o.promoId, local !== null, o.layoutServeur != null]);

  const layout = o.promoId && local && local.id === o.promoId ? local.l : (o.layoutServeur ?? null);

  const debut = o.onFin && o.promoId ? (e: React.PointerEvent, mode: 'deplacer' | 'taille') => {
    // Un lien, un bouton (« Découvrir », « Arrêter ») : un CLIC, jamais un déplacement.
    if (mode === 'deplacer' && (e.target as HTMLElement).closest('a,button,[data-promo-poignee]')) return;
    if (e.button !== undefined && e.button > 0) return;
    const scene = oRef.current.sceneRef.current?.getBoundingClientRect();
    const cadre = cadreRef.current?.getBoundingClientRect();
    const id = oRef.current.promoId;
    if (!scene || !cadre || scene.width <= 0 || scene.height <= 0 || !id) return;
    if (mode === 'taille') e.preventDefault();
    e.stopPropagation();
    const x0 = e.clientX; const y0 = e.clientY;
    const dx = x0 - cadre.left; const dy = y0 - cadre.top;
    let engage = mode === 'taille';
    const borner = (brut: LayoutPromo): LayoutPromo => {
      const s = oRef.current.sceneRef.current?.getBoundingClientRect() || scene;
      const p = placementPromo({ largeurScene: s.width, hauteurScene: s.height, reserveDroitePx: oRef.current.reserveDroitePx,
        reserveBasPx: oRef.current.reserveBasPx, layout: brut, hauteurContenuPx: 0 });
      return { x: p.x / s.width, y: p.y / s.height, w: p.largeur / s.width, ...(brut.h != null ? { h: p.hauteur / s.height } : {}) };
    };
    // Point de départ = là où la promo EST (pile du bas ou position déjà choisie) : aucun saut.
    const depart: LayoutPromo = { x: (cadre.left - scene.left) / scene.width, y: (cadre.top - scene.top) / scene.height,
      w: cadre.width / scene.width, h: cadre.height / scene.height };
    if (engage) setLocal({ id, l: borner(depart) });
    const bouger = (ev: PointerEvent) => {
      if (!engage) {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < SEUIL_GESTE_PX) return;   // encore un clic
        engage = true; setLocal({ id, l: borner(depart) });
      }
      ev.preventDefault();
      const s = oRef.current.sceneRef.current?.getBoundingClientRect() || scene;
      const cur = localRef.current?.l || depart;
      const brut = mode === 'taille'
        ? { ...cur, w: (ev.clientX - (s.left + cur.x * s.width)) / s.width, h: (ev.clientY - (s.top + cur.y * s.height)) / s.height }
        : { ...cur, x: (ev.clientX - dx - s.left) / s.width, y: (ev.clientY - dy - s.top) / s.height };
      setLocal({ id, l: borner(brut) });
    };
    const fin = () => {
      window.removeEventListener('pointermove', bouger);
      window.removeEventListener('pointerup', fin);
      window.removeEventListener('pointercancel', fin);
      const l = localRef.current?.l;
      if (engage && l) oRef.current.onFin?.(l);          // UNE écriture serveur par geste (au relâcher)
    };
    window.addEventListener('pointermove', bouger, { passive: false });
    window.addEventListener('pointerup', fin);
    window.addEventListener('pointercancel', fin);
  } : null;

  return { layout, cadreRef, texteRef, hauteurContenu, hauteurTexte, debut };
}

/** Poignée de TAILLE de l'hôte (rien chez un participant) : coin bas-droit, largeur ET hauteur. */
export function PoigneesPromo({ debut }: { debut: PromoPositionnable['debut'] }) {
  if (!debut) return null;
  return (
    <span
      role="presentation"
      data-promo-poignee
      onPointerDown={(e) => debut(e, 'taille')}
      className="absolute bottom-0 right-0 z-10 h-7 w-7 cursor-nwse-resize touch-none rounded-br-2xl"
      style={{ background: 'linear-gradient(135deg, transparent 50%, rgba(255,255,255,0.7) 50%)' }}
      title="Agrandir / réduire la promo"
      data-testid="live-promo-taille"
    />
  );
}

/** Props du cadre (pile ou calque placé) : la FENÊTRE entière se glisse, chez l'hôte seulement. */
export function propsCadrePromo(pos: PromoPositionnable): React.HTMLAttributes<HTMLDivElement> {
  if (!pos.debut) return {};
  return {
    onPointerDown: (e) => pos.debut?.(e, 'deplacer'),
    className: 'cursor-grab active:cursor-grabbing touch-none select-none',
    title: 'Glisser pour déplacer la promo',
  };
}

/** Calque POSITIONNÉ (dans la scène) — seulement quand un layout existe. */
export function CalquePromoPlace({ pos, largeurScene, hauteurScene, reserveDroitePx, reserveBasPx, children }: {
  pos: PromoPositionnable; largeurScene: number; hauteurScene: number; reserveDroitePx: number; reserveBasPx: number; children: React.ReactNode;
}) {
  if (!pos.layout) return null;
  const brut = placementPromo({ largeurScene, hauteurScene, reserveDroitePx, reserveBasPx, layout: pos.layout, hauteurContenuPx: 0 });
  const demandee = pos.layout.h != null ? pos.layout.h * hauteurScene : 0;
  const image = demandee > 0 ? tailleImagePromo(demandee, brut.largeur) : undefined;
  // Minimum = contenu réel (visuel ou texte, + marges) : la fenêtre ne coupe jamais la promo.
  const minimum = Math.max(image ?? 0, pos.hauteurTexte) + 26;
  const p = placementPromo({ largeurScene, hauteurScene, reserveDroitePx, reserveBasPx, layout: pos.layout, hauteurContenuPx: minimum });
  const cadre = propsCadrePromo(pos);
  const enfant = React.isValidElement(children)
    ? React.cloneElement(children as React.ReactElement<{ remplir?: boolean; tailleImage?: number; mesureRef?: React.Ref<HTMLDivElement> }>,
      { remplir: true, tailleImage: image, mesureRef: pos.texteRef })
    : children;
  return (
    <div ref={pos.cadreRef} {...cadre} className={`pointer-events-auto absolute z-[15] ${cadre.className ?? ''}`}
         style={{ left: p.x, top: p.y, width: p.largeur, height: pos.layout.h != null ? p.hauteur : undefined }}
         data-testid="visio-promo-placee">
      {enfant}
      <PoigneesPromo debut={pos.debut} />
    </div>
  );
}

export default CalquePromoPlace;
