import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { AudioPlayer } from '@/components/audio/AudioPlayer';
import { PlaylistDnD, Track } from '@/components/audio/PlaylistDnD';
import { ParticipantControls, Participant } from '@/components/audio/ParticipantControls';
import { HostMicControl } from '@/components/audio/HostMicControl';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useTheme } from '@/context/ThemeContext';
import { useSocket } from '@/context/SocketContext';
import { useToast } from '@/components/ui/Toast';
import { generateSessionId } from '@/hooks/useAudioSync';
import type { AudioState, SyncState } from '@/hooks/useAudioSync';

// LocalStorage key for nickname
const NICKNAME_STORAGE_KEY = 'bt_nickname';

// Demo tracks for testing
const DEMO_TRACKS: Track[] = [
  {
    id: 1,
    title: 'Midnight Groove',
    artist: 'Beattribe Collective',
    src: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
    coverArt: '',
  },
  {
    id: 2,
    title: 'Urban Pulse',
    artist: 'DJ Neon',
    src: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3',
    coverArt: '',
  },
  {
    id: 3,
    title: 'Summer Vibes',
    artist: 'The Rhythm Makers',
    src: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3',
    coverArt: '',
  },
  {
    id: 4,
    title: 'Night Drive',
    artist: 'Synthwave Heroes',
    src: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3',
    coverArt: '',
  },
  {
    id: 5,
    title: 'Electric Dreams',
    artist: 'Neon Lights',
    src: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3',
    coverArt: '',
  },
  {
    id: 6,
    title: 'Bass Drop',
    artist: 'Low Frequency',
    src: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-6.mp3',
    coverArt: '',
  },
  {
    id: 7,
    title: 'Chill Zone',
    artist: 'Ambient Masters',
    src: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-7.mp3',
    coverArt: '',
  },
  {
    id: 8,
    title: 'Funk It Up',
    artist: 'Groove Station',
    src: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-8.mp3',
    coverArt: '',
  },
  {
    id: 9,
    title: 'Deep House',
    artist: 'Underground Collective',
    src: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-9.mp3',
    coverArt: '',
  },
  {
    id: 10,
    title: 'Tribal Beats',
    artist: 'World Fusion',
    src: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-10.mp3',
    coverArt: '',
  },
];

