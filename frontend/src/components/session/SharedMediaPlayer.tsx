import React, { useEffect, useRef, useCallback } from 'react';
import { Maximize2, X, Video as VideoIcon, Image as ImageIcon, Link as LinkIcon, Youtube } from 'lucide-react';
import type { SharedMedia } from '@/lib/supabaseClient';

export interface RemoteMediaState {
  isPlaying: boolean;
  currentTime: number;
  seq: number; // incrémenté à chaque commande pour forcer la ré-application
}

interface SharedMediaPlayerProps {
  media: SharedMedia;
  isHost: boolean;
  onState?: (s: { isPlaying: boolean; currentTime: number }) => void;
  remote?: RemoteMediaState | null;
  onClose?: () => void; // hôte : retirer le média partagé
}

// Extrait l'ID YouTube d'une URL
function youtubeId(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/);
  return m ? m[1] : null;
}
function vimeoId(url: string): string | null {
  const m = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  return m ? m[1] : null;
}

export const SharedMediaPlayer: React.FC<SharedMediaPlayerProps> = ({ media, isHost, onState, remote, onClose }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Participant : appliquer l'état distant à l'élément <video>
  useEffect(() => {
    if (isHost || !remote || media.type !== 'video') return;
    const v = videoRef.current;
    if (!v) return;
    if (Math.abs(v.currentTime - remote.currentTime) > 1) {
      v.currentTime = remote.currentTime;
    }
    if (remote.isPlaying && v.paused) {
      v.play().catch(() => { /* autoplay bloqué : geste requis */ });
    } else if (!remote.isPlaying && !v.paused) {
      v.pause();
    }
  }, [remote, isHost, media.type]);

  // Hôte : diffuser play/pause/seek
  const emit = useCallback(() => {
    const v = videoRef.current;
    if (!v || !onState) return;
    onState({ isPlaying: !v.paused, currentTime: v.currentTime });
  }, [onState]);

  const goFullscreen = useCallback(() => {
    const el = (media.type === 'video' ? videoRef.current : containerRef.current) as HTMLElement | null;
    if (el?.requestFullscreen) el.requestFullscreen().catch(() => { /* ignore */ });
  }, [media.type]);

  const icon =
    media.type === 'image' ? <ImageIcon className="w-4 h-4" /> :
    media.type === 'youtube' ? <Youtube className="w-4 h-4" /> :
    media.type === 'video' ? <VideoIcon className="w-4 h-4" /> :
    <LinkIcon className="w-4 h-4" />;

  // Construire le contenu intégré (jamais de redirection externe)
  let body: React.ReactNode = null;
  if (media.type === 'video') {
    body = (
      <video
        ref={videoRef}
        src={media.url}
        controls={isHost}
        playsInline
        crossOrigin="anonymous"
        className="w-full h-full object-contain bg-black"
        onPlay={emit}
        onPause={emit}
        onSeeked={emit}
        data-testid="shared-video"
      />
    );
  } else if (media.type === 'image') {
    body = <img src={media.url} alt={media.title || 'Image partagée'} className="w-full h-full object-contain bg-black" />;
  } else if (media.type === 'youtube') {
    const id = youtubeId(media.url);
    const start = Math.floor(media.currentTime || 0);
    body = id ? (
      <iframe
        title="YouTube"
        src={`https://www.youtube.com/embed/${id}?autoplay=1&start=${start}&rel=0`}
        className="w-full h-full"
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen
        frameBorder={0}
      />
    ) : <p className="text-white/60 text-sm p-4">Lien YouTube invalide</p>;
  } else if (media.type === 'vimeo') {
    const id = vimeoId(media.url);
    const start = Math.floor(media.currentTime || 0);
    body = id ? (
      <iframe
        title="Vimeo"
        src={`https://player.vimeo.com/video/${id}?autoplay=1#t=${start}s`}
        className="w-full h-full"
        allow="autoplay; fullscreen; picture-in-picture"
        allowFullScreen
        frameBorder={0}
      />
    ) : <p className="text-white/60 text-sm p-4">Lien Vimeo invalide</p>;
  } else {
    // Lien générique : on tente l'intégration en iframe (reste DANS la page).
    // Sécurité : on n'accepte que http(s) et on isole le contenu via sandbox
    // (PAS de allow-same-origin → l'iframe ne peut pas accéder à l'origine parente).
    let safeUrl: string | null = null;
    try {
      const u = new URL(media.url);
      if (u.protocol === 'https:' || u.protocol === 'http:') safeUrl = u.href;
    } catch {
      safeUrl = null;
    }
    body = safeUrl ? (
      <iframe
        title="Contenu partagé"
        src={safeUrl}
        className="w-full h-full bg-white"
        allow="autoplay; fullscreen"
        sandbox="allow-scripts allow-forms allow-popups allow-presentation"
        allowFullScreen
        frameBorder={0}
      />
    ) : (
      <p className="text-white/60 text-sm p-4">Lien non pris en charge</p>
    );
  }

  return (
    <div className="rounded-2xl overflow-hidden border border-white/10 bg-[rgba(20,20,25,0.95)]">
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/10">
        <div className="flex items-center gap-2 text-white/80 text-sm min-w-0">
          <span className="text-[#8A2EFF]">{icon}</span>
          <span className="truncate">{media.title || 'Contenu partagé'}</span>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button onClick={goFullscreen} className="p-1.5 rounded text-white/60 hover:text-white hover:bg-white/10" title="Plein écran" data-testid="media-fullscreen">
            <Maximize2 className="w-4 h-4" />
          </button>
          {isHost && onClose && (
            <button onClick={onClose} className="p-1.5 rounded text-white/60 hover:text-red-400 hover:bg-white/10" title="Retirer" data-testid="media-close">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
      <div ref={containerRef} className="relative w-full aspect-video bg-black">
        {body}
      </div>
      {!isHost && media.type === 'video' && (
        <p className="px-4 py-1.5 text-[11px] text-white/40">Lecture synchronisée avec l'hôte</p>
      )}
    </div>
  );
};

export default SharedMediaPlayer;
