import { useState, useCallback, useRef, useEffect } from 'react';

// Types for audio synchronization
export interface AudioState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  isMuted: boolean;
  isLoading: boolean;
  isBuffering: boolean;
  error: string | null;
}

export interface SyncState {
  isHost: boolean;
  isLive: boolean;
  isSynced: boolean;
  latency: number;
  lastSyncTimestamp: number;
  sessionId: string | null;
}

// Repeat mode type
export type RepeatMode = 'none' | 'one' | 'all';

// Broadcast payload type
export interface BroadcastPayload {
  type: 'STATE_UPDATE' | 'SYNC_REQUEST' | 'SYNC_RESPONSE';
  sessionId: string;
  timestamp: number;
  data: {
    isPlaying: boolean;
    currentTime: number;
    trackSrc?: string;
  };
}

export interface AudioSyncOptions {
  isHost?: boolean;
  sessionId?: string | null;
  onStateChange?: (state: AudioState) => void;
  onSyncUpdate?: (syncState: SyncState) => void;
  onBroadcast?: (payload: BroadcastPayload) => void;
  onTrackEnded?: () => void; // Callback when track ends
}

interface UseAudioSyncReturn {
  // Audio element ref
  audioRef: React.RefObject<HTMLAudioElement | null>;
  
  // Audio state
  audioState: AudioState;
  
  // Sync state
  syncState: SyncState;
  
  // Repeat mode
  repeatMode: RepeatMode;
  setRepeatMode: (mode: RepeatMode) => void;
  cycleRepeatMode: () => void;
  
  // Host controls
  play: () => Promise<void>;
  pause: () => void;
  seek: (time: number) => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  
  // Sync functions
  getTimestamp: () => number;
  syncToTimestamp: (timestamp: number) => void;
  startLiveSession: () => void;
  endLiveSession: () => void;
  
  // Network simulation
  broadcastState: () => void;
  listenToState: (payload: BroadcastPayload) => void;
  
  // Load audio
  loadAudio: (src: string) => void;
}

const initialAudioState: AudioState = {
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  volume: 0.8,
  isMuted: false,
  isLoading: false,
  isBuffering: false,
  error: null,
};

const initialSyncState: SyncState = {
  isHost: true,
  isLive: false,
  isSynced: true,
  latency: 0,
  lastSyncTimestamp: 0,
  sessionId: null,
};

// Generate unique session ID
export function generateSessionId(): string {
  const timestamp = Date.now().toString(36);
  const randomPart = Math.random().toString(36).substring(2, 8);
  return `${timestamp}-${randomPart}`.toUpperCase();
}

