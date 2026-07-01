import { useState, useCallback, useRef, useEffect } from 'react';
import Peer, { MediaConnection, DataConnection } from 'peerjs';

// Types
export interface PeerState {
  isConnected: boolean;
  isHost: boolean;
  peerId: string | null;
  hostPeerId: string | null;
  connectedPeers: string[];
  error: string | null;
  isBroadcasting: boolean;
  isReady: boolean;
  isReceivingVoice: boolean; // NEW: Indicator for participants receiving voice
  // POINT B : userId des AUTRES participants dont on reçoit la voix (relayée par l'hôte)
  remoteMicUsers: string[];
}

export interface UsePeerAudioOptions {
  sessionId: string;
  isHost: boolean;
  userId?: string; // POINT 3 : identité du participant (envoyée à l'hôte → ciblage "parler en privé")
  onPeerConnected?: (peerId: string) => void;
  onPeerDisconnected?: (peerId: string) => void;
  onReceiveAudio?: (stream: MediaStream) => void;
  onVoiceStart?: () => void; // NEW: Called when voice reception starts
  onVoiceEnd?: () => void;   // NEW: Called when voice reception ends
  // 👥 POINT 5: l'hôte reçoit le micro montant d'un participant ("Prendre la parole")
  onReceiveTribeAudio?: (stream: MediaStream, peerId: string) => void;
  onTribeAudioEnd?: (peerId: string) => void;
  onError?: (error: string) => void;
  onReady?: () => void;
}

export interface UsePeerAudioReturn {
  state: PeerState;
  connect: (stream?: MediaStream | null) => Promise<boolean>;
  disconnect: () => void;
  broadcastAudio: (stream: MediaStream) => void;
  stopBroadcast: () => void;
  // 🎤 POINT 5: participant envoie son micro à l'hôte / arrête
  talkToHost: (stream: MediaStream) => void;
  stopTalkToHost: () => void;
  // 🔊 POINT 1.6: volume des voix participants (tribu) côté hôte
  setTribeVolume: (volume: number) => void;
  setHostVoiceVolume: (volume: number) => void;
  // 🎙️ POINT 3 (hôte) : restreindre sa voix à une sélection de participants (null = tout le monde)
  setPrivateTargets: (userIds: string[] | null) => void;
  // 🔊 POINT B (participant) : volume de la voix d'un AUTRE participant (relayée)
  setRemoteMicVolume: (userId: string, volume: number) => void;
  // 🔊 P4 (hôte) : volume d'un participant précis (0..2.5) → GainNode Web Audio
  setTribeUserVolume: (userId: string, volume: number) => void;
  // 🔇 P4 (hôte) : couper RÉELLEMENT un participant pour tout le monde (gain 0 + relais coupé)
  setTribeUserMuted: (userId: string, muted: boolean) => void;
  reconnect: () => Promise<boolean>;
  remoteAudioRef: React.RefObject<HTMLAudioElement | null>;
}

const initialState: PeerState = {
  isConnected: false,
  isHost: false,
  peerId: null,
  hostPeerId: null,
  connectedPeers: [],
  error: null,
  isBroadcasting: false,
  isReady: false,
  isReceivingVoice: false,
  remoteMicUsers: [],
};

// Audio element ID for remote voice
const REMOTE_AUDIO_ID = 'remote-voice-audio';

/**
 * Construit la liste des serveurs ICE : STUN publics (toujours) + TURN optionnel
 * activable SANS recompiler la logique, via variables d'environnement :
 *   REACT_APP_TURN_URL, REACT_APP_TURN_USERNAME, REACT_APP_TURN_CREDENTIAL
 */
function buildIceServers(): RTCIceServer[] {
  const iceServers: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    { urls: 'stun:stun.stunprotocol.org:3478' },
  ];

  const turnUrl = import.meta.env.REACT_APP_TURN_URL;
  if (turnUrl) {
    iceServers.push({
      urls: turnUrl,
      username: import.meta.env.REACT_APP_TURN_USERNAME,
      credential: import.meta.env.REACT_APP_TURN_CREDENTIAL,
    });
  }

  return iceServers;
}

// Classe commune des éléments audio "tribu" (voix montante des participants chez l'hôte)
const TRIBE_AUDIO_CLASS = 'bt-tribe-audio';

// 🔊 P4 : amplification réelle des voix distantes via GainNode (au-delà du plafond 1.0 de
// HTMLAudioElement.volume). Niveaux par défaut RELEVÉS pour passer au-dessus de la musique/vidéo.
const TRIBE_DEFAULT_GAIN = 1.6; // voix d'un participant entendue par l'hôte
const RELAY_DEFAULT_GAIN = 1.4; // voix d'un autre participant (relayée) entendue par un participant
const HOST_VOICE_DEFAULT_GAIN = 1.4; // voix de l'hôte entendue par les participants (au-dessus de la musique)
const VOICE_MAX_GAIN = 2.5;     // plafond d'amplification (≈250%)

// 🍏 iOS (#7 / 3d) : mêmes contraintes que la MUSIQUE — NE PAS router la voix reçue de l'hôte dans
//   Web Audio (un AudioContext se SUSPEND écran verrouillé / onglet en arrière-plan et rend l'élément
//   routé MUET). Sur iOS, l'élément <audio playsinline> joue DIRECTEMENT sur le matériel → la lecture
//   (voix + musique partagée véhiculées par ce flux) continue en arrière-plan. Compromis assumé :
//   pas de boost > 100% de la voix hôte sur iPhone, au profit de la continuité en arrière-plan.
const IS_IOS = typeof navigator !== 'undefined' && (
  /iP(hone|ad|od)/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && (navigator as unknown as { maxTouchPoints?: number }).maxTouchPoints ? ((navigator as unknown as { maxTouchPoints: number }).maxTouchPoints > 1) : false)
);

/**
 * POINT 1.3 : crée/récupère un <audio autoplay playsinline> DÉDIÉ par participant qui parle.
 * La voix distante est jouée en direct (aucun Web Audio, aucun buffer) → latence minimale.
 */
function getOrCreateTribeAudioElement(peerId: string): HTMLAudioElement {
  const id = `tribe-audio-${peerId}`;
  let el = document.getElementById(id) as HTMLAudioElement;
  if (!el) {
    el = document.createElement('audio');
    el.id = id;
    el.className = TRIBE_AUDIO_CLASS;
    el.autoplay = true;
    el.setAttribute('playsinline', 'true');
    el.controls = false;
    el.style.display = 'none';
    document.body.appendChild(el);
  }
  return el;
}

