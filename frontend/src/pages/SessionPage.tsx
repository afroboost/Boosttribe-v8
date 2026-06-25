import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { Music, Users, Radio, Volume2, Headphones, Crown, Check, Lightbulb, AlertCircle, Sparkles, Cloud, Zap, Clock, Rocket, ArrowLeft, Mic, MicOff, RefreshCw } from 'lucide-react';
import { AudioPlayer } from '@/components/audio/AudioPlayer';
import { PlaylistDnD, Track } from '@/components/audio/PlaylistDnD';
import { ParticipantControls, Participant } from '@/components/audio/ParticipantControls';
import { MicrophoneControl } from '@/components/audio/MicrophoneControl';
import { TrackUploader } from '@/components/audio/TrackUploader';
import { AudioMixerPanel } from '@/components/audio/AudioMixerPanel';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useTheme } from '@/context/ThemeContext';
import { useSocket } from '@/context/SocketContext';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { generateSessionId } from '@/hooks/useAudioSync';
import { usePeerAudio } from '@/hooks/usePeerAudio';
import { useAudioMixer } from '@/hooks/useAudioMixer';
import { useMicrophone } from '@/hooks/useMicrophone';
import type { AudioState, SyncState, RepeatMode } from '@/hooks/useAudioSync';
import { isSupabaseConfigured, deleteTracks, savePlaylist, loadPlaylist, saveSessionDescription, saveSharedMedia } from '@/lib/supabaseClient';
import type { SharedMedia } from '@/lib/supabaseClient';
import supabase from '@/lib/supabaseClient';
import { AvatarUploadCrop } from '@/components/profile/AvatarUploadCrop';
import { SharedMediaPlayer } from '@/components/session/SharedMediaPlayer';
import type { RemoteMediaState } from '@/components/session/SharedMediaPlayer';
import { MediaShareControls } from '@/components/session/MediaShareControls';
import type { ShareMode } from '@/components/session/MediaShareControls';
import { SessionSocial } from '@/components/session/SessionSocial';
import { claimHost, setCohosts } from '@/lib/paymentApi';
import { Pencil } from 'lucide-react';

// LocalStorage key for nickname
const NICKNAME_STORAGE_KEY = 'bt_nickname';

// Types de payload Realtime (E/F/C) — déclarés hors composant pour éviter les faux positifs
// de react-hooks/exhaustive-deps (noms de propriétés confondus avec des variables d'état).
interface MediaCommandPayload { media: SharedMedia | null; isPlaying?: boolean; currentTime?: number; }
interface DescPayload { description: string; }
interface PlaylistChangeRow { tracks?: Track[]; cohosts?: string[]; description?: string }
interface PlaylistChangePayload { new?: PlaylistChangeRow; eventType?: string }

// ============================================
// 🛡️ INTERFACES TYPESCRIPT - Boosttribe V8 Stable Gold
// ============================================

/**
 * Session Supabase - Structure de la table 'playlists'
 */
export interface Session {
  id: string;
  session_id: string;
  tracks: Track[];
  host_id?: string;
  is_playing?: boolean;
  current_time?: number;
  created_at?: string;
}

/**
 * Track - Structure d'une piste audio
 * Import depuis PlaylistDnD.tsx pour cohérence
 */
// Track est importé depuis @/components/audio/PlaylistDnD

/**
 * Participant - Structure d'un participant à la session
 * Import depuis ParticipantControls.tsx pour cohérence
 */
// Participant est importé depuis @/components/audio/ParticipantControls

/**
 * HostCommand - Commandes Broadcast du Maître vers les Esclaves
 */
export interface HostCommand {
  action: 'PLAY' | 'PAUSE' | 'SEEK';
  currentTime: number;
  trackId?: number;
}

/**
 * MixerVolumes - Volumes par défaut du mixeur
 * Musique: 80% pour éviter saturation
 * Micro: 100% pour être bien entendu
 */
export const DEFAULT_MIXER_VOLUMES = {
  music: 0.8,     // 80% - évite saturation
  mic: 1.0,       // 100% - voix claire
  tribe: 1.0,     // 100% - participants audibles
  hostVoice: 1.0, // 100% - hôte audible pour participants
} as const;

// ============================================

// ⚠️ SUPPRESSION DÉFINITIVE DES DÉMOS
// La playlist démarre TOUJOURS vide - pas de fallback, pas de données de test
// Les pistes ne peuvent être ajoutées que par upload utilisateur

// Empty participants list - real participants will join via session link
const BASE_PARTICIPANTS: Participant[] = [];

// Helper functions for LocalStorage
function getStoredNickname(): string | null {
  try {
    return localStorage.getItem(NICKNAME_STORAGE_KEY);
  } catch {
    return null;
  }
}

function setStoredNickname(nickname: string): void {
  try {
    localStorage.setItem(NICKNAME_STORAGE_KEY, nickname);
  } catch (error) {
    console.warn('Failed to store nickname:', error);
  }
}

// POINT 2 : marqueur de "session active" par utilisateur (heartbeat localStorage).
// Une session est considérée active si son heartbeat date de moins de 90 s.
const ACTIVE_SESSION_TTL_MS = 90 * 1000;

function activeSessionKey(userId: string): string {
  return `bt_active_session_${userId}`;
}

function markActiveSession(userId: string, sessionId: string): void {
  try {
    localStorage.setItem(activeSessionKey(userId), JSON.stringify({ sessionId, ts: Date.now() }));
  } catch { /* ignore */ }
}

function clearActiveSession(userId: string, sessionId: string): void {
  try {
    const raw = localStorage.getItem(activeSessionKey(userId));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.sessionId === sessionId) localStorage.removeItem(activeSessionKey(userId));
    }
  } catch { /* ignore */ }
}

// Renvoie le nombre de sessions actives appartenant à l'utilisateur (0 ou 1 via le heartbeat),
// en ignorant éventuellement une session courante.
function countActiveSessions(userId: string, ignoreSessionId?: string): number {
  try {
    const raw = localStorage.getItem(activeSessionKey(userId));
    if (!raw) return 0;
    const parsed = JSON.parse(raw);
    if (!parsed?.sessionId || !parsed?.ts) return 0;
    if (parsed.sessionId === ignoreSessionId) return 0;
    return Date.now() - parsed.ts < ACTIVE_SESSION_TTL_MS ? 1 : 0;
  } catch {
    return 0;
  }
}

// Generate avatar initials from name
function generateAvatar(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.substring(0, 2).toUpperCase();
}

// Nickname Modal Component
interface NicknameModalProps {
  isOpen: boolean;
  isHost: boolean;
  onSubmit: (nickname: string) => void;
  theme: ReturnType<typeof useTheme>['theme'];
}

const NicknameModal: React.FC<NicknameModalProps> = ({ isOpen, isHost, onSubmit, theme }) => {
  const [nickname, setNickname] = useState(isHost ? 'Coach' : '');
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = nickname.trim();
    
    if (!trimmed) {
      setError('Veuillez entrer un pseudo');
      return;
    }
    
    if (trimmed.length < 2) {
      setError('Le pseudo doit contenir au moins 2 caractères');
      return;
    }
    
    if (trimmed.length > 20) {
      setError('Le pseudo ne peut pas dépasser 20 caractères');
      return;
    }
    
    onSubmit(trimmed);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
      />
      
      {/* Modal */}
      <Card 
        className="relative z-10 w-full max-w-md border-2 bg-black/90 backdrop-blur-xl"
        style={{ borderColor: theme.colors.primary }}
      >
        <CardHeader className="text-center pb-4">
          {/* Avatar preview */}
          <div className="flex justify-center mb-4">
            <div 
              className="w-20 h-20 rounded-full flex items-center justify-center text-2xl font-bold text-white"
              style={{ background: theme.colors.gradient.primary }}
            >
              {nickname ? generateAvatar(nickname) : '?'}
            </div>
          </div>
          
          <CardTitle 
            className="text-2xl text-white"
            style={{ fontFamily: "'Space Grotesk', sans-serif" }}
          >
            {isHost ? 'Bienvenue, Coach !' : 'Rejoindre la tribu'}
          </CardTitle>
          <CardDescription className="text-white/60">
            {isHost 
              ? 'Choisissez votre nom pour cette session'
              : 'Sous quel nom rejoignez-vous la tribu ?'
            }
          </CardDescription>
        </CardHeader>
        
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="nickname" className="text-white/70">
                Votre pseudo
              </Label>
              <Input
                id="nickname"
                type="text"
                value={nickname}
                onChange={(e) => {
                  setNickname(e.target.value);
                  setError('');
                }}
                placeholder={isHost ? 'Coach' : 'Entrez votre pseudo'}
                className="h-12 text-lg text-center bg-white/5 border-white/10 text-white placeholder:text-white/30 focus:border-[#8A2EFF]"
                autoFocus
                maxLength={20}
              />
            </div>

            {error && (
              <p className="text-red-400 text-sm text-center">{error}</p>
            )}

            <Button
              type="submit"
              className="w-full h-12 text-white border-none font-medium flex items-center justify-center gap-2"
              style={{
                background: theme.colors.gradient.primary,
                boxShadow: '0 4px 24px rgba(138, 46, 255, 0.35)',
              }}
            >
              {isHost ? <Music className="w-4 h-4" /> : <Headphones className="w-4 h-4" />}
              {isHost ? 'Démarrer la session' : "Rejoindre l'écoute"}
            </Button>
          </form>

          <p className="mt-4 text-center text-white/40 text-xs">
            Votre pseudo sera visible par tous les participants
          </p>
        </CardContent>
      </Card>
    </div>
  );
};

// Subscription Badge Component
const SubscriptionBadge: React.FC = () => {
  const { isAdmin, isSubscribed, profile } = useAuth();
  
  if (isAdmin) {
    return (
      <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30 flex items-center gap-1">
        <Crown className="w-3.5 h-3.5" />
        Mode Admin
      </Badge>
    );
  }

  if (isSubscribed) {
    return (
      <Badge className="bg-green-500/20 text-green-400 border-green-500/30 flex items-center gap-1">
        <Check className="w-3.5 h-3.5" />
        Abonné {profile?.subscription_status}
      </Badge>
    );
  }

  // A : le badge « Essai (1 titre) » est définitivement retiré de l'UI.
  return null;
};

// Session creation view
interface CreateSessionViewProps {
  onCreateSession: () => void;
  theme: ReturnType<typeof useTheme>['theme'];
}

