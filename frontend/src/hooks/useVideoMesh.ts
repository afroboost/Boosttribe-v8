import { useCallback, useEffect, useRef, useState } from 'react';
import Peer, { MediaConnection } from 'peerjs';
import supabase from '@/lib/supabaseClient';

/**
 * 🎥 useVideoMesh — Mode "Live / Visio" (caméras) en pair-à-pair (mesh), ISOLÉ de l'audio.
 *
 * Conçu séparément de usePeerAudio : son PROPRE Peer PeerJS, son PROPRE canal de signaling
 * (Supabase broadcast `visio:<sessionId>`). N'altère JAMAIS l'audio/mixeur/synchro existants.
 *
 * Transport encapsulé derrière une petite interface (startCamera/stopCamera + flux local/distants)
 * → on pourra remplacer le mesh par un SFU plus tard sans toucher l'UI.
 *
 * Stratégie mesh (≤ 6 caméras, petits groupes) : chaque pair qui a sa caméra active APPELLE
 * tous les autres pairs visio (envoi unidirectionnel de SA caméra). Pas de renégociation, pas de
 * glare. À la réception on `answer()` sans flux et on affiche la vidéo distante.
 */

const MAX_CAMERAS = 6;
const PRESENCE_EVENT = 'VISIO_PRESENCE';
const HEARTBEAT_MS = 3000;

function buildIceServers(): RTCIceServer[] {
  const iceServers: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
  ];
  const turnUrl = process.env.REACT_APP_TURN_URL;
  if (turnUrl) {
    iceServers.push({
      urls: turnUrl,
      username: process.env.REACT_APP_TURN_USERNAME,
      credential: process.env.REACT_APP_TURN_CREDENTIAL,
    });
  }
  return iceServers;
}

function visioPeerId(sessionId: string, userId: string): string {
  const s = sessionId.replace(/[^a-zA-Z0-9]/g, '');
  const u = userId.replace(/[^a-zA-Z0-9]/g, '');
  return `btvisio-${s}-${u}`;
}

export interface RemoteCamera {
  userId: string;
  stream: MediaStream;
}

export interface VideoMeshOptions {
  sessionId: string;
  userId: string;
  active: boolean; // mode Live Visio activé
  maxCameras?: number;
  onLimit?: () => void;
}

export interface VideoMeshReturn {
  ready: boolean;
  cameraOn: boolean;
  localStream: MediaStream | null;
  remoteCameras: RemoteCamera[];
  activeCameraCount: number; // locale + distantes
  // force = true : l'hôte a validé une prise de parole (et libéré une place si besoin) → on ne
  // re-bloque PAS sur la limite locale (le décompte distant peut ne pas être encore propagé).
  startCamera: (force?: boolean) => Promise<boolean>;
  stopCamera: () => void;
  // 🖥️ Partage d'écran (diffusé à tous via le même transport mesh)
  screenOn: boolean;
  localScreen: MediaStream | null;       // l'écran que JE partage
  remoteScreen: RemoteCamera | null;     // l'écran partagé par un autre (reçu)
  startScreen: (stream: MediaStream) => void;
  stopScreen: () => void;
}

