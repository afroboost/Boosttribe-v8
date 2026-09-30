import React, { useRef } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import { placementVignette, tailleDepuisPoignee, VIGNETTE_MAX } from '@/lib/sceneLive';

/**
 * 🪟 LA vignette flottante du Live — UNE implémentation, utilisée par la vignette de la scène
 * (partage d'écran / film) ET par les caméras des participants en plein écran.
 *
 * Présentation LOCALE seulement : on déplace et on redimensionne un cadre posé sur la scène ;
 * le flux vidéo (piste LiveKit), la publication et les permissions ne sont jamais touchés.
 * Bornage : `placementVignette` (dans la scène, hors de la barre verticale à droite et hors du
 * champ commentaire en bas, ratio 16:9, plancher de 124 px). Doigt ou souris : Pointer Events +
 * `touch-none` (aucun défilement de page pendant le geste). Poignée en bas à droite = taille ;
 * double-clic ou ⛶ = agrandir (vue principale existante).
 */
export interface VignetteFlottanteProps {
  largeurScene: number;
  hauteurScene: number;
  reserveDroitePx: number;
  reserveBasPx: number;
  /** Coin haut-gauche, en fraction de la scène ; null = coin par défaut (bas-droit). */
  position: { x: number; y: number } | null;
  /** Largeur en fraction de la scène ; absent = taille par défaut (28 %). */
  taille?: number;
  tailleMax?: number;
  redimensionnable?: boolean;
  onChange: (v: { position: { x: number; y: number }; taille?: number }) => void;
  /** Référence de la SCÈNE (repère des fractions). */
  sceneRef: React.RefObject<HTMLElement | null>;
  onAgrandir?: () => void;
  onReduire?: () => void;
  testId: string;
  ariaLabel?: string;
  dataContenu?: string;
  children: React.ReactNode;
}

export function VignetteFlottante(props: VignetteFlottanteProps) {
  const { largeurScene, hauteurScene, reserveDroitePx, reserveBasPx, position, taille, tailleMax = VIGNETTE_MAX,
    redimensionnable = false, onChange, sceneRef, onAgrandir, onReduire, testId, ariaLabel, dataContenu, children } = props;
  const glisse = useRef<{ dx: number; dy: number } | null>(null);
  const redim = useRef(false);
  const place = placementVignette({ largeurScene, hauteurScene, reserveDroitePx, reserveBasPx, position, taille, tailleMax });

  const bornerEtEmettre = (pos: { x: number; y: number }, t: number | undefined) => {
    const box = sceneRef.current?.getBoundingClientRect();
    if (!box || box.width <= 0 || box.height <= 0) return;
    const p = placementVignette({ largeurScene: box.width, hauteurScene: box.height, reserveDroitePx, reserveBasPx, position: pos, taille: t, tailleMax });
    onChange({ position: { x: p.x / box.width, y: p.y / box.height }, taille: t });
  };

  return (
    <div
      role="group"
      aria-label={ariaLabel || 'Vignette : glisser pour la déplacer'}
      className="absolute z-10 overflow-hidden rounded-lg border border-white/25 bg-black shadow-lg shadow-black/50 cursor-grab active:cursor-grabbing touch-none select-none"
      style={{ left: place.x, top: place.y, width: place.largeur, height: place.hauteur }}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest('[data-vignette-bouton]')) return;
        const r = e.currentTarget.getBoundingClientRect();
        glisse.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      }}
      onPointerMove={(e) => {
        const box = sceneRef.current?.getBoundingClientRect();
        if (!box) return;
        if (redim.current) {
          const t = tailleDepuisPoignee({ largeurScene: box.width, gaucheVignettePx: box.left + place.x, pointeurPx: e.clientX });
          bornerEtEmettre({ x: place.x / box.width, y: place.y / box.height }, t);
          return;
        }
        const g = glisse.current;
        if (!g) return;
        bornerEtEmettre({ x: (e.clientX - g.dx - box.left) / box.width, y: (e.clientY - g.dy - box.top) / box.height }, taille);
      }}
      onPointerUp={() => { glisse.current = null; redim.current = false; }}
      onPointerCancel={() => { glisse.current = null; redim.current = false; }}
      onDoubleClick={onAgrandir}
      data-testid={testId}
      data-contenu={dataContenu}
    >
      {children}
      {(onAgrandir || onReduire) && (
        <button
          type="button"
          data-vignette-bouton
          onClick={onAgrandir || onReduire}
          className="absolute right-1 top-1 z-10 inline-flex h-7 w-7 items-center justify-center rounded-lg bg-black/60 text-white/85 hover:bg-black/80"
          aria-label={onAgrandir ? 'Agrandir' : 'Réduire'}
          title={onAgrandir ? 'Agrandir' : 'Réduire'}
          data-testid={onAgrandir ? `${testId}-agrandir` : `${testId}-reduire`}
        >
          {onAgrandir ? <Maximize2 size={14} /> : <Minimize2 size={14} />}
        </button>
      )}
      {redimensionnable && (
        <span
          data-vignette-bouton
          role="presentation"
          className="absolute bottom-0 right-0 z-10 h-6 w-6 cursor-nwse-resize touch-none"
          style={{ background: 'linear-gradient(135deg, transparent 50%, rgba(255,255,255,0.7) 50%)' }}
          onPointerDown={(e) => {
            e.stopPropagation();
            redim.current = true;
            try { (e.currentTarget.parentElement as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ignore */ }
          }}
          data-testid={`${testId}-poignee`}
        />
      )}
    </div>
  );
}

export default VignetteFlottante;
