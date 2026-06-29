import { useState, useCallback, useRef, useEffect } from 'react';

/**
 * 🎧 AUDIO MIXER HOOK - Boosttribe v8
 * 
 * Crée un mixeur avec des canaux indépendants pour :
 * - Musique (HTML5 Audio)
 * - Micro Hôte (WebRTC)
 * - Volume Tribu (Participants entrants)
 * - Volume Voix Hôte (Pour participants)
 */

export interface MixerState {
  musicVolume: number;      // 0-1 - Volume musique
  micVolume: number;        // 0-1 - Volume micro hôte
  tribeVolume: number;      // 0-1 - Volume participants (pour l'hôte)
  hostVoiceVolume: number;  // 0-1 - Volume voix hôte (pour participants)
  isInitialized: boolean;
}

export interface UseAudioMixerOptions {
  onInitialized?: () => void;
}

export interface UseAudioMixerReturn {
  state: MixerState;
  initialize: () => boolean;
  setMusicVolume: (volume: number) => void;
  setMicVolume: (volume: number) => void;
  setTribeVolume: (volume: number) => void;
  setHostVoiceVolume: (volume: number) => void;
  connectMusicSource: (audioElement: HTMLAudioElement) => void;
  connectMicSource: (stream: MediaStream) => MediaStream;
  connectTribeStream: (stream: MediaStream, peerId: string) => void;
  disconnectTribeStream: (peerId: string) => void;
  connectHostVoice: (audioElement: HTMLAudioElement) => void;
  disconnectMusic: () => void;
  disconnectMic: () => void;
  getContext: () => AudioContext | null;
  // 🔴 Flux de la musique (son RÉEL post-gain) pour l'enregistrement — jamais muet contrairement à
  //    element.captureStream() (l'élément est routé via createMediaElementSource).
  getMusicStream: () => MediaStream | null;
  // 🔊 « M'entendre » : l'hôte s'écoute (monitoring local, anti-larsen, on/off).
  setSelfMonitor: (on: boolean) => void;
}

// 🔊 Plages : 1.0 = pleine puissance ; au-delà = amplification (headroom). Aucun défaut < 1.0.
const MUSIC_MAX_GAIN = 2.0; // musique amplifiable jusqu'à 200%
const MIC_MAX_GAIN = 1.5;   // micro hôte : un peu de marge sans saturer la diffusion
const MASTER_MAKEUP_GAIN = 1.25; // léger gain de sortie maître (compensé par le compresseur → pas de clipping brutal)

const initialState: MixerState = {
  musicVolume: 1.0, // 🔊 plein volume par défaut (avant : 0.8 → atténuation perçue)
  micVolume: 1.0,
  tribeVolume: 1.0,
  hostVoiceVolume: 1.4, // 🔊 voix de l'hôte au-dessus de la musique par défaut
  isInitialized: false,
};

/**
 * Hook pour gérer le mixage audio avec des canaux indépendants
 * La musique et le micro ne s'affectent PAS mutuellement
 */