export function useVideoMesh(options: VideoMeshOptions): VideoMeshReturn {
  const { sessionId, userId, active, maxCameras = MAX_CAMERAS, onLimit } = options;

  const [ready, setReady] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteCameras, setRemoteCameras] = useState<RemoteCamera[]>([]);
  const [screenOn, setScreenOn] = useState(false);
  const [localScreen, setLocalScreen] = useState<MediaStream | null>(null);
  const [remoteScreen, setRemoteScreen] = useState<RemoteCamera | null>(null);

  const peerRef = useRef<Peer | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const outCallsRef = useRef<Map<string, MediaConnection>>(new Map()); // mes envois caméra → userId
  const outScreenCallsRef = useRef<Map<string, MediaConnection>>(new Map()); // mes envois écran → userId
  const inCallsRef = useRef<Map<string, MediaConnection>>(new Map());  // réceptions ← peerId
  const knownPeersRef = useRef<Set<string>>(new Set()); // userId des pairs visio présents
  const channelRef = useRef<ReturnType<NonNullable<typeof supabase>['channel']> | null>(null);
  const onLimitRef = useRef(onLimit);
  onLimitRef.current = onLimit;
  const cameraOnRef = useRef(false);
  cameraOnRef.current = cameraOn;
  const screenOnRef = useRef(false);
  screenOnRef.current = screenOn;

  const setRemote = useCallback((uid: string, stream: MediaStream) => {
    setRemoteCameras((prev) => {
      const others = prev.filter((c) => c.userId !== uid);
      return [...others, { userId: uid, stream }];
    });
  }, []);
  const removeRemote = useCallback((uid: string) => {
    setRemoteCameras((prev) => prev.filter((c) => c.userId !== uid));
  }, []);

  // Appelle un pair (envoi de MA caméra) — uniquement si j'ai une caméra active
  const callPeer = useCallback((targetUserId: string) => {
    const peer = peerRef.current;
    const stream = localStreamRef.current;
    if (!peer || !peer.open || !stream || targetUserId === userId) return;
    if (outCallsRef.current.has(targetUserId)) return; // déjà en cours
    try {
      const call = peer.call(visioPeerId(sessionId, targetUserId), stream, { metadata: { userId, kind: 'camera' } });
      if (!call) return;
      outCallsRef.current.set(targetUserId, call);
      call.on('close', () => outCallsRef.current.delete(targetUserId));
      call.on('error', () => outCallsRef.current.delete(targetUserId));
    } catch { /* ignore */ }
  }, [sessionId, userId]);

  // 🖥️ Appelle un pair (envoi de MON écran) — uniquement si je partage l'écran
  const callPeerScreen = useCallback((targetUserId: string) => {
    const peer = peerRef.current;
    const stream = screenStreamRef.current;
    if (!peer || !peer.open || !stream || targetUserId === userId) return;
    if (outScreenCallsRef.current.has(targetUserId)) return;
    try {
      const call = peer.call(visioPeerId(sessionId, targetUserId), stream, { metadata: { userId, kind: 'screen' } });
      if (!call) return;
      outScreenCallsRef.current.set(targetUserId, call);
      call.on('close', () => outScreenCallsRef.current.delete(targetUserId));
      call.on('error', () => outScreenCallsRef.current.delete(targetUserId));
    } catch { /* ignore */ }
  }, [sessionId, userId]);

  // Annonce ma présence visio (caméra + écran) sur le canal de signaling
  const announce = useCallback(() => {
    channelRef.current?.send({
      type: 'broadcast',
      event: PRESENCE_EVENT,
      payload: { userId, hasCamera: cameraOnRef.current, hasScreen: screenOnRef.current },
    });
  }, [userId]);

  // ─── Cycle de vie : créer/détruire le Peer + le canal selon `active` ───
  useEffect(() => {
    if (!active || !sessionId || !userId || !supabase) return;

    let cancelled = false;
    const peer = new Peer(visioPeerId(sessionId, userId), {
      debug: 1,
      config: { iceServers: buildIceServers() },
    });
    peerRef.current = peer;

    peer.on('open', () => {
      if (cancelled) return;
      setReady(true);
      announce();
    });

    // Réception d'un flux distant (caméra OU écran, distingué par metadata.kind)
    peer.on('call', (call) => {
      const meta = (call as unknown as { metadata?: { userId?: string; kind?: string } }).metadata;
      const fromUserId = meta?.userId;
      const isScreen = meta?.kind === 'screen';
      call.answer(); // on ne renvoie pas de flux ici (notre envoi est un call séparé)
      inCallsRef.current.set(call.peer, call);
      call.on('stream', (remoteStream) => {
        if (!fromUserId) return;
        if (isScreen) setRemoteScreen({ userId: fromUserId, stream: remoteStream });
        else setRemote(fromUserId, remoteStream);
      });
      const cleanup = () => {
        inCallsRef.current.delete(call.peer);
        if (!fromUserId) return;
        if (isScreen) setRemoteScreen((prev) => (prev && prev.userId === fromUserId ? null : prev));
        else removeRemote(fromUserId);
      };
      call.on('close', cleanup);
      call.on('error', cleanup);
    });

    peer.on('error', (err) => { console.warn('[VISIO] peer error', err?.type || err); });

    // Canal de signaling visio (présence + heartbeat) — ISOLÉ des autres canaux
    const channel = supabase
      .channel(`visio:${sessionId}`)
      .on('broadcast', { event: PRESENCE_EVENT }, (msg) => {
        const p = msg.payload as { userId?: string; hasCamera?: boolean };
        if (!p?.userId || p.userId === userId) return;
        knownPeersRef.current.add(p.userId);
        // si J'AI ma caméra/écran actif, j'envoie le flux à ce pair
        if (cameraOnRef.current) callPeer(p.userId);
        if (screenOnRef.current) callPeerScreen(p.userId);
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') announce();
      });
    channelRef.current = channel;

    const heartbeat = setInterval(announce, HEARTBEAT_MS);

    // Capturer les refs (Maps/Sets stables) pour le cleanup
    const outCalls = outCallsRef.current;
    const outScreenCalls = outScreenCallsRef.current;
    const inCalls = inCallsRef.current;
    const known = knownPeersRef.current;

    return () => {
      cancelled = true;
      clearInterval(heartbeat);
      // Nettoyage STRICT (anti-fuite caméra/écran) : pistes, calls, peer, canal
      outCalls.forEach((c) => { try { c.close(); } catch { /* ignore */ } });
      outCalls.clear();
      outScreenCalls.forEach((c) => { try { c.close(); } catch { /* ignore */ } });
      outScreenCalls.clear();
      inCalls.forEach((c) => { try { c.close(); } catch { /* ignore */ } });
      inCalls.clear();
      known.clear();
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
        localStreamRef.current = null;
      }
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach((t) => t.stop());
        screenStreamRef.current = null;
      }
      try { peer.destroy(); } catch { /* ignore */ }
      peerRef.current = null;
      if (channelRef.current && supabase) { try { supabase.removeChannel(channelRef.current); } catch { /* ignore */ } channelRef.current = null; }
      setReady(false);
      setCameraOn(false);
      setLocalStream(null);
      setRemoteCameras([]);
      setScreenOn(false);
      setLocalScreen(null);
      setRemoteScreen(null);
    };
  }, [active, sessionId, userId, announce, callPeer, callPeerScreen, setRemote, removeRemote]);

  const startCamera = useCallback(async (force = false): Promise<boolean> => {
    if (cameraOnRef.current) return true;
    // Limite : nb de caméras actives (la mienne + distantes) < max — sauf si l'hôte force (place libérée)
    const activeCount = remoteCameras.length + (cameraOnRef.current ? 1 : 0);
    if (!force && activeCount >= maxCameras) {
      onLimitRef.current?.();
      return false;
    }
    if (!navigator.mediaDevices?.getUserMedia) return false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, frameRate: 24 },
        audio: false, // l'audio passe par le canal micro existant (séparé)
      });
      localStreamRef.current = stream;
      setLocalStream(stream);
      setCameraOn(true);
      cameraOnRef.current = true;
      announce();
      // envoyer ma caméra à tous les pairs visio connus
      knownPeersRef.current.forEach((uid) => callPeer(uid));
      return true;
    } catch (err) {
      console.warn('[VISIO] getUserMedia (caméra) échec', err);
      return false;
    }
  }, [remoteCameras.length, maxCameras, announce, callPeer]);

  const stopCamera = useCallback(() => {
    outCallsRef.current.forEach((c) => { try { c.close(); } catch { /* ignore */ } });
    outCallsRef.current.clear();
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    setLocalStream(null);
    setCameraOn(false);
    cameraOnRef.current = false;
    announce();
  }, [announce]);

  // 🖥️ Diffuse un flux d'écran (déjà capturé via getDisplayMedia) à tous les pairs.
  const startScreen = useCallback((stream: MediaStream) => {
    screenStreamRef.current = stream;
    setLocalScreen(stream);
    setScreenOn(true);
    screenOnRef.current = true;
    announce();
    knownPeersRef.current.forEach((uid) => callPeerScreen(uid));
  }, [announce, callPeerScreen]);

  const stopScreen = useCallback(() => {
    outScreenCallsRef.current.forEach((c) => { try { c.close(); } catch { /* ignore */ } });
    outScreenCallsRef.current.clear();
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
    }
    setLocalScreen(null);
    setScreenOn(false);
    screenOnRef.current = false;
    announce();
  }, [announce]);

  return {
    ready,
    cameraOn,
    localStream,
    remoteCameras,
    activeCameraCount: remoteCameras.length + (cameraOn ? 1 : 0),
    startCamera,
    stopCamera,
    screenOn,
    localScreen,
    remoteScreen,
    startScreen,
    stopScreen,
  };
}

export default useVideoMesh;
