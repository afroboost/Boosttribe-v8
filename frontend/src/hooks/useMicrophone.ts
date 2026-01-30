import { useState, useCallback, useRef, useEffect } from 'react';

// Types
export interface MicrophoneState {
  isCapturing: boolean;
  isMuted: boolean;
  volume: number;
  audioLevel: number; // 0-100 for VU meter
  error: string | null;
  errorType: 'permission' | 'device' | 'browser' | 'https' | null;
  deviceId: string | null;
  devices: MediaDeviceInfo[];
  canRetry: boolean; // Show retry button
}

export interface UseMicrophoneOptions {
  autoGainControl?: boolean;
  echoCancellation?: boolean;
  noiseSuppression?: boolean;
  onAudioLevel?: (level: number) => void;
}

export interface UseMicrophoneReturn {
  state: MicrophoneState;
  startCapture: () => Promise<boolean>;
  stopCapture: () => void;
  toggleMute: () => void;
  setVolume: (volume: number) => void;
  setDevice: (deviceId: string) => Promise<void>;
  refreshDevices: () => Promise<MediaDeviceInfo[]>;
  retryCapture: () => Promise<boolean>;
  audioStream: MediaStream | null;
  audioContext: AudioContext | null;
  gainNode: GainNode | null;
}

const initialState: MicrophoneState = {
  isCapturing: false,
  isMuted: false,
  volume: 100,
  audioLevel: 0,
  error: null,
  errorType: null,
  deviceId: null,
  devices: [],
  canRetry: false,
};

/**
 * Hook for capturing microphone audio with VU meter
 * SIMPLIFIED: Calls getUserMedia DIRECTLY on user click (user gesture required)
 */