export function useAudioSync(options: AudioSyncOptions = {}): UseAudioSyncReturn {
  const { 
    isHost = true, 
    sessionId = null,
    onStateChange, 
    onSyncUpdate,
    onBroadcast,
    onTrackEnded,
  } = options;
  
  const audioRef = useRef<HTMLAudioElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const syncIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const currentTrackSrcRef = useRef<string>('');
  
  const [audioState, setAudioState] = useState<AudioState>(initialAudioState);
  const [syncState, setSyncState] = useState<SyncState>({
    ...initialSyncState,
    isHost,
    sessionId,
  });
  const [repeatMode, setRepeatMode] = useState<RepeatMode>('none');

  // Cycle through repeat modes: none -> all -> one -> none
  const cycleRepeatMode = useCallback(() => {
    setRepeatMode(prev => {
      switch (prev) {
        case 'none': return 'all';
        case 'all': return 'one';
        case 'one': return 'none';
        default: return 'none';
      }
    });
  }, []);

  // Update audio state and notify
  const updateAudioState = useCallback((updates: Partial<AudioState>) => {
    setAudioState(prev => {
      const newState = { ...prev, ...updates };
      onStateChange?.(newState);
      return newState;
    });
  }, [onStateChange]);

  // Update sync state and notify
  const updateSyncState = useCallback((updates: Partial<SyncState>) => {
    setSyncState(prev => {
      const newState = { ...prev, ...updates };
      onSyncUpdate?.(newState);
      return newState;
    });
  }, [onSyncUpdate]);

  // Get current timestamp with millisecond precision
  const getTimestamp = useCallback((): number => {
    if (!audioRef.current) return 0;
    return Math.round(audioRef.current.currentTime * 1000);
  }, []);

  // Broadcast state to participants (Network simulation)
  const broadcastState = useCallback(() => {
    if (!syncState.isHost || !syncState.sessionId) return;
    
    const payload: BroadcastPayload = {
      type: 'STATE_UPDATE',
      sessionId: syncState.sessionId,
      timestamp: Date.now(),
      data: {
        isPlaying: audioState.isPlaying,
        currentTime: audioRef.current?.currentTime || 0,
        trackSrc: currentTrackSrcRef.current,
      },
    };
    
    // Log broadcast for debugging (simulated network)
    console.log('[BROADCAST]', {
      sessionId: payload.sessionId,
      timestamp: payload.timestamp,
      isPlaying: payload.data.isPlaying,
      position: `${(payload.data.currentTime * 1000).toFixed(0)}ms`,
    });
    
    // Notify callback if provided
    onBroadcast?.(payload);
    
    updateSyncState({ lastSyncTimestamp: getTimestamp() });
  }, [syncState.isHost, syncState.sessionId, audioState.isPlaying, getTimestamp, onBroadcast, updateSyncState]);

  // Listen to state updates from host (Network simulation)
  const listenToState = useCallback((payload: BroadcastPayload) => {
    if (syncState.isHost) return; // Host doesn't listen
    if (payload.sessionId !== syncState.sessionId) return; // Wrong session
    
    console.log('[RECEIVED]', {
      type: payload.type,
      sessionId: payload.sessionId,
      position: `${(payload.data.currentTime * 1000).toFixed(0)}ms`,
      isPlaying: payload.data.isPlaying,
    });
    
    const audio = audioRef.current;
    if (!audio) return;
    
    // Calculate latency
    const networkLatency = Date.now() - payload.timestamp;
    
    // Sync position if difference > 150ms
    const currentTime = audio.currentTime;
    const targetTime = payload.data.currentTime + (networkLatency / 1000);
    const diff = Math.abs(currentTime - targetTime);
    
    if (diff > 0.15) {
      audio.currentTime = targetTime;
      console.log('[SYNC]', `Adjusted by ${(diff * 1000).toFixed(0)}ms`);
    }
    
    // Sync play/pause state
    if (payload.data.isPlaying && audio.paused) {
      audio.play().catch(console.error);
    } else if (!payload.data.isPlaying && !audio.paused) {
      audio.pause();
    }
    
    updateSyncState({
      isSynced: true,
      latency: networkLatency,
      lastSyncTimestamp: Date.now(),
    });
  }, [syncState.isHost, syncState.sessionId, updateSyncState]);

  // Sync to a specific timestamp (for participants)
  const syncToTimestamp = useCallback((timestamp: number) => {
    if (!audioRef.current || syncState.isHost) return;
    
    const targetTime = timestamp / 1000;
    const currentTime = audioRef.current.currentTime;
    const diff = Math.abs(currentTime - targetTime);
    
    // Only sync if difference is significant (> 100ms)
    if (diff > 0.1) {
      audioRef.current.currentTime = targetTime;
      updateSyncState({
        isSynced: true,
        latency: diff * 1000,
        lastSyncTimestamp: Date.now(),
      });
    }
  }, [syncState.isHost, updateSyncState]);

  // Load audio source
  const loadAudio = useCallback((src: string) => {
    if (!audioRef.current) return;
    
    currentTrackSrcRef.current = src;
    updateAudioState({ isLoading: true, error: null });
    audioRef.current.src = src;
    audioRef.current.load();
  }, [updateAudioState]);

  // Play audio
  const play = useCallback(async () => {
    if (!audioRef.current) return;
    
    try {
      await audioRef.current.play();
      updateAudioState({ isPlaying: true, error: null });
      
      // Broadcast state change if host
      if (syncState.isHost && syncState.isLive) {
        setTimeout(broadcastState, 50);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erreur de lecture';
      updateAudioState({ error: errorMessage, isPlaying: false });
    }
  }, [updateAudioState, syncState.isHost, syncState.isLive, broadcastState]);

  // Pause audio
  const pause = useCallback(() => {
    if (!audioRef.current) return;
    audioRef.current.pause();
    updateAudioState({ isPlaying: false });
    
    // Broadcast state change if host
    if (syncState.isHost && syncState.isLive) {
      setTimeout(broadcastState, 50);
    }
  }, [updateAudioState, syncState.isHost, syncState.isLive, broadcastState]);

  // Seek to position
  const seek = useCallback((time: number) => {
    if (!audioRef.current || !syncState.isHost) return;
    audioRef.current.currentTime = time;
    updateAudioState({ currentTime: time });
    
    // Broadcast seek if live
    if (syncState.isLive) {
      setTimeout(broadcastState, 50);
    }
  }, [syncState.isHost, syncState.isLive, updateAudioState, broadcastState]);

  // Set volume (0-1)
  const setVolume = useCallback((volume: number) => {
    if (!audioRef.current) return;
    const clampedVolume = Math.max(0, Math.min(1, volume));
    audioRef.current.volume = clampedVolume;
    updateAudioState({ volume: clampedVolume, isMuted: clampedVolume === 0 });
  }, [updateAudioState]);

  // Toggle mute
  const toggleMute = useCallback(() => {
    if (!audioRef.current) return;
    const newMuted = !audioRef.current.muted;
    audioRef.current.muted = newMuted;
    updateAudioState({ isMuted: newMuted });
  }, [updateAudioState]);

  // Start live session (host only)
  const startLiveSession = useCallback(() => {
    if (!syncState.isHost) return;
    
    updateSyncState({ isLive: true });
    
    // Start broadcasting state every 100ms
    syncIntervalRef.current = setInterval(() => {
      broadcastState();
    }, 100);
    
    console.log('[SESSION]', `Live session started: ${syncState.sessionId}`);
  }, [syncState.isHost, syncState.sessionId, broadcastState, updateSyncState]);

  // End live session
  const endLiveSession = useCallback(() => {
    updateSyncState({ isLive: false });
    
    if (syncIntervalRef.current) {
      clearInterval(syncIntervalRef.current);
      syncIntervalRef.current = null;
    }
    
    console.log('[SESSION]', `Live session ended: ${syncState.sessionId}`);
  }, [syncState.sessionId, updateSyncState]);

  // Update sessionId when it changes
  useEffect(() => {
    updateSyncState({ sessionId, isHost });
  }, [sessionId, isHost, updateSyncState]);

  // Time update loop for smooth progress
  useEffect(() => {
    const updateTime = () => {
      if (audioRef.current && audioState.isPlaying) {
        updateAudioState({ currentTime: audioRef.current.currentTime });
      }
      animationFrameRef.current = requestAnimationFrame(updateTime);
    };

    if (audioState.isPlaying) {
      animationFrameRef.current = requestAnimationFrame(updateTime);
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [audioState.isPlaying, updateAudioState]);

  // Setup audio element event listeners
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleLoadedMetadata = () => {
      updateAudioState({
        duration: audio.duration,
        isLoading: false,
      });
    };

    const handleTimeUpdate = () => {
      if (!audioState.isPlaying) {
        updateAudioState({ currentTime: audio.currentTime });
      }
    };

    const handlePlay = () => {
      updateAudioState({ isPlaying: true });
    };

    const handlePause = () => {
      updateAudioState({ isPlaying: false });
    };

    const handleWaiting = () => {
      updateAudioState({ isBuffering: true });
    };

    const handleCanPlay = () => {
      updateAudioState({ isBuffering: false, isLoading: false });
    };

    const handleError = () => {
      updateAudioState({
        error: 'Erreur de chargement audio',
        isLoading: false,
        isPlaying: false,
      });
    };

    const handleVolumeChange = () => {
      updateAudioState({
        volume: audio.volume,
        isMuted: audio.muted,
      });
    };

    // Add event listeners
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('waiting', handleWaiting);
    audio.addEventListener('canplay', handleCanPlay);
    audio.addEventListener('error', handleError);
    audio.addEventListener('volumechange', handleVolumeChange);

    // Set initial volume
    audio.volume = audioState.volume;

    // Cleanup
    return () => {
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('waiting', handleWaiting);
      audio.removeEventListener('canplay', handleCanPlay);
      audio.removeEventListener('error', handleError);
      audio.removeEventListener('volumechange', handleVolumeChange);
    };
  }, [audioState.volume, audioState.isPlaying, updateAudioState]);

  // Separate effect for 'ended' event to handle repeat mode with proper cleanup
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleEnded = () => {
      console.log('[AUDIO] Track ended. RepeatMode:', repeatMode);
      
      if (repeatMode === 'one') {
        // Repeat current track: reset to 0 and play
        audio.currentTime = 0;
        audio.play().catch(console.error);
      } else {
        // For 'all' or 'none': notify parent to handle next track
        updateAudioState({ isPlaying: false, currentTime: 0 });
        onTrackEnded?.();
      }
    };

    audio.addEventListener('ended', handleEnded);

    // Cleanup function to prevent memory leaks
    return () => {
      audio.removeEventListener('ended', handleEnded);
    };
  }, [repeatMode, onTrackEnded, updateAudioState]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (syncIntervalRef.current) {
        clearInterval(syncIntervalRef.current);
      }
    };
  }, []);

  return {
    audioRef,
    audioState,
    syncState,
    play,
    pause,
    seek,
    setVolume,
    toggleMute,
    getTimestamp,
    syncToTimestamp,
    startLiveSession,
    endLiveSession,
    broadcastState,
    listenToState,
    loadAudio,
  };
}

export default useAudioSync;
