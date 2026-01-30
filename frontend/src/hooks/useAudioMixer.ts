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
  connectHostVoice: (audioElement: HTMLAudioElement) => void;
  disconnectMusic: () => void;
  disconnectMic: () => void;
  getContext: () => AudioContext | null;
}

const initialState: MixerState = {
  musicVolume: 0.8,
  micVolume: 1.0,
  tribeVolume: 1.0,
  hostVoiceVolume: 1.0,
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
  
  // Source nodes
  const musicSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const hostVoiceSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  
  // Track connected elements
  const connectedMusicElement = useRef<HTMLAudioElement | null>(null);
  const connectedHostVoiceElement = useRef<HTMLAudioElement | null>(null);

  /**
   * Initialise l'AudioContext et les GainNodes
   */
  const initialize = useCallback((): boolean => {
    if (audioContextRef.current) {
      return true; // Déjà initialisé
    }
    
    try {
      // Créer l'AudioContext
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioContextClass();
      audioContextRef.current = ctx;
      
      // Créer les GainNodes indépendants
      // 🎵 Canal A: Musique
      musicGainRef.current = ctx.createGain();
      musicGainRef.current.gain.value = state.musicVolume;
      musicGainRef.current.connect(ctx.destination);
      
      // 🎤 Canal B: Micro Hôte
      micGainRef.current = ctx.createGain();
      micGainRef.current.gain.value = state.micVolume;
      micGainRef.current.connect(ctx.destination);
      
      // 👥 Canal C: Volume Tribu (participants entrants)
      tribeGainRef.current = ctx.createGain();
      tribeGainRef.current.gain.value = state.tribeVolume;
      tribeGainRef.current.connect(ctx.destination);
      
      // 🔊 Canal D: Voix Hôte (pour participants)
      hostVoiceGainRef.current = ctx.createGain();
      hostVoiceGainRef.current.gain.value = state.hostVoiceVolume;
      hostVoiceGainRef.current.connect(ctx.destination);
      
      console.log('🎧 [AUDIO] Mixer initialized - Independent channels active');
      console.log('🎧 [AUDIO] - Music channel: GainNode A');
      console.log('🎧 [AUDIO] - Mic channel: GainNode B');
      console.log('🎧 [AUDIO] - Tribe channel: GainNode C');
      console.log('🎧 [AUDIO] - Host voice channel: GainNode D');
      
      setState(prev => ({ ...prev, isInitialized: true }));
      onInitialized?.();
      
      return true;
    } catch (err) {
      console.error('🎧 [AUDIO] Failed to initialize mixer:', err);
      return false;
    }
  }, [state.musicVolume, state.micVolume, state.tribeVolume, state.hostVoiceVolume, onInitialized]);

  /**
   * Connecte un élément audio HTML5 au canal musique
   */
  const connectMusicSource = useCallback((audioElement: HTMLAudioElement) => {
    const ctx = audioContextRef.current;
    if (!ctx || !musicGainRef.current) {
      console.warn('🎧 [AUDIO] Mixer not initialized, initializing now...');
      initialize();
      // Retry after init
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
      
      console.log('🎧 [AUDIO] Music source connected to GainNode A');
    } catch (err) {
      // L'élément est peut-être déjà connecté
      console.warn('🎧 [AUDIO] Music source already connected or error:', err);
    }
  }, [initialize]);

  /**
   * Connecte un stream micro au canal micro
   * Retourne un nouveau stream avec le gain appliqué (pour WebRTC)
   */
  const connectMicSource = useCallback((stream: MediaStream): MediaStream => {
    const ctx = audioContextRef.current;
    if (!ctx || !micGainRef.current) {
      console.warn('🎧 [AUDIO] Mixer not initialized for mic');
      initialize();
      return stream; // Retourner le stream original si pas initialisé
    }
    
    // Déconnecter l'ancienne source
    if (micSourceRef.current) {
      try {
        micSourceRef.current.disconnect();
      } catch (e) {
        // Ignore
      }
    }
    
    try {
      // Créer la source à partir du stream
      const source = ctx.createMediaStreamSource(stream);
      source.connect(micGainRef.current);
      micSourceRef.current = source;
      
      // Créer un nouveau stream avec le gain appliqué pour WebRTC
      const destination = ctx.createMediaStreamDestination();
      micGainRef.current.connect(destination);
      
      console.log('🎧 [AUDIO] Mic source connected to GainNode B');
      
      return destination.stream;
    } catch (err) {
      console.warn('🎧 [AUDIO] Mic source connection error:', err);
      return stream;
    }
  }, [initialize]);

  /**
   * Connecte l'audio de la voix hôte pour les participants
   */
  const connectHostVoice = useCallback((audioElement: HTMLAudioElement) => {
    const ctx = audioContextRef.current;
    if (!ctx || !hostVoiceGainRef.current) {
      console.warn('🎧 [AUDIO] Mixer not initialized for host voice');
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
      
      console.log('🎧 [AUDIO] Host voice connected to GainNode D');
    } catch (err) {
      console.warn('🎧 [AUDIO] Host voice connection error:', err);
    }
  }, [initialize]);

  /**
   * Définit le volume de la musique
   */
  const setMusicVolume = useCallback((volume: number) => {
    const clamped = Math.max(0, Math.min(1, volume));
    setState(prev => ({ ...prev, musicVolume: clamped }));
    
    if (musicGainRef.current) {
      musicGainRef.current.gain.setValueAtTime(clamped, audioContextRef.current?.currentTime || 0);
    }
  }, []);

  /**
   * Définit le volume du micro
   */
  const setMicVolume = useCallback((volume: number) => {
    const clamped = Math.max(0, Math.min(1, volume));
    setState(prev => ({ ...prev, micVolume: clamped }));
    
    if (micGainRef.current) {
      micGainRef.current.gain.setValueAtTime(clamped, audioContextRef.current?.currentTime || 0);
    }
  }, []);

  /**
   * Définit le volume de la tribu (participants)
   */
  const setTribeVolume = useCallback((volume: number) => {
    const clamped = Math.max(0, Math.min(1, volume));
    setState(prev => ({ ...prev, tribeVolume: clamped }));
    
    if (tribeGainRef.current) {
      tribeGainRef.current.gain.setValueAtTime(clamped, audioContextRef.current?.currentTime || 0);
    }
  }, []);

  /**
   * Définit le volume de la voix hôte (pour participants)
   */
  const setHostVoiceVolume = useCallback((volume: number) => {
    const clamped = Math.max(0, Math.min(1, volume));
    setState(prev => ({ ...prev, hostVoiceVolume: clamped }));
    
    if (hostVoiceGainRef.current) {
      hostVoiceGainRef.current.gain.setValueAtTime(clamped, audioContextRef.current?.currentTime || 0);
    }
    
    // Aussi mettre à jour l'élément audio directement pour le fallback
    const remoteAudio = document.getElementById('remote-voice-audio') as HTMLAudioElement;
    if (remoteAudio) {
      remoteAudio.volume = clamped;
    }
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
    connectHostVoice,
    disconnectMusic,
    disconnectMic,
    getContext,
  };
}

export default useAudioMixer;
