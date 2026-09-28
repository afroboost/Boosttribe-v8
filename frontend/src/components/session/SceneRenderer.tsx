/**
 * 🎬 Phase 2 mini studio — rendu DOM d'une scène (Preview ou Programme local).
 *
 * Une `<video>` par boîte (`layoutBoxes`), positionnée en % dans un cadre 16:9. Rien d'autre :
 * PAS de prompteur, PAS de chat, PAS de minuteur, PAS d'overlay — ce rendu est la maquette
 * exacte de ce que Phase 3 peindra sur le canvas du programStream, il doit donc rester nu.
 *
 * Les médias ne sont pas créés ici : `resolveMedia` rend le MediaStream (coach = piste déjà
 * traitée par « Embellir » quand actif, caméra secondaire, écran) ou la piste distante d'un
 * participant. Attache / détache au montage / démontage, sans jamais arrêter une piste.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { deplacerSansCouper } from '@/lib/sceneLive';
import type { SceneBox, StudioSourceRef } from '@/lib/studioScenes';

export interface SceneRendererProps {
  boxes: SceneBox[];
  resolveMedia: (src: StudioSourceRef) => MediaStream | MediaStreamTrack | null;
  zone: 'preview' | 'program';
  /** Ratio CSS du cadre (défaut 16 / 9). */
  ratio?: string;
  className?: string;
}

const cleBoite = (b: SceneBox) => `${b.source.kind}:${b.source.id ?? ''}:${b.x}:${b.y}`;

function BoiteVideo({ box, media }: { box: SceneBox; media: MediaStream | MediaStreamTrack | null }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!media) { el.srcObject = null; return; }
    const stream = media instanceof MediaStream ? media : new MediaStream([media]);
    el.srcObject = stream;
    el.play().catch(() => { /* autoplay muet : silencieux */ });
    return () => { el.srcObject = null; };   // détache seulement — n'arrête jamais la piste
  }, [media]);
  return (
    <div
      data-studio-source={box.source.kind}
      data-studio-source-id={box.source.id ?? ''}
      className="absolute overflow-hidden rounded-md bg-black"
      style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%`, zIndex: box.z }}
    >
      <video ref={ref} muted playsInline autoPlay className="w-full h-full object-cover" />
      <span className="absolute left-1.5 bottom-1 text-[10px] leading-none text-white/70 bg-black/40 rounded px-1 py-0.5 pointer-events-none select-none">
        {box.source.label}
      </span>
    </div>
  );
}

/**
 * 🖥️ Écran partagé posé dans la scène du Live (LiveVisioPanel) : un flux, rien d'autre — le
 * même branchement que les boîtes ci-dessus. Détache sans jamais arrêter la piste.
 * `muted` : c'est MON écran (anti-écho) ; celui de l'hôte garde son son.
 */
export function FluxEcran({ stream, muted, className = '' }: { stream: MediaStream; muted?: boolean; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.srcObject !== stream) el.srcObject = stream;
    el.play().catch(() => { /* autoplay : relancé au prochain geste */ });
  }, [stream]);
  return <video ref={ref} autoPlay playsInline muted={muted} controls={false} className={`bg-black object-contain pointer-events-none ${className}`} />;
}

/**
 * 🎬 UN composant, PLUSIEURS places, AUCUN remontage. Renvoie un conteneur DOM créé une seule
 * fois (`hote`, cible d'un portail) et un ref-callback (`placer`) à poser sur chaque
 * emplacement possible. L'emplacement monté reçoit le conteneur ; quand il disparaît, le
 * conteneur part au parking (caché) AVANT que React ne retire l'emplacement — l'iframe ou la
 * vidéo n'est donc jamais sortie du document, et `moveBefore` conserve son état.
 */
export function usePlaceStable(classe = ''): { hote: HTMLDivElement | null; placer: (el: HTMLDivElement | null) => (() => void) | undefined } {
  const [hote] = useState<HTMLDivElement | null>(() => {
    if (typeof document === 'undefined') return null;
    const d = document.createElement('div');
    d.className = classe;
    return d;
  });
  const parking = useRef<HTMLDivElement | null>(null);
  useEffect(() => () => { parking.current?.remove(); parking.current = null; }, []);
  const placer = useCallback((el: HTMLDivElement | null) => {
    if (!el || !hote) return undefined;
    deplacerSansCouper(hote, el);
    return () => {
      if (hote.parentNode !== el) return;           // déjà parti vers un autre emplacement
      if (!parking.current) {
        const p = document.createElement('div');
        p.setAttribute('aria-hidden', 'true');
        p.style.cssText = 'position:fixed;width:0;height:0;overflow:hidden;';
        document.body.appendChild(p);
        parking.current = p;
      }
      deplacerSansCouper(hote, parking.current);
    };
  }, [hote]);
  return { hote, placer };
}

const SceneRenderer: React.FC<SceneRendererProps> = ({ boxes, resolveMedia, zone, ratio = '16 / 9', className = '' }) => (
  <div data-studio-zone={zone} className={`relative w-full overflow-hidden rounded-lg bg-black ${className}`} style={{ aspectRatio: ratio }}>
    {boxes.length === 0 && (
      <div className="absolute inset-0 flex items-center justify-center text-xs text-white/40 select-none">
        {zone === 'preview' ? 'Aucune scène en préparation' : 'Flux direct'}
      </div>
    )}
    {boxes.map((b) => <BoiteVideo key={cleBoite(b)} box={b} media={resolveMedia(b.source)} />)}
  </div>
);

export default SceneRenderer;
