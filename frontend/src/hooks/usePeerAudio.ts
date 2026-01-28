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
}

export interface UsePeerAudioOptions {
  sessionId: string;
  isHost: boolean;
  onPeerConnected?: (peerId: string) => void;
  onPeerDisconnected?: (peerId: string) => void;
  onReceiveAudio?: (stream: MediaStream) => void;
  onError?: (error: string) => void;
}

export interface UsePeerAudioReturn {
  state: PeerState;
  connect: () => Promise<boolean>;
  disconnect: () => void;
  broadcastAudio: (stream: MediaStream) => void;
  stopBroadcast: () => void;
  remoteAudioRef: React.RefObject<HTMLAudioElement>;
}

const initialState: PeerState = {
  isConnected: false,
  isHost: false,
  peerId: null,
  hostPeerId: null,
  connectedPeers: [],
  error: null,
  isBroadcasting: false,
};

/**
 * Hook for WebRTC audio broadcasting using PeerJS
 * Host broadcasts to all participants, participants receive
 */
export function usePeerAudio(options: UsePeerAudioOptions): UsePeerAudioReturn {
  const {
    sessionId,
    isHost,
    onPeerConnected,
    onPeerDisconnected,
    onReceiveAudio,
    onError,
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
    // Participants get unique IDs
    return `beattribe-${cleanSessionId}-${Date.now().toString(36)}`;
  }, [sessionId]);

  // Get host peer ID
  const getHostPeerId = useCallback(() => {
    const cleanSessionId = sessionId.replace(/[^a-zA-Z0-9]/g, '');
    return `beattribe-host-${cleanSessionId}`;
  }, [sessionId]);

  // Connect to PeerJS server
  const connect = useCallback(async (): Promise<boolean> => {
    if (peerRef.current) {
      console.log('[PEERJS] Already connected');
      return true;
    }

    return new Promise((resolve) => {
      try {
        const peerId = generatePeerId(isHost);
        const hostPeerId = getHostPeerId();

        console.log('[PEERJS] Connecting...', { peerId, isHost, hostPeerId });

        // Create peer with public PeerJS server
        const peer = new Peer(peerId, {
          debug: 1,
          config: {
            iceServers: [
              { urls: 'stun:stun.l.google.com:19302' },
              { urls: 'stun:stun1.l.google.com:19302' },
            ],
          },
        });

        peerRef.current = peer;

        // Handle peer open
        peer.on('open', (id) => {
          console.log('[PEERJS] ✅ Connected with ID:', id);
          updateState({
            isConnected: true,
            peerId: id,
            hostPeerId,
            error: null,
          });

          // If participant, connect to host for data channel
          if (!isHost) {
            console.log('[PEERJS] Participant connecting to host:', hostPeerId);
            const dataConn = peer.connect(hostPeerId);
            
            dataConn.on('open', () => {
              console.log('[PEERJS] Data connection to host established');
              dataConnectionsRef.current.set(hostPeerId, dataConn);
            });

            dataConn.on('error', (err) => {
              console.warn('[PEERJS] Data connection error:', err);
            });
          }

          resolve(true);
        });

        // Handle incoming calls (for participants)
        peer.on('call', (call) => {
          console.log('[PEERJS] 📞 Incoming call from:', call.peer);
          
          // Auto-answer with empty stream (we only receive)
          call.answer();

          call.on('stream', (remoteStream) => {
            console.log('[PEERJS] 🔊 Receiving audio stream');
            
            // Play audio through ref element
            if (remoteAudioRef.current) {
              remoteAudioRef.current.srcObject = remoteStream;
              remoteAudioRef.current.play().catch(err => {
                console.warn('[PEERJS] Autoplay blocked:', err);
              });
            }

            onReceiveAudio?.(remoteStream);
          });

          call.on('close', () => {
            console.log('[PEERJS] Call closed');
            if (remoteAudioRef.current) {
              remoteAudioRef.current.srcObject = null;
            }
          });
        });

        // Handle incoming data connections (for host)
        peer.on('connection', (dataConn) => {
          console.log('[PEERJS] 📡 Incoming connection from:', dataConn.peer);
          
          dataConn.on('open', () => {
            dataConnectionsRef.current.set(dataConn.peer, dataConn);
            setState(prev => ({
              ...prev,
              connectedPeers: [...prev.connectedPeers, dataConn.peer],
            }));
            onPeerConnected?.(dataConn.peer);

            // If we're already broadcasting, call the new peer
            if (currentStreamRef.current && isHost) {
              console.log('[PEERJS] Calling new peer:', dataConn.peer);
              const call = peerRef.current?.call(dataConn.peer, currentStreamRef.current);
              if (call) {
                connectionsRef.current.set(dataConn.peer, call);
              }
            }
          });

          dataConn.on('close', () => {
            dataConnectionsRef.current.delete(dataConn.peer);
            connectionsRef.current.delete(dataConn.peer);
            updateState(prev => ({
              connectedPeers: prev.connectedPeers.filter(id => id !== dataConn.peer),
            }));
            onPeerDisconnected?.(dataConn.peer);
          });
        });

        // Handle errors
        peer.on('error', (err) => {
          console.error('[PEERJS] ❌ Error:', err.type, err.message);
          
          let errorMessage = 'Erreur de connexion PeerJS';
          
          if (err.type === 'peer-unavailable') {
            errorMessage = isHost 
              ? 'Impossible de créer la session' 
              : 'L\'hôte n\'est pas encore connecté';
          } else if (err.type === 'network') {
            errorMessage = 'Erreur réseau WebRTC';
          } else if (err.type === 'unavailable-id') {
            errorMessage = 'Session déjà en cours. Réessayez.';
          }

          updateState({ error: errorMessage });
          onError?.(errorMessage);
          
          // Don't resolve false for peer-unavailable (participant might connect before host)
          if (err.type !== 'peer-unavailable') {
            resolve(false);
          }
        });

        peer.on('disconnected', () => {
          console.log('[PEERJS] Disconnected from server');
          updateState({ isConnected: false });
        });

        peer.on('close', () => {
          console.log('[PEERJS] Peer closed');
          updateState({ isConnected: false, peerId: null });
        });

        // Timeout for connection
        setTimeout(() => {
          if (!state.isConnected && !peerRef.current?.open) {
            console.warn('[PEERJS] Connection timeout');
            resolve(false);
          }
        }, 10000);

      } catch (err) {
        console.error('[PEERJS] Connection exception:', err);
        updateState({ error: 'Erreur lors de la connexion' });
        resolve(false);
      }
    });
  }, [sessionId, isHost, generatePeerId, getHostPeerId, updateState, onPeerConnected, onPeerDisconnected, onReceiveAudio, onError, state.isConnected]);

  // Broadcast audio to all connected peers (Host only)
  const broadcastAudio = useCallback((stream: MediaStream) => {
    if (!isHost || !peerRef.current) {
      console.warn('[PEERJS] Cannot broadcast: not host or not connected');
      return;
    }

    currentStreamRef.current = stream;

    console.log('[PEERJS] 📢 Broadcasting to', dataConnectionsRef.current.size, 'peers');

    // Call all connected participants
    dataConnectionsRef.current.forEach((_, peerId) => {
      if (!connectionsRef.current.has(peerId)) {
        console.log('[PEERJS] Calling peer:', peerId);
        const call = peerRef.current!.call(peerId, stream);
        
        call.on('close', () => {
          connectionsRef.current.delete(peerId);
        });

        connectionsRef.current.set(peerId, call);
      }
    });

    updateState({ isBroadcasting: true });
  }, [isHost, updateState]);

  // Stop broadcasting (Host only)
  const stopBroadcast = useCallback(() => {
    if (!isHost) return;

    console.log('[PEERJS] Stopping broadcast');

    // Close all media connections
    connectionsRef.current.forEach((call, peerId) => {
      call.close();
      console.log('[PEERJS] Closed call to:', peerId);
    });
    connectionsRef.current.clear();

    currentStreamRef.current = null;
    updateState({ isBroadcasting: false });
  }, [isHost, updateState]);

  // Disconnect from PeerJS
  const disconnect = useCallback(() => {
    stopBroadcast();

    // Close all data connections
    dataConnectionsRef.current.forEach((conn) => {
      conn.close();
    });
    dataConnectionsRef.current.clear();

    // Destroy peer
    if (peerRef.current) {
      peerRef.current.destroy();
      peerRef.current = null;
    }

    // Clear remote audio
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
    }

    updateState({
      isConnected: false,
      peerId: null,
      connectedPeers: [],
      isBroadcasting: false,
    });

    console.log('[PEERJS] Disconnected');
  }, [stopBroadcast, updateState]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    state,
    connect,
    disconnect,
    broadcastAudio,
    stopBroadcast,
    remoteAudioRef,
  };
}

export default usePeerAudio;
