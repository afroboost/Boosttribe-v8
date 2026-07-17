import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Room,
  RoomEvent,
  Track,
  RemoteTrack,
  RemoteTrackPublication,
  RemoteParticipant,
  Participant,
} from 'livekit-client';
import { supabase } from '@/lib/supabaseClient';
import type { RemoteCamera } from '@/hooks/useVideoMesh';

/**
 * 🎥 useLiveKitStage — Mode "Live / Visio" via LiveKit (SFU), remplaçant du mesh PeerJS (useVideoMesh).
 *
 * Même INTERFACE de sortie que useVideoMesh (cameraOn, localStream, remoteCameras, startCamera,
 * stopCamera, screen*, …) pour ne PAS toucher l'UI existante (grille caméras, bouton micro, spotlight).
 *
 * Modèle : une room LiveKit = une session (room name = sessionId). Deux rôles :
 *   - "stage"  : hôte/co-hôtes (autorisés par le backend) → publient CAMÉRA + ÉCRAN. Max 10.
 *   - "viewer" : spectateurs → s'abonnent seulement (ne publient JAMAIS).
 * La VOIX (micro) reste gérée par le système audio existant (mixeur) : LiveKit ne transporte ici
 * que la VIDÉO (caméra + partage d'écran), pour ne pas dupliquer l'audio ni régresser le mixeur.
 *
 * L'identité LiveKit = userId applicatif (socket userId) → la grille caméra mappe les pistes par cet id.
 */

const API_URL = (import.meta.env.REACT_APP_API_URL || '').replace(/\/$/, '');
const MAX_STAGE = 10;

export interface LiveKitStageOptions {
  sessionId: string;
  userId: string;
  name?: string;
  active: boolean;            // se connecter à la room quand true (Live Visio OU partage écran émis/reçu)
  canPublish: boolean;       // hôte/co-hôte → rôle initial "stage" ; sinon "viewer"
  maxCameras?: number;       // défaut 10 (= MAX_STAGE)
  onLimit?: () => void;      // parité useVideoMesh (limite locale)
  onStageFull?: () => void;  // backend 409 "stage_full" → "Scène pleine (10 max)"
}

export type PromoteResult = 'ok' | 'stage_full' | 'error';

export interface LiveKitStageReturn {
  ready: boolean;
  cameraOn: boolean;
  localStream: MediaStream | null;
  remoteCameras: RemoteCamera[];
  activeCameraCount: number;
  startCamera: (force?: boolean) => Promise<boolean>;
  stopCamera: () => void;
  screenOn: boolean;
  localScreen: MediaStream | null;
  remoteScreen: RemoteCamera | null;
  startScreen: (stream: MediaStream) => void;
  stopScreen: () => void;
  // 🎥 Sélection de caméra (externe) — sans reconnexion (switchActiveDevice / captureOptions).
  videoDevices: MediaDeviceInfo[];
  videoDeviceId: string | null;
  setCameraDevice: (deviceId: string) => Promise<void>;
  refreshVideoDevices: (probe?: boolean) => Promise<void>;
  flipCamera: () => Promise<void>;
  // 🎤 LEVER LA MAIN — actions hôte/co-hôte (accorder/retirer le droit de publier côté SFU)
  promote: (targetUserId: string) => Promise<PromoteResult>;
  demote: (targetUserId: string) => Promise<void>;
}

// Dernière caméra choisie (réutilisée à la prochaine ouverture).
const VIDEO_DEVICE_KEY = 'bt_video_device';

// Récupère un access_token Supabase frais (pour l'autorisation "stage" côté backend). Best-effort.
async function getAuthHeader(): Promise<Record<string, string>> {
  if (!supabase) return {};
  try {
    const { data } = await supabase.auth.getSession();
    let session = data.session;
    const expMs = session?.expires_at ? session.expires_at * 1000 : 0;
    if (!session || expMs - Date.now() < 60_000) {
      const { data: r } = await supabase.auth.refreshSession();
      session = r.session ?? session;
    }
    return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
  } catch {
    return {};
  }
}