// Base mock participants (will be augmented with current user)
const BASE_PARTICIPANTS: Participant[] = [
  { id: '2', name: 'Sarah K.', avatar: 'SK', isSynced: true, volume: 100, isMuted: false },
  { id: '3', name: 'Alex M.', avatar: 'AM', isSynced: true, volume: 100, isMuted: false },
  { id: '4', name: 'Emma L.', avatar: 'EL', isSynced: false, volume: 80, isMuted: false },
];

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
              className="w-full h-12 text-white border-none font-medium"
              style={{
                background: theme.colors.gradient.primary,
                boxShadow: '0 4px 24px rgba(138, 46, 255, 0.35)',
              }}
            >
              {isHost ? '🎵 Démarrer la session' : '🎧 Rejoindre l\'écoute'}
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
          className="w-full h-12 text-white border-none font-medium"
          style={{
            background: theme.colors.gradient.primary,
            boxShadow: '0 4px 24px rgba(138, 46, 255, 0.35)',
          }}
        >
          🎵 Créer une nouvelle session
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
            ← Retour à l'accueil
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
  
  // Track if user created this session (host) or joined via URL (participant)
  const [isHost, setIsHost] = useState<boolean>(!urlSessionId);
  const [sessionId, setSessionId] = useState<string | null>(urlSessionId || null);
  
  // Nickname state
  const [nickname, setNickname] = useState<string | null>(null);
  const [showNicknameModal, setShowNicknameModal] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  
  // Playlist state (draggable)
  const [tracks, setTracks] = useState<Track[]>(DEMO_TRACKS);
  const [selectedTrack, setSelectedTrack] = useState(DEMO_TRACKS[0]);
  
  // Participants state with volume/mute controls
  const [participantsState, setParticipantsState] = useState<Participant[]>(BASE_PARTICIPANTS);
  
  // Host mic state
  const [hostMicGain, setHostMicGain] = useState(80);
  const [hostMicMuted, setHostMicMuted] = useState(false);
  
  const [audioState, setAudioState] = useState<AudioState | null>(null);
  const [syncState, setSyncState] = useState<SyncState | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);

  // Build participants list with current user
  const participants = useMemo<Participant[]>(() => {
    if (!nickname) return participantsState;
    
    const currentUser: Participant = {
      id: 'current-user',
      name: nickname,
      avatar: generateAvatar(nickname),
      isSynced: true,
      isCurrentUser: true,
      isHost: isHost,
      volume: 100,
      isMuted: false,
    };
    
    // Place current user at the top
    return [currentUser, ...participantsState];
  }, [nickname, isHost, participantsState]);

  // Participant moderation handlers
  const handleParticipantVolumeChange = useCallback((id: string, volume: number) => {
    setParticipantsState(prev => 
      prev.map(p => p.id === id ? { ...p, volume, isMuted: volume === 0 } : p)
    );
  }, []);

  const handleParticipantMuteToggle = useCallback((id: string) => {
    setParticipantsState(prev =>
      prev.map(p => p.id === id ? { ...p, isMuted: !p.isMuted } : p)
    );
  }, []);

  const handleParticipantEject = useCallback((id: string) => {
    const participant = participantsState.find(p => p.id === id);
    setParticipantsState(prev => prev.filter(p => p.id !== id));
    showToast(`${participant?.name || 'Participant'} a été éjecté`, 'success');
  }, [participantsState, showToast]);

  // Playlist reorder handler
  const handlePlaylistReorder = useCallback((newTracks: Track[]) => {
    setTracks(newTracks);
    showToast('Playlist réorganisée', 'success');
  }, [showToast]);

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

  // Handle nickname submission
  const handleNicknameSubmit = useCallback((newNickname: string) => {
    setStoredNickname(newNickname);
    setNickname(newNickname);
    setShowNicknameModal(false);
    showToast(`Bienvenue ${newNickname} ! 🎵`, 'success');
  }, [showToast]);

  // Generate session ID when creating new session
  const handleCreateSession = useCallback(() => {
    const newSessionId = generateSessionId();
    setSessionId(newSessionId);
    setIsHost(true);
    navigate(`/session/${newSessionId}`, { replace: true });
    
    // Check nickname after creating session
    const stored = getStoredNickname();
    if (!stored) {
      setShowNicknameModal(true);
    } else {
      setNickname(stored);
      showToast('Session créée ! Partagez le lien avec vos amis.', 'success');
    }
  }, [navigate, showToast]);

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

  // Handle audio state changes
  const handleAudioStateChange = useCallback((state: AudioState) => {
    setAudioState(state);
  }, []);

  // Handle sync state changes
  const handleSyncStateChange = useCallback((state: SyncState) => {
    setSyncState(state);
    if (state.isLive && isHost) {
      showToast('Session live démarrée !', 'success');
    }
  }, [showToast, isHost]);

  // Select track (host only)
  const handleTrackSelect = useCallback((track: Track) => {
    if (!isHost) return;
    setSelectedTrack(track);
    showToast(`Piste sélectionnée: ${track.title}`, 'success');
  }, [showToast, isHost]);

  // Change nickname
  const handleChangeNickname = useCallback(() => {
    setShowNicknameModal(true);
  }, []);

  // Show create session view if no sessionId and is potential host
  if (!sessionId && !urlSessionId) {
    return <CreateSessionView onCreateSession={handleCreateSession} theme={theme} />;
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
                className={isHost 
                  ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
                  : 'bg-blue-500/20 text-blue-400 border-blue-500/30'
                }
              >
                {isHost ? '👑 Hôte' : '👤 Participant'}
              </Badge>
            </div>
            
            <div className="flex items-center gap-3">
              {/* Host Mic Control */}
              {isHost && (
                <HostMicControl
                  gain={hostMicGain}
                  isMuted={hostMicMuted}
                  onGainChange={setHostMicGain}
                  onMuteToggle={() => setHostMicMuted(!hostMicMuted)}
                />
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
                <Button variant="outline" size="sm" className="border-white/20 text-white/70 hover:bg-white/10">
                  ← Retour
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
                  ? 'Vous êtes l\'hôte. Contrôlez la lecture pour tous les participants.'
                  : 'Mode écoute seule. La lecture est synchronisée avec l\'hôte.'
                }
              </p>
            </div>

            {/* Share Link Card (Host only) */}
            {isHost && sessionId && (
              <Card className="border-white/10 bg-white/5">
                <CardContent className="p-4">
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
                        <>✓ Copié</>
                      ) : (
                        <>
                          <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                          </svg>
                          Copier le lien
                        </>
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Audio Player */}
            <AudioPlayer
              src={selectedTrack.src}
              title={selectedTrack.title}
              artist={selectedTrack.artist}
              coverArt={selectedTrack.coverArt}
              isHost={isHost}
              sessionId={sessionId}
              onStateChange={handleAudioStateChange}
              onSyncUpdate={handleSyncStateChange}
            />

            {/* Track Selection (Host only) */}
            {isHost && (
              <Card className="border-white/10 bg-white/5">
                <CardHeader className="pb-3">
                  <CardTitle className="text-white text-lg">
                    Playlist
                  </CardTitle>
                  <CardDescription className="text-white/50">
                    Glissez pour réorganiser les titres
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-0">
                  <PlaylistDnD
                    tracks={tracks}
                    selectedTrack={selectedTrack}
                    onTrackSelect={handleTrackSelect}
                    onReorder={handlePlaylistReorder}
                    isHost={isHost}
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
              </CardContent>
            </Card>

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
                  theme={theme}
                />
              </CardContent>
            </Card>

            {/* Instructions */}
            <Card className="border-white/10 bg-white/5">
              <CardHeader>
                <CardTitle className="text-white text-lg">
                  💡 Instructions
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
    </div>
  );
};

export default SessionPage;
