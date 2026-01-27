import React, { createContext, useContext, useEffect, useRef, useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RealtimeChannel } from '@supabase/supabase-js';
import { useToast } from '@/components/ui/Toast';
import { 
  supabase, 
  isSupabaseConfigured, 
  createSessionChannel, 
  broadcastToSession, 
  unsubscribeChannel,
  RealtimePayload,
  RealtimeEventType,
  savePlaylist,
  loadPlaylist,
  PlaylistRecord,
} from '@/lib/supabaseClient';

// Re-export types for consumers
export type { RealtimeEventType, RealtimePayload };

// Connection status types
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
export type ConnectionMode = 'supabase' | 'local' | 'none';

export interface PlaylistPayload {
  tracks: Array<{
    id: number;
    title: string;
    artist: string;
    src: string;
  }>;
  selectedTrackId: number;
}

export interface PlaybackPayload {
  isPlaying: boolean;
  currentTime: number;
  trackId: number;
}

interface SocketContextValue {
  // Connection state
  isConnected: boolean;
  isSupabaseMode: boolean;
  connectionStatus: ConnectionStatus;
  connectionMode: ConnectionMode;
  connectionError: string | null;
  userId: string;
  sessionId: string | null;
  
  // Join/Leave
  joinSession: (sessionId: string, userId: string, isHost: boolean) => void;
  leaveSession: () => void;
  
  // Host Commands
  muteUser: (targetUserId: string) => void;
  unmuteUser: (targetUserId: string) => void;
  ejectUser: (targetUserId: string) => void;
  setUserVolume: (targetUserId: string, volume: number) => void;
  
  // Sync Commands
  syncPlaylist: (tracks: PlaylistPayload['tracks'], selectedTrackId: number) => void;
  syncPlayback: (isPlaying: boolean, currentTime: number, trackId: number) => void;
  
  // Persistence
  savePlaylistToDb: (tracks: PlaylistPayload['tracks'], selectedTrackId: number) => Promise<boolean>;
  loadPlaylistFromDb: () => Promise<PlaylistRecord | null>;
  
  // Event listeners
  onMuted: (callback: (muted: boolean) => void) => () => void;
  onEjected: (callback: () => void) => () => void;
  onVolumeChange: (callback: (volume: number) => void) => () => void;
  onPlaylistSync: (callback: (payload: PlaylistPayload) => void) => () => void;
  onPlaybackSync: (callback: (payload: PlaybackPayload) => void) => () => void;
}

const SocketContext = createContext<SocketContextValue | null>(null);