export function useLiveKitStage(options: LiveKitStageOptions): LiveKitStageReturn {
  const { sessionId, userId, name, active, canPublish, maxCameras = MAX_STAGE, onStageFull } = options;

  const [ready, setReady] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteCameras, setRemoteCameras] = useState<RemoteCamera[]>([]);
  const [screenOn, setScreenOn] = useState(false);
  const [localScreen, setLocalScreen] = useState<MediaStream | null>(null);
  const [remoteScreen, setRemoteScreen] = useState<RemoteCamera | null>(null);
  // 🎥 Caméras disponibles + périphérique choisi (restauré depuis le dernier choix).
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [videoDeviceId, setVideoDeviceId] = useState<string | null>(() => {
    try { return localStorage.getItem(VIDEO_DEVICE_KEY); } catch { return null; }
  });
  const videoDeviceIdRef = useRef<string | null>(videoDeviceId);
  videoDeviceIdRef.current = videoDeviceId;

  const roomRef = useRef<Room | null>(null);
  const cameraOnRef = useRef(false); cameraOnRef.current = cameraOn;
  const pendingCameraRef = useRef(false);     // caméra demandée mais permission/connexion pas encore prête
  const pendingScreenRef = useRef<MediaStream | null>(null); // écran à publier dès que possible
  const localScreenTracksRef = useRef<MediaStreamTrack[]>([]);
  const screenStreamsRef = useRef<Map<string, MediaStream>>(new Map()); // écran distant par identité
  const onStageFullRef = useRef(onStageFull); onStageFullRef.current = onStageFull;
  const nameRef = useRef(name); nameRef.current = name;

  // ─── Helpers d'état des caméras distantes ───
  const upsertRemoteCamera = useCallback((uid: string, stream: MediaStream) => {
    setRemoteCameras((prev) => [...prev.filter((c) => c.userId !== uid), { userId: uid, stream }]);
  }, []);
  const removeRemoteCamera = useCallback((uid: string) => {
    setRemoteCameras((prev) => prev.filter((c) => c.userId !== uid));
  }, []);
  const removeRemoteScreen = useCallback((uid: string) => {
    const s = screenStreamsRef.current.get(uid);
    if (s) { s.getTracks().forEach((t) => { try { t.stop(); } catch { /* ignore */ } }); screenStreamsRef.current.delete(uid); }
    setRemoteScreen((prev) => (prev && prev.userId === uid ? null : prev));
  }, []);

  // ─── Énumère les caméras. `probe=true` (clic utilisateur) : si les libellés manquent
  //     (permission pas encore accordée), sonde brièvement la caméra pour obtenir les labels
  //     ET faire apparaître une webcam externe fraîchement branchée. `probe=false` = silencieux
  //     (montage / devicechange) : n'ouvre JAMAIS la caméra tout seul. ───
  const refreshVideoDevices = useCallback(async (probe = false): Promise<void> => {
    try {
      let devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
      if (probe && !cameraOnRef.current && (devs.length === 0 || devs.every((d) => !d.label))) {
        try {
          const p = await navigator.mediaDevices.getUserMedia({ video: true });
          p.getTracks().forEach((t) => { try { t.stop(); } catch { /* ignore */ } });
          devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
        } catch { /* permission refusée → on garde ce qu'on a */ }
      }
      setVideoDevices(devs);
    } catch { /* ignore */ }
  }, []);

  // ─── Publier réellement la caméra (suppose la permission accordée) ───
  //     Utilise le périphérique choisi (caméra externe) ; repli propre si indisponible.
  const publishCamera = useCallback(async (): Promise<boolean> => {
    const room = roomRef.current;
    if (!room) return false;
    const enable = (deviceId?: string | null) =>
      room.localParticipant.setCameraEnabled(true, deviceId ? { deviceId: { exact: deviceId } } : undefined);
    try {
      const wanted = videoDeviceIdRef.current;
      try {
        await enable(wanted);
      } catch (e) {
        // Caméra choisie indisponible (débranchée / refusée) → repli caméra par défaut, on oublie le choix.
        if (wanted) {
          videoDeviceIdRef.current = null; setVideoDeviceId(null);
          try { localStorage.removeItem(VIDEO_DEVICE_KEY); } catch { /* ignore */ }
          await enable(null);
        } else { throw e; }
      }
      const pub = room.localParticipant.getTrackPublication(Track.Source.Camera);
      const mst = pub?.track?.mediaStreamTrack;
      if (mst) { setLocalStream(new MediaStream([mst])); }
      setCameraOn(true);
      cameraOnRef.current = true;
      refreshVideoDevices();   // labels désormais disponibles (permission accordée)
      return true;
    } catch (err) {
      console.warn('[LIVEKIT] activation caméra échouée', err);
      return false;
    }
  }, [refreshVideoDevices]);

  // ─── Publier les pistes d'un flux d'écran déjà capturé (suppose la permission accordée) ───
  const publishScreen = useCallback((stream: MediaStream): boolean => {
    const room = roomRef.current;
    if (!room || !room.localParticipant.permissions?.canPublish) return false;
    const tracks: MediaStreamTrack[] = [];
    stream.getVideoTracks().forEach((t) => {
      room.localParticipant.publishTrack(t, { source: Track.Source.ScreenShare, name: 'screen' }).catch(() => { /* ignore */ });
      tracks.push(t);
    });
    stream.getAudioTracks().forEach((t) => {
      room.localParticipant.publishTrack(t, { source: Track.Source.ScreenShareAudio, name: 'screen-audio' }).catch(() => { /* ignore */ });
      tracks.push(t);
    });
    localScreenTracksRef.current = tracks;
    return true;
  }, []);

  // ─── Récupère un token et se connecte (ou se reconnecte) avec le rôle demandé ───
  const fetchToken = useCallback(async (role: 'stage' | 'viewer'): Promise<{ token: string; url: string } | 'stage_full' | null> => {
    if (!API_URL) return null;
    try {
      const res = await fetch(`${API_URL}/livekit/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getAuthHeader()) },
        body: JSON.stringify({ session_id: sessionId, identity: userId, name: nameRef.current || userId, role }),
      });
      if (res.status === 409) return 'stage_full';
      if (!res.ok) return null;
      const data = await res.json();
      return data?.token && data?.url ? { token: data.token, url: data.url } : null;
    } catch {
      return null;
    }
  }, [sessionId, userId]);

  // ─── Cycle de vie : connexion à la room selon `active` + rôle initial (canPublish) ───
  useEffect(() => {
    if (!active || !sessionId || !userId || !API_URL) return;

    let cancelled = false;
    const room = new Room({ adaptiveStream: true, dynacast: true });
    roomRef.current = room;
    const screenStreams = screenStreamsRef.current; // référence stable (jamais réassignée) pour le cleanup

    const handleSubscribed = (track: RemoteTrack, pub: RemoteTrackPublication, participant: RemoteParticipant) => {
      if (track.kind !== Track.Kind.Video) return; // l'audio reste géré par le système existant
      const uid = participant.identity;
      const mst = track.mediaStreamTrack;
      if (pub.source === Track.Source.ScreenShare) {
        let s = screenStreamsRef.current.get(uid);
        if (!s) { s = new MediaStream(); screenStreamsRef.current.set(uid, s); }
        s.addTrack(mst);
        setRemoteScreen({ userId: uid, stream: s });
      } else {
        upsertRemoteCamera(uid, new MediaStream([mst]));
      }
    };
    const handleUnsubscribed = (_t: RemoteTrack, pub: RemoteTrackPublication, participant: RemoteParticipant) => {
      const uid = participant.identity;
      if (pub.source === Track.Source.ScreenShare) removeRemoteScreen(uid);
      else if (pub.source === Track.Source.Camera) removeRemoteCamera(uid);
    };
    const handleParticipantLeft = (participant: RemoteParticipant) => {
      removeRemoteCamera(participant.identity);
      removeRemoteScreen(participant.identity);
    };
    // Promu par l'hôte (permission de publier accordée) → publier la caméra en attente
    const handlePermissions = (_prev: unknown, participant: Participant) => {
      if (participant !== room.localParticipant) return;
      if (!room.localParticipant.permissions?.canPublish) return;
      if (pendingCameraRef.current) {
        pendingCameraRef.current = false;
        publishCamera().catch(() => { /* ignore */ });
      }
      if (pendingScreenRef.current) {
        const s = pendingScreenRef.current;
        pendingScreenRef.current = null;
        publishScreen(s);
      }
    };

    room
      .on(RoomEvent.TrackSubscribed, handleSubscribed)
      .on(RoomEvent.TrackUnsubscribed, handleUnsubscribed)
      .on(RoomEvent.ParticipantDisconnected, handleParticipantLeft)
      .on(RoomEvent.ParticipantPermissionsChanged, handlePermissions)
      .on(RoomEvent.Disconnected, () => { if (!cancelled) setReady(false); });

    (async () => {
      // Rôle initial : hôte/co-hôte → stage ; sinon viewer. Repli viewer si 409/échec stage.
      let creds: { token: string; url: string } | 'stage_full' | null = null;
      if (canPublish) {
        creds = await fetchToken('stage');
        if (creds === 'stage_full') { onStageFullRef.current?.(); creds = await fetchToken('viewer'); }
      }
      if (!creds || creds === 'stage_full') creds = await fetchToken('viewer');
      if (!creds || creds === 'stage_full' || cancelled) return;
      try {
        await room.connect(creds.url, creds.token);
        if (cancelled) { await room.disconnect(); return; }
        setReady(true);
        // Vider les publications différées (caméra/écran demandés avant la fin de la connexion).
        if (room.localParticipant.permissions?.canPublish) {
          if (pendingCameraRef.current) { pendingCameraRef.current = false; publishCamera().catch(() => { /* ignore */ }); }
          if (pendingScreenRef.current) { const s = pendingScreenRef.current; pendingScreenRef.current = null; publishScreen(s); }
        }
      } catch (err) {
        console.warn('[LIVEKIT] connexion échouée', err);
      }
    })();

    return () => {
      cancelled = true;
      try { room.disconnect(); } catch { /* ignore */ }
      roomRef.current = null;
      localScreenTracksRef.current = [];
      screenStreams.forEach((s) => s.getTracks().forEach((t) => { try { t.stop(); } catch { /* ignore */ } }));
      screenStreams.clear();
      pendingCameraRef.current = false;
      pendingScreenRef.current = null;
      setReady(false);
      setCameraOn(false);
      setLocalStream(null);
      setRemoteCameras([]);
      setScreenOn(false);
      setLocalScreen(null);
      setRemoteScreen(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, sessionId, userId, canPublish]);

  const startCamera = useCallback(async (_force = false): Promise<boolean> => {
    const room = roomRef.current;
    if (!room) { pendingCameraRef.current = true; return true; }
    if (cameraOnRef.current) return true;
    // Déjà autorisé à publier (hôte/co-hôte) → on publie tout de suite.
    if (room.localParticipant.permissions?.canPublish) {
      return publishCamera();
    }
    // Sinon : viewer en attente de promotion par l'hôte → publiera dès la permission accordée.
    pendingCameraRef.current = true;
    return true;
  }, [publishCamera]);

  const stopCamera = useCallback(() => {
    const room = roomRef.current;
    pendingCameraRef.current = false;
    if (room) { try { room.localParticipant.setCameraEnabled(false); } catch { /* ignore */ } }
    setLocalStream(null);
    setCameraOn(false);
    cameraOnRef.current = false;
  }, []);

  // ─── Choisir une caméra (externe) — SANS reconnexion : switchActiveDevice remplace la piste
  //     en direct (les pairs voient le nouveau flux). Si la caméra n'est pas encore allumée, on
  //     mémorise juste le choix (utilisé au prochain publishCamera). ───
  const setCameraDevice = useCallback(async (deviceId: string): Promise<void> => {
    videoDeviceIdRef.current = deviceId;
    setVideoDeviceId(deviceId);
    try { localStorage.setItem(VIDEO_DEVICE_KEY, deviceId); } catch { /* ignore */ }
    const room = roomRef.current;
    if (!room || !cameraOnRef.current) return; // caméra éteinte → sera pris en compte à l'allumage
    try {
      await room.switchActiveDevice('videoinput', deviceId);
      const pub = room.localParticipant.getTrackPublication(Track.Source.Camera);
      const mst = pub?.track?.mediaStreamTrack;
      if (mst) { setLocalStream(new MediaStream([mst])); }
    } catch (err) {
      console.warn('[LIVEKIT] changement de caméra échoué (périphérique indisponible ?)', err);
    }
  }, []);

  // ─── Bascule rapide (mobile) : passe à la caméra suivante (avant/arrière) ───
  const flipCamera = useCallback(async (): Promise<void> => {
    let devs = videoDevices;
    if (devs.length < 2) {
      try { devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput'); } catch { /* ignore */ }
    }
    if (devs.length < 2) return;
    const cur = videoDeviceIdRef.current;
    const idx = Math.max(0, devs.findIndex((d) => d.deviceId === cur));
    const next = devs[(idx + 1) % devs.length];
    if (next) await setCameraDevice(next.deviceId);
  }, [videoDevices, setCameraDevice]);

  // ─── Rafraîchit la liste quand une caméra est branchée/débranchée ───
  useEffect(() => {
    const handler = () => { refreshVideoDevices(); };
    try { navigator.mediaDevices.addEventListener('devicechange', handler); } catch { /* ignore */ }
    return () => { try { navigator.mediaDevices.removeEventListener('devicechange', handler); } catch { /* ignore */ } };
  }, [refreshVideoDevices]);

  // ─── Partage d'écran : publie le flux déjà capturé (getDisplayMedia) par l'appelant ───
  // Si la room n'est pas encore connectée/autorisée, on diffère la publication (pendingScreenRef).
  const startScreen = useCallback((stream: MediaStream) => {
    setLocalScreen(stream);
    setScreenOn(true);
    if (!publishScreen(stream)) pendingScreenRef.current = stream;
  }, [publishScreen]);

  const stopScreen = useCallback(() => {
    const room = roomRef.current;
    pendingScreenRef.current = null;
    if (room) {
      localScreenTracksRef.current.forEach((t) => { try { room.localParticipant.unpublishTrack(t); } catch { /* ignore */ } });
    }
    localScreenTracksRef.current = [];
    setLocalScreen(null);
    setScreenOn(false);
  }, []);

  // ─── LEVER LA MAIN — l'hôte/co-hôte accorde (promote) / retire (demote) le droit de publier ───
  const promote = useCallback(async (targetUserId: string): Promise<PromoteResult> => {
    if (!API_URL) return 'error';
    try {
      const res = await fetch(`${API_URL}/livekit/promote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getAuthHeader()) },
        body: JSON.stringify({ session_id: sessionId, identity: targetUserId }),
      });
      if (res.status === 409) return 'stage_full';
      return res.ok ? 'ok' : 'error';
    } catch {
      return 'error';
    }
  }, [sessionId]);

  const demote = useCallback(async (targetUserId: string): Promise<void> => {
    if (!API_URL) return;
    try {
      await fetch(`${API_URL}/livekit/demote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getAuthHeader()) },
        body: JSON.stringify({ session_id: sessionId, identity: targetUserId }),
      });
    } catch { /* ignore */ }
  }, [sessionId]);

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
    videoDevices,
    videoDeviceId,
    setCameraDevice,
    refreshVideoDevices,
    flipCamera,
    promote,
    demote,
  };
}

export default useLiveKitStage;