export function useMicrophone(options: UseMicrophoneOptions = {}): UseMicrophoneReturn {
  const {
    autoGainControl = true,
    echoCancellation = true,
    noiseSuppression = true,
    onAudioLevel,
  } = options;

  const [state, setState] = useState<MicrophoneState>(initialState);
  
  // Refs for audio processing
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // Update state helper
  const updateState = useCallback((updates: Partial<MicrophoneState>) => {
    setState(prev => ({ ...prev, ...updates }));
  }, []);

  // Check if we're in a secure context (HTTPS or localhost)
  const isSecureContext = useCallback((): boolean => {
    const secure = window.isSecureContext || 
                   location.protocol === 'https:' || 
                   location.hostname === 'localhost' ||
                   location.hostname === '127.0.0.1';
    
    if (!secure) {
      console.warn('[MIC] ⚠️ Non-secure context - getUserMedia blocked');
    }
    return secure;
  }, []);

  // Refresh available audio devices
  const refreshDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter(d => d.kind === 'audioinput');
      updateState({ devices: audioInputs });
      // Production: log removed
      return audioInputs;
    } catch (err) {
      console.error('[MIC] Failed to enumerate devices:', err);
      return [];
    }
  }, [updateState]);

  // Calculate audio level from analyser data (VU meter)
  const calculateAudioLevel = useCallback(() => {
    if (!analyserRef.current) return;

    const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
    analyserRef.current.getByteFrequencyData(dataArray);

    // Calculate RMS (Root Mean Square) for better VU meter
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      sum += dataArray[i] * dataArray[i];
    }
    const rms = Math.sqrt(sum / dataArray.length);
    const level = Math.min(100, Math.round((rms / 128) * 100));

    updateState({ audioLevel: level });
    onAudioLevel?.(level);

    // Continue animation loop
    animationFrameRef.current = requestAnimationFrame(calculateAudioLevel);
  }, [onAudioLevel, updateState]);

  /**
   * START CAPTURE - DIRECT getUserMedia call on user gesture
   * This MUST be called from a click handler to trigger browser permission dialog
   */
  const startCapture = useCallback(async (): Promise<boolean> => {
    // Production: log removed
    
    // Clear previous errors
    updateState({ error: null, errorType: null, canRetry: false });

    // 1. Check secure context (HTTPS)
    if (!isSecureContext()) {
      const msg = '⚠️ HTTPS requis : Le microphone ne fonctionne que sur une connexion sécurisée (https://) ou localhost.';
      console.error('[MIC]', msg);
      updateState({ 
        error: msg,
        errorType: 'https',
        canRetry: false 
      });
      return false;
    }

    // 2. Check browser support
    if (!navigator.mediaDevices?.getUserMedia) {
      const msg = 'Votre navigateur ne supporte pas l\'accès au microphone.';
      console.error('[MIC]', msg);
      updateState({ 
        error: msg,
        errorType: 'browser',
        canRetry: false 
      });
      return false;
    }

    try {
      // 3. DIRECT getUserMedia call - browser will show permission dialog
      // Production: log removed
      
      const constraints: MediaStreamConstraints = {
        audio: {
          autoGainControl,
          echoCancellation,
          noiseSuppression,
          deviceId: state.deviceId ? { exact: state.deviceId } : undefined,
        },
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      
      const audioTrack = stream.getAudioTracks()[0];
      // Production: log removed

      // 4. Create AudioContext and RESUME it (user gesture required)
      const audioContext = new AudioContext();
      if (audioContext.state === 'suspended') {
        // Production: log removed
        await audioContext.resume();
      }
      audioContextRef.current = audioContext;
      // Production: log removed

      // 5. Create audio nodes
      const source = audioContext.createMediaStreamSource(stream);
      sourceRef.current = source;

      const gainNode = audioContext.createGain();
      gainNode.gain.value = state.volume / 100;
      gainNodeRef.current = gainNode;

      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      analyserRef.current = analyser;

      // Connect nodes: source -> gain -> analyser
      source.connect(gainNode);
      gainNode.connect(analyser);

      // 6. Start VU meter animation
      calculateAudioLevel();

      // 7. Get device info
      const settings = audioTrack.getSettings();

      updateState({
        isCapturing: true,
        isMuted: false,
        deviceId: settings.deviceId || null,
        canRetry: false,
      });

      // Production: log removed
      
      // Refresh devices list (now we have permission, labels will be visible)
      await refreshDevices();

      return true;

    } catch (err) {
      console.error('[MIC] ❌ getUserMedia failed:', err);
      
      let errorMessage = 'Erreur lors de l\'accès au microphone.';
      let errorType: MicrophoneState['errorType'] = 'browser';
      let canRetry = true;
      
      if (err instanceof Error) {
        // Production: log removed
        
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          errorMessage = '🔒 Permission refusée. Cliquez sur l\'icône cadenas dans la barre d\'adresse pour autoriser le microphone.';
          errorType = 'permission';
          canRetry = true;
        } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
          errorMessage = '🎤 Aucun microphone détecté. Branchez un micro et réessayez.';
          errorType = 'device';
          canRetry = true;
        } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
          errorMessage = '⚠️ Le micro est utilisé par une autre application. Fermez-la et réessayez.';
          errorType = 'device';
          canRetry = true;
        } else if (err.name === 'OverconstrainedError') {
          errorMessage = 'Micro non disponible. Essayez un autre appareil.';
          errorType = 'device';
          canRetry = true;
        } else if (err.name === 'SecurityError') {
          errorMessage = '🔐 HTTPS requis pour le microphone.';
          errorType = 'https';
          canRetry = false;
        }
      }

      updateState({ error: errorMessage, errorType, isCapturing: false, canRetry });
      return false;
    }
  }, [
    autoGainControl,
    echoCancellation,
    noiseSuppression,
    state.deviceId,
    state.volume,
    updateState,
    calculateAudioLevel,
    refreshDevices,
    isSecureContext,
  ]);

  // Retry capture (wrapper for UI button)
  const retryCapture = useCallback(async (): Promise<boolean> => {
    // Production: log removed
    updateState({ error: null, errorType: null, canRetry: false });
    return startCapture();
  }, [startCapture, updateState]);

  // Stop capturing audio
  const stopCapture = useCallback(() => {
    // Production: log removed
    
    // Stop animation
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    // Stop stream tracks
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => {
        track.stop();
        // Production: log removed
      });
      streamRef.current = null;
    }

    // Close audio context
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    // Clear refs
    analyserRef.current = null;
    gainNodeRef.current = null;
    sourceRef.current = null;

    updateState({
      isCapturing: false,
      audioLevel: 0,
    });

    // Production: log removed
  }, [updateState]);

  // Toggle mute
  const toggleMute = useCallback(() => {
    if (streamRef.current) {
      const audioTrack = streamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        updateState({ isMuted: !audioTrack.enabled });
        // Production: log removed
      }
    }
  }, [updateState]);

  // Set volume
  const setVolume = useCallback((volume: number) => {
    const clampedVolume = Math.max(0, Math.min(100, volume));
    
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = clampedVolume / 100;
    }
    
    updateState({ volume: clampedVolume });
  }, [updateState]);

  // Change device
  const setDevice = useCallback(async (deviceId: string) => {
    updateState({ deviceId });
    
    // If already capturing, restart with new device
    if (state.isCapturing) {
      stopCapture();
      await startCapture();
    }
  }, [state.isCapturing, stopCapture, startCapture, updateState]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopCapture();
    };
  }, [stopCapture]);

  // Listen for device changes
  useEffect(() => {
    const handleDeviceChange = () => {
      // Production: log removed
      refreshDevices();
    };

    navigator.mediaDevices?.addEventListener('devicechange', handleDeviceChange);
    
    return () => {
      navigator.mediaDevices?.removeEventListener('devicechange', handleDeviceChange);
    };
  }, [refreshDevices]);

  return {
    state,
    startCapture,
    stopCapture,
    toggleMute,
    setVolume,
    setDevice,
    refreshDevices,
    retryCapture,
    audioStream: streamRef.current,
    audioContext: audioContextRef.current,
    gainNode: gainNodeRef.current,
  };
}

export default useMicrophone;
