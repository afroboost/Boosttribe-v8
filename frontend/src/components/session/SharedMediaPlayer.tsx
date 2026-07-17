import React, { useEffect, useRef, useCallback, useState, forwardRef, useImperativeHandle } from 'react';
import { Maximize2, ArrowLeft, X, Video as VideoIcon, Image as ImageIcon, Link as LinkIcon, Youtube, Volume2 } from 'lucide-react';
import Vimeo from '@vimeo/player';
import type { SharedMedia } from '@/lib/supabaseClient';
import { DraggableWindow } from '@/components/session/DraggableWindow';

export interface RemoteMediaState {
  isPlaying: boolean;
  currentTime: number;
  seq: number; // incrémenté à chaque commande pour forcer la ré-application
}

// 🎙️ Handle impératif (VAD mains-libres) : l'hôte met en pause / reprend le média partagé via le
//    chemin lecteur EXISTANT → la synchro (heartbeat VIDEO_SYNC) propage à tous. Aucune nouvelle synchro.
export interface SharedMediaPlayerHandle {
  pauseSharedMedia: () => boolean;                 // pause le média ; renvoie true s'il JOUAIT (pour reprise conditionnelle)
  resumeSharedMedia: (wasPlaying: boolean) => void; // reprend UNIQUEMENT s'il jouait ; ne touche jamais muted/pendingUnmute
}