// Generate unique user ID (persisted in sessionStorage)
function generateUserId(): string {
  const stored = sessionStorage.getItem('bt_user_id');
  if (stored) return stored;
  
  const newId = `user_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  sessionStorage.setItem('bt_user_id', newId);
  return newId;
}

export const SocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const navigate = useNavigate();
  const { showToast } = useToast();
  
  // Refs for channels
  const supabaseChannelRef = useRef<RealtimeChannel | null>(null);
  
  // State
  const [isConnected, setIsConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [userId] = useState(generateUserId);
  const isHostRef = useRef(false);
  
  // Determine connection mode
  const connectionMode: ConnectionMode = isSupabaseConfigured ? 'supabase' : 'local';
  
  // Event listeners storage
  const listenersRef = useRef<{
    muted: Set<(muted: boolean) => void>;
    ejected: Set<() => void>;
    volumeChange: Set<(volume: number) => void>;
    playlistSync: Set<(payload: PlaylistPayload) => void>;
    playbackSync: Set<(payload: PlaybackPayload) => void>;
  }>({
    muted: new Set(),
    ejected: new Set(),
    volumeChange: new Set(),
    playlistSync: new Set(),
    playbackSync: new Set(),
  });

  // Handle incoming messages (works for both Supabase and BroadcastChannel)
  const handleMessage = useCallback((payload: RealtimePayload) => {
    // Ignore own messages
    if (payload.senderId === userId) return;
    
    console.log('[REALTIME IN]', payload.type, {
      from: payload.senderId,
      target: payload.targetUserId,
      latency: `${Date.now() - payload.timestamp}ms`,
    });

    // Handle targeted events (for specific user)
    if (payload.targetUserId && payload.targetUserId !== userId) return;

    switch (payload.type) {
      case 'CMD_MUTE_USER':
        listenersRef.current.muted.forEach(cb => cb(true));
        showToast('🔇 L\'hôte vous a mis en sourdine', 'warning');
        break;
        
      case 'CMD_UNMUTE_USER':
        listenersRef.current.muted.forEach(cb => cb(false));
        showToast('🔊 L\'hôte a réactivé votre son', 'success');
        break;
        
      case 'CMD_EJECT_USER':
        listenersRef.current.ejected.forEach(cb => cb());
        showToast('❌ Vous avez été exclu par l\'hôte', 'error');
        setTimeout(() => navigate('/'), 1500);
        break;
        
      case 'CMD_VOLUME_CHANGE':
        const volData = payload.data as { volume: number };
        listenersRef.current.volumeChange.forEach(cb => cb(volData.volume));
        break;
        
      case 'SYNC_PLAYLIST':
        if (!isHostRef.current) {
          const plData = payload.data as PlaylistPayload;
          listenersRef.current.playlistSync.forEach(cb => cb(plData));
        }
        break;
        
      case 'SYNC_PLAYBACK':
        if (!isHostRef.current) {
          const pbData = payload.data as PlaybackPayload;
          listenersRef.current.playbackSync.forEach(cb => cb(pbData));
        }
        break;
    }
  }, [userId, navigate, showToast]);

  // Send message via Supabase Realtime only
  const sendMessage = useCallback((type: RealtimeEventType, targetUserId?: string, data?: unknown) => {
    const payload: RealtimePayload = {
      type,
      senderId: userId,
      targetUserId,
      data,
      timestamp: Date.now(),
    };

    console.log('[REALTIME OUT]', type, { target: targetUserId });

    // Send via Supabase Realtime (primary method)
    if (supabaseChannelRef.current) {
      broadcastToSession(supabaseChannelRef.current, payload);
    } else if (!isSupabaseConfigured) {
      // Local mode - log but don't send (no network available)
      console.log('[LOCAL MODE] Command logged:', type, payload);
    }
  }, [userId]);

  // Join session
  const joinSession = useCallback((newSessionId: string, newUserId: string, isHost: boolean) => {
    // Close existing channels
    if (supabaseChannelRef.current && supabase) {
      unsubscribeChannel(supabaseChannelRef.current);
      supabaseChannelRef.current = null;
    }
    if (broadcastChannelRef.current) {
      broadcastChannelRef.current.close();
      broadcastChannelRef.current = null;
    }
    
    setSessionId(newSessionId);
    isHostRef.current = isHost;

    // Create Supabase Realtime channel if configured
    if (isSupabaseConfigured) {
      supabaseChannelRef.current = createSessionChannel(newSessionId, handleMessage);
      console.log('[REALTIME] Connected via Supabase Realtime');
    } else {
      console.log('[REALTIME] Supabase not configured, using BroadcastChannel fallback');
    }

    // Always create BroadcastChannel as fallback (for same-browser testing)
    const channelName = `beattribe_session_${newSessionId}`;
    broadcastChannelRef.current = new BroadcastChannel(channelName);
    broadcastChannelRef.current.onmessage = (event) => handleMessage(event.data);

    setIsConnected(true);
    
    console.log('[REALTIME]', `Joined session ${newSessionId} as ${isHost ? 'HOST' : 'PARTICIPANT'}`);
    
    // Announce joining
    sendMessage('USER_JOINED', undefined, { isHost });
  }, [handleMessage, sendMessage]);

  // Leave session
  const leaveSession = useCallback(() => {
    if (sessionId) {
      sendMessage('USER_LEFT');
    }

    if (supabaseChannelRef.current && supabase) {
      unsubscribeChannel(supabaseChannelRef.current);
      supabaseChannelRef.current = null;
    }
    
    if (broadcastChannelRef.current) {
      broadcastChannelRef.current.close();
      broadcastChannelRef.current = null;
    }
    
    setSessionId(null);
    setIsConnected(false);
    isHostRef.current = false;
  }, [sessionId, sendMessage]);

  // Host commands
  const muteUser = useCallback((targetUserId: string) => {
    sendMessage('CMD_MUTE_USER', targetUserId);
  }, [sendMessage]);

  const unmuteUser = useCallback((targetUserId: string) => {
    sendMessage('CMD_UNMUTE_USER', targetUserId);
  }, [sendMessage]);

  const ejectUser = useCallback((targetUserId: string) => {
    sendMessage('CMD_EJECT_USER', targetUserId);
  }, [sendMessage]);

  const setUserVolume = useCallback((targetUserId: string, volume: number) => {
    sendMessage('CMD_VOLUME_CHANGE', targetUserId, { volume });
  }, [sendMessage]);

  // Sync commands
  const syncPlaylist = useCallback((tracks: PlaylistPayload['tracks'], selectedTrackId: number) => {
    if (!isHostRef.current) return;
    sendMessage('SYNC_PLAYLIST', undefined, { tracks, selectedTrackId });
  }, [sendMessage]);

  const syncPlayback = useCallback((isPlaying: boolean, currentTime: number, trackId: number) => {
    if (!isHostRef.current) return;
    sendMessage('SYNC_PLAYBACK', undefined, { isPlaying, currentTime, trackId });
  }, [sendMessage]);

  // Database persistence
  const savePlaylistToDb = useCallback(async (tracks: PlaylistPayload['tracks'], selectedTrackId: number): Promise<boolean> => {
    if (!sessionId) return false;
    return savePlaylist({
      session_id: sessionId,
      tracks,
      selected_track_id: selectedTrackId,
    });
  }, [sessionId]);

  const loadPlaylistFromDb = useCallback(async (): Promise<PlaylistRecord | null> => {
    if (!sessionId) return null;
    return loadPlaylist(sessionId);
  }, [sessionId]);

  // Event listener registration
  const onMuted = useCallback((callback: (muted: boolean) => void) => {
    listenersRef.current.muted.add(callback);
    return () => { listenersRef.current.muted.delete(callback); };
  }, []);

  const onEjected = useCallback((callback: () => void) => {
    listenersRef.current.ejected.add(callback);
    return () => { listenersRef.current.ejected.delete(callback); };
  }, []);

  const onVolumeChange = useCallback((callback: (volume: number) => void) => {
    listenersRef.current.volumeChange.add(callback);
    return () => { listenersRef.current.volumeChange.delete(callback); };
  }, []);

  const onPlaylistSync = useCallback((callback: (payload: PlaylistPayload) => void) => {
    listenersRef.current.playlistSync.add(callback);
    return () => { listenersRef.current.playlistSync.delete(callback); };
  }, []);

  const onPlaybackSync = useCallback((callback: (payload: PlaybackPayload) => void) => {
    listenersRef.current.playbackSync.add(callback);
    return () => { listenersRef.current.playbackSync.delete(callback); };
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (supabaseChannelRef.current && supabase) {
        unsubscribeChannel(supabaseChannelRef.current);
      }
      if (broadcastChannelRef.current) {
        broadcastChannelRef.current.close();
      }
    };
  }, []);

  const value: SocketContextValue = {
    isConnected,
    isSupabaseMode: isSupabaseConfigured,
    userId,
    sessionId,
    joinSession,
    leaveSession,
    muteUser,
    unmuteUser,
    ejectUser,
    setUserVolume,
    syncPlaylist,
    syncPlayback,
    savePlaylistToDb,
    loadPlaylistFromDb,
    onMuted,
    onEjected,
    onVolumeChange,
    onPlaylistSync,
    onPlaybackSync,
  };

  return (
    <SocketContext.Provider value={value}>
      {children}
    </SocketContext.Provider>
  );
};

export const useSocket = (): SocketContextValue => {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error('useSocket must be used within a SocketProvider');
  }
  return context;
};

export default SocketContext;
