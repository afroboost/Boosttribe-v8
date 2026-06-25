import React, { useEffect, useRef, useCallback, useState } from 'react';
import { Maximize2, X, Video as VideoIcon, Image as ImageIcon, Link as LinkIcon, Youtube, Volume2 } from 'lucide-react';
import Vimeo from '@vimeo/player';
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

// Charge l'API IFrame YouTube une seule fois (sync + masquage des contrôles côté participant)
function loadYouTubeApi(): Promise<any> {
  return new Promise((resolve) => {
    const w = window as any;
    if (w.YT && w.YT.Player) { resolve(w.YT); return; }
    const prev = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => { if (typeof prev === 'function') prev(); resolve(w.YT); };
    if (!document.getElementById('yt-iframe-api')) {
      const s = document.createElement('script');
      s.id = 'yt-iframe-api';
      s.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(s);
    }
  });
}

const DRIFT = 1.2;          // s : seuil de resynchro de position
const HOST_EMIT_MS = 1500;  // intervalle d'émission de l'hôte pendant la lecture

export const SharedMediaPlayer: React.FC<SharedMediaPlayerProps> = ({ media, isHost, onState, remote, onClose }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastEmitRef = useRef(0);

  // Bug 2 : le participant démarre EN MUET (autoplay muet autorisé par les navigateurs → plus
  // d'écran noir). Un bouton "Activer le son" (geste utilisateur) réactive l'audio.
  const [muted, setMuted] = useState<boolean>(!isHost);

  // onState peut changer d'identité : on le garde dans une ref pour des effets stables.
  const onStateRef = useRef(onState);
  useEffect(() => { onStateRef.current = onState; }, [onState]);

  // Dernier état distant connu (appliqué dès qu'un player externe est prêt — late-join).
  const latestRemoteRef = useRef<RemoteMediaState | null>(remote || null);
  useEffect(() => { latestRemoteRef.current = remote || null; }, [remote]);

  // Hôte : émettre play/pause/seek/position (throttle pour la lecture continue)
  const emitState = useCallback((isPlaying: boolean, currentTime: number, force = false) => {
    const cb = onStateRef.current;
    if (!cb) return;
    const now = Date.now();
    if (!force && now - lastEmitRef.current < HOST_EMIT_MS) return;
    lastEmitRef.current = now;
    cb({ isPlaying, currentTime: currentTime || 0 });
  }, []);

  // ───────────────────────── VIDÉO UPLOADÉE (<video>) ─────────────────────────
  // Participant : appliquer l'état distant (sync + late-join : seek au temps reçu)
  useEffect(() => {
    if (isHost || !remote || media.type !== 'video') return;
    const v = videoRef.current;
    if (!v) return;
    if (Math.abs(v.currentTime - remote.currentTime) > DRIFT) {
      v.currentTime = remote.currentTime;
    }
    if (remote.isPlaying && v.paused) {
      v.play().catch(() => { /* autoplay bloqué : un geste page le débloquera, le prochain heartbeat relance */ });
    } else if (!remote.isPlaying && !v.paused) {
      v.pause();
    }
  }, [remote, isHost, media.type]);

  const emitVideo = useCallback((force = false) => {
    const v = videoRef.current;
    if (!v) return;
    emitState(!v.paused, v.currentTime, force);
  }, [emitState]);

  // ───────────────────────── YOUTUBE (IFrame Player API) ─────────────────────────
  const ytMountRef = useRef<HTMLDivElement>(null);
  const ytPlayerRef = useRef<any>(null);
  const ytReadyRef = useRef(false);

  useEffect(() => {
    if (media.type !== 'youtube') return;
    const id = youtubeId(media.url);
    if (!id) return;
    let cancelled = false;
    let poll: ReturnType<typeof setInterval> | null = null;
    ytReadyRef.current = false;

    loadYouTubeApi().then((YT) => {
      if (cancelled || !ytMountRef.current) return;
      ytPlayerRef.current = new YT.Player(ytMountRef.current, {
        videoId: id,
        // Bug 1 : host explicite → l'iframe poste vers la bonne origine (corrige le postMessage origin mismatch)
        host: 'https://www.youtube.com',
        playerVars: {
          // Participant : aucun contrôle visible ; hôte : contrôles natifs
          controls: isHost ? 1 : 0,
          // Bug 2 : participant en muet → l'autoplay muet est autorisé (plus d'écran noir)
          mute: isHost ? 0 : 1,
          // Bug 1 : activer l'API JS + déclarer l'origine parente → le player reçoit/émet l'état
          // (sinon "postMessage… does not match recipient origin" → participant en écran noir)
          enablejsapi: 1,
          origin: window.location.origin,
          disablekb: 1,
          rel: 0,
          modestbranding: 1,
          playsinline: 1,
          fs: 1,
          autoplay: 1,
          start: Math.floor(media.currentTime || 0),
        },
        events: {
          onReady: () => {
            ytReadyRef.current = true;
            const p = ytPlayerRef.current;
            // Participant : démarrer muet + se positionner et lancer la lecture si l'hôte joue
            if (!isHost && p) {
              try {
                p.mute();
                const r = latestRemoteRef.current;
                const pos = r ? r.currentTime : (media.currentTime || 0);
                if (Math.abs((p.getCurrentTime?.() || 0) - pos) > DRIFT) p.seekTo(pos, true);
                if (!r || r.isPlaying) p.playVideo(); else p.pauseVideo();
              } catch { /* ignore */ }
            }
          },
          onStateChange: (e: any) => {
            if (!isHost) return;
            const p = e.target;
            if (e.data === YT.PlayerState.PLAYING) emitState(true, p.getCurrentTime(), true);
            else if (e.data === YT.PlayerState.PAUSED) emitState(false, p.getCurrentTime(), true);
          },
        },
      });
    });

    // Hôte : émettre la position périodiquement pendant la lecture (sync fine + late-join)
    if (isHost) {
      poll = setInterval(() => {
        const p = ytPlayerRef.current;
        if (p?.getPlayerState && p.getPlayerState() === 1) emitState(true, p.getCurrentTime());
      }, HOST_EMIT_MS);
    }

    return () => {
      cancelled = true;
      if (poll) clearInterval(poll);
      try { ytPlayerRef.current?.destroy?.(); } catch { /* ignore */ }
      ytPlayerRef.current = null;
      ytReadyRef.current = false;
    };
    // currentTime volontairement exclu : on ne recrée le player que si l'URL change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [media.type, media.url, isHost, emitState]);

  // Participant : appliquer l'état distant YouTube
  useEffect(() => {
    if (isHost || media.type !== 'youtube' || !remote) return;
    const p = ytPlayerRef.current;
    if (!p || !ytReadyRef.current || !p.getCurrentTime) return;
    try {
      if (Math.abs(p.getCurrentTime() - remote.currentTime) > DRIFT) p.seekTo(remote.currentTime, true);
      const st = p.getPlayerState ? p.getPlayerState() : -1;
      if (remote.isPlaying && st !== 1) p.playVideo();
      else if (!remote.isPlaying && st === 1) p.pauseVideo();
    } catch { /* ignore */ }
  }, [remote, isHost, media.type]);

  // ───────────────────────── VIMEO (@vimeo/player SDK) ─────────────────────────
  const vimeoMountRef = useRef<HTMLDivElement>(null);
  const vimeoPlayerRef = useRef<Vimeo | null>(null);
  const vimeoReadyRef = useRef(false);

  useEffect(() => {
    if (media.type !== 'vimeo') return;
    const id = vimeoId(media.url);
    if (!id || !vimeoMountRef.current) return;
    let cancelled = false;
    vimeoReadyRef.current = false;

    const player = new Vimeo(vimeoMountRef.current, {
      id: Number(id),
      controls: isHost,   // participant : aucun contrôle
      // Bug 2 : participant en muet → autoplay muet autorisé (plus d'écran noir)
      muted: !isHost,
      autoplay: true,
      playsinline: true,
      keyboard: false,
      responsive: true,
    });
    vimeoPlayerRef.current = player;

    player.ready().then(() => {
      if (cancelled) return;
      vimeoReadyRef.current = true;
      const r = latestRemoteRef.current;
      const startAt = (!isHost && r) ? r.currentTime : (media.currentTime || 0);
      if (startAt) player.setCurrentTime(startAt).catch(() => { /* ignore */ });
      if (!isHost) {
        player.setMuted(true).catch(() => { /* ignore */ });
        // Lancer la lecture muette si l'hôte joue (ou par défaut au late-join)
        if (!r || r.isPlaying) player.play().catch(() => { /* ignore */ });
        else player.pause().catch(() => { /* ignore */ });
      }
    }).catch(() => { /* ignore */ });

    if (isHost) {
      const emitNow = (force: boolean) => {
        Promise.all([player.getCurrentTime(), player.getPaused()])
          .then(([t, paused]) => emitState(!paused, t, force))
          .catch(() => { /* ignore */ });
      };
      player.on('play', () => emitNow(true));
      player.on('pause', () => emitNow(true));
      player.on('seeked', () => emitNow(true));
      player.on('timeupdate', () => emitNow(false));
    }

    return () => {
      cancelled = true;
      vimeoReadyRef.current = false;
      try { player.destroy(); } catch { /* ignore */ }
      vimeoPlayerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [media.type, media.url, isHost, emitState]);

  // Participant : appliquer l'état distant Vimeo
  useEffect(() => {
    if (isHost || media.type !== 'vimeo' || !remote) return;
    const p = vimeoPlayerRef.current;
    if (!p || !vimeoReadyRef.current) return;
    p.getCurrentTime().then((cur) => {
      if (Math.abs(cur - remote.currentTime) > DRIFT) p.setCurrentTime(remote.currentTime).catch(() => { /* ignore */ });
      if (remote.isPlaying) p.play().catch(() => { /* ignore */ });
      else p.pause().catch(() => { /* ignore */ });
    }).catch(() => { /* ignore */ });
  }, [remote, isHost, media.type]);

  const goFullscreen = useCallback(() => {
    const el = (media.type === 'video' ? videoRef.current : containerRef.current) as HTMLElement | null;
    if (el?.requestFullscreen) el.requestFullscreen().catch(() => { /* ignore */ });
  }, [media.type]);

  // Bug 2 : geste utilisateur → réactiver le son du lecteur courant
  const enableSound = useCallback(() => {
    setMuted(false);
    try {
      if (media.type === 'video') {
        const v = videoRef.current;
        if (v) { v.muted = false; v.play?.().catch(() => { /* ignore */ }); }
      } else if (media.type === 'youtube') {
        const p = ytPlayerRef.current;
        if (p?.unMute) { p.unMute(); p.setVolume?.(100); }
      } else if (media.type === 'vimeo') {
        vimeoPlayerRef.current?.setMuted(false).catch(() => { /* ignore */ });
      }
    } catch { /* ignore */ }
  }, [media.type]);

  const icon =
    media.type === 'image' ? <ImageIcon className="w-4 h-4" /> :
    media.type === 'youtube' ? <Youtube className="w-4 h-4" /> :
    media.type === 'video' ? <VideoIcon className="w-4 h-4" /> :
    <LinkIcon className="w-4 h-4" />;

  // Types « pilotables » : sync hôte→participants ; le participant ne contrôle jamais.
  const isControllable = media.type === 'video' || media.type === 'youtube' || media.type === 'vimeo';
  const blockParticipant = !isHost && isControllable;

  // Construire le contenu intégré (jamais de redirection externe)
  let body: React.ReactNode = null;
  if (media.type === 'video') {
    body = (
      <video
        ref={videoRef}
        src={media.url}
        // Item 1 : seul l'hôte/co-animateur a les contrôles ; le participant ne peut pas piloter
        controls={isHost}
        tabIndex={isHost ? 0 : -1}
        playsInline
        // Bug 2 : participant en muet + autoplay → l'autoplay muet est autorisé (plus d'écran noir)
        // (lié à l'état `muted` pour que "Activer le son" persiste au re-render)
        muted={muted}
        autoPlay={!isHost}
        // Item 4 : lecture rapide depuis l'URL storage (Range/streaming progressif, pas de blob)
        preload="metadata"
        // Item 2 : pas de téléchargement / PiP / vitesse / menu contextuel
        controlsList="nodownload noremoteplayback noplaybackrate"
        disablePictureInPicture
        onContextMenu={(e) => e.preventDefault()}
        style={{ pointerEvents: isHost ? 'auto' : 'none' }}
        className="w-full h-full object-contain bg-black"
        onPlay={() => emitVideo(true)}
        onPause={() => emitVideo(true)}
        onSeeked={() => emitVideo(true)}
        onTimeUpdate={() => { if (isHost) emitVideo(false); }}
        data-testid="shared-video"
      />
    );
  } else if (media.type === 'image') {
    body = <img src={media.url} alt={media.title || 'Image partagée'} className="w-full h-full object-contain bg-black" />;
  } else if (media.type === 'youtube') {
    const id = youtubeId(media.url);
    // Item 1/3 : IFrame Player API (window.YT) — pas de simple <iframe> → contrôle + masquage possibles.
    body = id ? (
      <div ref={ytMountRef} className="w-full h-full" data-testid="shared-youtube" />
    ) : <p className="text-white/60 text-sm p-4">Lien YouTube invalide</p>;
  } else if (media.type === 'vimeo') {
    const id = vimeoId(media.url);
    body = id ? (
      <div ref={vimeoMountRef} className="w-full h-full [&>iframe]:w-full [&>iframe]:h-full" data-testid="shared-vimeo" />
    ) : <p className="text-white/60 text-sm p-4">Lien Vimeo invalide</p>;
  } else {
    // Lien générique : on tente l'intégration en iframe (reste DANS la page).
    // Sécurité : on n'accepte que http(s) et on isole le contenu via sandbox
    // (PAS de allow-popups / allow-top-navigation → impossible de sortir du site).
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
        sandbox="allow-scripts allow-forms allow-presentation"
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
        {/* Item 1 : overlay participant → aucune interaction possible (play/pause/seek bloqués) */}
        {blockParticipant && (
          <div className="absolute inset-0 z-10" style={{ cursor: 'default' }} data-testid="media-block-overlay" />
        )}
        {/* Bug 2 : participant en muet → bouton discret pour activer le son (geste utilisateur) */}
        {blockParticipant && muted && (
          <button
            onClick={enableSound}
            className="absolute bottom-2 right-2 z-20 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium text-white bg-black/70 hover:bg-black/85 border border-white/20 backdrop-blur-sm shadow-lg"
            data-testid="media-unmute"
          >
            <Volume2 className="w-3.5 h-3.5" />
            Activer le son
          </button>
        )}
      </div>
      {blockParticipant && (
        <p className="px-4 py-1.5 text-[11px] text-white/40">Lecture synchronisée avec l'hôte</p>
      )}
    </div>
  );
};

export default SharedMediaPlayer;