interface SharedMediaPlayerProps {
  media: SharedMedia;
  isHost: boolean;
  onState?: (s: { isPlaying: boolean; currentTime: number }) => void;
  remote?: RemoteMediaState | null;
  onClose?: () => void; // hôte : retirer le média partagé
  mediaVolume?: number;  // 0–1 : "Volume Vidéo" du mixeur → pilote le lecteur courant
  maxSeconds?: number;   // plan gratuit : coupe la lecture à 30s (émetteur) ; Pro : Infinity
  // 🔔 Notifie le parent quand la vue agrandie (plein écran) s'ouvre/ferme → le parent rend le chat
  //    À L'INTÉRIEUR de l'élément plein écran (sinon invisible en plein écran natif).
  onEnlargedChange?: (enlarged: boolean) => void;
  // 💬 Chat rendu À L'INTÉRIEUR de l'élément plein écran (overlay par-dessus la vidéo paysage).
  chatNode?: React.ReactNode;
  // 🎥 Vignettes caméra du Live Visio à garder visibles (fenêtre flottante) en vue agrandie.
  liveCamerasNode?: React.ReactNode;
  // ⏱️ Rappel LECTURE SEULE du décompte Interval training, affiché À L'INTÉRIEUR du plein écran vidéo.
  timerNode?: React.ReactNode;
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

const DRIFT = 1.0;          // s : seuil de resynchro de position participant (anti-saccade)
const HOST_EMIT_MS = 700;   // intervalle UNIQUE d'émission de l'hôte (lit l'état LIVE du lecteur)

export const SharedMediaPlayer = forwardRef<SharedMediaPlayerHandle, SharedMediaPlayerProps>(({ media, isHost, onState, remote, onClose, mediaVolume, maxSeconds = Infinity, onEnlargedChange, chatNode, liveCamerasNode, timerNode }, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  // 🔍 Racine du lecteur : c'est ELLE qu'on passe en plein écran (contient vidéo + overlay caméras + bouton Retour).
  const rootRef = useRef<HTMLDivElement>(null);
  // 🔍 Agrandissement (vrai plein écran + overlay) → permet de superposer caméras + retour, et le paysage.
  const [enlarged, setEnlarged] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaVolumeInitRef = useRef(true); // ignorer la 1re valeur (montage) pour ne pas casser l'autoplay muet

  // Identifiants STABLES du média (primitifs) : ce sont les SEULES dépendances des effets de
  // CRÉATION des players. Tant que l'id ne change pas, le player n'est jamais recréé — même si
  // l'objet `media` / `remote` change à chaque commande de synchro (heartbeat + broadcasts).
  const ytId = media.type === 'youtube' ? youtubeId(media.url) : null;
  const vmId = media.type === 'vimeo' ? vimeoId(media.url) : null;

  // Bug 2 : le participant démarre EN MUET (autoplay muet autorisé par les navigateurs → plus
  // d'écran noir). Un bouton "Activer le son" (geste utilisateur) réactive l'audio.
  const [muted, setMuted] = useState<boolean>(!isHost);
  const [limitReached, setLimitReached] = useState(false); // plan gratuit : 30s atteints
  // Si l'utilisateur clique "Activer le son" avant que le player soit prêt, on mémorise l'intention
  // et on l'exécute dans onReady (sinon le clic serait perdu).
  const pendingUnmuteRef = useRef(false);

  // onState peut changer d'identité : on le garde dans une ref pour des effets stables.
  const onStateRef = useRef(onState);
  useEffect(() => { onStateRef.current = onState; }, [onState]);

  // Dernier état distant connu (appliqué dès qu'un player externe est prêt — late-join).
  const latestRemoteRef = useRef<RemoteMediaState | null>(remote || null);
  useEffect(() => { latestRemoteRef.current = remote || null; }, [remote]);

  // 🎬 HÔTE = SOURCE UNIQUE : émettre l'état (lu sur le lecteur LIVE) vers le parent, qui le
  // diffuse en VIDEO_SYNC. Pas de throttle ici : appelé par l'UNIQUE interval (700ms) + à chaque action.
  // Dernier état de lecture connu (mis à jour à chaque émission hôte) — utilisé par pauseSharedMedia
  //   pour Vimeo dont getPaused() est asynchrone. Best-effort, rafraîchi ~700ms + à chaque action.
  const lastPlayingRef = useRef(false);
  const emitHostState = useCallback((isPlaying: boolean, currentTime: number) => {
    lastPlayingRef.current = isPlaying;
    onStateRef.current?.({ isPlaying, currentTime: currentTime || 0 });
  }, []);

  // ───────────────────────── VIDÉO UPLOADÉE (<video>) ─────────────────────────
  // Participant : appliquer l'état distant. host.isPlaying=true → play + seek si écart > DRIFT.
  // host.isPlaying=false → pause ET seek (caler exactement sur l'hôte).
  useEffect(() => {
    if (isHost || !remote || media.type !== 'video') return;
    const v = videoRef.current;
    if (!v) return;
    if (remote.isPlaying) {
      if (Math.abs(v.currentTime - remote.currentTime) > DRIFT) v.currentTime = remote.currentTime;
      if (v.paused) v.play().catch(() => { /* autoplay bloqué : muet l'autorise, le prochain sync relance */ });
    } else {
      v.currentTime = remote.currentTime;
      if (!v.paused) v.pause();
    }
  }, [remote, isHost, media.type]);

  // ───────────────────────── YOUTUBE (IFrame Player API) ─────────────────────────
  const ytMountRef = useRef<HTMLDivElement>(null);
  const ytPlayerRef = useRef<any>(null);
  const ytReadyRef = useRef(false);
  const ytLoadedIdRef = useRef<string | null>(null); // garde anti-recréation

  // EFFET DE CRÉATION — dépend UNIQUEMENT de l'id (ytId) et de isHost. Jamais de currentTime /
  // isPlaying / objet media → le player est créé UNE SEULE FOIS par vidéo (pas de boucle widget2→8).
  useEffect(() => {
    if (media.type !== 'youtube' || !ytId) return;
    // Garde : si le player existe déjà pour cette vidéo, NE PAS le recréer.
    if (ytPlayerRef.current && ytLoadedIdRef.current === ytId) return;
    const id = ytId;
    let cancelled = false;
    ytReadyRef.current = false;
    const mount = ytMountRef.current; // capturé pour le cleanup (ref stable pendant la vie de l'effet)

    loadYouTubeApi().then((YT) => {
      if (cancelled || !mount) return;
      ytLoadedIdRef.current = id;
      // CORRECTIF écran noir : l'API YouTube REMPLACE l'élément qu'on lui passe par son <iframe>.
      // On ne doit JAMAIS lui donner un nœud géré par React (le conteneur), sinon à chaque re-render
      // (commandes de sync fréquentes) React réinsère son div et détache l'iframe → écran noir et le
      // player pointe vers un élément détaché → playVideo() ne fait plus rien.
      // → on crée un div interne impératif que React ne touche jamais et que l'API peut remplacer.
      const inner = document.createElement('div');
      inner.style.width = '100%';
      inner.style.height = '100%';
      mount.replaceChildren(inner);
      ytPlayerRef.current = new YT.Player(inner, {
        videoId: id,
        // host explicite → l'iframe poste vers la bonne origine (corrige le postMessage origin mismatch)
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
          fs: 0, // pas de bouton plein écran NATIF YouTube → on garde UN seul bouton (le nôtre)
          autoplay: 1,
          start: Math.floor(latestRemoteRef.current?.currentTime ?? media.currentTime ?? 0),
        },
        events: {
          onReady: () => {
            ytReadyRef.current = true;
            const p = ytPlayerRef.current;
            // Participant : TOUJOURS démarrer la lecture (muet) → une frame se décode, jamais d'écran noir.
            // autoplay=1 ne suffit pas avec new YT.Player : il faut appeler playVideo() explicitement.
            if (!isHost && p) {
              try {
                const r = latestRemoteRef.current;
                const pos = r ? r.currentTime : 0; // position courante de l'hôte (ou 0 si inconnue)
                if (pendingUnmuteRef.current) { pendingUnmuteRef.current = false; p.unMute(); p.setVolume?.(100); setMuted(false); }
                else p.mute();
                if (pos > 0) p.seekTo(pos, true);
                p.playVideo();
                // Si l'hôte est explicitement en pause : laisser une frame s'afficher puis se mettre en pause.
                if (r && r.isPlaying === false) {
                  setTimeout(() => { try { ytPlayerRef.current?.pauseVideo?.(); } catch { /* ignore */ } }, 350);
                }
              } catch { /* ignore */ }
            }
          },
          onStateChange: (e: any) => {
            const p = e.target;
            if (isHost) {
              // Hôte : émission instantanée sur play/pause (en plus de l'interval unique)
              if (e.data === YT.PlayerState.PLAYING) emitHostState(true, p.getCurrentTime());
              else if (e.data === YT.PlayerState.PAUSED) emitHostState(false, p.getCurrentTime());
              return;
            }
            // PARTICIPANT — anti-pause : si l'hôte joue et que le lecteur passe en pause → relancer
            const r = latestRemoteRef.current;
            if (e.data === YT.PlayerState.PAUSED && r?.isPlaying) {
              console.log('[VIDEO] re-enforce play');
              try { p.playVideo(); } catch { /* ignore */ }
            }
          },
        },
      });
    });

    return () => {
      cancelled = true;
      try { ytPlayerRef.current?.destroy?.(); } catch { /* ignore */ }
      // Nettoyer l'iframe laissée par l'API dans le conteneur React
      try { mount?.replaceChildren(); } catch { /* ignore */ }
      ytPlayerRef.current = null;
      ytReadyRef.current = false;
      ytLoadedIdRef.current = null;
    };
    // Dépend UNIQUEMENT de l'id (ytId) + isHost → création unique. emitHostState est stable (useCallback []).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ytId, isHost]);

  // Participant : appliquer l'état distant YouTube (ré-imposé à chaque VIDEO_SYNC)
  useEffect(() => {
    if (isHost || media.type !== 'youtube' || !remote) return;
    const p = ytPlayerRef.current;
    if (!p || !ytReadyRef.current || !p.getCurrentTime) return;
    try {
      const st = p.getPlayerState ? p.getPlayerState() : -1;
      if (remote.isPlaying) {
        if (Math.abs(p.getCurrentTime() - remote.currentTime) > DRIFT) p.seekTo(remote.currentTime, true);
        if (st !== 1) p.playVideo();
      } else {
        p.seekTo(remote.currentTime, true);
        if (st === 1) p.pauseVideo();
      }
    } catch { /* ignore */ }
  }, [remote, isHost, media.type]);

  // ───────────────────────── VIMEO (@vimeo/player SDK) ─────────────────────────
  const vimeoMountRef = useRef<HTMLDivElement>(null);
  const vimeoPlayerRef = useRef<Vimeo | null>(null);
  const vimeoReadyRef = useRef(false);
  const vimeoLoadedIdRef = useRef<string | null>(null); // garde anti-recréation

  // EFFET DE CRÉATION — dépend UNIQUEMENT de l'id (vmId) + isHost → création unique par vidéo.
  useEffect(() => {
    if (media.type !== 'vimeo' || !vmId || !vimeoMountRef.current) return;
    // Garde : player déjà créé pour cette vidéo → ne pas recréer.
    if (vimeoPlayerRef.current && vimeoLoadedIdRef.current === vmId) return;
    const id = vmId;
    let cancelled = false;
    vimeoReadyRef.current = false;
    vimeoLoadedIdRef.current = id;

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
        // TOUJOURS lancer la lecture (muet) au ready → une frame s'affiche, jamais d'écran noir.
        if (pendingUnmuteRef.current) { pendingUnmuteRef.current = false; player.setMuted(false).catch(() => { /* ignore */ }); setMuted(false); }
        else player.setMuted(true).catch(() => { /* ignore */ });
        player.play().catch(() => { /* ignore */ });
        // Hôte explicitement en pause → afficher une frame puis se mettre en pause.
        if (r && r.isPlaying === false) {
          setTimeout(() => { vimeoPlayerRef.current?.pause().catch(() => { /* ignore */ }); }, 350);
        }
      }
    }).catch(() => { /* ignore */ });

    if (isHost) {
      // Hôte : émission instantanée sur chaque action (en plus de l'interval unique)
      const emitNow = () => {
        Promise.all([player.getCurrentTime(), player.getPaused()])
          .then(([t, paused]) => emitHostState(!paused, t))
          .catch(() => { /* ignore */ });
      };
      player.on('play', emitNow);
      player.on('pause', emitNow);
      player.on('seeked', emitNow);
    } else {
      // PARTICIPANT — anti-pause : si l'hôte joue et que le lecteur passe en pause → relancer
      player.on('pause', () => {
        const r = latestRemoteRef.current;
        if (r?.isPlaying) {
          console.log('[VIDEO] re-enforce play');
          player.play().catch(() => { /* ignore */ });
        }
      });
    }

    return () => {
      cancelled = true;
      vimeoReadyRef.current = false;
      try { player.destroy(); } catch { /* ignore */ }
      vimeoPlayerRef.current = null;
      vimeoLoadedIdRef.current = null;
    };
    // Dépend UNIQUEMENT de l'id (vmId) + isHost → création unique. emitHostState est stable (useCallback []).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vmId, isHost]);

  // Participant : appliquer l'état distant Vimeo (ré-imposé à chaque VIDEO_SYNC)
  useEffect(() => {
    if (isHost || media.type !== 'vimeo' || !remote) return;
    const p = vimeoPlayerRef.current;
    if (!p || !vimeoReadyRef.current) return;
    p.getCurrentTime().then((cur) => {
      if (remote.isPlaying) {
        if (Math.abs(cur - remote.currentTime) > DRIFT) p.setCurrentTime(remote.currentTime).catch(() => { /* ignore */ });
        p.play().catch(() => { /* ignore */ });
      } else {
        p.setCurrentTime(remote.currentTime).catch(() => { /* ignore */ });
        p.pause().catch(() => { /* ignore */ });
      }
    }).catch(() => { /* ignore */ });
  }, [remote, isHost, media.type]);

  // 🔊 "Volume Vidéo" (mixeur) → pilote le lecteur courant. On IGNORE la 1re valeur (montage)
  // pour ne pas dé-muter avant un geste utilisateur (sinon l'autoplay muet est bloqué → écran noir).
  // Dès que l'utilisateur bouge le slider : on applique le volume et on dé-mute si > 0.
  useEffect(() => {
    if (mediaVolume === undefined) return;
    if (mediaVolumeInitRef.current) { mediaVolumeInitRef.current = false; return; }
    const v = Math.max(0, Math.min(1, mediaVolume));
    try {
      if (media.type === 'youtube') {
        const p = ytPlayerRef.current;
        if (p?.setVolume) { p.setVolume(Math.round(v * 100)); if (v > 0) { p.unMute?.(); setMuted(false); } else { p.mute?.(); } }
      } else if (media.type === 'video') {
        const el = videoRef.current;
        if (el) { el.volume = v; if (v > 0) { el.muted = false; setMuted(false); } else { el.muted = true; } }
      } else if (media.type === 'vimeo') {
        const p = vimeoPlayerRef.current;
        if (p) { p.setVolume(v).catch(() => { /* ignore */ }); if (v > 0) { p.setMuted(false).catch(() => { /* ignore */ }); setMuted(false); } }
      }
    } catch { /* ignore */ }
  }, [mediaVolume, media.type]);

  // 🎬 ÉMETTEUR HÔTE UNIQUE : un SEUL setInterval qui lit l'état RÉEL du lecteur au moment T et
  // l'émet (le parent diffuse VIDEO_SYNC). C'est la seule source de vérité → plus d'états
  // contradictoires. Les actions (play/pause/seek) émettent en plus immédiatement (handlers ci-dessus).
  useEffect(() => {
    if (!isHost) return;
    // plan gratuit : couper la lecture à maxSeconds (l'émetteur coupe → la sync arrête tout le monde)
    const overLimit = (t: number) => Number.isFinite(maxSeconds) && t >= maxSeconds;
    const interval = setInterval(() => {
      try {
        if (media.type === 'youtube') {
          const p = ytPlayerRef.current;
          if (p?.getPlayerState && p.getCurrentTime) {
            const t = p.getCurrentTime();
            if (overLimit(t)) { try { p.pauseVideo(); } catch { /* ignore */ } setLimitReached(true); emitHostState(false, t); }
            else emitHostState(p.getPlayerState() === 1, t);
          }
        } else if (media.type === 'video') {
          const v = videoRef.current;
          if (v && !Number.isNaN(v.currentTime)) {
            if (overLimit(v.currentTime)) { try { v.pause(); } catch { /* ignore */ } setLimitReached(true); emitHostState(false, v.currentTime); }
            else emitHostState(!v.paused, v.currentTime);
          }
        } else if (media.type === 'vimeo') {
          const p = vimeoPlayerRef.current;
          if (p) Promise.all([p.getCurrentTime(), p.getPaused()]).then(([t, paused]) => {
            if (overLimit(t)) { p.pause().catch(() => { /* ignore */ }); setLimitReached(true); emitHostState(false, t); }
            else emitHostState(!paused, t);
          }).catch(() => { /* ignore */ });
        }
      } catch { /* ignore */ }
    }, HOST_EMIT_MS);
    return () => clearInterval(interval);
  }, [isHost, media.type, emitHostState, maxSeconds]);

  // 🔍 Vue agrandie (overlay maison) : verrouiller le scroll de fond + sortie au clavier (Échap).
  useEffect(() => {
    if (!enlarged) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') handleExitEnlarge(); };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enlarged]);

  // 🔁 Verrouillage paysage : screen.orientation.lock('landscape') n'agit QUE en vrai plein écran.
  const unlockOrientation = useCallback(() => {
    try { (screen.orientation as unknown as { unlock?: () => void })?.unlock?.(); } catch { /* ignore */ }
  }, []);
  const lockLandscape = useCallback(() => {
    try { (screen.orientation as unknown as { lock?: (o: string) => Promise<void> })?.lock?.('landscape').catch(() => { /* non supporté → rotation manuelle */ }); } catch { /* ignore */ }
  }, []);

  // 🔍 Entrer en plein écran : on demande le plein écran sur le CONTENEUR (root) — pas sur l'iframe —
  // pour que les caméras live (déplaçables) ET le bouton Retour (enfants du conteneur) restent visibles,
  // tout en permettant le verrouillage paysage. Fallback overlay CSS si l'API n'est pas dispo (iOS div).
  const handleEnlarge = useCallback(() => {
    // 🔍 Vue agrandie = PLEIN ÉCRAN NATIF + verrouillage PAYSAGE (mobile) → meilleur visionnage.
    //    Les caméras live ET le chat sont rendus À L'INTÉRIEUR de cet élément plein écran (rootRef)
    //    → ils restent visibles/accessibles en overlay PAR-DESSUS la vidéo paysage (cf. liveCamerasNode + chatNode).
    setEnlarged(true);
    const el = rootRef.current as (HTMLElement & { webkitRequestFullscreen?: () => void }) | null;
    try {
      if (el?.requestFullscreen) {
        el.requestFullscreen().then(lockLandscape).catch(lockLandscape);
      } else if (el?.webkitRequestFullscreen) {
        el.webkitRequestFullscreen();
        lockLandscape();
      } else {
        lockLandscape(); // pas de Fullscreen API (ex. iOS Safari div) → overlay CSS plein écran + rotation manuelle
      }
    } catch { /* ignore */ }
  }, [lockLandscape]);

  // 🔍 Sortir : déverrouiller l'orientation + quitter le vrai plein écran s'il est actif
  // (sinon simplement refermer l'overlay CSS). fullscreenchange refermera aussi l'overlay.
  const handleExitEnlarge = useCallback(() => {
    unlockOrientation();
    const d = document as Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void };
    if (d.fullscreenElement || d.webkitFullscreenElement) {
      try { (d.exitFullscreen?.() || d.webkitExitFullscreen?.()); } catch { /* ignore */ }
    } else {
      setEnlarged(false);
    }
  }, [unlockOrientation]);

  // 🔔 Informer le parent (SessionPage) de l'état agrandi → il rend le chat À L'INTÉRIEUR du plein écran.
  useEffect(() => { onEnlargedChange?.(enlarged); }, [enlarged, onEnlargedChange]);

  // 🔍 Suivre l'état plein écran : si on en sort (Échap, geste retour, bouton natif) → refermer l'overlay
  const enlargedRef = useRef(enlarged);
  enlargedRef.current = enlarged;
  useEffect(() => {
    const onFsChange = () => {
      const fsEl = document.fullscreenElement || (document as unknown as { webkitFullscreenElement?: Element }).webkitFullscreenElement;
      if (!fsEl) {
        unlockOrientation();
        if (enlargedRef.current) setEnlarged(false); // sortie du plein écran natif → fermer la vue agrandie
      }
    };
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange as EventListener);
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      document.removeEventListener('webkitfullscreenchange', onFsChange as EventListener);
    };
  }, [unlockOrientation]);

  // Bug 2 : geste utilisateur → réactiver le son du lecteur courant, relancer la lecture et
  // resynchroniser à la position de l'hôte. Si le player n'est pas prêt, on mémorise l'intention
  // (pendingUnmuteRef) et onReady l'exécutera.
  const enableSound = useCallback(() => {
    setMuted(false);
    const pos = latestRemoteRef.current?.currentTime ?? 0;
    try {
      if (media.type === 'video') {
        const v = videoRef.current;
        if (v) { v.muted = false; if (pos > 0 && Math.abs(v.currentTime - pos) > DRIFT) v.currentTime = pos; v.play?.().catch(() => { /* ignore */ }); }
      } else if (media.type === 'youtube') {
        const p = ytPlayerRef.current;
        if (p?.unMute && ytReadyRef.current) {
          p.unMute(); p.setVolume?.(100);
          if (pos > 0) p.seekTo(pos, true);
          p.playVideo?.();
        } else { pendingUnmuteRef.current = true; }
      } else if (media.type === 'vimeo') {
        const p = vimeoPlayerRef.current;
        if (p && vimeoReadyRef.current) {
          p.setMuted(false).catch(() => { /* ignore */ });
          if (pos > 0) p.setCurrentTime(pos).catch(() => { /* ignore */ });
          p.play().catch(() => { /* ignore */ });
        } else { pendingUnmuteRef.current = true; }
      }
    } catch { /* ignore */ }
  }, [media.type]);

  // 🎙️ VAD mains-libres : pause/reprise du média partagé pilotées par l'HÔTE (chemin lecteur EXISTANT).
  //    Appeler pause()/play() sur le lecteur hôte → la synchro (emitHostState → VIDEO_SYNC → participants)
  //    propage. On NE force PAS de seek (le heartbeat cale la position) et on NE touche PAS muted.
  useImperativeHandle(ref, (): SharedMediaPlayerHandle => ({
    pauseSharedMedia: () => {
      try {
        if (media.type === 'video') {
          const v = videoRef.current;
          if (!v) return false;
          const was = !v.paused;
          if (was) v.pause();
          return was;
        }
        if (media.type === 'youtube') {
          const p = ytPlayerRef.current;
          if (!p || !ytReadyRef.current || !p.getPlayerState) return false;
          const was = p.getPlayerState() === 1; // 1 = PLAYING
          if (was) p.pauseVideo();
          return was;
        }
        if (media.type === 'vimeo') {
          const p = vimeoPlayerRef.current;
          if (!p || !vimeoReadyRef.current) return false;
          const was = lastPlayingRef.current; // getPaused() est async → best-effort via dernier état émis
          p.pause().catch(() => { /* ignore */ });
          return was;
        }
      } catch { /* ignore */ }
      return false;
    },
    resumeSharedMedia: (wasPlaying: boolean) => {
      if (!wasPlaying) return; // ne relance QUE si le média jouait avant l'auto-pause
      try {
        if (media.type === 'video') { videoRef.current?.play?.().catch(() => { /* ignore */ }); }
        else if (media.type === 'youtube') { if (ytReadyRef.current) ytPlayerRef.current?.playVideo?.(); }
        else if (media.type === 'vimeo') { if (vimeoReadyRef.current) vimeoPlayerRef.current?.play?.().catch(() => { /* ignore */ }); }
      } catch { /* ignore */ }
    },
  }), [media.type]);

  const icon =
    media.type === 'image' ? <ImageIcon className="w-4 h-4" /> :
    media.type === 'youtube' ? <Youtube className="w-4 h-4" /> :
    media.type === 'video' ? <VideoIcon className="w-4 h-4" /> :
    <LinkIcon className="w-4 h-4" />;

  // Types « pilotables » : sync hôte→participants ; le participant ne contrôle jamais.
  const isControllable = media.type === 'video' || media.type === 'youtube' || media.type === 'vimeo';
  const blockParticipant = !isHost && isControllable;

  // 🖼️ Cadrage des iframes (YouTube/Vimeo) : object-fit ne s'applique PAS aux iframes. En vue AGRANDIE,
  //    on « couvre » le conteneur (technique vh/vw) → plus de bandes noires. En vue intégrée (boîte 16:9),
  //    l'iframe remplit déjà → comportement inchangé (sûr).
  const iframeMountClass = enlarged
    ? "absolute inset-0 overflow-hidden [&>iframe]:absolute [&>iframe]:left-1/2 [&>iframe]:top-1/2 [&>iframe]:-translate-x-1/2 [&>iframe]:-translate-y-1/2 [&>iframe]:w-[177.78vh] [&>iframe]:h-[56.25vw] [&>iframe]:min-w-full [&>iframe]:min-h-full"
    : "w-full h-full [&>iframe]:w-full [&>iframe]:h-full";

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
        // Item 2 : pas de téléchargement / PiP / vitesse / menu contextuel + pas de plein écran NATIF
        // (on garde UN seul bouton plein écran : le nôtre, sur le conteneur)
        controlsList="nodownload noremoteplayback noplaybackrate nofullscreen"
        disablePictureInPicture
        onContextMenu={(e) => e.preventDefault()}
        style={{ pointerEvents: isHost ? 'auto' : 'none' }}
        // 🖼️ object-cover → la vidéo REMPLIT tout le conteneur (plus de bandes noires latérales).
        className="w-full h-full object-cover bg-black"
        // Bug 2 : participant → au chargement, se positionner à l'état hôte et lancer la lecture muette
        // (frame visible, jamais d'écran noir) ; la sync mettra en pause si l'hôte est en pause.
        onLoadedMetadata={() => {
          if (isHost) return;
          const v = videoRef.current;
          if (!v) return;
          const r = latestRemoteRef.current;
          v.muted = true;
          if (r && r.currentTime && Math.abs(v.currentTime - r.currentTime) > DRIFT) v.currentTime = r.currentTime;
          v.play().catch(() => { /* autoplay bloqué : le 1er tap relancera */ });
          if (r && r.isPlaying === false) setTimeout(() => { try { videoRef.current?.pause(); } catch { /* ignore */ } }, 350);
        }}
        // Hôte : émission instantanée sur action. Participant : anti-pause (relance si l'hôte joue).
        onPlay={() => { const v = videoRef.current; if (isHost && v) emitHostState(true, v.currentTime); }}
        onPause={() => {
          const v = videoRef.current; if (!v) return;
          if (isHost) { emitHostState(false, v.currentTime); return; }
          const r = latestRemoteRef.current;
          if (r?.isPlaying) { console.log('[VIDEO] re-enforce play'); v.play().catch(() => { /* ignore */ }); }
        }}
        onSeeked={() => { const v = videoRef.current; if (isHost && v) emitHostState(!v.paused, v.currentTime); }}
        data-testid="shared-video"
      />
    );
  } else if (media.type === 'image') {
    body = <img src={media.url} alt={media.title || 'Image partagée'} className="w-full h-full object-contain bg-black" />;
  } else if (media.type === 'youtube') {
    const id = youtubeId(media.url);
    // Item 1/3 : IFrame Player API (window.YT) — pas de simple <iframe> → contrôle + masquage possibles.
    body = id ? (
      <div ref={ytMountRef} className={iframeMountClass} data-testid="shared-youtube" />
    ) : <p className="text-white/60 text-sm p-4">Lien YouTube invalide</p>;
  } else if (media.type === 'vimeo') {
    const id = vimeoId(media.url);
    body = id ? (
      <div ref={vimeoMountRef} className={iframeMountClass} data-testid="shared-vimeo" />
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
    <div
      ref={rootRef}
      className={
        enlarged
          // 🔍 Vue agrandie : couvre TOUT l'écran (plein écran natif paysage sur mobile). Caméras + chat
          //    sont rendus À L'INTÉRIEUR (enfants) → visibles en overlay par-dessus la vidéo paysage.
          ? 'fixed inset-0 z-[100] bg-black flex flex-col'
          : 'rounded-2xl overflow-hidden border border-white/10 bg-[rgba(20,20,25,0.95)]'
      }
      data-testid="shared-media-root"
    >
      {/* Barre supérieure — normale OU vue agrandie (bouton "Retour") */}
      {enlarged ? (
        <div className="flex items-center justify-between gap-2 px-3 sm:px-4 py-2.5 bg-black/85 border-b border-white/10 z-[105]">
          <button
            onClick={handleExitEnlarge}
            className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold text-white bg-white/10 hover:bg-white/20 border border-white/15 transition-colors"
            data-testid="media-back-to-session"
          >
            <ArrowLeft className="w-4 h-4" /> Retour
          </button>
          <span className="flex items-center gap-2 text-white/70 text-sm min-w-0">
            <span className="text-[var(--bt-accent)]">{icon}</span>
            <span className="truncate hidden sm:block">{media.title || 'Contenu partagé'}</span>
          </span>
          {/* spacer pour garder le titre centré (un seul bouton plein écran : pas de doublon) */}
          <span className="w-[88px] flex-shrink-0" aria-hidden="true" />
        </div>
      ) : (
        <div className="flex items-center justify-between px-4 py-2 border-b border-white/10">
          <div className="flex items-center gap-2 text-white/80 text-sm min-w-0">
            <span className="text-[var(--bt-accent)]">{icon}</span>
            <span className="truncate">{media.title || 'Contenu partagé'}</span>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <button onClick={handleEnlarge} className="p-1.5 rounded text-white/60 hover:text-white hover:bg-white/10" title="Plein écran" data-testid="media-fullscreen">
              <Maximize2 className="w-4 h-4" />
            </button>
            {isHost && onClose && (
              <button onClick={onClose} className="p-1.5 rounded text-white/60 hover:text-red-400 hover:bg-white/10" title="Retirer" data-testid="media-close">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      )}
      {/* Conteneur du média : normal (16:9) OU agrandi (occupe tout l'espace, object-contain) */}
      <div
        ref={containerRef}
        className={
          enlarged
            ? 'relative flex-1 min-h-0 bg-black flex items-center justify-center overflow-hidden'
            : 'relative w-full aspect-video bg-black [&:fullscreen]:w-screen [&:fullscreen]:h-screen [&:fullscreen]:aspect-auto [&:fullscreen]:flex [&:fullscreen]:items-center [&:fullscreen]:justify-center'
        }
      >
        {body}
        {/* Item 2 : overlay BLOQUANT → capte et neutralise TOUS les clics/taps du participant.
            Le participant ne peut JAMAIS piloter le lecteur (pas de pause via clic vidéo). */}
        {blockParticipant && (
          <div
            className="absolute inset-0 z-10"
            style={{ cursor: 'default' }}
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
            onTouchStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
            onContextMenu={(e) => e.preventDefault()}
            data-testid="media-block-overlay"
          />
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

        {/* 🔒 Plan gratuit : aperçu limité à 30s */}
        {limitReached && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-2 bg-black/75 backdrop-blur-sm text-center p-4">
            <p className="text-white font-semibold text-sm">Aperçu limité à 30 s</p>
            <p className="text-white/60 text-xs">Utilisez des crédits pour la vidéo complète</p>
            <a href="/pricing" className="mt-1 px-3 py-1.5 rounded-full text-white text-xs font-semibold" style={{ background: 'linear-gradient(135deg, var(--bt-accent) 0%, var(--bt-accent-2) 100%)' }}>
              Acheter des crédits
            </a>
          </div>
        )}
      </div>
      {!enlarged && blockParticipant && !limitReached && (
        <p className="px-4 py-1.5 text-[11px] text-white/40">Lecture synchronisée avec l'hôte</p>
      )}

      {/* 🎥 Vue agrandie : caméras live dans une fenêtre FLOTTANTE déplaçable (en haut par défaut),
          par-dessus la vidéo. La vidéo reste synchronisée et en lecture (pas de remontage). */}
      {enlarged && liveCamerasNode && (
        /* z-[110] : TOUJOURS au-dessus des barres du lecteur plein écran (root z-[100], barre z-[105])
           → la fenêtre caméras ne se coince jamais sous la barre « Contenu partagé ». */
        <DraggableWindow title="Caméras live" storageKey="bt_visio_enlarged_pos" defaultWidth={260} zClass="z-[110]">
          {liveCamerasNode}
        </DraggableWindow>
      )}

      {/* 💬 Chat rendu À L'INTÉRIEUR de l'élément plein écran → reste accessible par-dessus la vidéo
          paysage (le plein écran natif n'affiche QUE cet élément ; un chat hors de lui serait invisible). */}
      {enlarged && chatNode}

      {/* ⏱️ Rappel LECTURE SEULE du timer À L'INTÉRIEUR du plein écran (même raison que le chat ci-dessus). */}
      {enlarged && timerNode}
    </div>
  );
});

SharedMediaPlayer.displayName = 'SharedMediaPlayer';

export default SharedMediaPlayer;
