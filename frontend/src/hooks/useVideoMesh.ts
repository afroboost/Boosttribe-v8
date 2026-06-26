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
  startCamera: () => Promise<boolean>;
  stopCamera: () => void;
}

export function useVideoMesh(options: VideoMeshOptions): VideoMeshReturn {
  const { sessionId, userId, active, maxCameras = MAX_CAMERAS, onLimit } = options;

  const [ready, setReady] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteCameras, setRemoteCameras] = useState<RemoteCamera[]>([]);

  const peerRef = useRef<Peer | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const outCallsRef = useRef<Map<string, MediaConnection>>(new Map()); // mes envois → userId
  const inCallsRef = useRef<Map<string, MediaConnection>>(new Map());  // réceptions ← userId
  const knownPeersRef = useRef<Set<string>>(new Set()); // userId des pairs visio présents
  const channelRef = useRef<ReturnType<NonNullable<typeof supabase>['channel']> | null>(null);
  const onLimitRef = useRef(onLimit);
  onLimitRef.current = onLimit;
  const cameraOnRef = useRef(false);
  cameraOnRef.current = cameraOn;

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
      const call = peer.call(visioPeerId(sessionId, targetUserId), stream, { metadata: { userId } });
      if (!call) return;
      outCallsRef.current.set(targetUserId, call);
      call.on('close', () => outCallsRef.current.delete(targetUserId));
      call.on('error', () => outCallsRef.current.delete(targetUserId));
    } catch { /* ignore */ }
  }, [sessionId, userId]);

  // Annonce ma présence visio (+ si caméra active) sur le canal de signaling
  const announce = useCallback(() => {
    channelRef.current?.send({
      type: 'broadcast',
      event: PRESENCE_EVENT,
      payload: { userId, hasCamera: cameraOnRef.current },
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

    // Réception d'une caméra distante (envoi unidirectionnel d'un autre pair)
    peer.on('call', (call) => {
      const fromUserId = (call as unknown as { metadata?: { userId?: string } }).metadata?.userId;
      call.answer(); // on ne renvoie pas de flux ici (notre envoi est un call séparé)
      inCallsRef.current.set(call.peer, call);
      call.on('stream', (remoteStream) => {
        if (fromUserId) setRemote(fromUserId, remoteStream);
      });
      const cleanup = () => {
        inCallsRef.current.delete(call.peer);
        if (fromUserId) removeRemote(fromUserId);
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
        // si J'AI ma caméra active, j'envoie ma vidéo à ce pair
        if (cameraOnRef.current) callPeer(p.userId);
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') announce();
      });
    channelRef.current = channel;

    const heartbeat = setInterval(announce, HEARTBEAT_MS);

    // Capturer les refs (Maps/Sets stables) pour le cleanup
    const outCalls = outCallsRef.current;
    const inCalls = inCallsRef.current;
    const known = knownPeersRef.current;

    return () => {
      cancelled = true;
      clearInterval(heartbeat);
      // Nettoyage STRICT (anti-fuite caméra) : pistes, calls, peer, canal
      outCalls.forEach((c) => { try { c.close(); } catch { /* ignore */ } });
      outCalls.clear();
      inCalls.forEach((c) => { try { c.close(); } catch { /* ignore */ } });
      inCalls.clear();
      known.clear();
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
        localStreamRef.current = null;
      }
      try { peer.destroy(); } catch { /* ignore */ }
      peerRef.current = null;
      if (channelRef.current && supabase) { try { supabase.removeChannel(channelRef.current); } catch { /* ignore */ } channelRef.current = null; }
      setReady(false);
      setCameraOn(false);
      setLocalStream(null);
      setRemoteCameras([]);
    };
  }, [active, sessionId, userId, announce, callPeer, setRemote, removeRemote]);

  const startCamera = useCallback(async (): Promise<boolean> => {
    if (cameraOnRef.current) return true;
    // Limite : nb de caméras actives (la mienne + distantes) < max
    const activeCount = remoteCameras.length + (cameraOnRef.current ? 1 : 0);
    if (activeCount >= maxCameras) {
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

  return {
    ready,
    cameraOn,
    localStream,
    remoteCameras,
    activeCameraCount: remoteCameras.length + (cameraOn ? 1 : 0),
    startCamera,
    stopCamera,
  };
}

export default useVideoMesh;