const CreateSessionView: React.FC<CreateSessionViewProps> = ({ onCreateSession, theme }) => (
  <div 
    className="min-h-screen flex items-center justify-center p-4"
    style={{ background: '#000000' }}
  >
    {/* Background Effects */}
    <div className="fixed inset-0 overflow-hidden pointer-events-none">
      <div 
        className="absolute -top-1/4 -left-1/4 w-1/2 h-1/2 rounded-full opacity-20 blur-3xl"
        style={{ background: `radial-gradient(circle, ${theme.colors.primary} 0%, transparent 70%)` }}
      />
      <div 
        className="absolute -bottom-1/4 -right-1/4 w-1/2 h-1/2 rounded-full opacity-15 blur-3xl"
        style={{ background: `radial-gradient(circle, ${theme.colors.secondary} 0%, transparent 70%)` }}
      />
    </div>

    <Card className="w-full max-w-md border-white/10 bg-black/50 backdrop-blur-xl relative z-10">
      <CardHeader className="text-center">
        <div className="flex justify-center mb-4">
          <div 
            className="w-20 h-20 rounded-2xl flex items-center justify-center"
            style={{ background: theme.colors.gradient.primary }}
          >
            <svg viewBox="0 0 24 24" className="w-10 h-10 text-white" fill="currentColor">
              <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
            </svg>
          </div>
        </div>
        <CardTitle 
          className="text-2xl text-white"
          style={{ fontFamily: "'Space Grotesk', sans-serif" }}
        >
          Session d'écoute
        </CardTitle>
        <CardDescription className="text-white/50">
          Créez une nouvelle session pour partager votre musique en temps réel
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button
          onClick={onCreateSession}
          className="w-full h-12 text-white border-none font-medium flex items-center justify-center gap-2"
          style={{
            background: theme.colors.gradient.primary,
            boxShadow: '0 4px 24px rgba(138, 46, 255, 0.35)',
          }}
        >
          <Music className="w-4 h-4" />
          Créer une nouvelle session
        </Button>
        
        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t border-white/10" />
          </div>
          <div className="relative flex justify-center text-xs">
            <span className="bg-black px-2 text-white/40">ou</span>
          </div>
        </div>

        <div className="text-center">
          <p className="text-white/50 text-sm mb-2">
            Vous avez un lien de session ?
          </p>
          <p className="text-white/30 text-xs">
            Collez l'URL dans votre navigateur pour rejoindre
          </p>
        </div>

        <Link to="/" className="block">
          <Button 
            variant="outline" 
            className="w-full border-white/20 text-white/70 hover:bg-white/10"
          >
            <span className="inline-flex items-center gap-1"><ArrowLeft className="w-4 h-4" /> Retour à l'accueil</span>
          </Button>
        </Link>
      </CardContent>
    </Card>
  </div>
);