function removeTribeAudioElement(peerId: string): void {
  const el = document.getElementById(`tribe-audio-${peerId}`);
  if (el) {
    (el as HTMLAudioElement).srcObject = null;
    el.remove();
  }
}

// POINT B : <audio> dédié à la voix d'un AUTRE participant (relayée par l'hôte), 1 par userId source.
const RELAY_AUDIO_CLASS = 'bt-relay-audio';
function getOrCreateRelayAudioElement(fromUserId: string): HTMLAudioElement {
  const id = `relay-audio-${fromUserId}`;
  let el = document.getElementById(id) as HTMLAudioElement;
  if (!el) {
    el = document.createElement('audio');
    el.id = id;
    el.className = RELAY_AUDIO_CLASS;
    el.autoplay = true;
    el.setAttribute('playsinline', 'true');
    el.controls = false;
    el.style.display = 'none';
    document.body.appendChild(el);
  }
  return el;
}
function removeRelayAudioElement(fromUserId: string): void {
  const el = document.getElementById(`relay-audio-${fromUserId}`);
  if (el) {
    (el as HTMLAudioElement).srcObject = null;
    el.remove();
  }
}

/**
 * Create or get the remote audio element for voice playback
 * This element plays the host's voice on participant devices
 */
function getOrCreateRemoteAudioElement(): HTMLAudioElement {
  let audioEl = document.getElementById(REMOTE_AUDIO_ID) as HTMLAudioElement;
  
  if (!audioEl) {
    // Production: log removed
    audioEl = document.createElement('audio');
    audioEl.id = REMOTE_AUDIO_ID;
    audioEl.autoplay = true;        // Auto-play when stream is attached
    audioEl.setAttribute('playsinline', 'true'); // Required for iOS
    audioEl.controls = false;       // Hidden
    audioEl.volume = 1.0;           // Full volume for voice
    audioEl.style.display = 'none'; // Hidden element
    document.body.appendChild(audioEl);
  }
  
  return audioEl;
}

/**
 * Hook for WebRTC audio broadcasting using PeerJS
 * Host broadcasts voice to all participants
 * Participants receive and play voice through speakers
 */
