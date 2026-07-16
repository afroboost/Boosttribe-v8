import React, { useEffect, useRef, useCallback } from 'react';
import { Maximize2, MonitorUp, X } from 'lucide-react';

interface ScreenShareViewProps {
  stream: MediaStream;
  isLocal?: boolean;      // hôte : preview de son propre écran (muet pour éviter l'écho)
  onStop?: () => void;    // hôte : bouton arrêter
  hostName?: string;
}

// 🖥️ Affiche un partage d'écran en grand dans "Contenu partagé". Non contrôlable par le participant.
export const ScreenShareView: React.FC<ScreenShareViewProps> = ({ stream, isLocal, onStop, hostName }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const v = videoRef.current;
    if (v && stream && v.srcObject !== stream) {
      v.srcObject = stream;
      v.play().catch(() => { /* autoplay : sera relancé par un geste */ });
    }
  }, [stream]);

  const goFullscreen = useCallback(() => {
    const el = containerRef.current as (HTMLElement & { webkitRequestFullscreen?: () => void }) | null;
    try {
      if (el?.requestFullscreen) { el.requestFullscreen().then(() => {
        try { (screen.orientation as unknown as { lock?: (o: string) => Promise<void> })?.lock?.('landscape').catch(() => { /* ignore */ }); } catch { /* ignore */ }
      }).catch(() => { /* ignore */ }); }
      else if (el?.webkitRequestFullscreen) { el.webkitRequestFullscreen(); }
    } catch { /* ignore */ }
  }, []);

  return (
    <div className="rounded-2xl overflow-hidden border border-[#7A5CFF]/30 bg-[rgba(20,20,25,0.95)]" data-testid="screen-share-view">
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/10">
        <span className="flex items-center gap-2 text-white/80 text-sm min-w-0">
          <MonitorUp className="w-4 h-4 text-[#7A5CFF]" />
          <span className="truncate">{isLocal ? "Votre partage d'écran" : `Partage d'écran de ${hostName || "l'hôte"}`}</span>
        </span>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button onClick={goFullscreen} className="p-1.5 rounded text-white/60 hover:text-white hover:bg-white/10" title="Plein écran" data-testid="screen-fullscreen">
            <Maximize2 className="w-4 h-4" />
          </button>
          {isLocal && onStop && (
            <button onClick={onStop} className="flex items-center gap-1 px-2 py-1 rounded text-red-400 hover:bg-red-500/10 text-xs" title="Arrêter le partage" data-testid="screen-stop">
              <X className="w-4 h-4" /> Arrêter
            </button>
          )}
        </div>
      </div>
      <div ref={containerRef} className="relative w-full aspect-video bg-black [&:fullscreen]:w-screen [&:fullscreen]:h-screen [&:fullscreen]:aspect-auto [&:fullscreen]:flex [&:fullscreen]:items-center [&:fullscreen]:justify-center">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={isLocal}            // anti-écho : l'hôte ne s'entend pas
          controls={false}
          className="w-full h-full object-contain bg-black"
          style={{ pointerEvents: 'none' }}  // non contrôlable
        />
      </div>
    </div>
  );
};

export default ScreenShareView;
