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
}

export interface UsePeerAudioOptions {
  sessionId: string;
  isHost: boolean;
  onPeerConnected?: (peerId: string) => void;
  onPeerDisconnected?: (peerId: string) => void;
  onReceiveAudio?: (stream: MediaStream) => void;
  onVoiceStart?: () => void; // NEW: Called when voice reception starts
  onVoiceEnd?: () => void;   // NEW: Called when voice reception ends
  onError?: (error: string) => void;
  onReady?: () => void;
}

export interface UsePeerAudioReturn {
  state: PeerState;
  connect: (stream?: MediaStream | null) => Promise<boolean>;
  disconnect: () => void;
  broadcastAudio: (stream: MediaStream) => void;
  stopBroadcast: () => void;
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
};

// Audio element ID for remote voice
const REMOTE_AUDIO_ID = 'remote-voice-audio';

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
    onPeerConnected,
    onPeerDisconnected,
    onReceiveAudio,
    onVoiceStart,
    onVoiceEnd,
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
  const activeCallRef = useRef<MediaConnection | null>(null);

  // Update state helper
  const updateState = useCallback((updates: Partial<PeerState>) => {
    setState(prev => ({ ...prev, ...updates }));
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
    
    // Attach stream
    audioEl.srcObject = stream;
    audioEl.volume = 1.0;
    audioEl.muted = false;
    
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
  }, [updateState, onVoiceStart]);

  /**
   * Connect to PeerJS server
   * @param stream - Optional MediaStream for host broadcasting
   */
  const connect = useCallback(async (stream?: MediaStream | null): Promise<boolean> => {
    // Production: log removed
    // Production: log removed
    // Production: log removed

    // For HOST: Require stream
    if (isHost && !stream) {
      // Production: log removed
      return false;
    }

    if (peerRef.current?.open) {
      // Production: log removed
      return true;
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

        // Create peer with robust STUN servers
        const peer = new Peer(peerId, {
          debug: 2,
          config: {
            iceServers: [
              { urls: 'stun:stun.l.google.com:19302' },
              { urls: 'stun:stun1.l.google.com:19302' },
              { urls: 'stun:stun2.l.google.com:19302' },
              { urls: 'stun:stun3.l.google.com:19302' },
              { urls: 'stun:stun4.l.google.com:19302' },
              { urls: 'stun:stun.stunprotocol.org:3478' },
            ],
          },
        });

        peerRef.current = peer;

        // Handle peer open
        peer.on('open', (id) => {
          // Production: log removed
          reconnectAttempts.current = 0;

          updateState({
            isConnected: true,
            peerId: id,
            hostPeerId,
            error: null,
            isReady: true,
          });

          // Host: Store stream and signal ready
          if (isHost && stream) {
            // Production: log removed
            currentStreamRef.current = stream;
            onReady?.();
          }

          // Participant: Connect to host for data channel
          if (!isHost) {
            // Production: log removed
            const dataConn = peer.connect(hostPeerId);
            
            dataConn.on('open', () => {
              // Production: log removed
              dataConnectionsRef.current.set(hostPeerId, dataConn);
            });

            dataConn.on('error', (err) => {
              console.warn('[PEER] ⚠️ Data connection error:', err);
            });
          }

          resolve(true);
        });

        // ========================================
        // PARTICIPANT: Handle incoming voice calls
        // ========================================
        peer.on('call', (call) => {
          // Production: log removed
          // Production: log removed
          
          // Store the call reference
          activeCallRef.current = call;
          
          // FORCE ANSWER - participants receive only, no stream to send
          // Production: log removed
          call.answer();

          // Handle incoming stream (host's voice)
          call.on('stream', async (remoteStream) => {
            // Production: log removed
            // Production: log removed
            // Production: log removed
            // Production: log removed
            // Production: log removed
            
            // Get or create the audio element
            const audioEl = getOrCreateRemoteAudioElement();
            
            // Force play
            await forcePlayRemoteAudio(audioEl, remoteStream);
            
            // Notify parent component
            onReceiveAudio?.(remoteStream);
          });

          call.on('close', () => {
            // Production: log removed
            updateState({ isReceivingVoice: false });
            onVoiceEnd?.();
            
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
                // Production: log removed
              }
            }
          });

          dataConn.on('close', () => {
            // Production: log removed
            dataConnectionsRef.current.delete(dataConn.peer);
            connectionsRef.current.delete(dataConn.peer);
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
          } else if (err.type === 'network') {
            errorMessage = 'Erreur réseau. Vérifiez votre connexion.';
          } else if (err.type === 'unavailable-id') {
            errorMessage = 'ID déjà utilisé. Rafraîchissez la page.';
          }

          updateState({ error: errorMessage });
          onError?.(errorMessage);
          
          if (err.type !== 'peer-unavailable') {
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
  }, [sessionId, isHost, generatePeerId, getHostPeerId, updateState, onPeerConnected, onPeerDisconnected, onReceiveAudio, onVoiceStart, onVoiceEnd, onError, onReady, forcePlayRemoteAudio]);

  /**
   * HOST: Broadcast audio to all connected peers
   */
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

    if (!peerRef.current?.open) {
      console.warn('[PEER] Peer not connected, cannot broadcast');
      return;
    }

    currentStreamRef.current = stream;
    const peerCount = dataConnectionsRef.current.size;
    // Production: log removed

    // Call all connected participants
    dataConnectionsRef.current.forEach((_, peerId) => {
      if (!connectionsRef.current.has(peerId)) {
        // Production: log removed
        const call = peerRef.current!.call(peerId, stream);
        
        call.on('stream', () => {
          // Production: log removed
        });

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

    updateState({ isBroadcasting: true });
    // Production: log removed
  }, [isHost, updateState]);

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

  // Disconnect
  const disconnect = useCallback(() => {
    // Production: log removed
    stopBroadcast();

    // Close active call (participant)
    if (activeCallRef.current) {
      activeCallRef.current.close();
      activeCallRef.current = null;
    }

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
  }, [stopBroadcast, updateState]);

  // Manual reconnect
  const reconnect = useCallback(async (): Promise<boolean> => {
    // Production: log removed
    disconnect();
    await new Promise(r => setTimeout(r, 500));
    return connect(currentStreamRef.current);
  }, [disconnect, connect]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
      // Remove audio element on unmount
      const audioEl = document.getElementById(REMOTE_AUDIO_ID);
      if (audioEl) {
        audioEl.remove();
      }
    };
  }, [disconnect]);

  return {
    state,
    connect,
    disconnect,
    broadcastAudio,
    stopBroadcast,
    reconnect,
    remoteAudioRef,
  };
}

export default usePeerAudio;