export const SessionPage: React.FC = () => {
  const { sessionId: urlSessionId } = useParams<{ sessionId?: string }>();
  const navigate = useNavigate();
  const { theme } = useTheme();
  const { showToast } = useToast();
  const socket = useSocket();
  const { isAdmin, user, profile, refreshProfile, isLoading: authLoading, isSubscribed, sessionLimit } = useAuth();
  
  // ADMIN BYPASS: Check email directly for instant host access
  const userEmail = user?.email?.toLowerCase() || '';
  const isAdminByEmail = userEmail === 'contact.artboost@gmail.com';
  const isAdminUser = isAdminByEmail || isAdmin;

  // 🎤 DROIT D'HÉBERGER = être AUTHENTIFIÉ (pas l'abonnement).
  // L'offre gratuite autorise 1 session active (1 titre/30s) : tout utilisateur connecté
  // peut donc créer et contrôler SA session en tant qu'hôte. L'abonnement ne fait que
  // lever la limite de titres (gérée par trackLimit/canUploadTrack dans TrackUploader).
  const hasHostPrivileges = !!user;
  
  // Audio element ref for remote mute control
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  
  // 🔒 CALCUL ROBUSTE DE isHost:
  // 1. Création de session (pas d'URL) = toujours host
  // 2. Tout utilisateur AUTHENTIFIÉ (hasHostPrivileges = !!user) = host de sa session
  // 3. Visiteur non connecté ouvrant un lien = participant (lecture seule)
  const [isHost, setIsHost] = useState<boolean>(() => {
    // Si création de session (pas d'URL ID), toujours host
    if (!urlSessionId) return true;
    // Hôte si connecté (gratuit/abonné/admin). bt_is_admin = bypass admin instantané.
    const isAdminStored = sessionStorage.getItem('bt_is_admin') === 'true';
    return isAdminStored || hasHostPrivileges;
  });
  const [sessionId, setSessionId] = useState<string | null>(urlSessionId || null);
  
  // Admin/Subscriber bypass
  useEffect(() => {
    if (hasHostPrivileges && !isHost) {
      setIsHost(true);
    }
  }, [hasHostPrivileges, isHost]);
  
  // Nickname state
  const [nickname, setNickname] = useState<string | null>(null);
  const [showNicknameModal, setShowNicknameModal] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  
  // Remote mute state (controlled by host)
  const [isRemoteMuted, setIsRemoteMuted] = useState(false);
  
  // Playlist state - TOUJOURS vide au démarrage, jamais de fallback
  const [tracks, setTracks] = useState<Track[]>([]);
  const [selectedTrack, setSelectedTrack] = useState<Track | null>(null);
  const [isSyncActive, setIsSyncActive] = useState(false); // État de synchronisation Cloud
  const [hostIsPlaying, setHostIsPlaying] = useState(false); // 🔄 Sync Play/Pause
  
  // Participants state with volume/mute controls
  const [participantsState, setParticipantsState] = useState<Participant[]>(BASE_PARTICIPANTS);
  
  // Host mic state
  const [hostMicActive, setHostMicActive] = useState(false);
  const [hostMicStream, setHostMicStream] = useState<MediaStream | null>(null);
  
  const [audioState, setAudioState] = useState<AudioState | null>(null);
  const [syncState, setSyncState] = useState<SyncState | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>('none');
  const [autoPlayPending, setAutoPlayPending] = useState<string | null>(null);
  // 🔊 BUG 1: autoplay bloqué côté participant (NotAllowedError) → bouton geste utilisateur
  const [audioBlocked, setAudioBlocked] = useState(false);

  // 🔇 Décisions de mute de l'hôte (persistées localement, indépendantes de la presence)
  const [mutedUserIds, setMutedUserIds] = useState<Set<string>>(new Set());
  // 🔊 Volumes par participant (overlay local, la presence ne transporte pas le volume)
  const [userVolumes, setUserVolumes] = useState<Record<string, number>>({});

  // B : photo de profil — avatar courant (compte) ou data URL locale (anonyme)
  const [localAvatar, setLocalAvatar] = useState<string | null>(null);
  const myAvatar = profile?.avatar_url || localAvatar || null;
  const [showAvatarCrop, setShowAvatarCrop] = useState(false);
  const pendingAfterAvatarRef = useRef<(() => void) | null>(null);

  // C : description de session
  const [description, setDescription] = useState('');
  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState('');

  // E : média partagé (vidéo/image/youtube/vimeo/lien) + état distant pour les participants
  const [sharedMedia, setSharedMedia] = useState<SharedMedia | null>(null);
  const [remoteMediaState, setRemoteMediaState] = useState<RemoteMediaState | null>(null);
  // Item 6 : le sélecteur de mode pilote TOUTE la zone centrale (audio = lecteur + playlist ;
  // vidéo/image/lien = uniquement le média partagé). Hôte/co-host le contrôlent via le sélecteur ;
  // les participants le dérivent du média reçu (effet plus bas).
  const [shareMode, setShareMode] = useState<ShareMode>('audio');
  const mediaSeqRef = useRef(0);

  // F : co-animateurs autorisés à partager (userId)
  const [coHostIds, setCoHostIds] = useState<Set<string>>(new Set());
  const isCoHost = !isHost && !!user && coHostIds.has(socket.userId);
  const canShare = isHost || isCoHost;

  // 💓 POINT 3a: dernier état de lecture de l'hôte (pour heartbeat de resynchro)
  const heartbeatStateRef = useRef<{ isPlaying: boolean; currentTime: number; trackId: number | null }>({
    isPlaying: false,
    currentTime: 0,
    trackId: null,
  });

  // 🎧 AUDIO MIXER: Canaux indépendants pour musique et voix
  const {
    state: mixerState,
    initialize: initializeMixer,
    setMusicVolume,
    setMicVolume,
    setTribeVolume,
    setHostVoiceVolume,
    connectMicSource,
  } = useAudioMixer({
    onInitialized: () => {
      // Silencieux - démarrage réussi
    },
  });

  // 🎚️ POINT 4: "Volume Musique" du mixeur contrôle réellement le gain de l'élément <audio>
  const handleMusicVolumeChange = useCallback((volume: number) => {
    setMusicVolume(volume);
    const audioEl = document.querySelector('audio') as HTMLAudioElement | null;
    if (audioEl) {
      audioEl.volume = Math.max(0, Math.min(1, volume));
    }
  }, [setMusicVolume]);


  // Initialiser le mixeur au premier clic (user gesture required)
  useEffect(() => {
    const handleFirstInteraction = () => {
      if (!mixerState.isInitialized) {
        initializeMixer();
      }
      document.removeEventListener('click', handleFirstInteraction);
    };
    document.addEventListener('click', handleFirstInteraction);
    return () => document.removeEventListener('click', handleFirstInteraction);
  }, [mixerState.isInitialized, initializeMixer]);

  // FREE TRIAL LIMIT: 5 minutes (300 seconds)
  // ⚠️ UNIQUEMENT pour l'hôte - Les participants ont une écoute illimitée
  const FREE_TRIAL_LIMIT_SECONDS = 300;
  const [totalPlayTime, setTotalPlayTime] = useState(0);
  const [trialLimitReached, setTrialLimitReached] = useState(false);
  const playTimeIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Check if HOST is on free trial (participants are always unlimited)
  const isFreeTrial = isHost && !isSubscribed;

  // PeerJS for WebRTC voice broadcast
  const {
    state: peerState,
    connect: connectPeer,
    disconnect: disconnectPeer,
    broadcastAudio,
    stopBroadcast,
    talkToHost,
    stopTalkToHost,
    setTribeVolume: setTribeAudioVolume,
    remoteAudioRef,
  } = usePeerAudio({
    sessionId: sessionId || 'default',
    isHost,
    onPeerConnected: () => {},
    onPeerDisconnected: () => {},
    onReceiveAudio: () => {},
    onVoiceStart: () => {},
    onVoiceEnd: () => {},
    // 👥 POINT 1.3 : la voix participant est jouée en direct via <audio> dédié (dans usePeerAudio).
    // Plus de routage Web Audio ici → latence minimale, pas d'écho/interférences.
    onReceiveTribeAudio: () => {},
    onTribeAudioEnd: () => {},
    onError: (error) => {
      console.error('[WebRTC] Error:', error);
    },
    onReady: () => {
      if (isHost && socket.isSupabaseMode) {
        socket.broadcast('HOST_MIC_READY', { hostPeerId: `beattribe-host-${sessionId?.replace(/[^a-zA-Z0-9]/g, '')}` });
      }
    },
  });

  // 🔊 POINT 1.6 : "Volume Tribu" met à jour l'affichage ET le volume des <audio> participants
  const handleTribeVolumeChange = useCallback((volume: number) => {
    setTribeVolume(volume);       // état du slider
    setTribeAudioVolume(volume);  // volume direct des <audio> tribu (zéro latence)
  }, [setTribeVolume, setTribeAudioVolume]);

  // Host: Broadcast VOICE_START when mic is active
  useEffect(() => {
    if (isHost && hostMicStream && peerState.isBroadcasting && socket.isSupabaseMode) {
      socket.broadcast('VOICE_START', { timestamp: Date.now() });
    }
  }, [isHost, hostMicStream, peerState.isBroadcasting, socket]);

  // 🔌 OBJECTIF A: Connexion du peer liée à la SESSION (hôte ET participant), pas au micro.
  // L'hôte se connecte dès l'entrée → prêt à RÉPONDRE aux prises de parole, micro ON ou OFF.
  // Garde anti-churn : connexion UNE seule fois (les callbacks inline de usePeerAudio
  // changent d'identité à chaque render, on ne dépend donc pas de connectPeer ici).
  const peerConnectedRef = useRef(false);
  useEffect(() => {
    if (!sessionId || !nickname || peerConnectedRef.current) return;
    peerConnectedRef.current = true;
    connectPeer(); // sans flux : l'hôte répond aux appels, le participant rejoint l'hôte
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, nickname]);

  // Nettoyage propre du peer à la sortie de la session
  useEffect(() => {
    return () => {
      disconnectPeer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 🎤 OBJECTIF A + POINT 5: l'activation du micro hôte ne fait qu'AJOUTER/RETIRER le flux
  // sortant via le GainNode "Mon Micro" (anti-larsen). Le peer reste connecté indépendamment.
  // On n'agit que sur un VRAI changement de flux (on/off) → pas de churn de source audio.
  const broadcastedStreamRef = useRef<MediaStream | null>(null);
  useEffect(() => {
    if (!isHost) return;
    if (hostMicStream === broadcastedStreamRef.current) return;
    broadcastedStreamRef.current = hostMicStream;

    if (hostMicStream) {
      initializeMixer();
      const micBroadcastStream = connectMicSource(hostMicStream);
      broadcastAudio(micBroadcastStream); // mémorise le flux, diffuse aux participants connectés
    } else {
      stopBroadcast(); // retire le flux sortant, garde le peer actif
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHost, hostMicStream]);

  // 🎤 POINT 5: PARTICIPANT — "Prendre la parole" (micro montant vers l'hôte)
  const [isTalking, setIsTalking] = useState(false);
  const participantMic = useMicrophone({
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  });

  // Quand le micro participant est prêt et qu'il a pris la parole → envoyer à l'hôte
  useEffect(() => {
    if (isHost || !isTalking) return;
    if (participantMic.state.isCapturing && participantMic.audioStream) {
      talkToHost(participantMic.audioStream);
    }
  }, [isHost, isTalking, participantMic.state.isCapturing, participantMic.audioStream, talkToHost]);

  const handleToggleTalk = useCallback(async () => {
    if (isTalking) {
      stopTalkToHost();
      participantMic.stopCapture();
      setIsTalking(false);
      showToast('Vous avez rendu la parole', 'default');
    } else {
      const ok = await participantMic.startCapture();
      if (ok) {
        setIsTalking(true);
        showToast('Vous avez la parole', 'success');
      }
    }
  }, [isTalking, participantMic, stopTalkToHost, showToast]);

  // Auto-play effect: when a new track is set via autoplay, force play
  useEffect(() => {
    if (autoPlayPending && selectedTrack && selectedTrack.src === autoPlayPending) {
      const timer = setTimeout(() => {
        const audioEl = document.querySelector('audio');
        if (audioEl) {
          audioEl.play().catch(err => {
            console.warn('[AUTOPLAY HOST] Play blocked:', err);
          });
        }
        setAutoPlayPending(null);
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [autoPlayPending, selectedTrack]);

  // Handle track ended - autoplay next track with sync
  const handleTrackEnded = useCallback(() => {
    if (!isHost || !selectedTrack) return;
    
    if (tracks.length === 0) return;
    
    const currentIndex = tracks.findIndex(t => t.id === selectedTrack.id);
    if (currentIndex === -1) return;

    // 🔁 BUG 2: repeat 'one' → le titre vient d'être relancé localement (useAudioSync).
    // On re-broadcaste pour que les participants relancent le même titre depuis 0.
    if (repeatMode === 'one') {
      socket.syncPlayback(true, 0, selectedTrack.id);
      return;
    }

    let nextTrack: Track | null = null;

    if (repeatMode === 'all') {
      const nextIndex = (currentIndex + 1) % tracks.length;
      nextTrack = tracks[nextIndex];
    } else if (repeatMode === 'none') {
      if (currentIndex < tracks.length - 1) {
        nextTrack = tracks[currentIndex + 1];
      } else {
        showToast('Fin de la playlist', 'default');
        return;
      }
    }
    
    if (nextTrack) {
      setSelectedTrack(nextTrack);
      setAutoPlayPending(nextTrack.src);
      showToast(`Enchaînement : ${nextTrack.title}`, 'success');
      socket.syncPlaylist(tracks, nextTrack.id);
      socket.syncPlayback(true, 0, nextTrack.id);
    }
  }, [isHost, tracks, selectedTrack, repeatMode, socket, showToast]);

  // Join socket session when session ID is available
  useEffect(() => {
    if (sessionId && socket.userId && nickname) {
      socket.joinSession(sessionId, socket.userId, isHost, nickname, myAvatar || undefined);
    }
    
    return () => {
      if (socket.isConnected) {
        socket.leaveSession();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, socket.userId, nickname, isHost]);

  // Listen for remote mute commands (for participants)
  useEffect(() => {
    if (isHost) return;
    
    const unsubMute = socket.onMuted((muted) => {
      setIsRemoteMuted(muted);
      if (audioElementRef.current) {
        audioElementRef.current.muted = muted;
      }
    });
    
    return unsubMute;
  }, [socket, isHost]);

  // Listen for ejection (for participants)
  useEffect(() => {
    if (isHost) return;
    
    const unsubEject = socket.onEjected(() => {
      // Navigation and toast are handled in SocketContext
    });
    
    return unsubEject;
  }, [socket, isHost]);

  // Listen for playlist sync (for participants)
  useEffect(() => {
    if (isHost) return;
    
    const unsubPlaylist = socket.onPlaylistSync((payload) => {
      const safeTracks = Array.isArray(payload.tracks) ? payload.tracks : [];
      setTracks(safeTracks as Track[]);
      
      if (safeTracks.length > 0) {
        const newSelected = safeTracks.find(t => t.id === payload.selectedTrackId);
        if (newSelected) {
          setSelectedTrack(newSelected as Track);
          showToast(`Piste suivante : ${(newSelected as Track).title}`, 'default');
        }
      } else {
        setSelectedTrack(null);
      }
    });
    
    return unsubPlaylist;
  }, [socket, isHost, showToast]);

  // Listen for playback sync (for participants to auto-play new tracks)
  useEffect(() => {
    if (isHost) return;
    
    const unsubPlayback = socket.onPlaybackSync((payload) => {
      const targetTrack = tracks.find(t => t.id === payload.trackId);
      if (targetTrack) {
        // POINT 1: synchro silencieuse (plus de toast "Enchaînement" qui spamme, surtout en repeat)
        setSelectedTrack(targetTrack);

        setTimeout(() => {
          const audioEl = document.querySelector('audio');
          if (audioEl && payload.isPlaying) {
            audioEl.currentTime = payload.currentTime || 0;
            audioEl.play().catch((err) => {
              // 🔊 BUG 1: autoplay bloqué (NotAllowedError) → demander un geste utilisateur
              console.warn('[PARTICIPANT] Autoplay bloqué:', err);
              setAudioBlocked(true);
            });
          }
        }, 100);
      }
    });
    
    return unsubPlayback;
  }, [socket, isHost, tracks, showToast]);

  // 🔄 SUPABASE REALTIME: Sync playlist changes for participants
  useEffect(() => {
    if (!sessionId || !supabase || !isSupabaseConfigured) return;
    
    // ⚡ OPTIMISATION SRE: Exécuter fetch initial ET connexion Realtime EN PARALLÈLE
    
    // 📡 FETCH INITIAL (non-bloquant)
    const fetchPromise = (async () => {
      if (!supabase) return;
      
      try {
        const { data, error } = await supabase
          .from('playlists')
          .select('tracks, description, shared_media')
          .eq('session_id', sessionId)
          .maybeSingle();

        if (error) return;

        // C : charger la description ; E : média partagé courant
        if (data) {
          if (typeof data.description === 'string') setDescription(data.description);
          if (data.shared_media) setSharedMedia(data.shared_media as SharedMedia);
        }

        // F : co-animateurs (autorité DB) — requête séparée tolérante (colonne optionnelle)
        try {
          const { data: cd } = await supabase
            .from('playlists')
            .select('cohosts')
            .eq('session_id', sessionId)
            .maybeSingle();
          if (cd && Array.isArray((cd as { cohosts?: string[] }).cohosts)) {
            setCoHostIds(new Set((cd as { cohosts: string[] }).cohosts));
          }
        } catch { /* colonne cohosts pas encore créée → ignoré */ }

        if (data && data.tracks && Array.isArray(data.tracks) && data.tracks.length > 0) {
          setTracks(data.tracks as Track[]);
          setIsSyncActive(true);

          if (!selectedTrack) {
            setSelectedTrack(data.tracks[0] as Track);
          }
        } else {
          setIsSyncActive(true);
        }
      } catch (err) {
        setIsSyncActive(true);
      }
    })();
    
    // 📡 REALTIME CHANNEL pour la playlist (connexion en parallèle)
    const channel = supabase
      .channel(`playlist:${sessionId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'playlists',
          filter: `session_id=eq.${sessionId}`,
        },
        (payload) => {
          handlePlaylistUpdate(payload);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'playlists',
          filter: `session_id=eq.${sessionId}`,
        },
        (payload) => {
          handlePlaylistUpdate(payload);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'playlists',
          filter: `session_id=eq.${sessionId}`,
        },
        (payload) => {
          if (!isHost) {
            setTracks([]);
            setSelectedTrack(null);
            showToast('La playlist a été supprimée par l\'hôte', 'warning');
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setIsSyncActive(true);
        }
      });

    // 🔄 CANAL BROADCAST MAÎTRE/ESCLAVE pour la synchronisation Play/Pause
    // L'hôte est le MAÎTRE : il envoie les commandes
    // Les participants sont ESCLAVES : ils obéissent instantanément
    const playbackChannel = supabase
      .channel(`playback:${sessionId}`)
      .on('broadcast', { event: 'HOST_COMMAND' }, (payload) => {
        // ⚠️ PARTICIPANT ESCLAVE : écouter et obéir aux commandes de l'hôte
        if (!isHost && payload.payload) {
          const command = payload.payload as {
            action: 'PLAY' | 'PAUSE' | 'SEEK' | 'STATE';
            currentTime: number;
            trackId?: number;
            isPlaying?: boolean;
          };

          const audioEl = document.querySelector('audio') as HTMLAudioElement;
          if (!audioEl) return;

          // Synchroniser la piste si fournie
          if (command.trackId && tracks.length > 0) {
            const targetTrack = tracks.find(t => t.id === command.trackId);
            if (targetTrack && selectedTrack?.id !== command.trackId) {
              setSelectedTrack(targetTrack);
            }
          }

          // 🔊 Lance la lecture côté participant ; ouvre l'overlay si autoplay bloqué
          const tryPlay = () => {
            audioEl.play().catch((err) => {
              console.warn('[PARTICIPANT] Autoplay bloqué (commande hôte):', err);
              setAudioBlocked(true);
            });
          };

          switch (command.action) {
            case 'PAUSE':
              // ⏸️ PAUSE IMMÉDIATE - L'esclave obéit (POINT 1: synchro silencieuse, plus de toast)
              if (!audioEl.paused) {
                audioEl.pause();
              }
              setHostIsPlaying(false);
              break;

            case 'PLAY':
              // ▶️ LECTURE - L'esclave reprend à la position exacte (POINT 1: silencieux)
              audioEl.currentTime = command.currentTime || 0;
              tryPlay();
              setHostIsPlaying(true);
              break;

            case 'SEEK':
              // 🔄 SYNCHRONISATION DE POSITION
              if (Math.abs(audioEl.currentTime - command.currentTime) > 1) {
                audioEl.currentTime = command.currentTime;
              }
              break;

            case 'STATE':
              // 💓 POINT 3a: heartbeat de l'hôte → resynchro complète (reconnexion / arrière-plan)
              if (command.isPlaying) {
                if (audioEl.paused) {
                  // Le participant avait raté le PLAY (join tardif) → on relance à la bonne position
                  audioEl.currentTime = command.currentTime || 0;
                  tryPlay();
                } else if (Math.abs(audioEl.currentTime - command.currentTime) > 1.5) {
                  // Dérive trop importante → on recale
                  audioEl.currentTime = command.currentTime;
                }
                setHostIsPlaying(true);
              } else {
                if (!audioEl.paused) {
                  audioEl.pause();
                }
                setHostIsPlaying(false);
              }
              break;
          }
        }
      })
      // E : média partagé (vidéo/image/lien) — les participants suivent l'hôte
      .on('broadcast', { event: 'MEDIA_COMMAND' }, (payload) => {
        if (isHost || !payload.payload) return;
        const p = payload.payload as MediaCommandPayload;
        setSharedMedia(p.media);
        if (p.media) {
          mediaSeqRef.current += 1;
          setRemoteMediaState({ isPlaying: !!p.isPlaying, currentTime: p.currentTime || 0, seq: mediaSeqRef.current });
        } else {
          setRemoteMediaState(null);
        }
      })
      // F : les co-animateurs ne sont PLUS dérivés d'un broadcast (spoofable) mais de la DB
      //     (playlists.cohosts), écrite par le backend host-only et reçue via postgres_changes.
      // C : mise à jour live de la description
      .on('broadcast', { event: 'DESC_UPDATE' }, (payload) => {
        if (isHost || !payload.payload) return;
        const p = payload.payload as DescPayload;
        setDescription(p.description || '');
      })
      .subscribe();

    // Handler pour INSERT et UPDATE (playlist seulement)
    function handlePlaylistUpdate(payload: unknown) {
      const data = payload as PlaylistChangePayload;

      // F : co-animateurs depuis la DB (autorité). Tous les clients dérivent la liste de playlists.cohosts.
      if (data.new && Array.isArray(data.new.cohosts)) {
        setCoHostIds(new Set(data.new.cohosts));
      }
      // C : description live (participants)
      if (data.new && typeof data.new.description === 'string' && !isHost) {
        setDescription(data.new.description);
      }

      // Synchroniser la playlist uniquement
      if (data.new && 'tracks' in data.new) {
        const newTracks = data.new.tracks || [];

        if (!isHost) {
          setTracks(newTracks);
          showToast('Playlist synchronisée', 'default');

          if (newTracks.length > 0 && !selectedTrack) {
            setSelectedTrack(newTracks[0]);
          }
        }
      }
    }

    return () => {
      setIsSyncActive(false);
      if (supabase) {
        supabase.removeChannel(channel);
        supabase.removeChannel(playbackChannel);
      }
    };
  }, [sessionId, isHost, showToast, selectedTrack, user?.id, tracks]);

  // 👥 POINT 2: Peupler la liste des participants depuis la Presence Realtime (temps réel).
  // On exclut soi-même (ajouté séparément dans le useMemo ci-dessous) et on applique
  // les overlays locaux (mute décidé par l'hôte, volume par participant).
  useEffect(() => {
    const others: Participant[] = socket.presentUsers
      .filter(u => u.userId !== socket.userId)
      .map(u => ({
        id: u.userId,
        name: u.nickname || 'Invité',
        avatar: generateAvatar(u.nickname || 'Invité'),
        avatarUrl: u.avatar,
        isSynced: true,
        isCurrentUser: false,
        isHost: u.isHost,
        isCoHost: coHostIds.has(u.userId),
        volume: userVolumes[u.userId] ?? 100,
        isMuted: mutedUserIds.has(u.userId),
      }));
    setParticipantsState(others);
  }, [socket.presentUsers, socket.userId, mutedUserIds, userVolumes, coHostIds]);

  // Build participants list with current user
  const participants = useMemo<Participant[]>(() => {
    if (!nickname) return participantsState;

    const currentUser: Participant = {
      id: socket.userId,
      name: nickname,
      avatar: generateAvatar(nickname),
      avatarUrl: myAvatar || undefined,
      isSynced: true,
      isCurrentUser: true,
      isHost: isHost,
      isCoHost: isCoHost,
      volume: 100,
      isMuted: isRemoteMuted,
    };

    // Place current user at the top
    return [currentUser, ...participantsState];
  }, [nickname, isHost, isCoHost, myAvatar, participantsState, socket.userId, isRemoteMuted]);

  // FREE TRIAL TIME TRACKING
  useEffect(() => {
    if (!isFreeTrial || trialLimitReached) return;

    const checkPlayback = () => {
      const audioEl = document.querySelector('audio') as HTMLAudioElement;
      if (audioEl && !audioEl.paused) {
        setTotalPlayTime(prev => {
          const newTime = prev + 1;
          if (newTime >= FREE_TRIAL_LIMIT_SECONDS) {
            setTrialLimitReached(true);
            audioEl.pause();
            showToast('Limite d\'essai gratuit atteinte (5 min). Passez à un abonnement Pro pour une écoute illimitée.', 'warning');
          }
          return newTime;
        });
      }
    };

    playTimeIntervalRef.current = setInterval(checkPlayback, 1000);

    return () => {
      if (playTimeIntervalRef.current) {
        clearInterval(playTimeIntervalRef.current);
      }
    };
  }, [isFreeTrial, trialLimitReached, showToast]);

  // Participant moderation handlers (Host only - sends socket commands)
  // ⚠️ Les id ciblés sont les userId issus de la Presence → cohérents avec
  //    muteUser/ejectUser → CMD_MUTE_USER/CMD_EJECT_USER (targetUserId === userId du participant).
  const handleParticipantVolumeChange = useCallback((id: string, volume: number) => {
    setUserVolumes(prev => ({ ...prev, [id]: volume }));

    if (isHost) {
      socket.setUserVolume(id, volume);
    }
  }, [isHost, socket]);

  const handleParticipantMuteToggle = useCallback((id: string) => {
    const participant = participantsState.find(p => p.id === id);
    const newMuted = !mutedUserIds.has(id);

    setMutedUserIds(prev => {
      const next = new Set(prev);
      if (newMuted) next.add(id); else next.delete(id);
      return next;
    });

    if (isHost) {
      if (newMuted) {
        socket.muteUser(id);
        showToast(`${participant?.name || 'Participant'} mis en sourdine`, 'warning');
      } else {
        socket.unmuteUser(id);
        showToast(`${participant?.name || 'Participant'} réactivé`, 'success');
      }
    }
  }, [isHost, participantsState, mutedUserIds, socket, showToast]);

  const handleParticipantEject = useCallback((id: string) => {
    const participant = participantsState.find(p => p.id === id);

    // Retrait optimiste ; la Presence (leave) réconciliera quand le client se déconnecte
    setParticipantsState(prev => prev.filter(p => p.id !== id));

    if (isHost) {
      socket.ejectUser(id);
      showToast(`${participant?.name || 'Participant'} a été éjecté`, 'success');
    }
  }, [isHost, participantsState, socket, showToast]);

  // E/F : ref vers le média courant + envoi d'événements sur le canal de lecture
  const sharedMediaRef = useRef<SharedMedia | null>(null);
  useEffect(() => { sharedMediaRef.current = sharedMedia; }, [sharedMedia]);

  // Item 6 : maintenir shareMode cohérent.
  // - Hôte : pilote librement via le sélecteur (qui inclut "Audio").
  // - Co-host : pas de panneau audio → ne jamais rester bloqué sur 'audio'.
  // - Participant : dérive le mode du média reçu (média ⇒ on cache lecteur audio + playlist).
  useEffect(() => {
    if (canShare) {
      if (!isHost) setShareMode((m) => (m === 'audio' ? 'video' : m));
      return;
    }
    if (!sharedMedia) { setShareMode('audio'); return; }
    setShareMode(sharedMedia.type === 'image' ? 'image' : sharedMedia.type === 'video' ? 'video' : 'link');
  }, [canShare, isHost, sharedMedia]);

  const sendPlaybackEvent = useCallback((event: string, payload: unknown) => {
    if (!sessionId || !supabase || !isSupabaseConfigured) return;
    supabase.channel(`playback:${sessionId}`).send({ type: 'broadcast', event, payload });
  }, [sessionId]);

  // E : partager un média (vidéo/image/lien)
  const handleShareMedia = useCallback((media: SharedMedia) => {
    setSharedMedia(media);
    if (sessionId) saveSharedMedia(sessionId, media);
    sendPlaybackEvent('MEDIA_COMMAND', { media, isPlaying: media.isPlaying ?? false, currentTime: media.currentTime ?? 0 });
  }, [sessionId, sendPlaybackEvent]);

  // E : état de lecture du média (hôte/co-animateur) → diffusé aux participants
  const handleMediaState = useCallback((s: { isPlaying: boolean; currentTime: number }) => {
    const media = sharedMediaRef.current ? { ...sharedMediaRef.current, isPlaying: s.isPlaying, currentTime: s.currentTime } : null;
    setSharedMedia(media);
    sendPlaybackEvent('MEDIA_COMMAND', { media, isPlaying: s.isPlaying, currentTime: s.currentTime });
  }, [sendPlaybackEvent]);

  // E : retirer le média partagé
  const handleCloseMedia = useCallback(() => {
    setSharedMedia(null);
    if (sessionId) saveSharedMedia(sessionId, null);
    sendPlaybackEvent('MEDIA_COMMAND', { media: null });
  }, [sessionId, sendPlaybackEvent]);

  // C : édition de la description de session (hôte)
  const handleStartEditDesc = useCallback(() => {
    setDescDraft(description);
    setEditingDesc(true);
  }, [description]);

  const handleSaveDescription = useCallback(() => {
    const text = descDraft.trim().slice(0, 140);
    setDescription(text);
    setEditingDesc(false);
    if (sessionId) saveSessionDescription(sessionId, text);
    sendPlaybackEvent('DESC_UPDATE', { description: text });
  }, [descDraft, sessionId, sendPlaybackEvent]);

  // F : autoriser/retirer un co-animateur — autorité SERVEUR (backend host-only).
  // La liste est persistée dans playlists.cohosts ; tous les clients la dérivent via postgres_changes.
  const handleToggleCoHost = useCallback(async (id: string, makeCoHost: boolean) => {
    if (!isHost || !sessionId) return;
    const next = new Set(coHostIds);
    if (makeCoHost) next.add(id); else next.delete(id);
    setCoHostIds(next); // optimiste ; réconcilié par la DB

    const p = participantsState.find(x => x.id === id);
    const { ok, error } = await setCohosts(sessionId, Array.from(next));
    if (ok) {
      showToast(
        makeCoHost ? `${p?.name || 'Participant'} peut maintenant partager` : `Partage retiré pour ${p?.name || 'Participant'}`,
        makeCoHost ? 'success' : 'default',
      );
    } else {
      setCoHostIds(coHostIds); // rollback
      showToast(error || 'Échec de la mise à jour des co-animateurs', 'error');
    }
  }, [isHost, sessionId, coHostIds, participantsState, showToast]);

  // 💾 OBJECTIF B: Sauvegarde STABLE de la playlist du coach, liée à son COMPTE.
  // Clé dérivée de l'utilisateur (indépendante du session_id aléatoire) → retrouvée à la reconnexion.
  const ownerPlaylistKey = useMemo(
    () => (user?.id ? `owner-${user.id}` : null),
    [user?.id]
  );

  const persistOwnerPlaylist = useCallback((newTracks: Track[], selectedId: number) => {
    if (!isHost || !ownerPlaylistKey || !isSupabaseConfigured) {
      console.log('[PLAYLIST] save owner skipped', { isHost, ownerPlaylistKey, isSupabaseConfigured });
      return;
    }
    // Ligne dédiée au compte (séparée de la ligne de session live → ne casse pas la synchro participant)
    console.log('[PLAYLIST] save owner', ownerPlaylistKey, '→', newTracks.length, 'tracks');
    savePlaylist({
      session_id: ownerPlaylistKey,
      tracks: newTracks,
      selected_track_id: selectedId,
    }).then((ok) => console.log('[PLAYLIST] save owner result:', ok));
  }, [isHost, ownerPlaylistKey]);

  // Playlist reorder handler (syncs via socket for participants)
  const handlePlaylistReorder = useCallback((newTracks: Track[]) => {
    setTracks(newTracks);
    showToast('Playlist réorganisée', 'success');

    if (isHost && selectedTrack) {
      socket.syncPlaylist(newTracks, selectedTrack.id);
      persistOwnerPlaylist(newTracks, selectedTrack.id);
    }
  }, [showToast, isHost, socket, selectedTrack, persistOwnerPlaylist]);

  // Track selection handler (syncs via socket)
  const handleTrackSelectWithSync = useCallback((track: Track) => {
    if (!isHost) return;
    setSelectedTrack(track);
    showToast(`Piste sélectionnée: ${track.title}`, 'success');
    socket.syncPlaylist(tracks, track.id);
    persistOwnerPlaylist(tracks, track.id);
  }, [showToast, isHost, socket, tracks, persistOwnerPlaylist]);

  // POINT 4b: non-abonné à la limite → notification puis redirection vers le paiement
  const handleUpgradeRequest = useCallback(() => {
    showToast('Passez Premium pour ajouter plusieurs titres', 'warning');
    navigate('/pricing');
  }, [showToast, navigate]);

  // Handle track upload
  const handleTrackUploaded = useCallback((newTrack: Track) => {
    if (tracks.length >= 10) {
      showToast('Limite de 10 titres atteinte', 'warning');
      return;
    }
    
    setTracks(prev => [...prev, newTrack]);
    
    if (!selectedTrack) {
      setSelectedTrack(newTrack);
    }
    
    showToast(`"${newTrack.title}" ajouté à la playlist`, 'success');
    
    const updatedTracks = [...tracks, newTrack];
    const trackIdToSync = selectedTrack?.id || newTrack.id;
    socket.syncPlaylist(updatedTracks, trackIdToSync);
    socket.savePlaylistToDb(updatedTracks, trackIdToSync);
    persistOwnerPlaylist(updatedTracks, trackIdToSync);
  }, [tracks, selectedTrack, socket, showToast, persistOwnerPlaylist]);

  // Handle track deletion
  const handleDeleteTracks = useCallback(async (tracksToDelete: Track[]) => {
    if (!isHost || tracksToDelete.length === 0) return;
    
    const trackUrls = tracksToDelete.map(t => t.src);
    const trackIds = new Set(tracksToDelete.map(t => t.id));
    
    await deleteTracks(trackUrls);
    
    const updatedTracks = tracks.filter(t => !trackIds.has(t.id));
    setTracks(updatedTracks);
    
    if (selectedTrack && trackIds.has(selectedTrack.id)) {
      const nextTrack = updatedTracks.length > 0 ? updatedTracks[0] : null;
      setSelectedTrack(nextTrack);
    }
    
    if (tracksToDelete.length === 1) {
      showToast(`"${tracksToDelete[0].title}" supprimé`, 'success');
    } else {
      showToast(`${tracksToDelete.length} titres supprimés`, 'success');
    }
    
    const trackIdToSync = selectedTrack && !trackIds.has(selectedTrack.id)
      ? selectedTrack.id
      : (updatedTracks[0]?.id || 0);
    socket.syncPlaylist(updatedTracks, trackIdToSync);
    socket.savePlaylistToDb(updatedTracks, trackIdToSync);
    persistOwnerPlaylist(updatedTracks, trackIdToSync);
  }, [isHost, tracks, selectedTrack, socket, showToast, persistOwnerPlaylist]);

  // Refs vers tracks/socket courants (lecture dans l'async de restauration sans dépendance instable).
  // ⚠️ socket change d'identité à chaque render (value non mémoïsé) : on NE doit pas le mettre en
  // dépendance de l'effet de restauration, sinon le cleanup annule l'async et le garde bloque la reprise.
  const tracksRef = useRef<Track[]>(tracks);
  useEffect(() => { tracksRef.current = tracks; }, [tracks]);
  const socketRef = useRef(socket);
  useEffect(() => { socketRef.current = socket; }, [socket]);

  // 💾 OBJECTIF B: Restauration auto de la playlist du coach à l'ouverture/création de session.
  // Une seule fois par sessionId ; uniquement si la session n'a pas déjà sa propre playlist
  // (on ne veut pas écraser une session existante ni la synchro participant).
  const restoredForSessionRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isHost || !ownerPlaylistKey || !sessionId || !isSupabaseConfigured) return;
    if (restoredForSessionRef.current === sessionId) return;
    restoredForSessionRef.current = sessionId;

    let cancelled = false;
    (async () => {
      console.log('[PLAYLIST] restore: start', { sessionId, ownerPlaylistKey });
      // Laisser d'abord le fetch de la session live se faire (évite d'écraser une playlist existante)
      await new Promise(r => setTimeout(r, 800));
      if (cancelled) return;
      if (tracksRef.current.length > 0) {
        console.log('[PLAYLIST] restore: session a déjà', tracksRef.current.length, 'titres → skip');
        return;
      }

      const saved = await loadPlaylist(ownerPlaylistKey);
      if (cancelled) return;
      const restored = (saved?.tracks || []) as Track[];
      console.log('[PLAYLIST] restore: owner playlist chargée =', restored.length, 'titres');
      if (restored.length === 0) return;
      if (tracksRef.current.length > 0) {
        console.log('[PLAYLIST] restore: session peuplée entre-temps → skip');
        return;
      }

      setTracks(restored);
      const sel = restored.find(t => t.id === saved?.selected_track_id) || restored[0];
      setSelectedTrack(sel);
      // Pousser vers la session live pour les participants (réutilise la synchro existante)
      socketRef.current.syncPlaylist(restored, sel.id);
      socketRef.current.savePlaylistToDb(restored, sel.id);
      showToast('Votre playlist a été restaurée', 'success');
      console.log('[PLAYLIST] restore: appliquée ✓', restored.length, 'titres');
    })();

    return () => { cancelled = true; };
    // socket/showToast volontairement hors deps (cf. commentaire ci-dessus) ; showToast est stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHost, ownerPlaylistKey, sessionId]);

  // Initialize - check for stored nickname
  useEffect(() => {
    const stored = getStoredNickname();
    
    if (stored) {
      setNickname(stored);
      setIsInitialized(true);
    } else {
      // Show modal if joining a session (has sessionId) or creating one
      if (urlSessionId || sessionId) {
        setShowNicknameModal(true);
      }
      setIsInitialized(true);
    }
  }, [urlSessionId, sessionId]);

  // B : photo de profil obligatoire — exécute `next` si avatar présent, sinon ouvre le crop
  const ensureAvatar = useCallback((next: () => void) => {
    if (myAvatar) { next(); return; }
    pendingAfterAvatarRef.current = next;
    setShowAvatarCrop(true);
  }, [myAvatar]);

  const handleAvatarComplete = useCallback((url: string) => {
    setShowAvatarCrop(false);
    if (user?.id) {
      // compte connecté : enregistrer l'URL dans profiles.avatar_url
      if (supabase) {
        supabase.from('profiles').update({ avatar_url: url }).eq('id', user.id).then(() => refreshProfile());
      }
    } else {
      setLocalAvatar(url); // participant anonyme : avatar local (présence)
    }
    const next = pendingAfterAvatarRef.current;
    pendingAfterAvatarRef.current = null;
    if (next) next();
  }, [user?.id, refreshProfile]);

  // Handle nickname submission (B : exige une photo de profil avant de rejoindre)
  const handleNicknameSubmit = useCallback((newNickname: string) => {
    const finish = () => {
      setStoredNickname(newNickname);
      setNickname(newNickname);
      setShowNicknameModal(false);
      showToast(`Bienvenue ${newNickname} !`, 'success');
    };
    ensureAvatar(finish);
  }, [showToast, ensureAvatar]);

  // Création de session (corps), gardée par l'avatar dans handleCreateSession
  const createSessionNow = useCallback(() => {
    // POINT 2 : respect du nombre de sessions par plan (gratuit = 1 session active à la fois)
    if (sessionLimit !== Infinity && user?.id) {
      const active = countActiveSessions(user.id);
      if (active >= sessionLimit) {
        showToast('Limite de sessions atteinte — passez à un plan supérieur', 'warning');
        navigate('/pricing');
        return;
      }
    }

    const newSessionId = generateSessionId();

    setSessionId(newSessionId);
    setIsHost(true);
    if (user?.id) markActiveSession(user.id, newSessionId);
    navigate(`/session/${newSessionId}`, { replace: true });

    const stored = getStoredNickname();
    if (!stored) {
      setShowNicknameModal(true);
    } else {
      setNickname(stored);
      showToast('Session créée ! Partagez le lien avec vos amis.', 'success');
    }
  }, [navigate, showToast, sessionLimit, user?.id]);

  // B : à la création, l'hôte DOIT avoir une photo de profil
  const handleCreateSession = useCallback(() => {
    ensureAvatar(createSessionNow);
  }, [ensureAvatar, createSessionNow]);

  // POINT 2 : heartbeat de la session active de l'hôte (garde le marqueur frais, libère à la sortie)
  useEffect(() => {
    if (!isHost || !sessionId || !user?.id) return;
    const uid = user.id;
    markActiveSession(uid, sessionId);
    const interval = setInterval(() => markActiveSession(uid, sessionId), 30 * 1000);
    return () => {
      clearInterval(interval);
      clearActiveSession(uid, sessionId);
    };
  }, [isHost, sessionId, user?.id]);

  // F : l'hôte revendique sa session côté serveur (host_id) → autorité pour le partage/co-animateurs
  const claimedSessionRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isHost || !sessionId || !user?.id) return;
    if (claimedSessionRef.current === sessionId) return;
    claimedSessionRef.current = sessionId;
    claimHost(sessionId);
  }, [isHost, sessionId, user?.id]);

  // Get shareable session URL
  const sessionUrl = useMemo(() => {
    if (!sessionId) return '';
    const baseUrl = window.location.origin;
    return `${baseUrl}/session/${sessionId}`;
  }, [sessionId]);

  // Copy session link to clipboard
  const handleCopyLink = useCallback(async () => {
    if (!sessionUrl) return;
    
    try {
      await navigator.clipboard.writeText(sessionUrl);
      setLinkCopied(true);
      showToast('Lien copié dans le presse-papier !', 'success');
      setTimeout(() => setLinkCopied(false), 3000);
    } catch (error) {
      showToast('Erreur lors de la copie', 'error');
    }
  }, [sessionUrl, showToast]);

  // 🔢 BUG 5: Copier le CODE de session
  const handleCopyCode = useCallback(async () => {
    if (!sessionId) return;
    try {
      await navigator.clipboard.writeText(sessionId);
      setCodeCopied(true);
      showToast('Code de session copié !', 'success');
      setTimeout(() => setCodeCopied(false), 3000);
    } catch (error) {
      showToast('Erreur lors de la copie', 'error');
    }
  }, [sessionId, showToast]);

  // 🔁 POINT 3 : l'hôte renouvelle le code de session (l'ancien cesse de fonctionner)
  const handleRenewCode = useCallback(() => {
    if (!isHost || !sessionId) return;
    if (!window.confirm('Générer un nouveau code ? Les participants devront utiliser le nouveau code pour rejoindre.')) {
      return;
    }

    const newSessionId = generateSessionId();

    // Réinitialiser le peer WebRTC pour qu'il se reconnecte avec le nouvel id d'hôte
    disconnectPeer();
    peerConnectedRef.current = false;

    // Reporter la playlist courante sur la nouvelle session (les participants la retrouvent)
    if (tracks.length > 0 && isSupabaseConfigured) {
      const sel = selectedTrack?.id ?? tracks[0].id;
      savePlaylist({ session_id: newSessionId, tracks, selected_track_id: sel });
    }

    if (user?.id) markActiveSession(user.id, newSessionId);

    setSessionId(newSessionId);
    navigate(`/session/${newSessionId}`, { replace: true });
    setCodeCopied(false);
    setLinkCopied(false);
    showToast('Nouveau code généré. Partagez-le avec vos participants.', 'success');
  }, [isHost, sessionId, tracks, selectedTrack, user?.id, navigate, showToast, disconnectPeer]);

  // 🔊 BUG 1: Le participant active le son via un geste utilisateur explicite
  const handleActivateSound = useCallback(() => {
    const audioEl = document.querySelector('audio') as HTMLAudioElement | null;
    if (!audioEl) {
      setAudioBlocked(false);
      return;
    }
    audioEl
      .play()
      .then(() => setAudioBlocked(false))
      .catch((err) => {
        console.warn('[PARTICIPANT] Lecture toujours bloquée:', err);
        showToast('Impossible d\'activer le son, réessayez', 'error');
      });
  }, [showToast]);

  // Ref to track if "Go Live" toast has been shown (prevent infinite loop)
  const hasShownLiveToast = useRef(false);
  // Ref pour tracker le dernier état de lecture (éviter les envois redondants)
  const lastPlayingState = useRef<boolean | null>(null);

  // Handle audio state changes - L'HÔTE envoie des COMMANDES aux ESCLAVES
  const handleAudioStateChange = useCallback((state: AudioState) => {
    setAudioState(state);

    // 💓 POINT 3a: mémoriser le dernier état pour le heartbeat de resynchro
    heartbeatStateRef.current = {
      isPlaying: state.isPlaying,
      currentTime: state.currentTime,
      trackId: selectedTrack?.id ?? null,
    };

    // 🔄 MAÎTRE: L'hôte envoie des commandes PLAY/PAUSE explicites
    if (isHost && sessionId && supabase && isSupabaseConfigured) {
      // Détecter le changement d'état play/pause
      const playStateChanged = lastPlayingState.current !== state.isPlaying;
      
      if (playStateChanged) {
        lastPlayingState.current = state.isPlaying;
        
        // Envoyer la commande appropriée
        supabase.channel(`playback:${sessionId}`).send({
          type: 'broadcast',
          event: 'HOST_COMMAND',
          payload: {
            action: state.isPlaying ? 'PLAY' : 'PAUSE',
            currentTime: state.currentTime,
            trackId: selectedTrack?.id || null,
          },
        });
      }
      // Sync position toutes les 5 secondes pendant la lecture
      else if (state.isPlaying && Math.floor(state.currentTime) % 5 === 0) {
        supabase.channel(`playback:${sessionId}`).send({
          type: 'broadcast',
          event: 'HOST_COMMAND',
          payload: {
            action: 'SEEK',
            currentTime: state.currentTime,
            trackId: selectedTrack?.id || null,
          },
        });
      }
    }
  }, [isHost, sessionId, selectedTrack?.id]);

  // 💓 POINT 3a: Heartbeat d'état de l'hôte toutes les 4s sur le canal playback.
  // Permet à un participant qui (re)rejoint ou revient d'arrière-plan de retrouver
  // immédiatement la lecture synchronisée (piste + position + play/pause).
  useEffect(() => {
    if (!isHost || !sessionId || !supabase || !isSupabaseConfigured) return;

    const interval = setInterval(() => {
      const st = heartbeatStateRef.current;
      if (!st.trackId) return; // rien à diffuser tant qu'aucune piste n'est jouée
      supabase!.channel(`playback:${sessionId}`).send({
        type: 'broadcast',
        event: 'HOST_COMMAND',
        payload: {
          action: 'STATE',
          currentTime: st.currentTime,
          trackId: st.trackId,
          isPlaying: st.isPlaying,
        },
      });
    }, 4000);

    return () => clearInterval(interval);
  }, [isHost, sessionId]);

  // 💓 Item 1 : Heartbeat MÉDIA (vidéo) toutes les 3s → late-join précis (position courante).
  useEffect(() => {
    if (!isHost || !sessionId || !supabase || !isSupabaseConfigured) return;
    const interval = setInterval(() => {
      const m = sharedMediaRef.current;
      if (!m || m.type !== 'video') return; // heartbeat utile pour la sync vidéo uniquement
      supabase!.channel(`playback:${sessionId}`).send({
        type: 'broadcast',
        event: 'MEDIA_COMMAND',
        payload: { media: m, isPlaying: m.isPlaying ?? false, currentTime: m.currentTime ?? 0 },
      });
    }, 3000);
    return () => clearInterval(interval);
  }, [isHost, sessionId]);

  // Handle sync state changes
  const handleSyncStateChange = useCallback((state: SyncState) => {
    setSyncState(prevState => {
      // Only show toast ONCE when transitioning to live state
      if (state.isLive && !prevState?.isLive && isHost && !hasShownLiveToast.current) {
        hasShownLiveToast.current = true;
        showToast('Session live démarrée !', 'success');
      }
      // Reset flag when going offline
      if (!state.isLive && prevState?.isLive) {
        hasShownLiveToast.current = false;
      }
      return state;
    });
  }, [showToast, isHost]);

  // Change nickname
  const handleChangeNickname = useCallback(() => {
    setShowNicknameModal(true);
  }, []);

  // Show create session view if no sessionId and is potential host
  if (!sessionId && !urlSessionId) {
    return (
      <>
        <CreateSessionView onCreateSession={handleCreateSession} theme={theme} />
        {/* B : photo de profil obligatoire avant de créer une session */}
        {showAvatarCrop && (
          <AvatarUploadCrop
            userId={user?.id || null}
            title="Votre photo de profil"
            subtitle="Ajoutez une photo pour créer votre session"
            onComplete={handleAvatarComplete}
            onCancel={() => setShowAvatarCrop(false)}
          />
        )}
      </>
    );
  }

  // Show loading while initializing
  if (!isInitialized) {
    return (
      <div 
        className="min-h-screen flex items-center justify-center"
        style={{ background: '#000000' }}
      >
        <div className="flex items-center gap-3 text-white/60">
          <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <span>Chargement...</span>
        </div>
      </div>
    );
  }

  return (
    <div 
      className="min-h-screen"
      style={{ 
        background: '#000000',
        fontFamily: "'Inter', sans-serif",
      }}
    >
      {/* Nickname Modal */}
      <NicknameModal
        isOpen={showNicknameModal}
        isHost={isHost}
        onSubmit={handleNicknameSubmit}
        theme={theme}
      />

      {/* B : photo de profil obligatoire (upload + recadrage) */}
      {showAvatarCrop && (
        <AvatarUploadCrop
          userId={user?.id || null}
          title="Votre photo de profil"
          subtitle={isHost ? 'Ajoutez une photo pour créer votre session' : 'Ajoutez une photo pour rejoindre la session'}
          onComplete={handleAvatarComplete}
        />
      )}

      {/* 🔊 BUG 1: Overlay d'activation du son (autoplay bloqué côté participant) */}
      {audioBlocked && !isHost && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center p-6 bg-black/90 backdrop-blur-sm">
          <div className="text-center max-w-sm">
            <div
              className="w-24 h-24 mx-auto mb-6 rounded-full flex items-center justify-center animate-pulse"
              style={{ background: theme.colors.gradient.primary }}
            >
              <Volume2 className="w-12 h-12 text-white" />
            </div>
            <h2
              className="text-2xl font-bold text-white mb-3"
              style={{ fontFamily: "'Space Grotesk', sans-serif" }}
            >
              Le son est en attente
            </h2>
            <p className="text-white/60 text-sm mb-6">
              Votre navigateur bloque la lecture automatique. Appuyez sur le bouton
              ci-dessous pour rejoindre l'écoute synchronisée.
            </p>
            <button
              onClick={handleActivateSound}
              className="w-full h-14 rounded-xl text-white font-bold text-lg flex items-center justify-center gap-3 transition-transform hover:scale-105 active:scale-95"
              style={{
                background: theme.colors.gradient.primary,
                boxShadow: '0 4px 24px rgba(138, 46, 255, 0.4)',
              }}
              data-testid="activate-sound-btn"
            >
              <Volume2 className="w-6 h-6" />
              Activer le son
            </button>
          </div>
        </div>
      )}

      {/* Background Effects */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div 
          className="absolute -top-1/4 -left-1/4 w-1/2 h-1/2 rounded-full opacity-20 blur-3xl"
          style={{ background: `radial-gradient(circle, ${theme.colors.primary} 0%, transparent 70%)` }}
        />
        <div 
          className="absolute -bottom-1/4 -right-1/4 w-1/2 h-1/2 rounded-full opacity-15 blur-3xl"
          style={{ background: `radial-gradient(circle, ${theme.colors.secondary} 0%, transparent 70%)` }}
        />
      </div>

      {/* Header */}
      <header 
        className="sticky top-0 z-40 border-b border-white/10"
        style={{ 
          background: 'rgba(0, 0, 0, 0.8)',
          backdropFilter: 'blur(20px)',
        }}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              <Link to="/" className="flex items-center gap-2">
                <div 
                  className="w-8 h-8 rounded-lg flex items-center justify-center"
                  style={{ background: theme.colors.gradient.primary }}
                >
                  <svg viewBox="0 0 24 24" className="w-5 h-5 text-white" fill="currentColor">
                    <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
                  </svg>
                </div>
                <span 
                  className="text-xl font-bold hidden sm:block"
                  style={{
                    fontFamily: "'Space Grotesk', sans-serif",
                    background: theme.colors.gradient.primary,
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                  }}
                >
                  {theme.name}
                </span>
              </Link>
              
              {/* Role Badge */}
              <Badge
                className={`flex items-center gap-1 ${isHost
                  ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
                  : 'bg-blue-500/20 text-blue-400 border-blue-500/30'
                }`}
              >
                {isHost ? <Radio className="w-3.5 h-3.5" /> : <Users className="w-3.5 h-3.5" />}
                {isHost ? 'Hôte' : 'Participant'}
              </Badge>

              {/* Subscription Badge — POINT 1: réservé à l'hôte/admin, masqué pour les participants */}
              {isHost && <SubscriptionBadge />}
            </div>
            
            <div className="flex items-center gap-3">
              {/* Host Microphone Control */}
              {isHost && (
                <MicrophoneControl
                  isHost={true}
                  onMicActive={setHostMicActive}
                  onStreamReady={setHostMicStream}
                />
              )}
              
              {/* PARTICIPANT: Voice receiving indicator */}
              {!isHost && peerState.isReceivingVoice && (
                <span
                  className="text-xs px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-400 animate-pulse flex items-center gap-1"
                  data-testid="voice-receiving-indicator"
                >
                  <span className="inline-block w-2 h-2 rounded-full bg-purple-400 animate-ping" />
                  <Volume2 className="w-3 h-3" />
                  Voix reçue
                </span>
              )}
              
              {/* User nickname display */}
              {nickname && (
                <button
                  onClick={handleChangeNickname}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 hover:bg-white/10 transition-colors"
                >
                  <div 
                    className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium text-white"
                    style={{ background: theme.colors.gradient.primary }}
                  >
                    {generateAvatar(nickname)}
                  </div>
                  <span className="text-white/70 text-sm hidden sm:block">{nickname}</span>
                </button>
              )}
              <Link to="/">
                <Button variant="outline" size="sm" className="border-white/20 text-white/70 hover:bg-white/10 inline-flex items-center gap-1">
                  <ArrowLeft className="w-4 h-4" /> Retour
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 relative z-10">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main Player */}
          <div className="lg:col-span-2 space-y-6">
            {/* Session Title */}
            <div>
              <h1 
                className="text-2xl sm:text-3xl font-bold text-white mb-2"
                style={{ fontFamily: "'Space Grotesk', sans-serif" }}
              >
                Session d'écoute
              </h1>
              <p className="text-white/60 text-sm sm:text-base">
                {isHost
                  ? (isAdminUser
                      ? 'Mode Admin - Contrôle total de la session.'
                      : 'Vous êtes l\'hôte. Contrôlez la lecture pour tous les participants.')
                  : 'Mode écoute seule. La lecture est synchronisée avec l\'hôte.'
                }
              </p>
            </div>

            {/* C : Description de session (modifiable par l'hôte) */}
            {(isHost || description) && (
              <Card className="border-white/10 bg-white/5">
                <CardContent className="p-4">
                  {editingDesc ? (
                    <div className="space-y-2">
                      <textarea
                        value={descDraft}
                        onChange={(e) => setDescDraft(e.target.value.slice(0, 140))}
                        maxLength={140}
                        rows={2}
                        placeholder="Description courte de la session (140 caractères max)"
                        className="w-full rounded-lg bg-white/5 border border-white/10 text-white text-sm p-2 placeholder:text-white/30 focus:outline-none focus:border-[#8A2EFF]"
                        autoFocus
                      />
                      <div className="flex items-center justify-between">
                        <span className="text-white/30 text-xs">{descDraft.length}/140</span>
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" onClick={() => setEditingDesc(false)} className="border-white/20 text-white/70">Annuler</Button>
                          <Button size="sm" onClick={handleSaveDescription} className="text-white border-none" style={{ background: 'linear-gradient(135deg, #8A2EFF 0%, #FF2FB3 100%)' }}>
                            <Check className="w-4 h-4 mr-1" /> Enregistrer
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-white/70 text-sm min-w-0 break-words">
                        {description || (isHost ? <span className="text-white/30 italic">Ajoutez une description courte…</span> : null)}
                      </p>
                      {isHost && (
                        <button onClick={handleStartEditDesc} className="p-1.5 rounded text-white/50 hover:text-white hover:bg-white/10 flex-shrink-0" title="Modifier la description" data-testid="edit-desc-btn">
                          <Pencil className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* E : Média partagé (vidéo/image/lien) — affiché UNIQUEMENT hors mode audio */}
            {shareMode !== 'audio' && sharedMedia && (
              <SharedMediaPlayer
                media={sharedMedia}
                isHost={canShare}
                onState={canShare ? handleMediaState : undefined}
                remote={!canShare ? remoteMediaState : null}
                onClose={canShare ? handleCloseMedia : undefined}
              />
            )}

            {/* E + item 6 : Panneau de partage (Audio | Vidéo | Image | Lien) — hôte + co-animateurs */}
            {canShare && sessionId && (
              <MediaShareControls
                sessionId={sessionId}
                onShare={handleShareMedia}
                showToast={showToast}
                mode={shareMode}
                onModeChange={setShareMode}
                audioPanel={isHost ? (
                  <TrackUploader
                    sessionId={sessionId}
                    onTrackUploaded={handleTrackUploaded}
                    currentTrackCount={tracks.length}
                    maxTracks={10}
                    disabled={!isHost}
                    onUpgradeRequest={handleUpgradeRequest}
                  />
                ) : undefined}
              />
            )}

            {/* Share Link Card (Host only) */}
            {isHost && sessionId && (
              <Card className="border-white/10 bg-white/5">
                <CardContent className="p-4 space-y-4">
                  {/* 🔢 BUG 5: CODE de session bien visible + explication pour rejoindre */}
                  <div className="rounded-xl border border-[#8A2EFF]/30 bg-[#8A2EFF]/10 p-4 text-center">
                    <p className="text-white/50 text-xs mb-2 uppercase tracking-wider">
                      Code de la session
                    </p>
                    {/* A : responsive — le code passe à la ligne, les boutons s'enroulent sans déborder */}
                    <div className="text-xl sm:text-3xl font-bold text-white tracking-[0.15em] sm:tracking-[0.2em] font-mono select-all break-all px-1" data-testid="session-code">
                      {sessionId}
                    </div>
                    <div className="flex flex-wrap items-center justify-center gap-2 mt-3">
                      <Button
                        onClick={handleCopyCode}
                        size="sm"
                        variant="outline"
                        className={`flex items-center gap-1 ${codeCopied
                          ? 'bg-green-500/20 text-green-400 border-green-500/30'
                          : 'bg-white/10 text-white border-white/20'
                        }`}
                      >
                        {codeCopied && <Check className="w-4 h-4" />}
                        {codeCopied ? 'Copié' : 'Copier le code'}
                      </Button>
                      {/* POINT 3 : renouveler le code (hôte uniquement) */}
                      <Button
                        onClick={handleRenewCode}
                        size="sm"
                        variant="outline"
                        className="flex items-center gap-1 bg-white/10 text-white border-white/20"
                        data-testid="renew-code-btn"
                        title="Générer un nouveau code"
                      >
                        <RefreshCw className="w-4 h-4" />
                        Nouveau code
                      </Button>
                    </div>
                    <p className="text-white/60 text-xs mt-3 leading-relaxed">
                      Partagez ce code avec vos amis, ou envoyez-leur directement le lien
                      ci-dessous. En ouvrant le lien, ils rejoignent automatiquement votre
                      session en écoute synchronisée.
                    </p>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-3">
                    <div className="flex-1">
                      <label className="text-white/50 text-xs mb-1 block">
                        Lien de partage
                      </label>
                      <Input
                        value={sessionUrl}
                        readOnly
                        className="bg-white/5 border-white/10 text-white/80 text-sm font-mono"
                      />
                    </div>
                    <Button
                      onClick={handleCopyLink}
                      className={`h-auto sm:h-[42px] sm:mt-5 ${
                        linkCopied 
                          ? 'bg-green-500/20 text-green-400 border-green-500/30'
                          : 'bg-white/10 text-white border-white/20'
                      }`}
                      variant="outline"
                    >
                      {linkCopied ? (
                        <span className="flex items-center gap-1"><Check className="w-4 h-4" /> Copié</span>
                      ) : (
                        <span className="flex items-center gap-1">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                          </svg>
                          Copier le lien
                        </span>
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Audio Player - Only show if there's a track selected */}
            {/* Item 6 : lecteur audio + playlist UNIQUEMENT en mode audio */}
            {shareMode === 'audio' && (selectedTrack ? (
              <>
                {/* Free Trial Timer Indicator */}
                {isFreeTrial && !trialLimitReached && (
                  <div className="bg-gradient-to-r from-purple-500/20 to-pink-500/20 border border-purple-500/30 rounded-lg p-3 mb-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="flex items-center gap-1 text-purple-400 text-sm font-medium"><Clock className="w-3.5 h-3.5" /> Essai Gratuit</span>
                        <span className="text-white/70 text-sm">
                          {Math.floor((FREE_TRIAL_LIMIT_SECONDS - totalPlayTime) / 60)}:{String((FREE_TRIAL_LIMIT_SECONDS - totalPlayTime) % 60).padStart(2, '0')} restant
                        </span>
                      </div>
                      <Link 
                        to="/pricing" 
                        className="text-xs bg-purple-600 hover:bg-purple-700 text-white px-3 py-1 rounded-full transition-colors"
                      >
                        Passer à Pro
                      </Link>
                    </div>
                    <div className="mt-2 bg-white/10 rounded-full h-1.5 overflow-hidden">
                      <div 
                        className="bg-gradient-to-r from-purple-500 to-pink-500 h-full transition-all duration-1000"
                        style={{ width: `${((FREE_TRIAL_LIMIT_SECONDS - totalPlayTime) / FREE_TRIAL_LIMIT_SECONDS) * 100}%` }}
                      />
                    </div>
                  </div>
                )}
                
                {/* Trial Limit Reached - MODAL BLOQUANT */}
                {trialLimitReached && (
                  <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 backdrop-blur-sm">
                    <div className="bg-gradient-to-br from-[#1a1a2e] to-[#0a0a15] border-2 border-red-500/50 rounded-2xl p-8 max-w-md w-full shadow-2xl shadow-red-500/20">
                      {/* Icon */}
                      <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-red-500/20 flex items-center justify-center">
                        <svg className="w-10 h-10 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </div>
                      
                      {/* Title */}
                      <h2 className="flex items-center justify-center gap-2 text-2xl font-bold text-white text-center mb-3" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                        <Clock className="w-6 h-6 text-red-400" />
                        Limite d'essai atteinte
                      </h2>
                      
                      {/* Description */}
                      <p className="text-white/70 text-center mb-6">
                        Votre essai gratuit de <strong className="text-red-400">5 minutes</strong> est terminé.<br />
                        Passez à Pro pour une écoute <strong className="text-purple-400">illimitée</strong> !
                      </p>
                      
                      {/* Features */}
                      <div className="bg-white/5 rounded-lg p-4 mb-6 space-y-2">
                        <div className="flex items-center gap-2 text-white/80 text-sm">
                          <Check className="w-4 h-4 text-green-400 flex-shrink-0" /> Écoute illimitée
                        </div>
                        <div className="flex items-center gap-2 text-white/80 text-sm">
                          <Check className="w-4 h-4 text-green-400 flex-shrink-0" /> 50 chansons par session
                        </div>
                        <div className="flex items-center gap-2 text-white/80 text-sm">
                          <Check className="w-4 h-4 text-green-400 flex-shrink-0" /> Voix en temps réel
                        </div>
                      </div>

                      {/* CTA */}
                      <Link
                        to="/pricing"
                        className="flex items-center justify-center gap-2 w-full text-center py-4 rounded-xl text-white font-bold text-lg transition-all hover:scale-105"
                        style={{ background: theme.colors.gradient.primary }}
                        data-testid="trial-limit-upgrade-btn"
                      >
                        <Rocket className="w-5 h-5" />
                        Passer à Pro
                      </Link>
                      
                      {/* Secondary link */}
                      <Link 
                        to="/"
                        className="block text-center mt-4 text-white/50 hover:text-white/70 text-sm transition-colors"
                      >
                        <span className="inline-flex items-center gap-1"><ArrowLeft className="w-4 h-4" /> Retour à l'accueil</span>
                      </Link>
                    </div>
                  </div>
                )}
                
                {/* Bandeau Mode Participant */}
                {!isHost && (
                  <div className="mb-4 px-4 py-3 rounded-lg bg-purple-500/10 border border-purple-500/20">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <Headphones className="w-6 h-6 text-purple-300 flex-shrink-0" />
                        <div className="min-w-0">
                          <p className="text-purple-300 font-medium text-sm truncate">Mode écoute seule - Synchronisé avec l'hôte</p>
                          <p className="text-white/50 text-xs truncate">La lecture est contrôlée par l'hôte de la session</p>
                        </div>
                      </div>

                      {/* 🎤 POINT 5: Prendre la parole (micro participant → hôte) */}
                      <button
                        onClick={handleToggleTalk}
                        className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all flex-shrink-0 ${
                          isTalking
                            ? 'bg-red-500/20 text-red-300 border border-red-500/40 hover:bg-red-500/30'
                            : 'bg-white/10 text-white/80 border border-white/20 hover:bg-white/20'
                        }`}
                        data-testid="talk-toggle-btn"
                      >
                        {isTalking ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                        <span className="hidden sm:inline">{isTalking ? 'Rendre la parole' : 'Prendre la parole'}</span>
                      </button>
                    </div>

                    {participantMic.state.error && (
                      <p className="mt-2 flex items-center gap-1.5 text-xs text-red-400">
                        <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                        {participantMic.state.error}
                      </p>
                    )}
                  </div>
                )}
                
                <AudioPlayer
                  src={selectedTrack.src}
                  title={selectedTrack.title}
                  artist={selectedTrack.artist}
                  coverArt={selectedTrack.coverArt}
                  isHost={isHost && !trialLimitReached}
                  sessionId={sessionId}
                  onStateChange={handleAudioStateChange}
                  onSyncUpdate={handleSyncStateChange}
                  onTrackEnded={handleTrackEnded}
                  onRepeatModeChange={setRepeatMode}
                />
              </>
            ) : (
              <Card className="border-white/10 bg-white/5">
                <CardContent className="p-8 text-center">
                  <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-white/5 flex items-center justify-center">
                    <svg className="w-8 h-8 text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                    </svg>
                  </div>
                  <h3 className="text-white/80 font-medium mb-2">
                    {isHost ? "Playlist vide" : (isSyncActive ? "En attente de l'hôte" : "Connexion...")}
                  </h3>
                  <p className="text-white/50 text-sm">
                    {isHost
                      ? "Uploadez votre premier morceau pour démarrer la session"
                      : isSyncActive
                        ? "Sync Cloud actif - La playlist s'affichera dès que l'hôte ajoutera des morceaux"
                        : "Connexion au serveur..."
                    }
                  </p>
                </CardContent>
              </Card>
            ))}

            {/* Track Selection (Host only) */}
            {shareMode === 'audio' && isHost && (
              <Card className="border-white/10 bg-white/5">
                <CardHeader className="pb-3">
                  <CardTitle className="text-white text-lg">
                    Playlist
                  </CardTitle>
                  <CardDescription className="text-white/50">
                    Glissez pour réorganiser • {tracks.length}/10 titres
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-0 space-y-4">
                  {/* L'ajout de pistes se fait via le panneau de partage (mode Audio) ci-dessus */}
                  {/* Playlist with DnD */}
                  <PlaylistDnD
                    tracks={tracks}
                    selectedTrack={selectedTrack}
                    onTrackSelect={handleTrackSelectWithSync}
                    onReorder={handlePlaylistReorder}
                    onDeleteTracks={handleDeleteTracks}
                    isHost={isHost}
                    maxTracks={10}
                  />
                  
                  {/* Supabase status */}
                  {!isSupabaseConfigured && (
                    <p className="flex items-center justify-center gap-1.5 text-xs text-yellow-400/60 text-center pt-2 border-t border-white/10">
                      <AlertCircle className="w-3.5 h-3.5" />
                      Mode démo (Supabase non configuré)
                    </p>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Playlist View (Participant - Read Only) */}
            {shareMode === 'audio' && !isHost && tracks.length > 0 && (
              <Card className="border-white/10 bg-white/5">
                <CardHeader className="pb-3">
                  <CardTitle className="text-white text-lg flex items-center gap-2">
                    <Radio className="w-4 h-4 text-green-400" />
                    Playlist de l'hôte
                  </CardTitle>
                  <CardDescription className="text-white/50">
                    Mode lecture seule - Synchronisé avec l'hôte
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-0">
                  {/* Indicator bar */}
                  <div className="mb-3 px-3 py-2 rounded-lg bg-green-500/10 border border-green-500/20">
                    <p className="text-green-400 text-xs flex items-center gap-2">
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                      </span>
                      {tracks.length} titre{tracks.length > 1 ? 's' : ''} synchronisé{tracks.length > 1 ? 's' : ''} en temps réel
                    </p>
                  </div>
                  
                  {/* Read-only playlist for participants - NO delete buttons, NO drag handles */}
                  <PlaylistDnD
                    tracks={tracks}
                    selectedTrack={selectedTrack}
                    onTrackSelect={() => {}} // Disabled for participants
                    onReorder={() => {}} // Disabled for participants
                    onDeleteTracks={() => {}} // Disabled for participants
                    isHost={false}
                    maxTracks={10}
                  />
                </CardContent>
              </Card>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Session Info */}
            <Card className="border-white/10 bg-white/5">
              <CardHeader>
                <CardTitle className="text-white text-lg flex items-center gap-2">
                  <span className="relative flex h-3 w-3">
                    <span 
                      className={`absolute inline-flex h-full w-full rounded-full opacity-75 ${
                        syncState?.isLive ? 'animate-ping' : ''
                      }`}
                      style={{ background: syncState?.isLive ? '#8A2EFF' : '#666' }}
                    />
                    <span 
                      className="relative inline-flex rounded-full h-3 w-3"
                      style={{ background: syncState?.isLive ? '#8A2EFF' : '#666' }}
                    />
                  </span>
                  Statut de la session
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-white/60 text-sm">Session ID</span>
                  <span className="text-white text-sm font-mono truncate max-w-[120px]">
                    {sessionId || urlSessionId || 'N/A'}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-white/60 text-sm">État</span>
                  <Badge 
                    className={syncState?.isLive 
                      ? 'bg-green-500/20 text-green-400 border-green-500/30'
                      : 'bg-white/10 text-white/60 border-white/20'
                    }
                  >
                    {syncState?.isLive ? 'En direct' : 'En pause'}
                  </Badge>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-white/60 text-sm">Mode</span>
                  <span className="text-white text-sm">{isHost ? 'Hôte' : 'Participant'}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-white/60 text-sm">Latence</span>
                  <span className="text-white text-sm font-mono">
                    {syncState?.latency?.toFixed(0) || 0}ms
                  </span>
                </div>
                {audioState && (
                  <div className="flex justify-between items-center">
                    <span className="text-white/60 text-sm">Position</span>
                    <span className="text-white text-sm font-mono">
                      {(audioState.currentTime * 1000).toFixed(0)}ms
                    </span>
                  </div>
                )}
                <div className="flex justify-between items-center">
                  <span className="text-white/60 text-sm">Sync</span>
                  <Badge
                    className={`flex items-center gap-1 ${socket.isSupabaseMode
                      ? 'bg-green-500/20 text-green-400 border-green-500/30'
                      : 'bg-amber-500/20 text-amber-400 border-amber-500/30'
                    }`}
                    data-testid="sync-status-badge"
                  >
                    {socket.isSupabaseMode ? <Cloud className="w-3 h-3" /> : <Zap className="w-3 h-3" />}
                    {socket.isSupabaseMode ? 'Cloud' : 'Démo'}
                  </Badge>
                </div>
                
                {/* Demo mode indicator - styled and non-intrusive */}
                {!socket.isSupabaseMode && (
                  <div className="pt-3 mt-3 border-t border-white/5">
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gradient-to-r from-amber-500/10 to-orange-500/10 border border-amber-500/20">
                      <Sparkles className="w-4 h-4 text-amber-400 flex-shrink-0" />
                      <div className="flex-1">
                        <p className="text-amber-400/90 text-xs font-medium">Mode Démo</p>
                        <p className="text-amber-400/60 text-[10px] leading-tight">
                          Sync local uniquement
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* 🎧 Audio Mixer Panel - Escamotable sur mobile */}
            <AudioMixerPanel
              isHost={isHost}
              musicVolume={mixerState.musicVolume}
              micVolume={mixerState.micVolume}
              tribeVolume={mixerState.tribeVolume}
              hostVoiceVolume={mixerState.hostVoiceVolume}
              onMusicVolumeChange={handleMusicVolumeChange}
              onMicVolumeChange={setMicVolume}
              onTribeVolumeChange={handleTribeVolumeChange}
              onHostVoiceVolumeChange={setHostVoiceVolume}
              isMicActive={hostMicActive}
              defaultCollapsed={false}
            />

            {/* Participants */}
            <Card className="border-white/10 bg-white/5">
              <CardHeader className="pb-3">
                <CardTitle className="text-white text-lg">
                  Participants ({participants.length})
                </CardTitle>
                {isHost && (
                  <CardDescription className="text-white/50 text-xs">
                    Contrôlez le volume de chaque participant
                  </CardDescription>
                )}
              </CardHeader>
              <CardContent className="pt-0">
                <ParticipantControls
                  participants={participants}
                  isHost={isHost}
                  onVolumeChange={handleParticipantVolumeChange}
                  onMuteToggle={handleParticipantMuteToggle}
                  onEject={handleParticipantEject}
                  onToggleCoHost={isHost ? handleToggleCoHost : undefined}
                  theme={theme}
                />
              </CardContent>
            </Card>

            {/* Item 8 : Likes + commentaires de session (temps réel) */}
            {sessionId && <SessionSocial sessionId={sessionId} />}

            {/* Instructions */}
            <Card className="border-white/10 bg-white/5">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-white text-lg">
                  <Lightbulb className="w-5 h-5 text-purple-400" />
                  Instructions
                </CardTitle>
              </CardHeader>
              <CardContent className="text-white/60 text-sm space-y-2">
                {isHost ? (
                  <>
                    <p>• Partagez le lien de session avec vos amis</p>
                    <p>• Cliquez sur <strong>Go Live</strong> pour démarrer</p>
                    <p>• Les participants se synchroniseront automatiquement</p>
                  </>
                ) : (
                  <>
                    <p>• Vous êtes en mode écoute seule</p>
                    <p>• La lecture est contrôlée par l'hôte</p>
                    <p>• Ajustez le volume à votre convenance</p>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </main>

      {/* Hidden audio element for receiving host voice via WebRTC */}
      {!isHost && (
        <audio 
          ref={remoteAudioRef}
          autoPlay
          playsInline
          className="hidden"
          data-testid="remote-audio"
        />
      )}
    </div>
  );
};

export default SessionPage;