export function usePeerAudio(options: UsePeerAudioOptions): UsePeerAudioReturn {
  const {
    sessionId,
    isHost,
    userId,
    onPeerConnected,
    onPeerDisconnected,
    onReceiveAudio,
    onVoiceStart,
    onVoiceEnd,
    onReceiveTribeAudio,
    onTribeAudioEnd,
    onError,
    onReady,
  } = options;

  const [state, setState] = useState<PeerState>({
    ...initialState,
    isHost,
  });

  // Refs
  const peerRef = useRef<Peer | null>(null);
  const connectionsRef = useRef<Map<string, MediaConnection>>(new Map());
  const currentStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const dataConnectionsRef = useRef<Map<string, DataConnection>>(new Map());
  const reconnectAttempts = useRef(0);
  const maxReconnectAttempts = 3;
  // 🔁 P5 : fiabilisation du micro. Ref vers la dernière `connect` (appelée depuis les handlers d'erreur),
  //    compteur de reprise de l'ID hôte fixe (unavailable-id : l'ancien peer met un instant à se libérer),
  //    et compteur de (re)connexion du canal data vers l'hôte (peer-unavailable : hôte pas encore prêt).
  const connectRef = useRef<((stream?: MediaStream | null) => Promise<boolean>) | null>(null);
  const idRetryRef = useRef(0);
  const hostDataRetryRef = useRef(0);
  const MAX_ID_RETRIES = 5;
  const MAX_HOST_DATA_RETRIES = 15;
  const activeCallRef = useRef<MediaConnection | null>(null);
  // 🎤 POINT 5: appel montant du participant vers l'hôte ("Prendre la parole")
  const upstreamCallRef = useRef<MediaConnection | null>(null);
  // 👥 POINT 5: appels tribu entrants reçus par l'hôte (un par participant qui parle)
  const tribeCallsRef = useRef<Map<string, MediaConnection>>(new Map());
  // 🔊 POINT 1.6: volume "Volume Tribu" appliqué directement aux <audio> tribu (zéro latence)
  const tribeVolumeRef = useRef<number>(1);
  // 🔊 "Volume Hôte" (participant) : gain de la voix de l'hôte (défaut boosté > 100%)
  const hostVoiceVolumeRef = useRef<number>(HOST_VOICE_DEFAULT_GAIN);
  // 🎙️ POINT 3 : identité du participant (pour le ciblage "parler en privé")
  const userIdRef = useRef<string | undefined>(userId);
  userIdRef.current = userId;
  // 🎙️ POINT 3 (hôte) : mapping peerId WebRTC → userId du participant, et sélection privée courante
  const peerIdToUserIdRef = useRef<Map<string, string>>(new Map());
  const privateTargetsRef = useRef<Set<string> | null>(null); // null = parler à TOUT le monde
  // POINT B (hôte) : relais des voix participants → relayCalls clé `${fromPeerId}__${toPeerId}`
  const relayCallsRef = useRef<Map<string, MediaConnection>>(new Map());
  // POINT B (participant) : volume choisi par flux relay (userId → 0..2.5)
  const relayVolumesRef = useRef<Map<string, number>>(new Map());

  // 🔊 P4 : AudioContext + GainNodes pour amplifier les voix distantes au-delà de 100%.
  const voiceCtxRef = useRef<AudioContext | null>(null);
  // Hôte : un nœud par participant qui parle (peerId → source/gain/élément)
  const tribeNodesRef = useRef<Map<string, { source: MediaStreamAudioSourceNode; gain: GainNode; el: HTMLAudioElement }>>(new Map());
  const tribeUserVolumeRef = useRef<Map<string, number>>(new Map()); // userId → gain 0..2.5
  const tribeUserMutedRef = useRef<Set<string>>(new Set());          // userId coupés par l'hôte
  // Participant : un nœud par voix d'autre participant relayée (fromUserId → source/gain/élément)
  const relayNodesRef = useRef<Map<string, { source: MediaStreamAudioSourceNode; gain: GainNode; el: HTMLAudioElement }>>(new Map());
  // 🔊 Sortie maître des voix : (gains) → master → compresseur → destination (puissance perçue + headroom)
  const voiceMasterRef = useRef<GainNode | null>(null);
  const voiceCompRef = useRef<DynamicsCompressorNode | null>(null);
  const voiceResumeBoundRef = useRef(false); // listener "reprise au geste" attaché une seule fois
  // Participant : voix de l'HÔTE routée via GainNode (amplification réelle > 100%)
  const hostVoiceNodeRef = useRef<{ source: MediaStreamAudioSourceNode; gain: GainNode; el: HTMLAudioElement } | null>(null);

  // Update state helper
  const updateState = useCallback((updates: Partial<PeerState>) => {
    setState(prev => ({ ...prev, ...updates }));
  }, []);

  // 🔊 P4 : AudioContext partagé (lazy) pour router les voix distantes via GainNode.
  // Inclut une sortie maître (gain + compresseur léger) pour une puissance perçue franche sans clipping.
  const ensureVoiceCtx = useCallback((): AudioContext | null => {
    try {
      if (!voiceCtxRef.current) {
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        voiceCtxRef.current = new Ctx();
      }
      const ctx = voiceCtxRef.current;
      if (!voiceMasterRef.current) {
        const master = ctx.createGain();
        master.gain.value = 1.25; // léger gain de sortie (makeup)
        const comp = ctx.createDynamicsCompressor();
        // 🔊 3c : limiteur QUASI TRANSPARENT (brickwall proche de 0 dBFS), plus un compresseur qui
        //   écrase le volume. L'ancien réglage (seuil -18 dB, ratio 3) compressait la voix ~3:1 dès
        //   -18 dB → voix des participants/hôte perçue FAIBLE. Ici on ne rattrape que les toutes
        //   dernières crêtes pour éviter la distorsion quand les voix sont poussées (1.4×..2.5×).
        comp.threshold.value = -1.5;
        comp.knee.value = 0;
        comp.ratio.value = 20;
        comp.attack.value = 0.002;
        comp.release.value = 0.1;
        master.connect(comp);
        comp.connect(ctx.destination);
        voiceMasterRef.current = master;
        voiceCompRef.current = comp;
      }
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => { /* ignore */ });
        // Filet de sécurité : reprendre au prochain geste utilisateur (politique autoplay)
        if (!voiceResumeBoundRef.current) {
          voiceResumeBoundRef.current = true;
          const resume = () => { voiceCtxRef.current?.resume().catch(() => { /* ignore */ }); };
          document.addEventListener('click', resume);
          document.addEventListener('touchstart', resume, { passive: true });
        }
      }
      return ctx;
    } catch { return null; }
  }, []);

  // Nœud de sortie où brancher les gains de voix (master si dispo, sinon destination directe).
  const voiceOutput = useCallback((ctx: AudioContext): AudioNode => voiceMasterRef.current || ctx.destination, []);

  // 🔊 P4 (hôte) : gain effectif d'un participant = (coupé ? 0 : son volume) × Volume Tribu maître.
  const tribeEffectiveGain = useCallback((userId?: string): number => {
    if (userId && tribeUserMutedRef.current.has(userId)) return 0;
    const base = (userId && tribeUserVolumeRef.current.has(userId))
      ? tribeUserVolumeRef.current.get(userId)!
      : TRIBE_DEFAULT_GAIN;
    return base * tribeVolumeRef.current;
  }, []);

  // 🔊 P4 : déconnecte le nœud Web Audio d'un participant (à la fin de sa prise de parole).
  const cleanupTribeNode = useCallback((peerId: string) => {
    const node = tribeNodesRef.current.get(peerId);
    if (node) {
      try { node.source.disconnect(); } catch { /* ignore */ }
      try { node.gain.disconnect(); } catch { /* ignore */ }
      tribeNodesRef.current.delete(peerId);
    }
  }, []);

  // Generate peer ID based on session and role
  const generatePeerId = useCallback((forHost: boolean) => {
    const cleanSessionId = sessionId.replace(/[^a-zA-Z0-9]/g, '');
    if (forHost) {
      return `beattribe-host-${cleanSessionId}`;
    }
    return `beattribe-${cleanSessionId}-${Date.now().toString(36)}`;
  }, [sessionId]);

  // Get host peer ID
  const getHostPeerId = useCallback(() => {
    const cleanSessionId = sessionId.replace(/[^a-zA-Z0-9]/g, '');
    return `beattribe-host-${cleanSessionId}`;
  }, [sessionId]);

  /**
   * Force play the remote audio element
   * Handles autoplay restrictions
   */
  const forcePlayRemoteAudio = useCallback(async (audioEl: HTMLAudioElement, stream: MediaStream) => {
    // Production: log removed
    
    // Attach stream — voix de l'hôte routée via GainNode (amplification réelle > 100%),
    // fallback element.volume si Web Audio indisponible.
    audioEl.srcObject = stream;
    // 🍏 3d : sur iOS, NE PAS router via Web Audio (contexte suspendu écran verrouillé = muet).
    //   L'élément <audio playsinline> joue en direct → voix/musique partagée continuent en arrière-plan.
    const ctx = IS_IOS ? null : ensureVoiceCtx();
    let routed = false;
    if (ctx) {
      try {
        if (hostVoiceNodeRef.current) {
          try { hostVoiceNodeRef.current.source.disconnect(); } catch { /* ignore */ }
          try { hostVoiceNodeRef.current.gain.disconnect(); } catch { /* ignore */ }
          hostVoiceNodeRef.current = null;
        }
        const source = ctx.createMediaStreamSource(stream);
        const gain = ctx.createGain();
        gain.gain.value = hostVoiceVolumeRef.current;
        source.connect(gain);
        gain.connect(voiceOutput(ctx));
        hostVoiceNodeRef.current = { source, gain, el: audioEl };
        audioEl.muted = true; // sortie via Web Audio
        routed = true;
      } catch { routed = false; }
    }
    if (!routed) {
      audioEl.muted = false;
      audioEl.volume = Math.min(1, hostVoiceVolumeRef.current);
    }

    // Force play
    try {
      await audioEl.play();
      // Production: log removed
      updateState({ isReceivingVoice: true });
      onVoiceStart?.();
      return true;
    } catch (err) {
      console.warn('[PEER] ⚠️ Autoplay blocked:', err);
      
      // Try again with user interaction workaround
      const playOnClick = async () => {
        try {
          await audioEl.play();
          // Production: log removed
          updateState({ isReceivingVoice: true });
          onVoiceStart?.();
          document.removeEventListener('click', playOnClick);
        } catch (e) {
          console.error('[PEER] ❌ Still cannot play:', e);
        }
      };
      
      document.addEventListener('click', playOnClick, { once: true });
      // Production: log removed
      return false;
    }
  }, [updateState, onVoiceStart, ensureVoiceCtx, voiceOutput]);

  /**
   * Connect to PeerJS server
   * @param stream - Optional MediaStream for host broadcasting
   */
  const connect = useCallback(async (stream?: MediaStream | null): Promise<boolean> => {
    // ⚠️ OBJECTIF A: l'hôte se connecte au peer dès l'entrée en session, SANS exiger de flux micro.
    // Son peer doit pouvoir RÉPONDRE aux appels entrants (prise de parole participant) même micro coupé.
    // Le flux micro hôte est ajouté/retiré ensuite via broadcastAudio/stopBroadcast.

    // 🔁 3a : le peer est peut-être déjà ouvert, mais avec la MAUVAISE identité pour le rôle courant.
    //   Cause racine du symptôme « coach non-admin inaudible » : le rôle (isHost) d'un coach est
    //   résolu de façon ASYNCHRONE (fetch backend). Si connect() s'exécute pendant que isHost vaut
    //   encore false, le peer s'ouvre avec une identité PARTICIPANT (beattribe-<session>-<ts>) et des
    //   handlers figés en mode participant. Quand isHost passe ensuite à true, l'ancien `return true`
    //   ci-dessous empêchait toute recréation → le coach ne revendiquait JAMAIS l'ID hôte fixe
    //   `beattribe-host-<session>`. Les participants s'y connectent mais n'atteignent jamais le coach
    //   (dataConnectionsRef reste vide côté coach) : son micro est bien capté (niveau d'entrée qui
    //   bouge) mais broadcastAudio n'a personne à appeler → participants muets. Chez l'admin, isHost
    //   est vrai dès le départ → peer créé directement en hôte → ça marche. On détecte le décalage
    //   d'identité et on RECRÉE le peer avec la bonne identité.
    if (peerRef.current?.open) {
      const isHostPeer = peerRef.current.id === getHostPeerId();
      if (isHost === isHostPeer) {
        return true; // identité cohérente avec le rôle → rien à faire
      }
      // Rôle changé après ouverture → détruire et recréer avec la bonne identité (hôte/participant)
      try { peerRef.current.destroy(); } catch { /* ignore */ }
      peerRef.current = null;
    }

    // Destroy existing peer if not open
    if (peerRef.current) {
      // Production: log removed
      peerRef.current.destroy();
      peerRef.current = null;
    }

    return new Promise((resolve) => {
      try {
        const peerId = generatePeerId(isHost);
        const hostPeerId = getHostPeerId();

        // Production: log removed
        // Production: log removed
        // Production: log removed
        // Production: log removed

        // Create peer with robust STUN servers (+ TURN optionnel via variables d'env)
        const peer = new Peer(peerId, {
          debug: 2,
          config: {
            iceServers: buildIceServers(),
          },
        });

        peerRef.current = peer;

        // 🔁 P5 (participant) : (re)connexion du canal data vers l'hôte, RETENTABLE. Si l'hôte n'est pas
        //    encore en ligne (peer-unavailable), on relance jusqu'à ce qu'il réponde → l'hôte reçoit
        //    alors la dataConn et rappelle le participant avec sa voix (fin des « participants inaudibles »).
        const connectToHost = () => {
          if (isHost || !peerRef.current || peerRef.current.destroyed) return;
          if (dataConnectionsRef.current.has(hostPeerId)) return; // déjà connecté
          try {
            // POINT 3 : on transmet l'userId à l'hôte (metadata) → ciblage "parler en privé"
            const dataConn = peerRef.current.connect(hostPeerId, { metadata: { userId: userIdRef.current } });
            dataConn.on('open', () => {
              hostDataRetryRef.current = 0;
              dataConnectionsRef.current.set(hostPeerId, dataConn);
            });
            dataConn.on('error', (err) => {
              console.warn('[PEER] ⚠️ Data connection error:', err);
            });
          } catch { /* réessayé via le handler d'erreur peer-unavailable */ }
        };

        // Handle peer open
        peer.on('open', (id) => {
          // Production: log removed
          reconnectAttempts.current = 0;
          idRetryRef.current = 0; // 🔁 P5 : l'ID hôte a été obtenu → on remet le compteur à zéro

          updateState({
            isConnected: true,
            peerId: id,
            hostPeerId,
            error: null,
            isReady: true,
          });

          // Host: peer prêt (avec ou sans flux). Le flux éventuel est mémorisé pour diffusion.
          if (isHost) {
            if (stream) {
              currentStreamRef.current = stream;
            }
            onReady?.();
          }

          // Participant: Connect to host for data channel (retentable)
          if (!isHost) {
            hostDataRetryRef.current = 0;
            connectToHost();
          }

          resolve(true);
        });

        // ========================================
        // Handle incoming media calls (rôle-dépendant)
        // ========================================
        peer.on('call', (call) => {
          // 👥 HÔTE: appel entrant = un participant "prend la parole".
          // POINT 1.3 : on joue le flux en DIRECT via un <audio> dédié (pas de Web Audio).
          if (isHost) {
            call.answer(); // l'hôte ne renvoie pas de flux sur cet appel
            tribeCallsRef.current.set(call.peer, call);

            call.on('stream', (tribeStream) => {
              const el = getOrCreateTribeAudioElement(call.peer);
              el.srcObject = tribeStream;
              const uid = peerIdToUserIdRef.current.get(call.peer);
              // 🔊 P4 : sortie via Web Audio (gain réglable >100%) ; l'élément reste attaché
              // (muet) pour maintenir le pipeline WebRTC. Fallback sur el.volume si Web Audio KO.
              const ctx = ensureVoiceCtx();
              let routed = false;
              if (ctx) {
                try {
                  const source = ctx.createMediaStreamSource(tribeStream);
                  const gain = ctx.createGain();
                  gain.gain.value = tribeEffectiveGain(uid);
                  source.connect(gain);
                  gain.connect(voiceOutput(ctx));
                  tribeNodesRef.current.set(call.peer, { source, gain, el });
                  el.muted = true;
                  routed = true;
                } catch { routed = false; }
              }
              if (!routed) {
                el.muted = !!(uid && tribeUserMutedRef.current.has(uid));
                el.volume = Math.min(1, tribeEffectiveGain(uid));
              }
              el.play().catch((e) => console.warn('[PEER] tribe autoplay blocked:', e));
              onReceiveTribeAudio?.(tribeStream, call.peer);
              // 🔊 POINT B : relayer cette voix vers les AUTRES participants — sauf si coupé par l'hôte
              if (!(uid && tribeUserMutedRef.current.has(uid))) relayStreamToOthers(call.peer, tribeStream);
            });

            call.on('close', () => {
              tribeCallsRef.current.delete(call.peer);
              cleanupTribeNode(call.peer);
              removeTribeAudioElement(call.peer);
              closeRelaysFrom(call.peer); // 🔊 POINT B : couper les relais de ce participant
              onTribeAudioEnd?.(call.peer);
            });

            call.on('error', (err) => {
              console.error('[PEER] ❌ Tribe call error:', err);
              tribeCallsRef.current.delete(call.peer);
              cleanupTribeNode(call.peer);
              removeTribeAudioElement(call.peer);
              closeRelaysFrom(call.peer);
              onTribeAudioEnd?.(call.peer);
            });
            return;
          }

          // 🔊 POINT B — PARTICIPANT: appel RELAYÉ = voix d'un AUTRE participant (metadata.kind === 'relay')
          const meta = (call as unknown as { metadata?: { kind?: string; fromUserId?: string } }).metadata;
          if (meta?.kind === 'relay' && meta.fromUserId) {
            const fromUserId = meta.fromUserId;
            call.answer();
            call.on('stream', (relayStream) => {
              const el = getOrCreateRelayAudioElement(fromUserId);
              el.srcObject = relayStream;
              const vol = relayVolumesRef.current.get(fromUserId) ?? RELAY_DEFAULT_GAIN;
              // 🔊 P4 : amplification réelle via GainNode (au-dessus de la musique), fallback el.volume.
              const ctx = ensureVoiceCtx();
              let routed = false;
              if (ctx) {
                try {
                  const source = ctx.createMediaStreamSource(relayStream);
                  const gain = ctx.createGain();
                  gain.gain.value = vol;
                  source.connect(gain);
                  gain.connect(voiceOutput(ctx));
                  relayNodesRef.current.set(fromUserId, { source, gain, el });
                  el.muted = true;
                  routed = true;
                } catch { routed = false; }
              }
              if (!routed) { el.muted = false; el.volume = Math.min(1, vol); }
              el.play().catch(() => { /* autoplay : débloqué par un geste */ });
              setState((prev) => prev.remoteMicUsers.includes(fromUserId)
                ? prev
                : { ...prev, remoteMicUsers: [...prev.remoteMicUsers, fromUserId] });
            });
            const cleanupRelay = () => {
              const node = relayNodesRef.current.get(fromUserId);
              if (node) {
                try { node.source.disconnect(); } catch { /* ignore */ }
                try { node.gain.disconnect(); } catch { /* ignore */ }
                relayNodesRef.current.delete(fromUserId);
              }
              removeRelayAudioElement(fromUserId);
              setState((prev) => ({ ...prev, remoteMicUsers: prev.remoteMicUsers.filter((u) => u !== fromUserId) }));
            };
            call.on('close', cleanupRelay);
            call.on('error', cleanupRelay);
            return;
          }

          // PARTICIPANT: appel entrant = voix de l'hôte
          activeCallRef.current = call;
          call.answer(); // participant reçoit uniquement, pas de flux à envoyer ici

          // Handle incoming stream (host's voice)
          call.on('stream', async (remoteStream) => {
            // Get or create the audio element
            const audioEl = getOrCreateRemoteAudioElement();

            // Force play
            await forcePlayRemoteAudio(audioEl, remoteStream);

            // Notify parent component
            onReceiveAudio?.(remoteStream);
          });

          call.on('close', () => {
            updateState({ isReceivingVoice: false });
            onVoiceEnd?.();

            // 🔊 Libérer le nœud Web Audio de la voix hôte
            if (hostVoiceNodeRef.current) {
              try { hostVoiceNodeRef.current.source.disconnect(); } catch { /* ignore */ }
              try { hostVoiceNodeRef.current.gain.disconnect(); } catch { /* ignore */ }
              hostVoiceNodeRef.current = null;
            }
            // Clear the audio element
            const audioEl = document.getElementById(REMOTE_AUDIO_ID) as HTMLAudioElement;
            if (audioEl) {
              audioEl.srcObject = null;
            }
            activeCallRef.current = null;
          });

          call.on('error', (err) => {
            console.error('[PEER] ❌ Call error:', err);
          });
        });

        // ========================================
        // HOST: Handle incoming participant connections
        // ========================================
        peer.on('connection', (dataConn) => {
          // Production: log removed
          
          dataConn.on('open', () => {
            dataConnectionsRef.current.set(dataConn.peer, dataConn);
            // POINT 3 : mémoriser le mapping peerId → userId (depuis la metadata du participant)
            const meta = (dataConn as unknown as { metadata?: { userId?: string } }).metadata;
            if (meta?.userId) peerIdToUserIdRef.current.set(dataConn.peer, meta.userId);
            setState(prev => ({
              ...prev,
              connectedPeers: [...prev.connectedPeers, dataConn.peer],
            }));
            onPeerConnected?.(dataConn.peer);

            // If broadcasting, call the new peer immediately
            if (currentStreamRef.current && isHost) {
              // Production: log removed
              const call = peerRef.current?.call(dataConn.peer, currentStreamRef.current);
              if (call) {
                connectionsRef.current.set(dataConn.peer, call);
                // POINT 3 : appliquer la sélection privée à ce nouveau participant
                call.on('stream', () => applyPrivacyToCall(call, dataConn.peer));
                applyPrivacyToCall(call, dataConn.peer);
              }
            }
            // 🔊 POINT B : si des participants parlent déjà, relayer leur voix vers ce nouveau venu
            if (isHost) {
              tribeCallsRef.current.forEach((tribeCall, fromPeerId) => {
                const s = (tribeCall as unknown as { remoteStream?: MediaStream }).remoteStream;
                if (s) relayStreamToOthers(fromPeerId, s);
              });
            }
          });

          dataConn.on('close', () => {
            // Production: log removed
            dataConnectionsRef.current.delete(dataConn.peer);
            connectionsRef.current.delete(dataConn.peer);
            peerIdToUserIdRef.current.delete(dataConn.peer); // POINT 3 : nettoyer le mapping
            setState(prev => ({
              ...prev,
              connectedPeers: prev.connectedPeers.filter(id => id !== dataConn.peer),
            }));
            onPeerDisconnected?.(dataConn.peer);
          });
        });

        // Handle errors
        peer.on('error', (err) => {
          console.error('[PEER] ❌ Error:', err.type, '-', err.message);
          
          let errorMessage = 'Erreur de connexion WebRTC';

          if (err.type === 'peer-unavailable') {
            errorMessage = isHost
              ? 'Impossible de créer la session'
              : 'L\'hôte n\'est pas encore connecté';
            // 🔁 P5 (participant) : l'hôte n'a pas (encore) de peer joignable → on retente la dataConn
            //    jusqu'à ce qu'il soit en ligne. Sans ça, l'hôte ne « voit » jamais le participant et ne
            //    lui envoie pas sa voix (participant inaudible). Backoff borné.
            if (!isHost && peerRef.current?.open && hostDataRetryRef.current < MAX_HOST_DATA_RETRIES) {
              hostDataRetryRef.current++;
              setTimeout(() => { connectToHost(); }, Math.min(5000, 1000 * hostDataRetryRef.current));
            }
          } else if (err.type === 'network') {
            errorMessage = 'Erreur réseau. Vérifiez votre connexion.';
          } else if (err.type === 'unavailable-id') {
            errorMessage = 'Reconnexion en cours…';
            // 🔁 P5 (hôte) : l'ID hôte est FIXE (beattribe-host-<session>). Après un reload / renouvellement
            //    de code / coupure, l'ancien peer reste brièvement enregistré côté serveur → cette erreur.
            //    On détruit et on RETENTE après un court délai (l'ID se libère) au lieu d'exiger un refresh
            //    manuel → c'est LA cause du micro hôte « parfois oui, parfois non ».
            if (isHost && idRetryRef.current < MAX_ID_RETRIES) {
              idRetryRef.current++;
              try { peerRef.current?.destroy(); } catch { /* ignore */ }
              peerRef.current = null;
              setTimeout(() => { connectRef.current?.(currentStreamRef.current); }, 1200 * idRetryRef.current);
            } else if (isHost) {
              errorMessage = 'ID déjà utilisé. Rafraîchissez la page.';
            }
          }

          updateState({ error: errorMessage });
          onError?.(errorMessage);

          // peer-unavailable (participant) et unavailable-id (hôte, en cours de reprise) : on ne
          // résout PAS l'échec → la reprise automatique ci-dessus prend le relais.
          if (err.type !== 'peer-unavailable' && err.type !== 'unavailable-id') {
            resolve(false);
          }
        });

        // Handle disconnection - attempt reconnect
        peer.on('disconnected', () => {
          // Production: log removed
          updateState({ isConnected: false });

          // Auto-reconnect
          if (reconnectAttempts.current < maxReconnectAttempts) {
            reconnectAttempts.current++;
            // Production: log removed
            setTimeout(() => {
              if (peerRef.current && !peerRef.current.destroyed) {
                peerRef.current.reconnect();
              }
            }, 1000 * reconnectAttempts.current);
          }
        });

        peer.on('close', () => {
          // Production: log removed
          updateState({ isConnected: false, peerId: null, isReady: false, isReceivingVoice: false });
        });

        // Connection timeout
        setTimeout(() => {
          if (!peerRef.current?.open) {
            console.warn('[PEER] ⏰ Connection timeout');
            resolve(false);
          }
        }, 15000);

      } catch (err) {
        console.error('[PEER] ❌ Exception:', err);
        updateState({ error: 'Erreur de connexion' });
        resolve(false);
      }
    });
    // onVoiceStart est consommé via forcePlayRemoteAudio ; sessionId via generatePeerId/getHostPeerId.
    // applyPrivacyToCall (stable) est déclaré plus bas et userId est lu via userIdRef → hors deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHost, generatePeerId, getHostPeerId, updateState, onPeerConnected, onPeerDisconnected, onReceiveAudio, onVoiceEnd, onReceiveTribeAudio, onTribeAudioEnd, onError, onReady, forcePlayRemoteAudio]);

  /**
   * HOST: Broadcast audio to all connected peers
   */
  // 🔊 POINT B (hôte) : relaie le flux d'un participant (fromPeerId) vers TOUS les autres
  // participants connectés (sauf lui-même → pas d'écho). Réutilise l'infra PeerJS + TURN.
  const relayStreamToOthers = useCallback((fromPeerId: string, stream: MediaStream) => {
    if (!isHost || !peerRef.current?.open) return;
    const fromUserId = peerIdToUserIdRef.current.get(fromPeerId);
    if (!fromUserId) return; // sans identité, on ne peut pas étiqueter la source
    dataConnectionsRef.current.forEach((_, toPeerId) => {
      if (toPeerId === fromPeerId) return; // ne jamais renvoyer la voix à son émetteur
      const key = `${fromPeerId}__${toPeerId}`;
      if (relayCallsRef.current.has(key)) return; // relais déjà actif
      try {
        const relay = peerRef.current!.call(toPeerId, stream, { metadata: { kind: 'relay', fromUserId } });
        relayCallsRef.current.set(key, relay);
        relay.on('close', () => relayCallsRef.current.delete(key));
        relay.on('error', () => relayCallsRef.current.delete(key));
      } catch { /* ignore */ }
    });
  }, [isHost]);

  // 🔊 POINT B (hôte) : ferme tous les relais émis depuis un participant qui arrête de parler
  const closeRelaysFrom = useCallback((fromPeerId: string) => {
    relayCallsRef.current.forEach((call, key) => {
      if (key.startsWith(`${fromPeerId}__`)) {
        try { call.close(); } catch { /* ignore */ }
        relayCallsRef.current.delete(key);
      }
    });
  }, []);

  // 🔊 POINT B (participant) : règle le volume de la voix d'un autre participant (relayée).
  // P4 : agit sur le GainNode (0..250%) → amplification réelle au-dessus de la musique.
  const setRemoteMicVolume = useCallback((userId: string, volume: number) => {
    const clamped = Math.max(0, Math.min(VOICE_MAX_GAIN, volume));
    relayVolumesRef.current.set(userId, clamped);
    const node = relayNodesRef.current.get(userId);
    if (node) {
      node.gain.gain.value = clamped;
    } else {
      const el = document.getElementById(`relay-audio-${userId}`) as HTMLAudioElement | null;
      if (el && !el.muted) el.volume = Math.min(1, clamped);
    }
  }, []);

  // 🔊 P4 (hôte) : volume d'un participant précis (slider "Participants") → GainNode Web Audio.
  const setTribeUserVolume = useCallback((userId: string, volume: number) => {
    tribeUserVolumeRef.current.set(userId, Math.max(0, Math.min(VOICE_MAX_GAIN, volume)));
    tribeNodesRef.current.forEach((node, peerId) => {
      if (peerIdToUserIdRef.current.get(peerId) === userId) node.gain.gain.value = tribeEffectiveGain(userId);
    });
  }, [tribeEffectiveGain]);

  // 🔇 P4 (hôte) : "Couper" coupe RÉELLEMENT ce participant pour TOUT LE MONDE
  // (gain local à 0 + arrêt du relais vers les autres). "Réactiver" rétablit gain et relais.
  const setTribeUserMuted = useCallback((userId: string, muted: boolean) => {
    if (muted) tribeUserMutedRef.current.add(userId); else tribeUserMutedRef.current.delete(userId);
    // Pour chaque participant (peerId) correspondant à cet userId, appliquer le mute là où il joue.
    peerIdToUserIdRef.current.forEach((uid, peerId) => {
      if (uid !== userId) return;
      const node = tribeNodesRef.current.get(peerId);
      if (node) {
        node.gain.gain.value = tribeEffectiveGain(userId); // Web Audio : gain 0 si coupé
        node.el.muted = true;
      } else {
        // Fallback (Web Audio indispo) : couper directement l'élément <audio>
        const el = document.getElementById(`tribe-audio-${peerId}`) as HTMLAudioElement | null;
        if (el) { el.muted = muted; el.volume = Math.min(1, tribeEffectiveGain(userId)); }
      }
      // Relais vers les autres participants : coupé si muet, rétabli sinon
      if (muted) {
        closeRelaysFrom(peerId);
      } else {
        const el = document.getElementById(`tribe-audio-${peerId}`) as HTMLAudioElement | null;
        const s = el?.srcObject as MediaStream | null;
        if (s) relayStreamToOthers(peerId, s);
      }
    });
  }, [tribeEffectiveGain, closeRelaysFrom, relayStreamToOthers]);

  // 🎙️ POINT 3 : applique la sélection privée à UNE connexion (call vers un participant).
  // null = tout le monde entend → on (re)met la piste micro. Sinon, seuls les userId sélectionnés
  // gardent la piste ; les autres reçoivent replaceTrack(null) → ils n'entendent pas la voix privée.
  const applyPrivacyToCall = useCallback((call: MediaConnection, peerId: string) => {
    try {
      const pc = (call as unknown as { peerConnection?: RTCPeerConnection }).peerConnection;
      if (!pc || !pc.getSenders) return;
      const sender = pc.getSenders().find((s) => !s.track || s.track.kind === 'audio') || pc.getSenders()[0];
      if (!sender || !sender.replaceTrack) return;
      const micTrack = currentStreamRef.current?.getAudioTracks?.()[0] || null;
      const targets = privateTargetsRef.current;
      const uid = peerIdToUserIdRef.current.get(peerId);
      const allowed = !targets || (uid != null && targets.has(uid));
      sender.replaceTrack(allowed ? micTrack : null).catch(() => { /* ignore */ });
    } catch { /* ignore */ }
  }, []);

  // 🎙️ POINT 3 : ré-applique la sélection à TOUTES les connexions actives
  const applyPrivacyToAll = useCallback(() => {
    connectionsRef.current.forEach((call, peerId) => applyPrivacyToCall(call, peerId));
  }, [applyPrivacyToCall]);

  // 🎙️ POINT 3 (hôte) : définir la sélection des participants entendant la voix privée.
  // [] ou null → "parler à tous".
  const setPrivateTargets = useCallback((userIds: string[] | null) => {
    privateTargetsRef.current = (userIds && userIds.length > 0) ? new Set(userIds) : null;
    applyPrivacyToAll();
  }, [applyPrivacyToAll]);

  const broadcastAudio = useCallback((stream: MediaStream) => {
    // Production: log removed
    // Production: log removed
    // Production: log removed
    // Production: log removed
    // Production: log removed

    if (!isHost) {
      console.warn('[PEER] Not host, cannot broadcast');
      return;
    }

    // Mémoriser le flux quoi qu'il arrive : les participants qui se connectent ensuite
    // seront appelés via peer.on('connection') avec currentStreamRef.
    currentStreamRef.current = stream;
    updateState({ isBroadcasting: true });

    if (!peerRef.current?.open) {
      // Peer pas encore ouvert : la diffusion se fera à la connexion des participants
      return;
    }

    // Call all connected participants
    dataConnectionsRef.current.forEach((_, peerId) => {
      if (!connectionsRef.current.has(peerId)) {
        // Production: log removed
        const call = peerRef.current!.call(peerId, stream);

        // POINT 3 : appliquer la sélection privée dès que la connexion média est établie
        call.on('stream', () => applyPrivacyToCall(call, peerId));

        call.on('close', () => {
          // Production: log removed
          connectionsRef.current.delete(peerId);
        });

        call.on('error', (err) => {
          console.error('[PEER] Call error to', peerId, ':', err);
        });

        connectionsRef.current.set(peerId, call);
      }
    });
    // (re)appliquer la sélection privée à toutes les connexions existantes
    applyPrivacyToAll();
  }, [isHost, updateState, applyPrivacyToCall, applyPrivacyToAll]);

  // Stop broadcasting
  const stopBroadcast = useCallback(() => {
    if (!isHost) return;

    // Production: log removed

    connectionsRef.current.forEach((call, peerId) => {
      call.close();
      // Production: log removed
    });
    connectionsRef.current.clear();

    currentStreamRef.current = null;
    updateState({ isBroadcasting: false });
  }, [isHost, updateState]);

  /**
   * 🎤 POINT 5: PARTICIPANT — envoie son micro à l'hôte ("Prendre la parole").
   * Appelle le peer de l'hôte avec le flux micro ; l'hôte le mixe via "Volume Tribu".
   */
  const talkToHost = useCallback((stream: MediaStream) => {
    if (isHost) {
      console.warn('[PEER] talkToHost ignoré côté hôte');
      return;
    }
    if (!peerRef.current?.open) {
      console.warn('[PEER] Peer non connecté, impossible de prendre la parole');
      return;
    }

    // Fermer un éventuel appel montant précédent
    if (upstreamCallRef.current) {
      try { upstreamCallRef.current.close(); } catch (e) { /* ignore */ }
      upstreamCallRef.current = null;
    }

    const hostPeerId = getHostPeerId();
    const call = peerRef.current.call(hostPeerId, stream);
    if (call) {
      upstreamCallRef.current = call;
      call.on('error', (err) => {
        console.error('[PEER] ❌ Upstream call error:', err);
      });
    }
  }, [isHost, getHostPeerId]);

  /**
   * 🔊 POINT 1.6: règle le volume des voix participants (tribu) — direct sur les <audio>.
   */
  const setTribeVolume = useCallback((volume: number) => {
    const clamped = Math.max(0, Math.min(VOICE_MAX_GAIN, volume)); // P4 : "Volume Tribu" maître 0..250%
    tribeVolumeRef.current = clamped;
    // Web Audio : recalculer le gain effectif de chaque participant (master × volume × mute)
    tribeNodesRef.current.forEach((node, peerId) => {
      node.gain.gain.value = tribeEffectiveGain(peerIdToUserIdRef.current.get(peerId));
    });
    // Fallback (Web Audio indispo) : éléments encore audibles via volume direct
    document.querySelectorAll<HTMLAudioElement>(`.${TRIBE_AUDIO_CLASS}`).forEach((el) => {
      if (!el.muted) el.volume = Math.min(1, clamped);
    });
  }, [tribeEffectiveGain]);

  /**
   * 🔊 PARTICIPANT — règle le volume de la VOIX DE L'HÔTE (effet immédiat + mémorisé pour
   * les prochains flux reçus).
   */
  const setHostVoiceVolume = useCallback((volume: number) => {
    const clamped = Math.max(0, Math.min(VOICE_MAX_GAIN, volume)); // 0..250% (amplification réelle)
    hostVoiceVolumeRef.current = clamped;
    if (hostVoiceNodeRef.current) {
      hostVoiceNodeRef.current.gain.gain.value = clamped; // Web Audio : gain réel > 100%
    } else if (remoteAudioRef.current) {
      remoteAudioRef.current.volume = Math.min(1, clamped); // fallback élément (plafonné à 1.0)
      if (clamped > 0) remoteAudioRef.current.muted = false;
    }
  }, []);

  /**
   * 🎤 POINT 5: PARTICIPANT — rend la parole (ferme l'appel montant).
   */
  const stopTalkToHost = useCallback(() => {
    if (upstreamCallRef.current) {
      try { upstreamCallRef.current.close(); } catch (e) { /* ignore */ }
      upstreamCallRef.current = null;
    }
  }, []);

  // Disconnect
  const disconnect = useCallback(() => {
    // Production: log removed
    stopBroadcast();

    // Close active call (participant)
    if (activeCallRef.current) {
      activeCallRef.current.close();
      activeCallRef.current = null;
    }

    // 🎤 POINT 5: fermer l'appel montant (participant) et les appels tribu (hôte)
    if (upstreamCallRef.current) {
      try { upstreamCallRef.current.close(); } catch (e) { /* ignore */ }
      upstreamCallRef.current = null;
    }
    tribeCallsRef.current.forEach((call, peerId) => {
      try { call.close(); } catch (e) { /* ignore */ }
      cleanupTribeNode(peerId);
      removeTribeAudioElement(peerId);
    });
    tribeCallsRef.current.clear();

    // 🔊 POINT B : couper tous les relais + supprimer les <audio> relay (anti-fuite)
    relayCallsRef.current.forEach((call) => { try { call.close(); } catch { /* ignore */ } });
    relayCallsRef.current.clear();
    relayNodesRef.current.forEach((node) => {
      try { node.source.disconnect(); } catch { /* ignore */ }
      try { node.gain.disconnect(); } catch { /* ignore */ }
    });
    relayNodesRef.current.clear();
    document.querySelectorAll<HTMLAudioElement>(`.${RELAY_AUDIO_CLASS}`).forEach((el) => { el.srcObject = null; el.remove(); });
    // 🔊 Libérer le nœud Web Audio de la voix hôte
    if (hostVoiceNodeRef.current) {
      try { hostVoiceNodeRef.current.source.disconnect(); } catch { /* ignore */ }
      try { hostVoiceNodeRef.current.gain.disconnect(); } catch { /* ignore */ }
      hostVoiceNodeRef.current = null;
    }
    setState((prev) => ({ ...prev, remoteMicUsers: [] }));

    dataConnectionsRef.current.forEach((conn) => conn.close());
    dataConnectionsRef.current.clear();

    if (peerRef.current) {
      peerRef.current.destroy();
      peerRef.current = null;
    }

    // Clean up remote audio element
    const audioEl = document.getElementById(REMOTE_AUDIO_ID) as HTMLAudioElement;
    if (audioEl) {
      audioEl.srcObject = null;
    }

    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
    }

    updateState({
      isConnected: false,
      peerId: null,
      connectedPeers: [],
      isBroadcasting: false,
      isReady: false,
      isReceivingVoice: false,
    });

    // Production: log removed
  }, [stopBroadcast, updateState, cleanupTribeNode]);

  // Manual reconnect
  const reconnect = useCallback(async (): Promise<boolean> => {
    // Production: log removed
    disconnect();
    await new Promise(r => setTimeout(r, 500));
    return connect(currentStreamRef.current);
  }, [disconnect, connect]);

  // 🔁 P5 : garde une ref à jour de `connect` pour la reprise automatique de l'ID hôte
  //    (unavailable-id) déclenchée depuis le handler d'erreur du peer.
  useEffect(() => { connectRef.current = connect; }, [connect]);

  // 🔁 3a : si isHost change APRÈS l'ouverture du peer (coach dont le rôle est résolu de façon
  //   asynchrone → false puis true), on relance connect pour revendiquer la bonne identité (ID hôte
  //   fixe). Sans ce filet, le peer reste un « participant » et la voix du coach n'atteint jamais les
  //   participants. La recréation est gérée dans connect() (garde d'identité de rôle ci-dessus).
  useEffect(() => {
    const peer = peerRef.current;
    if (!peer || !peer.open) return;
    const isHostPeer = peer.id === getHostPeerId();
    if (isHost !== isHostPeer) {
      connectRef.current?.(currentStreamRef.current);
    }
  }, [isHost, getHostPeerId]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
      // Remove audio element on unmount
      const audioEl = document.getElementById(REMOTE_AUDIO_ID);
      if (audioEl) {
        audioEl.remove();
      }
      // 🔊 P4 : fermer l'AudioContext des voix distantes (anti-fuite)
      if (voiceCtxRef.current && voiceCtxRef.current.state !== 'closed') {
        voiceCtxRef.current.close().catch(() => { /* ignore */ });
        voiceCtxRef.current = null;
        voiceMasterRef.current = null;
        voiceCompRef.current = null;
      }
    };
  }, [disconnect]);

  return {
    state,
    connect,
    disconnect,
    broadcastAudio,
    stopBroadcast,
    talkToHost,
    stopTalkToHost,
    setTribeVolume,
    setHostVoiceVolume,
    setPrivateTargets,
    setRemoteMicVolume,
    setTribeUserVolume,
    setTribeUserMuted,
    reconnect,
    remoteAudioRef,
  };
}

export default usePeerAudio;