export function useAudioMixer(options: UseAudioMixerOptions = {}): UseAudioMixerReturn {
  const { onInitialized } = options;
  
  const [state, setState] = useState<MixerState>(initialState);
  
  // Refs pour l'AudioContext et les nœuds
  const audioContextRef = useRef<AudioContext | null>(null);
  
  // GainNodes séparés
  const musicGainRef = useRef<GainNode | null>(null);
  const micGainRef = useRef<GainNode | null>(null);
  const tribeGainRef = useRef<GainNode | null>(null);
  const hostVoiceGainRef = useRef<GainNode | null>(null);
  // 🔊 Sortie maître : (sources HP) → masterGain → compresseur → destination
  // → relève la puissance perçue sans clipping brutal (> 1.0).
  const masterGainRef = useRef<GainNode | null>(null);
  const compressorRef = useRef<DynamicsCompressorNode | null>(null);
  
  // Source nodes
  const musicSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const hostVoiceSourceRef = useRef<MediaElementAudioSourceNode | null>(null);

  // 🎤 POINT 5: destination de flux pour le micro hôte (sortie WebRTC, JAMAIS les HP de l'hôte)
  const micStreamDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  // 👥 POINT 5: sources des micros participants entrants (mixés via tribeGain → HP hôte)
  const tribeSourcesRef = useRef<Map<string, MediaStreamAudioSourceNode>>(new Map());

  // 🔴 ENREGISTREMENT — dérivation SÉPARÉE du chemin principal (cf. demande : "source → gain →
  //    destination plein volume ET dérivation séparée vers le recorder, SANS réduire le chemin principal").
  //    Capte la MUSIQUE post-gain (élément routé via createMediaElementSource → captureStream() serait MUET).
  //    La voix de l'hôte et des participants est captée séparément par le recorder (clone micro + flux tribu).
  const musicTapDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  // 🔊 MONITORING « M'entendre » (#6) : micSource → monitorGain(0 par défaut) → master.
  //    Activable par l'hôte pour s'écouter (anti-larsen : gain 0 tant que désactivé).
  const monitorGainRef = useRef<GainNode | null>(null);

  // Track connected elements
  const connectedMusicElement = useRef<HTMLAudioElement | null>(null);
  const connectedHostVoiceElement = useRef<HTMLAudioElement | null>(null);

  /**
   * Initialise l'AudioContext et les GainNodes
   */
  const initialize = useCallback((): boolean => {
    if (audioContextRef.current) {
      // Déjà initialisé — s'assurer qu'il tourne (évite une diffusion muette si suspendu)
      if (audioContextRef.current.state === 'suspended') {
        audioContextRef.current.resume().catch(() => { /* ignore */ });
      }
      return true;
    }

    try {
      // Créer l'AudioContext en mode faible latence (POINT 1 : voix temps réel)
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioContextClass({ latencyHint: 'interactive' });
      audioContextRef.current = ctx;
      // S'assurer que le contexte tourne (politique autoplay → parfois 'suspended')
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => { /* ignore */ });
      }
      // Filet de sécurité : reprendre le contexte à chaque geste (survit à un passage en arrière-plan)
      // → la musique routée via Web Audio ne reste jamais muette après un retour d'onglet.
      const resumeOnGesture = () => { audioContextRef.current?.resume().catch(() => { /* ignore */ }); };
      document.addEventListener('click', resumeOnGesture);
      document.addEventListener('touchstart', resumeOnGesture, { passive: true });

      // 🔊 SORTIE MAÎTRE : masterGain → compresseur → destination.
      // Le compresseur (léger) augmente la puissance perçue sans distorsion (limite les crêtes),
      // et le master applique un petit gain de compensation (makeup) → son plus franc.
      const master = ctx.createGain();
      master.gain.value = MASTER_MAKEUP_GAIN;
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -18; // dB : ne comprime que les crêtes
      compressor.knee.value = 20;
      compressor.ratio.value = 3;       // compression douce
      compressor.attack.value = 0.003;
      compressor.release.value = 0.25;
      master.connect(compressor);
      compressor.connect(ctx.destination);
      masterGainRef.current = master;
      compressorRef.current = compressor;

      // Créer les GainNodes indépendants
      // 🔴 Dérivation d'enregistrement de la MUSIQUE (séparée du chemin HP).
      //    UNIQUEMENT la musique : la voix de l'hôte et les participants sont captés séparément par
      //    le recorder (clone du micro + flux tribu) → pas de double-captation/écho de la voix de l'hôte.
      const recTap = ctx.createMediaStreamDestination();
      musicTapDestRef.current = recTap;

      // 🎵 Canal A: Musique → master → compresseur → HP. + dérivation → recTap (enregistrement réel).
      musicGainRef.current = ctx.createGain();
      musicGainRef.current.gain.value = Math.max(1, state.musicVolume); // jamais < 1.0 (pas d'atténuation par le gain)
      musicGainRef.current.connect(master);
      musicGainRef.current.connect(recTap); // 🔴 capte la musique pour l'enregistrement (son réel, pas muet)

      // 🎤 Canal B: Micro Hôte → destination de flux UNIQUEMENT (anti-larsen).
      // ⚠️ POINT 5: micGain n'est PAS connecté à la sortie HP → l'hôte ne s'entend jamais (sauf « M'entendre »).
      micGainRef.current = ctx.createGain();
      micGainRef.current.gain.value = state.micVolume;
      micStreamDestRef.current = ctx.createMediaStreamDestination();
      micGainRef.current.connect(micStreamDestRef.current);

      // 🔊 MONITORING « M'entendre » : nœud de gain dédié (0 = silencieux), micSource y sera branché.
      const monitor = ctx.createGain();
      monitor.gain.value = 0; // anti-larsen : désactivé par défaut
      monitor.connect(master);
      monitorGainRef.current = monitor;

      // 👥 Canal C: Volume Tribu (participants entrants) → master → HP de l'hôte
      tribeGainRef.current = ctx.createGain();
      tribeGainRef.current.gain.value = state.tribeVolume;
      tribeGainRef.current.connect(master);

      // 🔊 Canal D: Voix Hôte (pour participants) → master → HP
      hostVoiceGainRef.current = ctx.createGain();
      hostVoiceGainRef.current.gain.value = state.hostVoiceVolume;
      hostVoiceGainRef.current.connect(master);
      
      // Message unique de démarrage (production)
      console.log('🚀 Boosttribe Engine Active');
      
      setState(prev => ({ ...prev, isInitialized: true }));
      onInitialized?.();
      
      return true;
    } catch (err) {
      // Silencieux en production - ne pas bloquer l'app
      return false;
    }
  }, [state.musicVolume, state.micVolume, state.tribeVolume, state.hostVoiceVolume, onInitialized]);

  /**
   * Connecte un élément audio HTML5 au canal musique
   */
  const connectMusicSource = useCallback((audioElement: HTMLAudioElement) => {
    const ctx = audioContextRef.current;
    if (!ctx || !musicGainRef.current) {
      initialize();
      setTimeout(() => connectMusicSource(audioElement), 100);
      return;
    }
    
    // Éviter de reconnecter le même élément
    if (connectedMusicElement.current === audioElement && musicSourceRef.current) {
      return;
    }
    
    // Déconnecter l'ancienne source
    if (musicSourceRef.current) {
      try {
        musicSourceRef.current.disconnect();
      } catch (e) {
        // Ignore disconnect errors
      }
    }
    
    try {
      // Créer la source à partir de l'élément audio
      const source = ctx.createMediaElementSource(audioElement);
      source.connect(musicGainRef.current);
      
      musicSourceRef.current = source;
      connectedMusicElement.current = audioElement;
    } catch (err) {
      // L'élément est peut-être déjà connecté - silencieux
    }
  }, [initialize]);

  /**
   * 🎤 POINT 5: Connecte le micro hôte au GainNode "Mon Micro" et retourne le flux
   * traité (gain appliqué) destiné à la diffusion WebRTC. Ce flux ne passe JAMAIS
   * par les haut-parleurs de l'hôte (micGain → micStreamDest uniquement) → anti-larsen.
   */
  const connectMicSource = useCallback((stream: MediaStream): MediaStream => {
    const ctx = audioContextRef.current;
    if (!ctx || !micGainRef.current || !micStreamDestRef.current) {
      initialize();
      return stream; // Fallback: stream original si le mixeur n'est pas prêt
    }

    // Déconnecter l'ancienne source micro
    if (micSourceRef.current) {
      try {
        micSourceRef.current.disconnect();
      } catch (e) {
        // Ignore
      }
    }

    // S'assurer que le contexte tourne, sinon le flux diffusé serait muet
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => { /* ignore */ });
    }

    try {
      const source = ctx.createMediaStreamSource(stream);
      source.connect(micGainRef.current); // source → micGain → micStreamDest (déjà câblé à l'init)
      if (monitorGainRef.current) source.connect(monitorGainRef.current); // 🔊 « M'entendre » (gain 0 par défaut)
      micSourceRef.current = source;
      return micStreamDestRef.current.stream;
    } catch (err) {
      // Silencieux - retourner le stream original
      return stream;
    }
  }, [initialize]);

  /**
   * 👥 POINT 5: Mixe un flux micro participant entrant via le GainNode "Volume Tribu".
   * source(participant) → tribeGain → HP de l'hôte. Piloté par le slider Volume Tribu.
   */
  const connectTribeStream = useCallback((stream: MediaStream, peerId: string) => {
    const ctx = audioContextRef.current;
    if (!ctx || !tribeGainRef.current) {
      initialize();
      setTimeout(() => connectTribeStream(stream, peerId), 100);
      return;
    }

    // Remplacer une éventuelle source existante pour ce participant
    const existing = tribeSourcesRef.current.get(peerId);
    if (existing) {
      try { existing.disconnect(); } catch (e) { /* ignore */ }
    }

    try {
      const source = ctx.createMediaStreamSource(stream);
      source.connect(tribeGainRef.current);
      tribeSourcesRef.current.set(peerId, source);
    } catch (err) {
      // Silencieux
    }
  }, [initialize]);

  /**
   * 👥 POINT 5: Retire un flux participant (quand il rend la parole / se déconnecte)
   */
  const disconnectTribeStream = useCallback((peerId: string) => {
    const source = tribeSourcesRef.current.get(peerId);
    if (source) {
      try { source.disconnect(); } catch (e) { /* ignore */ }
      tribeSourcesRef.current.delete(peerId);
    }
  }, []);

  /**
   * Connecte l'audio de la voix hôte pour les participants
   */
  const connectHostVoice = useCallback((audioElement: HTMLAudioElement) => {
    const ctx = audioContextRef.current;
    if (!ctx || !hostVoiceGainRef.current) {
      initialize();
      setTimeout(() => connectHostVoice(audioElement), 100);
      return;
    }
    
    if (connectedHostVoiceElement.current === audioElement && hostVoiceSourceRef.current) {
      return;
    }
    
    if (hostVoiceSourceRef.current) {
      try {
        hostVoiceSourceRef.current.disconnect();
      } catch (e) {
        // Ignore
      }
    }
    
    try {
      const source = ctx.createMediaElementSource(audioElement);
      source.connect(hostVoiceGainRef.current);
      
      hostVoiceSourceRef.current = source;
      connectedHostVoiceElement.current = audioElement;
    } catch (err) {
      // Silencieux
    }
  }, [initialize]);

  /**
   * Définit le volume de la musique
   */
  const setMusicVolume = useCallback((volume: number) => {
    const clamped = Math.max(0, Math.min(MUSIC_MAX_GAIN, volume)); // 🔊 0..200% (affichage + feed vidéo)
    setState(prev => ({ ...prev, musicVolume: clamped }));

    // Le GainNode ne sert QUE de boost (≥ 1.0) : l'atténuation 0..100% reste pilotée par
    // element.volume (côté SessionPage) → pas de double atténuation, et headroom > 100% réel.
    if (musicGainRef.current) {
      musicGainRef.current.gain.setValueAtTime(Math.max(1, clamped), audioContextRef.current?.currentTime || 0);
    }
  }, []);

  /**
   * Définit le volume du micro (avec un peu de marge pour passer au-dessus de la musique)
   */
  const setMicVolume = useCallback((volume: number) => {
    const clamped = Math.max(0, Math.min(MIC_MAX_GAIN, volume));
    setState(prev => ({ ...prev, micVolume: clamped }));

    if (micGainRef.current) {
      micGainRef.current.gain.setValueAtTime(clamped, audioContextRef.current?.currentTime || 0);
    }
  }, []);

  /**
   * Définit le volume de la tribu (participants)
   */
  const setTribeVolume = useCallback((volume: number) => {
    const clamped = Math.max(0, Math.min(2.5, volume)); // 🔊 P4 : "Volume Tribu" amplifiable jusqu'à 250%
    setState(prev => ({ ...prev, tribeVolume: clamped }));

    if (tribeGainRef.current) {
      tribeGainRef.current.gain.setValueAtTime(clamped, audioContextRef.current?.currentTime || 0);
    }
  }, []);

  /**
   * Définit le volume de la voix hôte (pour participants)
   */
  const setHostVoiceVolume = useCallback((volume: number) => {
    const clamped = Math.max(0, Math.min(2.5, volume)); // 🔊 voix hôte amplifiable jusqu'à 250%
    setState(prev => ({ ...prev, hostVoiceVolume: clamped }));

    if (hostVoiceGainRef.current) {
      hostVoiceGainRef.current.gain.setValueAtTime(clamped, audioContextRef.current?.currentTime || 0);
    }
    // NB : le gain RÉEL de la voix hôte est piloté par usePeerAudio.setHostVoiceVolume (GainNode dédié).
    // On NE touche PLUS element.volume ici : l'élément est routé/muet via Web Audio (sinon double contrôle).
  }, []);

  /**
   * Déconnecte la source musique
   */
  const disconnectMusic = useCallback(() => {
    if (musicSourceRef.current) {
      try {
        musicSourceRef.current.disconnect();
      } catch (e) {
        // Ignore
      }
      musicSourceRef.current = null;
      connectedMusicElement.current = null;
    }
  }, []);

  /**
   * Déconnecte la source micro
   */
  const disconnectMic = useCallback(() => {
    if (micSourceRef.current) {
      try {
        micSourceRef.current.disconnect();
      } catch (e) {
        // Ignore
      }
      micSourceRef.current = null;
    }
  }, []);

  /**
   * Retourne l'AudioContext
   */
  const getContext = useCallback(() => audioContextRef.current, []);

  /**
   * 🔴 Flux audio de la MUSIQUE (son réel, post-gain) destiné à l'enregistrement.
   * On dérive musicGain → musicTapDest : contrairement à audioElement.captureStream() (muet car
   * l'élément est déjà routé via createMediaElementSource), ce flux contient bien le son de la musique.
   */
  const getMusicStream = useCallback((): MediaStream | null => {
    return musicTapDestRef.current?.stream ?? null;
  }, []);

  /**
   * 🔊 « M'entendre » (#6) : active/désactive le monitoring local de la voix de l'hôte.
   * micSource → monitorGain → master. Gain 0 = silencieux (anti-larsen). Geste utilisateur requis.
   */
  const setSelfMonitor = useCallback((on: boolean) => {
    const ctx = audioContextRef.current;
    if (ctx?.state === 'suspended') ctx.resume().catch(() => { /* ignore */ });
    if (monitorGainRef.current) {
      monitorGainRef.current.gain.setValueAtTime(on ? 1 : 0, ctx?.currentTime || 0);
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnectMusic();
      disconnectMic();
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close();
      }
    };
  }, [disconnectMusic, disconnectMic]);

  return {
    state,
    initialize,
    setMusicVolume,
    setMicVolume,
    setTribeVolume,
    setHostVoiceVolume,
    connectMusicSource,
    connectMicSource,
    connectTribeStream,
    disconnectTribeStream,
    connectHostVoice,
    disconnectMusic,
    disconnectMic,
    getContext,
    getMusicStream,
    setSelfMonitor,
  };
}

export default useAudioMixer;
