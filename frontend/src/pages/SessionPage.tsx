import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { Music, Users, Radio, Volume2, Headphones, Crown, Check, Lightbulb, AlertCircle, Sparkles, Cloud, Zap, Clock, Rocket, ArrowLeft, Mic, MicOff, RefreshCw, ChevronDown, KeyRound, Copy, QrCode, Video, Lock, Globe, Menu, X, Camera, Plus, ListMusic, SlidersHorizontal } from 'lucide-react';
import { QRCodeCanvas } from 'qrcode.react';
import { AudioPlayer } from '@/components/audio/AudioPlayer';
import { PlaylistDnD, Track } from '@/components/audio/PlaylistDnD';
import { ParticipantControls, Participant } from '@/components/audio/ParticipantControls';
import { MicrophoneControl, type MicrophoneControlHandle } from '@/components/audio/MicrophoneControl';
import { TrackUploader } from '@/components/audio/TrackUploader';
import { AudioMixerPanel } from '@/components/audio/AudioMixerPanel';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useTheme } from '@/context/ThemeContext';
import { useSocket } from '@/context/SocketContext';
import { useI18n, LanguageSelector } from '@/context/I18nContext';
import { WaitingRoomScreen } from '@/components/session/WaitingRoomScreen';
import { ScreenShareView } from '@/components/session/ScreenShareView';
import { AccessRequestsPanel, AccessRequest } from '@/components/session/AccessRequestsPanel';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { generateSessionId } from '@/hooks/useAudioSync';
import { usePeerAudio } from '@/hooks/usePeerAudio';
import { useAudioMixer } from '@/hooks/useAudioMixer';
import { useMicrophone } from '@/hooks/useMicrophone';
import type { AudioState, SyncState, RepeatMode } from '@/hooks/useAudioSync';
import { isSupabaseConfigured, deleteTracks, savePlaylist, loadPlaylist, saveSharedMedia, saveSessionPrivacy, saveAccessMode } from '@/lib/supabaseClient';
import { AccessModeSelector, type AccessMode } from '@/components/session/AccessModeSelector';
import type { SharedMedia } from '@/lib/supabaseClient';
import supabase from '@/lib/supabaseClient';
import { AvatarUploadCrop } from '@/components/profile/AvatarUploadCrop';
import { SharedMediaPlayer } from '@/components/session/SharedMediaPlayer';
import { IntervalTimer, type IntervalRun, type IntervalConfig, type IntervalTimerHandle, type IntervalTickInfo } from '@/components/session/IntervalTimer';
import { IntervalConfigModal } from '@/components/session/IntervalConfigModal';
import type { RemoteMediaState, SharedMediaPlayerHandle } from '@/components/session/SharedMediaPlayer';
import { MediaShareControls } from '@/components/session/MediaShareControls';
import type { ShareMode } from '@/components/session/MediaShareControls';
import { SessionSocial } from '@/components/session/SessionSocial';
import { LiveVisioPanel } from '@/components/session/LiveVisioPanel';
import { VisioControlBar } from '@/components/session/VisioControlBar';
import { useFullscreenPortalTarget } from '@/hooks/useFullscreenPortalTarget';
import { createPortal } from 'react-dom';
import { isUuid } from '@/utils/ids';
import { StageRequestsPanel } from '@/components/session/StageRequestsPanel';
import type { StageRequest } from '@/components/session/StageRequestsPanel';
import { ChatPanel } from '@/components/session/ChatPanel';
import { PromoEditor } from '@/components/session/PromoEditor';
import type { ChatMessage } from '@/components/session/ChatPanel';
import { CameraTile } from '@/components/session/CameraTile';
import { useLiveKitStage } from '@/hooks/useLiveKitStage';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useSessionRecorder } from '@/hooks/useSessionRecorder';
import { claimHost, setCohosts, spendCredit, listAccessRequests, decideAccessRequest } from '@/lib/paymentApi';
import { startRecording, stopRecording, uploadRecording, getCreditsConfig } from '@/lib/paymentApi';
import {
  getSessionAccessInfo, getBilletterieConfig, configureSession, buyTicket, checkTicket, getCoachPlan,
  getPawapayConfig, claimPendingAccess,
  type SessionAccessInfo, type PawapayConfig,
} from '@/lib/paymentApi';
import { Maximize2, Minimize2, Coins, Ticket, SkipBack, SkipForward, Play, Pause, Smartphone } from 'lucide-react';
import { DraggableWindow } from '@/components/session/DraggableWindow';

// LocalStorage key for nickname
const NICKNAME_STORAGE_KEY = 'bt_nickname';
// P2 : photo de profil (data URL) mémorisée pour les participants anonymes → pré-remplie au prochain join
const LOCAL_AVATAR_STORAGE_KEY = 'bt_local_avatar';

// Types de payload Realtime (E/F/C) — déclarés hors composant pour éviter les faux positifs
// de react-hooks/exhaustive-deps (noms de propriétés confondus avec des variables d'état).
interface MediaCommandPayload { media: SharedMedia | null; isPlaying?: boolean; currentTime?: number; }
interface DescPayload { description: string; }
interface PlaylistChangeRow { tracks?: Track[]; cohosts?: string[]; description?: string; host_id?: string; is_private?: boolean }
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

// P2 : mémorisation de la photo de profil locale (participant anonyme)
function getStoredLocalAvatar(): string | null {
  try {
    return localStorage.getItem(LOCAL_AVATAR_STORAGE_KEY);
  } catch {
    return null;
  }
}

function setStoredLocalAvatar(dataUrl: string): void {
  try {
    localStorage.setItem(LOCAL_AVATAR_STORAGE_KEY, dataUrl);
  } catch (error) {
    console.warn('Failed to store local avatar:', error);
  }
}

// 🎫 Demande d'accès APPROUVÉE : id lu depuis l'URL (?ar=<id>) puis PERSISTÉ par session.
// Permet à un participant ANONYME approuvé par l'hôte d'entrer en session PAYANTE sans compte :
// le backend vérifie que cette demande est bien approuvée ET rattachée à cette session.
function getApprovedRequestId(sessionId: string): number | null {
  try {
    const key = `bt_ar_${sessionId}`;
    const fromUrl = new URLSearchParams(window.location.search).get('ar');
    if (fromUrl && /^\d+$/.test(fromUrl)) { localStorage.setItem(key, fromUrl); return Number(fromUrl); }
    const saved = localStorage.getItem(key);
    return saved && /^\d+$/.test(saved) ? Number(saved) : null;
  } catch {
    return null;
  }
}

// POINT 2 : marqueur de "session active" par utilisateur (heartbeat localStorage).
// Une session est considérée active si son heartbeat date de moins de 90 s.
const ACTIVE_SESSION_TTL_MS = 90 * 1000;

// 🎯 SYNC : re-synchro ASYMÉTRIQUE (participant). drift = position participant − position hôte reçue.
//   - Le participant reçoit une position déjà « vieille » de la latence réseau → il est NORMALEMENT
//     légèrement EN AVANCE. On TOLÈRE cette avance (jusqu'à SYNC_AHEAD) → JAMAIS de re-seek arrière en
//     boucle (c'était la cause du « reboucle sur un segment » : un seuil symétrique serré renvoyait le
//     participant en arrière à chaque heartbeat).
//   - S'il est EN RETARD de plus de SYNC_BEHIND (buffering, onglet réveillé…), on rattrape vers l'avant.
const SYNC_BEHIND = 0.75; // retard toléré avant rattrapage (réduit le décalage ressenti)
const SYNC_AHEAD = 1.75;  // avance tolérée (latence normale) avant correction → anti-boucle
function needsResync(participantTime: number, hostTime: number): boolean {
  const drift = participantTime - hostTime; // >0 : participant en avance
  return drift < -SYNC_BEHIND || drift > SYNC_AHEAD;
}

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

// 🔒 Le marqueur local prouve que CET utilisateur est le CRÉATEUR de CETTE session
// (posé par createSessionNow via markActiveSession). Sert à réparer, SANS risque de « vol » de
// session, le cas où host_id n'a jamais été écrit en DB : seul le créateur (marqueur présent)
// peut revendiquer une session non revendiquée — jamais un simple participant. Ignore le TTL :
// on veut savoir « ai-je créé cette session ? », pas « est-elle encore fraîche ? ».
function hasActiveSessionMarker(userId: string, sessionId: string): boolean {
  try {
    const raw = localStorage.getItem(activeSessionKey(userId));
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return parsed?.sessionId === sessionId;
  } catch {
    return false;
  }
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
  // P2 : photo optionnelle pour les participants
  initialNickname?: string;
  currentAvatar?: string | null;
  onAddPhoto?: () => void;
}

const NicknameModal: React.FC<NicknameModalProps> = ({ isOpen, isHost, onSubmit, theme, initialNickname, currentAvatar, onAddPhoto }) => {
  const [nickname, setNickname] = useState(initialNickname || (isHost ? 'Coach' : ''));
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
          {/* Avatar preview — photo mémorisée si dispo, sinon initiales */}
          <div className="flex justify-center mb-4">
            <div
              className="w-20 h-20 rounded-full flex items-center justify-center text-2xl font-bold text-white overflow-hidden"
              style={{ background: theme.colors.gradient.primary }}
            >
              {currentAvatar ? (
                <img src={currentAvatar} alt="Votre photo" className="w-full h-full object-cover" />
              ) : (
                nickname ? generateAvatar(nickname) : '?'
              )}
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
                className="h-12 text-lg text-center bg-white/5 border-white/10 text-white placeholder:text-white/30 focus:border-[var(--bt-accent)]"
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
                boxShadow: '0 4px 24px rgba(122, 92, 255, 0.35)',
              }}
            >
              {isHost ? <Music className="w-4 h-4" /> : <Headphones className="w-4 h-4" />}
              {isHost ? 'Démarrer la session' : "Rejoindre l'écoute"}
            </Button>
          </form>

          {/* P2 : photo OPTIONNELLE pour les participants — conseil non bloquant + ajout rapide */}
          {!isHost && onAddPhoto && (
            <div className="mt-4 space-y-3">
              <button
                type="button"
                onClick={onAddPhoto}
                className="w-full h-11 rounded-xl font-medium text-sm flex items-center justify-center gap-2 border border-white/15 bg-white/5 text-white/80 hover:bg-white/10 transition-colors"
                data-testid="add-photo-btn"
              >
                <Camera className="w-4 h-4" />
                {currentAvatar ? 'Changer ma photo' : 'Ajouter ma photo (recommandé)'}
              </button>
              <p className="flex items-start gap-2 text-amber-300/80 text-xs leading-snug">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>Ajoutez votre vraie photo de profil pour une meilleure expérience — sinon l'hôte peut vous éjecter.</span>
              </p>
            </div>
          )}

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
  const { isAdmin, isSubscribed, effectivePlan, compActive } = useAuth();

  if (isAdmin) {
    return (
      <Badge className="bg-[rgb(var(--bt-accent-rgb)/0.2)] text-[var(--bt-accent)] border-[rgb(var(--bt-accent-rgb)/0.3)] flex items-center gap-1">
        <Crown className="w-3.5 h-3.5" />
        Mode Admin
      </Badge>
    );
  }

  if (isSubscribed) {
    return (
      <Badge className="bg-green-500/20 text-green-400 border-green-500/30 flex items-center gap-1">
        <Check className="w-3.5 h-3.5" />
        {compActive ? 'Offert' : 'Abonné'} {effectivePlan}
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
            boxShadow: '0 4px 24px rgba(122, 92, 255, 0.35)',
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
  const { t } = useI18n();
  const socket = useSocket();
  const { isAdmin, user, profile, refreshProfile, isLoading: authLoading, isSubscribed, isUnlimited, isFree, sessionLimit, refreshCredits } = useAuth();
  
  // ADMIN BYPASS: Check email directly for instant host access
  const userEmail = user?.email?.toLowerCase() || '';
  const isAdminByEmail = userEmail === 'contact.artboost@gmail.com';
  const isAdminUser = isAdminByEmail || isAdmin;

  // 💬 CHAT (Pro uniquement) : Pro/Enterprise/comp-access/admin. Les gratuits voient un cadenas.
  const isPro = isSubscribed || isAdminUser;

  // Audio element ref for remote mute control
  const audioElementRef = useRef<HTMLAudioElement | null>(null);

  // 🔒 SÉCURITÉ — être l'HÔTE de CETTE session ≠ être authentifié.
  // L'hôte est UNIQUEMENT : le créateur de la session, OU le propriétaire (host_id == user.id)
  // chargé depuis la DB, OU un admin. Un utilisateur connecté qui rejoint la session d'un AUTRE
  // est un simple participant (aucun contrôle de partage). Le droit de CRÉER une session
  // (plan Pro/etc.) est géré ailleurs et n'a rien à voir avec être hôte d'une session donnée.
  const [sessionHostId, setSessionHostId] = useState<string | null>(null);
  // 🔒 true dès que le fetch initial a DÉTERMINÉ host_id (présent ou absent). Permet de distinguer
  // « host_id pas encore chargé » de « session réellement non revendiquée (host_id NULL) ».
  const [hostResolved, setHostResolved] = useState<boolean>(false);
  const [isHost, setIsHost] = useState<boolean>(() => {
    // Création de session (pas d'URL ID) = créateur = hôte
    if (!urlSessionId) return true;
    // bypass admin instantané
    if (sessionStorage.getItem('bt_is_admin') === 'true') return true;
    // 🔑 ITEM 1 : le CRÉATEUR est reconnu HÔTE immédiatement, SANS attendre le round-trip host_id.
    // createSessionNow pose un marqueur local (markActiveSession) puis navigue vers /session/:id → la
    // page REMONTE avec urlSessionId défini. Sans ceci, isHost repartait à false → « En attente de
    // l'hôte » jusqu'à un refresh. Le marqueur n'est posé QUE par le créateur (jamais un participant),
    // donc aucun risque de « vol » d'hôte. L'auto-correction DB reste prioritaire (cf. effet ci-dessous).
    if (user?.id && hasActiveSessionMarker(user.id, urlSessionId)) return true;
    // sinon participant tant que host_id non vérifié
    return false;
  });
  const [sessionId, setSessionId] = useState<string | null>(urlSessionId || null);

  // 🚪 SALLE D'ATTENTE (sessions privées) — additif, public par défaut.
  const [isPrivate, setIsPrivate] = useState(false);          // état de la session (playlists.is_private)
  const [privacyChecked, setPrivacyChecked] = useState(false); // le fetch initial a-t-il déterminé is_private ?
  const [admitted, setAdmitted] = useState(false);            // participant admis dans la session privée
  const [refused, setRefused] = useState(false);              // participant refusé par l'hôte
  const [accessRequests, setAccessRequests] = useState<AccessRequest[]>([]); // (hôte) demandes en attente
  const admittedIdsRef = useRef<Set<string>>(new Set());      // (hôte) userId déjà admis (persistés)

  // 🔒 Détermination de l'hôte propriétaire à partir de host_id (DB) — JAMAIS de "tout authentifié".
  useEffect(() => {
    if (isAdminUser) { setIsHost(true); return; }
    if (!urlSessionId) return;        // création → isHost déjà true (createSessionNow)
    if (sessionHostId) {
      // host_id connu depuis la DB = SOURCE DE VÉRITÉ (auto-correction incluse) :
      // si la session appartient à un AUTRE compte, je redeviens participant.
      setIsHost(!!user?.id && user.id === sessionHostId);
      return;
    }
    // 🔑 ITEM 1 : host_id pas encore résolu → reconnaître le CRÉATEUR via le marqueur local
    // (zéro refresh). Ne concerne que le créateur (marqueur posé par createSessionNow), jamais un
    // participant. Dès que host_id est résolu, la branche ci-dessus reprend la main.
    if (user?.id && hasActiveSessionMarker(user.id, urlSessionId)) { setIsHost(true); return; }
    // sinon : rester participant tant que host_id non vérifié (ne pas dégrader avant claim)
  }, [isAdminUser, urlSessionId, sessionHostId, user?.id]);

  // Item 3 : mémoriser le code de session rejoint (participant) → reprise rapide depuis l'accueil
  useEffect(() => {
    if (urlSessionId && !isHost) {
      try { localStorage.setItem('bt_last_session_code', urlSessionId); } catch { /* ignore */ }
    }
  }, [urlSessionId, isHost]);

  // 🔒 ITEM 2 (B) — FIABILITÉ DU PROFIL EN SESSION : recharge UNE fois le vrai profil au montage.
  // Si l'auth a posé un profil minimal 'trial' (fallback timeout, sans comp_access_*), un coach
  // illimité verrait réapparaître « limite version d'essai ». refreshProfile refait un select('*')
  // complet → comp_access_plan/comp_access_until présents → compActive/isUnlimited corrects, zéro
  // refresh manuel. Sans effet sur l'admin (bypass) ni sur un vrai coach gratuit (profil identique).
  const profileEnsuredRef = useRef(false);
  useEffect(() => {
    if (!user?.id || isAdminUser) return;
    if (profileEnsuredRef.current) return;
    profileEnsuredRef.current = true;
    refreshProfile();
  }, [user?.id, isAdminUser, refreshProfile]);
  
  // Nickname state
  const [nickname, setNickname] = useState<string | null>(null);
  const [showNicknameModal, setShowNicknameModal] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  
  // Remote mute state (controlled by host)
  const [isRemoteMuted, setIsRemoteMuted] = useState(false);

  // 📱 P2 : menu hamburger de l'en-tête de session (mobile < md)
  const [sessionMenuOpen, setSessionMenuOpen] = useState(false);

  // Playlist state - TOUJOURS vide au démarrage, jamais de fallback
  const [tracks, setTracks] = useState<Track[]>([]);
  const [selectedTrack, setSelectedTrack] = useState<Track | null>(null);
  // ⏱️ Interval training (additif) : run affiché en overlay + piste dont la config est ouverte.
  const [intervalRun, setIntervalRun] = useState<IntervalRun | null>(null);
  const [intervalConfigTrackId, setIntervalConfigTrackId] = useState<number | null>(null);
  const intervalTimerRef = useRef<IntervalTimerHandle | null>(null); // ⏱️ débloquer le son du timer au geste musique
  // ⏱️ Interval PENDANT la visio : décompte lecture seule (rappel plein écran) + modale de config SANS musique.
  const [intervalTick, setIntervalTick] = useState<IntervalTickInfo | null>(null);
  const [showVisioTimerConfig, setShowVisioTimerConfig] = useState(false);
  // ⏱️ Dernière config du timer de visio (sans piste) — mémorisée pour la retrouver à la réouverture.
  const [visioTimerConfig, setVisioTimerConfig] = useState<IntervalConfig | undefined>(() => {
    try { const raw = localStorage.getItem('bt_visio_timer_cfg'); return raw ? (JSON.parse(raw) as IntervalConfig) : undefined; } catch { return undefined; }
  });
  const persistVisioTimerConfig = useCallback((cfg: IntervalConfig) => {
    setVisioTimerConfig(cfg);
    try { localStorage.setItem('bt_visio_timer_cfg', JSON.stringify(cfg)); } catch { /* ignore */ }
  }, []);
  // 🎥 Chantier B : voir les caméras PAR-DESSUS la vidéo partagée (mobile, hors plein écran).
  const [showMobileCameras, setShowMobileCameras] = useState(false);
  const [isSyncActive, setIsSyncActive] = useState(false); // État de synchronisation Cloud
  const [hostIsPlaying, setHostIsPlaying] = useState(false); // 🔄 Sync Play/Pause
  
  // Participants state with volume/mute controls
  const [participantsState, setParticipantsState] = useState<Participant[]>(BASE_PARTICIPANTS);
  
  // Host mic state
  const [hostMicActive, setHostMicActive] = useState(false);
  const [hostMicStream, setHostMicStream] = useState<MediaStream | null>(null);
  // 🎙️ Mode du micro hôte :
  //   'manual' (DÉFAUT) = l'hôte PARLE PAR-DESSUS la musique (elle CONTINUE) ; il coupe/relance à la main.
  //   'voice' = VAD mains-libres : la musique s'AUTO-PAUSE dès que l'hôte parle (auto-reprise après).
  //   Persisté localement (le choix de l'hôte prime sur le défaut). Bascule par double-clic sur le micro.
  //   POINT #3 : défaut = manual pour restaurer « parler par-dessus la musique » (musique qui continue).
  const [micMode, setMicMode] = useState<'voice' | 'manual'>(() => {
    try { return localStorage.getItem('bt_mic_mode') === 'voice' ? 'voice' : 'manual'; } catch { return 'manual'; }
  });
  const [manualMusicPaused, setManualMusicPaused] = useState(false);
  
  const [audioState, setAudioState] = useState<AudioState | null>(null);
  const [syncState, setSyncState] = useState<SyncState | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>('none');
  const [autoPlayPending, setAutoPlayPending] = useState<string | null>(null);
  // 🔊 BUG 1: autoplay bloqué côté participant (NotAllowedError) → bouton geste utilisateur
  const [audioBlocked, setAudioBlocked] = useState(false);
  // 🔓 Une fois le son DÉBLOQUÉ par un geste, on ne réaffiche PLUS l'overlay « Activer le son »
  //    (fin de la boucle : l'autoplay reste autorisé pour la suite de la session).
  const audioUnlockedRef = useRef(false);
  // 🎯 SYNCHRO ROBUSTE (participant = suiveur pur). Refs de contrôle anti-boucle :
  const loadedTrackIdRef = useRef<number | null>(null);  // piste RÉELLEMENT chargée (≠ selectedTrack qui peut lag)
  // 🔧 BUG 3 (émission HÔTE) : trackId TOUJOURS FRAIS pour les commandes PLAY/PAUSE/SEEK/STATE. La closure
  //   `selectedTrack?.id` de handleAudioStateChange TRAÎNE d'un render pendant une transition de piste →
  //   elle diffusait un trackId périmé → le participant basculait/rebasculait (oscillation + coupures).
  //   On lit ce ref (synchronisé ci-dessous sur selectedTrack) au lieu de la closure.
  const currentTrackIdRef = useRef<number | null>(null);
  const isApplyingRemoteRef = useRef(false);             // vrai pendant qu'on applique l'état hôte → ignore la ré-entrance
  const lastRemotePlayingRef = useRef<boolean | null>(null); // dernier isPlaying appliqué (log seulement sur changement)
  // 🎯 Position/état distant à appliquer QUAND la nouvelle piste est prête (anti-boucle au changement de piste)
  const pendingRemoteRef = useRef<{ currentTime: number; isPlaying: boolean } | null>(null);
  const lastSeekSecRef = useRef<number>(-1);             // dernière seconde de resynchro SEEK émise (anti-rafale ~60/s)

  // 🔇 Décisions de mute de l'hôte (persistées localement, indépendantes de la presence)
  const [mutedUserIds, setMutedUserIds] = useState<Set<string>>(new Set());
  // 🔊 Volumes par participant (overlay local, la presence ne transporte pas le volume)
  const [userVolumes, setUserVolumes] = useState<Record<string, number>>({});

  // B : photo de profil — avatar courant (compte) ou data URL locale (anonyme)
  // P2 : pré-remplie depuis le localStorage si une photo a déjà été choisie auparavant
  const [localAvatar, setLocalAvatar] = useState<string | null>(() => getStoredLocalAvatar());
  const myAvatar = profile?.avatar_url || localAvatar || null;
  const [showAvatarCrop, setShowAvatarCrop] = useState(false);
  const pendingAfterAvatarRef = useRef<(() => void) | null>(null);

  // C : description de session
  const [description, setDescription] = useState(''); // reçue via realtime/DB (plus d'édition — P8)

  // E : média partagé (vidéo/image/youtube/vimeo/lien) + état distant pour les participants
  const [sharedMedia, setSharedMedia] = useState<SharedMedia | null>(null);
  const [remoteMediaState, setRemoteMediaState] = useState<RemoteMediaState | null>(null);
  // 🎬 SYNCHRO VIDÉO : ts du dernier VIDEO_SYNC appliqué → ignorer les messages plus anciens
  // (réordonnancement réseau) pour ne jamais revenir en arrière.
  const lastVideoTsRef = useRef(0);
  // Item 6 : le sélecteur de mode pilote TOUTE la zone centrale (audio = lecteur + playlist ;
  // vidéo/image/lien = uniquement le média partagé). Hôte/co-host le contrôlent via le sélecteur ;
  // les participants le dérivent du média reçu (effet plus bas).
  const [shareMode, setShareMode] = useState<ShareMode>('audio');
  // 🔊 Une vidéo est-elle partagée ? → le curseur "Volume Musique" devient "Volume Vidéo"
  const isVideoShared = !!sharedMedia && (sharedMedia.type === 'video' || sharedMedia.type === 'youtube' || sharedMedia.type === 'vimeo');
  // Item 2 : panneaux repliables (repliés par défaut pour désencombrer la page)
  const [panelOpen, setPanelOpen] = useState<{ status: boolean; code: boolean; instructions: boolean; share: boolean }>({
    status: false, code: false, instructions: false, share: false,
  });
  const togglePanel = useCallback((key: 'status' | 'code' | 'instructions' | 'share') => {
    setPanelOpen((p) => ({ ...p, [key]: !p[key] }));
  }, []);
  // 👥 Liste des participants rétractable quand elle dépasse 5 personnes (aération mobile).
  const [participantsCollapsed, setParticipantsCollapsed] = useState<boolean>(false);
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
    setTimerVolume,
    connectMicSource,
    connectMusicSource,
    getMusicStream,
    setSelfMonitor,
    getContext: getMixerContext,
    getTimerOutput,
    setMicDuckCompensation,
    startVoiceActivity,
    stopVoiceActivity,
  } = useAudioMixer({
    onInitialized: () => {
      // Silencieux - démarrage réussi
    },
  });

  // ⏱️ Curseur « Timer / Bips » : volume LOCAL persisté par utilisateur (localStorage). Additif — pilote
  //    UNIQUEMENT le GainNode du timer (getTimerOutput → master + recTap), aucun autre canal.
  const handleTimerVolumeChange = useCallback((v: number) => {
    setTimerVolume(v);
    try { localStorage.setItem('bt_mixer_timer_vol', String(v)); } catch { /* ignore */ }
  }, [setTimerVolume]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem('bt_mixer_timer_vol');
      if (raw != null) { const v = parseFloat(raw); if (!Number.isNaN(v)) setTimerVolume(v); }
    } catch { /* ignore */ }
  }, [setTimerVolume]);

  // 🎵 Cible l'élément <audio> de la MUSIQUE (et pas les <audio> de voix tribu/relay/hôte).
  const getMusicEl = useCallback((): HTMLAudioElement | null => {
    // 🎵 Cible SANS AMBIGUÏTÉ l'élément MUSIQUE (id dédié), jamais un <audio> voix (usePeerAudio ajoute
    //    des <audio> voix/tribu/relay au body → querySelector('audio') pouvait attraper le mauvais →
    //    la synchro play/pause s'appliquait au mauvais élément (bug « pause non synchronisée »)).
    return (document.getElementById('bt-music-audio')
      || document.querySelector('audio:not(.bt-tribe-audio):not(.bt-relay-audio):not(#remote-voice-audio)')) as HTMLAudioElement | null;
  }, []);

  // 🎵 AUTO-PAUSE / AUTO-RESUME de la musique pendant la parole — piloté par l'HÔTE et synchronisé à TOUS
  //    via le mécanisme play/pause EXISTANT : pause()/play() de l'élément musique → event 'pause'/'play'
  //    → handleAudioStateChange → HOST_COMMAND PAUSE/PLAY broadcast. On ne réinvente rien.
  //    Plusieurs micros peuvent tenir la pause (micro hôte + participants à qui on donne la parole) : on
  //    ne relance la musique que lorsque PLUS AUCUN ne la tient, et UNIQUEMENT si elle jouait avant.
  const micHoldRef = useRef<Set<string>>(new Set());
  const musicWasPlayingRef = useRef(false);
  // 🎬 Média partagé (vidéo/YouTube/Vimeo) piloté par le MÊME compteur : pause à la parole, reprise au silence.
  const sharedMediaPlayerRef = useRef<SharedMediaPlayerHandle | null>(null);
  const sharedMediaWasPlayingRef = useRef(false);

  // Réveille le contexte mixeur que la libération du micro a pu suspendre (changement de périphérique OS),
  // sur ~1.2 s. Ne touche PAS l'état play/pause (piloté par la synchro). Utilisé côté participant.
  const resumeMixerContextSoon = useCallback(() => {
    let tries = 0;
    const tick = () => {
      try { const ctx = getMixerContext(); if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => { /* ignore */ }); } catch { /* ignore */ }
      if (++tries < 6) setTimeout(tick, 200);
    };
    tick();
  }, [getMixerContext]);

  // ⏱️ ANTI-FLUTTER : garantit un écart minimal (~600ms) entre deux transitions RÉELLES pause↔play de la
  //   musique. En mode Voix (VAD) sur haut-parleurs, l'écho HP pouvait enchaîner hold→resume→hold →
  //   PAUSE→PLAY→PAUSE rapprochés (à-coups chez le participant). Les transitions trop proches sont
  //   COALESCÉES vers l'état final. La 1re transition d'une salve reste immédiate (réactivité).
  const MIN_HOLD_GAP_MS = 600;
  const musicHoldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const musicHoldAppliedPausedRef = useRef(false); // dernier état RÉELLEMENT appliqué (true = musique en pause)
  const musicHoldLastAtRef = useRef(0);

  // Applique RÉELLEMENT la pause (musique + média partagé) et mémorise si ça jouait (pour l'auto-resume).
  const applyMusicPause = useCallback(() => {
    const audioEl = getMusicEl();
    if (audioEl) {
      musicWasPlayingRef.current = !audioEl.paused && !audioEl.ended && !!audioEl.src;
      if (musicWasPlayingRef.current) audioEl.pause(); // → event 'pause' → HOST_COMMAND PAUSE synchronisé à tous
    } else {
      musicWasPlayingRef.current = false;
    }
    // 🎬 Média partagé (vidéo/YouTube/Vimeo) : pause via le chemin hôte existant → VIDEO_SYNC propage à tous.
    try { sharedMediaWasPlayingRef.current = sharedMediaPlayerRef.current?.pauseSharedMedia() ?? false; }
    catch { sharedMediaWasPlayingRef.current = false; }
  }, [getMusicEl]);

  // Applique RÉELLEMENT la reprise — resume() du contexte mixeur + play() de l'élément UNIQUEMENT si la
  //   musique jouait avant l'auto-pause. JAMAIS load() (reprise à la position courante).
  const applyMusicResume = useCallback(() => {
    const shouldResume = musicWasPlayingRef.current;
    musicWasPlayingRef.current = false;
    // 🎬 Média partagé : reprise UNE fois (le heartbeat cale la position) UNIQUEMENT s'il jouait avant.
    const resumeShared = sharedMediaWasPlayingRef.current;
    sharedMediaWasPlayingRef.current = false;
    if (resumeShared) { try { sharedMediaPlayerRef.current?.resumeSharedMedia(true); } catch { /* ignore */ } }
    const audioEl = getMusicEl();
    if (!audioEl) return;
    let tries = 0;
    const tick = () => {
      try { const ctx = getMixerContext(); if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => { /* ignore */ }); } catch { /* ignore */ }
      if (shouldResume && audioEl.paused && audioEl.src) {
        audioEl.play().catch(() => { /* geste requis ? ignore, jamais load() → reprise à la position courante */ });
      }
      if (++tries < 6) setTimeout(tick, 200);
    };
    tick();
  }, [getMusicEl, getMixerContext]);

  // Programme l'état voulu (pause si un micro tient encore, sinon reprise) en respectant l'écart minimal.
  const scheduleMusicHold = useCallback((shouldPause: boolean) => {
    if (musicHoldTimerRef.current) { clearTimeout(musicHoldTimerRef.current); musicHoldTimerRef.current = null; }
    if (shouldPause === musicHoldAppliedPausedRef.current) return; // déjà dans l'état voulu → rien à faire
    const apply = () => {
      musicHoldTimerRef.current = null;
      if (shouldPause === musicHoldAppliedPausedRef.current) return; // l'état voulu a pu re-changer entre-temps
      musicHoldAppliedPausedRef.current = shouldPause;
      musicHoldLastAtRef.current = Date.now();
      if (shouldPause) applyMusicPause(); else applyMusicResume();
    };
    const elapsed = Date.now() - musicHoldLastAtRef.current;
    if (elapsed >= MIN_HOLD_GAP_MS) apply();                                        // 1re transition : immédiate
    else musicHoldTimerRef.current = setTimeout(apply, MIN_HOLD_GAP_MS - elapsed);  // sinon : coalescing
  }, [applyMusicPause, applyMusicResume]);

  // Un micro s'ACTIVE → on VEUT la musique en pause (appliqué via le coalescing anti-flutter).
  const addMicHold = useCallback((key: string) => {
    micHoldRef.current.add(key);
    scheduleMusicHold(micHoldRef.current.size > 0);
  }, [scheduleMusicHold]);

  // Un micro se DÉSACTIVE → si PLUS AUCUN micro n'est actif, on VEUT la reprise (via le coalescing).
  const removeMicHold = useCallback((key: string) => {
    micHoldRef.current.delete(key);
    scheduleMusicHold(micHoldRef.current.size > 0);
  }, [scheduleMusicHold]);

  // 🎯 POINT D'APPLICATION UNIQUE de l'état de lecture de l'HÔTE (source unique de vérité). TOUS les
  //   transports de synchro (HOST_COMMAND supabase, socket) passent par ici → plus de va-et-vient.
  //   Règles : le participant ne fait qu'APPLIQUER ; on ne change de piste QUE si trackId ≠ piste chargée ;
  //   on marque isApplyingRemote pour ignorer les events <audio> auto-générés ; aucun rechargement inutile.
  const applyRemoteState = useCallback((o: { trackId?: number | null; currentTime?: number; isPlaying?: boolean; reason: string; source: string }) => {
    if (isHostRef.current) return; // l'hôte n'applique JAMAIS d'état distant
    const audioEl = getMusicEl();
    // 1) CHANGEMENT DE PISTE — anti-boucle : on NE touche PAS l'élément encore chargé avec l'ANCIENNE
    //    piste (avant : on le seek à 0 + play, puis reload → glissement/boucle sur un segment). On
    //    mémorise la position/état à appliquer UNE SEULE FOIS quand la nouvelle piste est prête (effet
    //    'canplay' plus bas), et on sort immédiatement.
    if (o.trackId != null && o.trackId !== loadedTrackIdRef.current) {
      const target = tracksRef.current.find((t) => t.id === o.trackId);
      if (target) {
        console.log('[SYNC] piste', loadedTrackIdRef.current, '→', o.trackId, '| raison=', o.reason, '| source=', o.source);
        loadedTrackIdRef.current = o.trackId;
        pendingRemoteRef.current = {
          currentTime: typeof o.currentTime === 'number' ? o.currentTime : 0,
          isPlaying: o.isPlaying !== false, // défaut : jouer la nouvelle piste
        };
        isApplyingRemoteRef.current = true;
        setSelectedTrack(target); // rechargement réel = effet src d'AudioPlayer → 'canplay' applique le pending
        setTimeout(() => { isApplyingRemoteRef.current = false; }, 400);
      }
      return; // ne pas exécuter play/seek sur l'ancienne piste ce tick
    }
    if (!audioEl) return;
    // 2) play / pause / seek sur la MÊME piste — marqués « application distante ». Re-synchro via
    //    needsResync() (asymétrique) : on rattrape le RETARD (>0,75s) mais on TOLÈRE l'AVANCE due à la
    //    latence (jusqu'à 1,75s) → JAMAIS de re-seek arrière en boucle vers une position figée.
    isApplyingRemoteRef.current = true;
    try {
      if (o.isPlaying != null) {
        if (o.isPlaying) {
          if (typeof o.currentTime === 'number') {
            const drift = audioEl.currentTime - o.currentTime; // >0 : participant en avance (latence normale)
            if (needsResync(audioEl.currentTime, o.currentTime)) {
              audioEl.currentTime = o.currentTime;
              console.log('[SYNC] participant applique seek=', o.currentTime.toFixed(2), '(drift', drift.toFixed(2), 's)');
            } else {
              console.log('[SYNC] participant pas de seek (drift', drift.toFixed(2), 's ok)');
            }
          }
          if (audioEl.paused && audioEl.src) {
            audioEl.play().catch((err) => { console.warn('[SYNC] play bloqué (autoplay)', err); if (!audioUnlockedRef.current) setAudioBlocked(true); });
          }
          if (lastRemotePlayingRef.current !== true) console.log('[SYNC] ▶️ PLAY | raison=', o.reason, '| source=', o.source);
        } else {
          if (!audioEl.paused) audioEl.pause();
          if (lastRemotePlayingRef.current !== false) console.log('[SYNC] ⏸️ PAUSE | raison=', o.reason, '| source=', o.source);
        }
        lastRemotePlayingRef.current = o.isPlaying;
      } else if (typeof o.currentTime === 'number') {
        const drift = audioEl.currentTime - o.currentTime;
        if (needsResync(audioEl.currentTime, o.currentTime)) {
          audioEl.currentTime = o.currentTime; // SEEK pur (sans changer play/pause)
          console.log('[SYNC] participant applique seek=', o.currentTime.toFixed(2), '(drift', drift.toFixed(2), 's)');
        } else {
          console.log('[SYNC] participant pas de seek (drift', drift.toFixed(2), 's ok)');
        }
      }
    } finally {
      setTimeout(() => { isApplyingRemoteRef.current = false; }, 150);
    }
  }, [getMusicEl]);

  // 🎯 Participant — applique la position/état distant MÉMORISÉ dès que la NOUVELLE piste peut jouer
  //   (anti-boucle : la nouvelle chanson démarre proprement, positionnée une seule fois, au lieu de
  //   rejouer un segment de l'ancienne piste). Le listener vit sur l'élément musique stable.
  useEffect(() => {
    if (isHost) return;
    const audioEl = getMusicEl();
    if (!audioEl) return;
    const applyPending = () => {
      const p = pendingRemoteRef.current;
      if (!p) return;
      pendingRemoteRef.current = null;
      isApplyingRemoteRef.current = true;
      try {
        const didSeek = p.currentTime > 0 && needsResync(audioEl.currentTime, p.currentTime);
        if (didSeek) audioEl.currentTime = p.currentTime;
        console.log('[SYNC] participant nouvelle piste prête → cale', didSeek ? 'seek=' + p.currentTime.toFixed(2) : 'position=0', '| play=', p.isPlaying);
        if (p.isPlaying) {
          if (audioEl.paused && audioEl.src) audioEl.play().catch((err) => { console.warn('[SYNC] play bloqué (autoplay)', err); if (!audioUnlockedRef.current) setAudioBlocked(true); });
        } else if (!audioEl.paused) {
          audioEl.pause();
        }
        lastRemotePlayingRef.current = p.isPlaying;
      } finally {
        setTimeout(() => { isApplyingRemoteRef.current = false; }, 150);
      }
    };
    audioEl.addEventListener('canplay', applyPending);
    audioEl.addEventListener('loadeddata', applyPending);
    // Anti-course : si la piste est DÉJÀ prête (canplay déjà passé avant l'abonnement), appliquer tout de suite.
    if (audioEl.readyState >= 2 && pendingRemoteRef.current) applyPending();
    return () => {
      audioEl.removeEventListener('canplay', applyPending);
      audioEl.removeEventListener('loadeddata', applyPending);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHost, getMusicEl, selectedTrack?.id]);

  // 🔧 BUG 3 : garder currentTrackIdRef synchronisé sur la piste sélectionnée. Cet effet s'exécute au
  //   commit du render (donc AVANT l'événement 'play' de la nouvelle piste, qui suit le chargement du
  //   nouveau src) → les émetteurs HOST_COMMAND lisent toujours le BON trackId, jamais une closure périmée.
  useEffect(() => {
    currentTrackIdRef.current = selectedTrack?.id ?? null;
  }, [selectedTrack?.id]);

  // 🎚️ "Volume Musique" : 0..100% via element.volume, 100..200% via le GainNode (boost réel).
  // Pas de double atténuation : le gain reste ≥ 1.0 (cf. useAudioMixer.setMusicVolume).
  const handleMusicVolumeChange = useCallback((volume: number) => {
    setMusicVolume(volume);                 // état + GainNode de boost (≥ 1.0)
    const audioEl = getMusicEl();
    if (audioEl) audioEl.volume = Math.max(0, Math.min(1, volume)); // atténuation 0..100%
  }, [setMusicVolume, getMusicEl]);

  // 🔊 Router la musique dans le mixeur (Web Audio) → master + compresseur → pleine puissance + headroom.
  // L'audio de Supabase Storage public est servi en CORS (*) → createMediaElementSource ne "tainte" pas.
  // Si le routage échoue, element.volume continue de fonctionner (aucune régression).
  const musicConnectedRef = useRef(false);
  useEffect(() => {
    if (!mixerState.isInitialized || musicConnectedRef.current) return;
    let cancelled = false;
    let tries = 0;
    const tryConnect = () => {
      if (cancelled || musicConnectedRef.current) return;
      const audioEl = getMusicEl();
      if (audioEl) {
        musicConnectedRef.current = true;
        audioEl.volume = Math.min(1, mixerState.musicVolume); // 100% par défaut (atténuation 0..1)
        try { connectMusicSource(audioEl); } catch { /* fallback : element.volume continue de marcher */ }
        return;
      }
      // L'élément <audio> de la musique n'est monté qu'après l'entrée en session → on réessaie brièvement.
      if (tries++ < 40) setTimeout(tryConnect, 250);
    };
    tryConnect();
    return () => { cancelled = true; };
  }, [mixerState.isInitialized, mixerState.musicVolume, getMusicEl, connectMusicSource]);


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

  // ♾️ SOURCE AUTORITAIRE (backend) du statut illimité : GET /coach/plan.unlimited reflète EXACTEMENT
  //   is_coach_unlimited (comp_access pro/enterprise actif OU abo coach 'subscription' actif), sans
  //   dépendre du timing de chargement des champs comp_access_* dans le profil front. Filet anti-régression
  //   « limite version d'essai » chez un coach illimité. Ne s'applique qu'à l'hôte authentifié.
  const [backendUnlimited, setBackendUnlimited] = useState(false); // alimenté par getCoachPlan (effet plus bas)

  // Check if HOST is on free trial (participants are always unlimited)
  // ♾️ Un coach illimité (comp pro/enterprise, enterprise, admin, OU backend unlimited) n'est JAMAIS en
  //    essai gratuit : aucune limite de 5 min. Un vrai coach gratuit (non-abonné, sans comp) garde son essai.
  const isUnlimitedHost = isUnlimited || backendUnlimited;
  const isFreeTrial = isHost && !isSubscribed && !isUnlimitedHost;

  // PeerJS for WebRTC voice broadcast
  const {
    state: peerState,
    connect: connectPeer,
    disconnect: disconnectPeer,
    broadcastAudio,
    stopBroadcast,
    unlockAudio,
    ensureVoiceAudible,
    talkToHost,
    stopTalkToHost,
    setTribeVolume: setTribeAudioVolume,
    setHostVoiceVolume: setHostVoiceAudioVolume,
    setPrivateTargets,
    setRemoteMicVolume,
    setTribeUserVolume,
    setTribeUserMuted,
    remoteAudioRef,
  } = usePeerAudio({
    sessionId: sessionId || 'default',
    isHost,
    userId: socket.userId,
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

  // 🔊 "Volume Hôte" (participant) : met à jour l'affichage ET le volume réel de la voix de l'hôte
  const handleHostVoiceVolumeChange = useCallback((volume: number) => {
    setHostVoiceVolume(volume);       // état du slider
    setHostVoiceAudioVolume(volume);  // volume direct de l'<audio> de la voix hôte
  }, [setHostVoiceVolume, setHostVoiceAudioVolume]);

  // 🔊 POINT B (participant) : volume par AUTRE participant (voix relayée par l'hôte)
  const [remoteMicVolumes, setRemoteMicVolumes] = useState<Record<string, number>>({});
  const handleRemoteMicVolumeChange = useCallback((userId: string, volume: number) => {
    setRemoteMicVolumes((prev) => ({ ...prev, [userId]: volume }));
    setRemoteMicVolume(userId, volume); // applique direct sur l'<audio> du flux relayé
  }, [setRemoteMicVolume]);

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
    // ⏳ CORRECTIF « hôte enregistré comme participant » : ne créer le peer qu'une fois le PROFIL chargé
    //   (authLoading=false) → isHost est proche de sa valeur finale (admin/marqueur connus). Le cas
    //   coach-non-admin résolu via la DB est rattrapé par la réconciliation à l'ouverture (usePeerAudio).
    if (authLoading) return;
    peerConnectedRef.current = true;
    connectPeer(); // sans flux : l'hôte répond aux appels, le participant rejoint l'hôte
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, nickname, authLoading]);

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
  // 🎙️ VAD MAINS-LIBRES (hôte) : le micro reste allumé en continu ; c'est la DÉTECTION DE PAROLE qui
  //    pilote l'auto-pause. Parler → auto-pause musique (synchro tous) + voix garantie audible ; se taire
  //    (après hangover ~900ms) → auto-resume. Réutilise le compteur micHoldRef (clé 'host-vad').
  // 🔧 Anti-spam VAD : minuterie de reprise différée. La détection de parole « clignote » entre les mots
  //   (parole/silence/parole) → sans hystérésis, on enchaînait PAUSE→PLAY→PAUSE en rafale (coupures de
  //   musique chez le participant). On ne RELANCE la musique qu'après un silence PROLONGÉ ; si la parole
  //   reprend avant, on annule la reprise → la musique reste en pause proprement.
  const vadResumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleSpeechStart = useCallback(() => {
    if (vadResumeTimerRef.current) { clearTimeout(vadResumeTimerRef.current); vadResumeTimerRef.current = null; }
    ensureVoiceAudible();    // voix nette immédiatement, même musique/vidéo en pause
    addMicHold('host-vad');  // auto-pause musique (+ vidéo partagée) synchronisée à tous (idempotent)
  }, [ensureVoiceAudible, addMicHold]);
  const handleSpeechEnd = useCallback(() => {
    if (vadResumeTimerRef.current) clearTimeout(vadResumeTimerRef.current);
    vadResumeTimerRef.current = setTimeout(() => {
      vadResumeTimerRef.current = null;
      removeMicHold('host-vad'); // auto-resume seulement après ~1,4 s de vrai silence
    }, 1400);
  }, [removeMicHold]);

  // 🎙️ Bascule VOIX (VAD) ↔ MANUEL (double-clic sur le micro). Persistée localement.
  const handleToggleMicMode = useCallback(() => {
    setMicMode((prev) => {
      const next = prev === 'voice' ? 'manual' : 'voice';
      try { localStorage.setItem('bt_mic_mode', next); } catch { /* ignore */ }
      if (next === 'manual') {
        // MANUEL : couper la VAD + libérer un hold VAD → la musique reprend ; l'hôte pilotera à la main.
        stopVoiceActivity();
        removeMicHold('host-vad');
        setManualMusicPaused(false);
      } else {
        // VOIX : réinitialiser un hold manuel puis (ré)armer la VAD si le micro est allumé.
        removeMicHold('host-manual');
        setManualMusicPaused(false);
        if (hostMicStream) startVoiceActivity(handleSpeechStart, handleSpeechEnd);
      }
      return next;
    });
  }, [stopVoiceActivity, removeMicHold, startVoiceActivity, hostMicStream, handleSpeechStart, handleSpeechEnd]);

  // 🎚️ MANUEL : couper / reprendre la musique (+ vidéo partagée) à la main — même mécanisme synchronisé.
  const handleToggleManualMusic = useCallback(() => {
    setManualMusicPaused((paused) => {
      if (paused) { removeMicHold('host-manual'); return false; }
      ensureVoiceAudible();       // voix nette pendant la coupure
      addMicHold('host-manual');  // pause synchronisée musique + vidéo partagée
      return true;
    });
  }, [addMicHold, removeMicHold, ensureVoiceAudible]);

  const broadcastedStreamRef = useRef<MediaStream | null>(null);
  useEffect(() => {
    if (!isHost) return;
    if (hostMicStream === broadcastedStreamRef.current) return;
    broadcastedStreamRef.current = hostMicStream;

    if (hostMicStream) {
      initializeMixer();
      const micBroadcastStream = connectMicSource(hostMicStream);
      broadcastAudio(micBroadcastStream); // mémorise le flux, diffuse aux participants connectés
      // 🎙️ Micro diffusé en continu. En mode VOIX, la VAD décide de l'auto-pause ; en MANUEL, l'hôte pilote.
      if (micMode === 'voice') startVoiceActivity(handleSpeechStart, handleSpeechEnd);
    } else {
      stopBroadcast(); // retire le flux sortant, garde le peer actif
      stopVoiceActivity();
      if (vadResumeTimerRef.current) { clearTimeout(vadResumeTimerRef.current); vadResumeTimerRef.current = null; }
      removeMicHold('host-vad');    // sécurité : libère un hold VAD éventuel
      removeMicHold('host-manual'); // sécurité : libère un hold manuel éventuel
      setManualMusicPaused(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHost, hostMicStream]);

  // 🎚️ #4 — VOLUME STABLE AU MICRO : on NE réécrit PLUS le gain de la musique à la bascule du micro. La
  //    « compensation de ducking » est neutralisée (MIC_DUCK_COMPENSATION=1.0) car sur le web aucun ducking
  //    OS n'a lieu → la « compenser » ne faisait que faire SAUTER le volume (monte à l'activation, baisse à
  //    la coupure). À la place, on RÉVEILLE le contexte mixeur : ouvrir/fermer le micro peut le SUSPENDRE →
  //    la musique (routée via Web Audio par createMediaElementSource) devenait muette/faible et il fallait
  //    RECHARGER la page. resume() idempotent → volume restauré sans rechargement, sans toucher au gain.
  //    🐛 BUG 1 (régression) : déclenché aussi sur CHANGEMENT DE PÉRIPHÉRIQUE micro (hostMicStream change
  //    sans que hostMicActive bascule) → on RÉVEILLE le contexte ET on RÉ-AFFIRME le volume musique (gain
  //    mixeur ≥1 + volume de l'élément) pour qu'un transert/suspend ne laisse JAMAIS la musique baissée.
  //    Le micro vit toujours dans son AudioContext dédié (micCtx) → jamais mélangé à la musique.
  useEffect(() => {
    try { const ctx = getMixerContext(); if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => { /* ignore */ }); } catch { /* ignore */ }
    // 🐛 BUG 1 : compensation d'un ducking OS RÉSIDUEL sur MOBILE non-iOS (Android) UNIQUEMENT (>1 quand le
    //    micro est actif) ; sur desktop/iOS = 1.0 → aucun « saut » de volume. Puis on ré-affirme le gain.
    try { setMicDuckCompensation(hostMicActive); } catch { /* ignore */ }
    try { setMusicVolume(mixerState.musicVolume); } catch { /* ignore */ }        // ré-affirme le gain (≥1, jamais < 1)
    try { const el = getMusicEl(); if (el) el.volume = Math.min(1, mixerState.musicVolume); } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostMicActive, hostMicStream]);

  // 🎤 POINT 5: PARTICIPANT — "Prendre la parole" (micro montant vers l'hôte)
  const [isTalking, setIsTalking] = useState(false);
  // 🎤 L'hôte peut « donner la parole » à distance ; si le micro n'a jamais été autorisé (getUserMedia
  //    refusé sans geste), on affiche une invite : un simple tap suffit ensuite pour activer.
  const [coachMicInvite, setCoachMicInvite] = useState(false);
  const participantMic = useMicrophone({
    // 🎚️ AEC/AGC/NS OFF : sinon la musique du participant chute quand il prend la parole (ducking Chrome).
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    initialVolume: 150, // 🔊 makeup par défaut → participant audible même sans toucher au curseur
  });

  // Quand le micro participant est prêt et qu'il a pris la parole → envoyer à l'hôte
  useEffect(() => {
    if (isHost || !isTalking) return;
    // 🔊 diffuser le flux GAINÉ (broadcastStream) si dispo, sinon le flux brut (fallback).
    const outStream = participantMic.broadcastStream || participantMic.audioStream;
    if (participantMic.state.isCapturing && outStream) {
      talkToHost(outStream);
    }
  }, [isHost, isTalking, participantMic.state.isCapturing, participantMic.audioStream, participantMic.broadcastStream, talkToHost]);

  const handleToggleTalk = useCallback(async () => {
    if (isTalking) {
      stopTalkToHost();
      participantMic.stopCapture();
      setIsTalking(false);
      showToast('Vous avez rendu la parole', 'default');
      resumeMixerContextSoon(); // 🎵 réveille son contexte musique local (la synchro hôte gère play/pause)
    } else {
      const ok = await participantMic.startCapture();
      if (ok) {
        setIsTalking(true);
        showToast('Vous avez la parole', 'success');
      }
    }
  }, [isTalking, participantMic, stopTalkToHost, showToast, resumeMixerContextSoon]);

  // 🎤 L'HÔTE donne/coupe la parole à distance à CE participant. Réutilise EXACTEMENT le flux
  //    « prendre la parole » (startCapture → isTalking → effet talkToHost). Additif, rien d'existant modifié.
  const applyHostMic = useCallback(async (on: boolean) => {
    if (on) {
      if (isTalking) { setCoachMicInvite(false); return; }   // déjà en parole → rien à faire
      const ok = await participantMic.startCapture();         // OK direct si permission déjà accordée
      if (ok) {
        setIsTalking(true);
        setCoachMicInvite(false);
        showToast('🎤 Le coach t\'a donné la parole', 'success');
      } else {
        // Permission non accordée / geste requis → on ne peut pas forcer : invite au tap.
        setCoachMicInvite(true);
        showToast('🎤 Le coach t\'invite à parler — appuie pour activer ton micro', 'default');
      }
    } else {
      setCoachMicInvite(false);
      if (isTalking) {
        stopTalkToHost();
        participantMic.stopCapture();
        setIsTalking(false);
        showToast('Le coach a coupé ton micro', 'default');
        resumeMixerContextSoon(); // 🎵 réveille son contexte musique local (la synchro hôte relance le PLAY)
      }
    }
  }, [isTalking, participantMic, stopTalkToHost, showToast, resumeMixerContextSoon]);
  const applyHostMicRef = useRef(applyHostMic);
  useEffect(() => { applyHostMicRef.current = applyHostMic; }, [applyHostMic]);

  // 🎥 MODE LIVE / VISIO (Zoom-like) — module ISOLÉ (son propre Peer + canal de signaling).
  // N'altère rien de l'audio/mixeur/synchro existants : purement additif.
  const MAX_VISIO_CAMERAS = 10; // 🎥 scène LiveKit : 10 publishers max
  const [liveMode, setLiveMode] = useState(false);
  // 📱 MOBILE UNIQUEMENT : 4 onglets. Le contenu est MASQUÉ/AFFICHÉ en CSS (jamais démonté) ;
  //    le desktop (≥1024px) n'est PAS affecté (la règle CSS est sous @media max-width:1023px).
  // 📱 Mobile : 2 onglets seulement (moins de scroll). « player » = Lecteur & Playlist (contenu
  //    principal + Live), « controls » = Mixeur & Participants (contrôles). Mount-always + hide-CSS.
  const [mobileTab, setMobileTab] = useState<'player' | 'controls'>('player');
  const [screenSharing, setScreenSharing] = useState(false); // 🖥️ l'hôte/co-hôte partage son écran
  const [remoteScreenActive, setRemoteScreenActive] = useState(false); // un AUTRE partage son écran
  // 🎥 LiveKit (SFU) — remplace le mesh PeerJS pour les caméras/écran. Interface identique à useVideoMesh.
  const videoMesh = useLiveKitStage({
    sessionId: sessionId || '',
    userId: socket.userId,
    name: nickname || undefined,
    // la room doit être active pour le Live Visio, le partage d'écran émis OU reçu
    active: (liveMode || screenSharing || remoteScreenActive) && !!sessionId,
    canPublish: canShare, // hôte/co-hôtes publient ; les autres sont viewers (promus par l'hôte si acceptés)
    maxCameras: MAX_VISIO_CAMERAS,
    onLimit: () => showToast(`Limite de ${MAX_VISIO_CAMERAS} caméras atteinte`, 'warning'),
    onStageFull: () => showToast('Scène pleine (10 max)', 'warning'),
  });
  const handleToggleCamera = useCallback(async () => {
    if (videoMesh.cameraOn) {
      videoMesh.stopCamera();
    } else {
      // 🐛 BUG 1 : allumer la caméra depuis le plein écran de la vidéo partagée (hors Live Visio) doit
      //    ACTIVER la room LiveKit (sinon startCamera reste en attente et rien ne se publie). Additif :
      //    en Live Visio liveMode est déjà true (no-op) ; la vidéo partagée reste affichée.
      if (!liveMode && sessionId) setLiveMode(true);
      const ok = await videoMesh.startCamera();
      if (!ok && videoMesh.activeCameraCount < MAX_VISIO_CAMERAS) {
        showToast('Impossible d\'accéder à la caméra (autorisez l\'accès)', 'error');
      }
    }
  }, [videoMesh, showToast, liveMode, sessionId]);

  // 🖥️ PARTAGE ÉCRAN (desktop) — capture getDisplayMedia puis diffusion mesh à tous
  const screenSupported = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia;
  const broadcastScreenState = useCallback((active: boolean) => {
    if (sessionId && supabase && isSupabaseConfigured) {
      supabase.channel(`playback:${sessionId}`).send({ type: 'broadcast', event: 'SCREEN_SHARE_STATE', payload: { active } });
    }
  }, [sessionId]);
  const handleToggleScreenShare = useCallback(async () => {
    if (screenSharing) {
      videoMesh.stopScreen();
      setScreenSharing(false);
      broadcastScreenState(false);
      return;
    }
    if (!screenSupported) { showToast('Partage d\'écran disponible sur ordinateur uniquement', 'warning'); return; }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      setScreenSharing(true);          // active le Peer visio
      videoMesh.startScreen(stream);   // diffuse le flux écran
      broadcastScreenState(true);      // prévient les participants → ils activent leur Peer pour recevoir
      // l'arrêt natif du navigateur ("Arrêter le partage") coupe la piste → on stoppe proprement
      const onEnded = () => { videoMesh.stopScreen(); setScreenSharing(false); broadcastScreenState(false); };
      stream.getVideoTracks().forEach((tr) => tr.addEventListener('ended', onEnded, { once: true }));
      showToast('Partage d\'écran démarré', 'success');
    } catch {
      // l'utilisateur a annulé le sélecteur, ou refus → rien
    }
  }, [screenSharing, screenSupported, videoMesh, showToast, broadcastScreenState]);
  // Heartbeat de l'état partage écran (late-join : un participant qui arrive active son Peer)
  useEffect(() => {
    if (!screenSharing || !sessionId || !supabase || !isSupabaseConfigured) return;
    const t = setInterval(() => broadcastScreenState(true), 4000);
    return () => clearInterval(t);
  }, [screenSharing, sessionId, broadcastScreenState]);
  // 🎤 Poignée du micro HÔTE (MicrophoneControl) → permet de (dé)activer le micro depuis la barre plein
  //    écran du Live Visio (BUG 5), via le MÊME chemin que le bouton principal.
  const hostMicCtrlRef = useRef<MicrophoneControlHandle | null>(null);
  const handleLiveMicToggle = useCallback(() => {
    if (isHost) { hostMicCtrlRef.current?.toggle(); return; } // 🐛 BUG 5 : le micro hôte s'active/coupe même en plein écran
    handleToggleTalk();
  }, [isHost, handleToggleTalk]);

  // 🎤 SCÈNE (Live Visio) — système de prise de parole : un spectateur demande à monter en vidéo,
  // l'hôte/co-hôte valide. Réutilise le maillage caméra (useVideoMesh) + le Realtime (playback:<id>).
  // 🔍 Spotlight Live Visio remonté au niveau page (UI pure) → persiste quel que soit l'emplacement
  //    du panneau (fenêtre flottante mobile / colonne desktop / fenêtre plein écran) et survit aux re-rendus.
  const [visioSpotlightId, setVisioSpotlightId] = useState<string | null>(null);
  // 💳 Paywall « crédits insuffisants » (remplace la redirection brutale vers /pricing).
  const [creditsBlocked, setCreditsBlocked] = useState<null | 'join' | 'host' | 'record'>(null);
  // 🎟️ Billetterie : infos d'accès de la session + état du billet du participant.
  const [accessInfo, setAccessInfo] = useState<SessionAccessInfo | null>(null);
  const [hasTicket, setHasTicket] = useState<boolean | null>(null);   // null = inconnu ; gating après vérif
  const [ticketBusy, setTicketBusy] = useState(false);
  // 📱 Mobile Money (PawaPay) — ADDITIF : config publique + pays choisi. Masqué si non configuré.
  const [ppConfig, setPpConfig] = useState<PawapayConfig | null>(null);
  const [ppCountry, setPpCountry] = useState<string>('');
  const [showMobileMoney, setShowMobileMoney] = useState(false);
  // 📱 Payer AVANT inscription : email saisi si non connecté + écran « paiement reçu, crée ton compte ».
  const [ppEmail, setPpEmail] = useState('');
  const [paidAwaitingSignup, setPaidAwaitingSignup] = useState(false);
  const ppReturnHandledRef = useRef(false);
  // Réglages billetterie pour le configurateur hôte (garde-fous de prix).
  const [billConfig, setBillConfig] = useState<{ price_min_chf: number; price_max_chf: number } | null>(null);
  const [savingMode, setSavingMode] = useState(false);
  const [modeDraft, setModeDraft] = useState<{ mode: 'open' | 'paid' | 'private'; price: string; capacity: string }>({ mode: 'open', price: '', capacity: '' });
  const [showSessionSettings, setShowSessionSettings] = useState(false);
  const [showPromoEditor, setShowPromoEditor] = useState(false); // 📣 éditeur de la page promo
  // 🚪 Mode d'accès : 'account' (avec nom → chat + visio) ou 'guest' (sans inscription → écoute/lecture seule).
  const [accessMode, setAccessMode] = useState<AccessMode>('account');
  // 🚪 Le type d'accès (guest/account) est-il RÉSOLU depuis la DB ? Le gating paywall doit l'attendre
  //    (sinon course : accessInfo backend arrive avant, accessMode vaut 'account' par défaut → faux paywall).
  const [accessModeResolved, setAccessModeResolved] = useState<boolean>(() => !isSupabaseConfigured);
  const [savingAccessMode, setSavingAccessMode] = useState(false);
  const handleAccessMode = useCallback(async (mode: AccessMode) => {
    setAccessMode(mode);
    if (!sessionId) return;
    setSavingAccessMode(true);
    const ok = await saveAccessMode(sessionId, mode, user?.id); // ⚠️ vérifier le retour (échec silencieux avant)
    setSavingAccessMode(false);
    if (ok) showToast(mode === 'guest' ? 'Accès sans inscription activé' : 'Accès avec inscription activé', 'success');
    else showToast('Échec d\'enregistrement du mode d\'accès — réessaie', 'error');
  }, [sessionId, user?.id, showToast]);
  // Invité = mode guest ET pas l'hôte → pas de chat ni de visio (écoute/lecture seule).
  const isGuestRestricted = accessMode === 'guest' && !isHost;
  // 🚪 Sécurité : un invité ne doit jamais être en Live Visio (coupe la visio si le mode passe en 'guest').
  useEffect(() => { if (isGuestRestricted) setLiveMode(false); }, [isGuestRestricted]);

  // 🙋 Demandes d'accès gratuit (session payante) — l'HÔTE est notifié en TEMPS RÉEL (Supabase realtime).
  const [promoAccessReqs, setPromoAccessReqs] = useState<Array<{ id: number; requester_name: string }>>([]);
  useEffect(() => {
    if (!isHost || !sessionId || !supabase || !isSupabaseConfigured) return;
    const refresh = () => listAccessRequests(sessionId).then(({ requests }) =>
      setPromoAccessReqs(requests.filter((r) => r.status === 'pending').map((r) => ({ id: r.id, requester_name: r.requester_name }))));
    refresh();
    const ch = supabase.channel(`access-req:${sessionId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'access_requests', filter: `session_id=eq.${sessionId}` }, refresh)
      .subscribe();
    return () => { try { supabase!.removeChannel(ch); } catch { /* ignore */ } };
  }, [isHost, sessionId]);
  const handleAccessDecision = useCallback(async (id: number, approve: boolean) => {
    setPromoAccessReqs((prev) => prev.filter((r) => r.id !== id));
    await decideAccessRequest(id, approve);
    showToast(approve ? 'Accès accordé (sans paiement)' : 'Demande refusée', approve ? 'success' : 'default');
  }, [showToast]);
  // Type de paiement du coach hôte ('subscription' par défaut → mode Payante masqué).
  const [coachPaymentType, setCoachPaymentType] = useState<'subscription' | 'commission'>('subscription');
  const [stageRequests, setStageRequests] = useState<StageRequest[]>([]); // hôte : demandes en attente
  const [stageRequestPending, setStageRequestPending] = useState(false);  // spectateur : ma demande envoyée
  // 🙋 Panneau des demandes de scène (plein écran) : ouvert par défaut ; le bouton « Demandes » le
  //    masque/affiche → l'hôte peut le pousser pour voir la vidéo. Réouvert automatiquement à chaque
  //    nouvelle demande. Aucune incidence sur la vue normale (le panneau y reste toujours affiché).
  const [stagePanelOpen, setStagePanelOpen] = useState(true);
  useEffect(() => { if (stageRequests.length > 0) setStagePanelOpen(true); }, [stageRequests.length]);
  // Refs pour piloter la caméra depuis les handlers Realtime (souscrits une seule fois)
  const startCameraRef = useRef(videoMesh.startCamera);
  const stopCameraRef = useRef(videoMesh.stopCamera);
  useEffect(() => { startCameraRef.current = videoMesh.startCamera; stopCameraRef.current = videoMesh.stopCamera; }, [videoMesh.startCamera, videoMesh.stopCamera]);
  const canManageStageRef = useRef(false);
  canManageStageRef.current = canShare; // hôte + co-hôtes gèrent les demandes
  // Quitter le mode Live → réinitialiser ma demande en attente (évite un état "envoyée" fantôme)
  useEffect(() => { if (!liveMode) { setStageRequestPending(false); setVisioSpotlightId(null); } }, [liveMode]);

  // 🖥️ Desktop ≥ 1024px → Live Visio dans la colonne de droite ; mobile → onglet "Live"
  const isDesktop = useMediaQuery('(min-width: 1024px)');

  // 📱 Mobile : la Live Visio se démarre désormais depuis le bouton « Démarrer la Live Visio »
  //    (onglet « Lecteur ») ou l'interrupteur de mode. On n'éteint JAMAIS liveMode au changement
  //    d'onglet → la connexion LiveKit reste montée (mount-always + hide-CSS).

  // 🔴 POINT 3 — Bandeau de consentement « enregistrement » diffusé à tous (realtime).
  //    UN SEUL enregistrement : l'option complète (toutes voix + musique) + transcription IA (premiumRec).
  const [recordingActive, setRecordingActive] = useState(false); // état "vu par tous" (bandeau)
  const broadcastRecording = useCallback((active: boolean) => {
    setRecordingActive(active);
    if (sessionId && supabase && isSupabaseConfigured) {
      supabase.channel(`playback:${sessionId}`).send({ type: 'broadcast', event: 'RECORDING_STATE', payload: { active } });
    }
  }, [sessionId]);

  // 🔴 OPTION PREMIUM : enregistrement COMPLET (toutes voix + visio + musique) + transcription IA.
  const [recCost, setRecCost] = useState(4);
  const [premiumRecActive, setPremiumRecActive] = useState(false);
  const [recProcessing, setRecProcessing] = useState(false);
  const [recResult, setRecResult] = useState<{ id?: number; transcript?: string; summary?: string } | null>(null);
  const [recConsentAck, setRecConsentAck] = useState(false);
  const sessionIdRef = useRef<string | null>(null);
  sessionIdRef.current = sessionId;
  useEffect(() => { getCreditsConfig().then(({ data }) => { if (data?.cost_record_transcribe != null) setRecCost(data.cost_record_transcribe); }); }, []);

  // Recorder premium : micro hôte (best-effort) + voix tribu (WebRTC) + musique. Tout est CLONÉ par le hook
  // → on ne touche JAMAIS les pistes du live. (La visio LiveKit ne transporte que la VIDÉO : aucun audio à
  //  capter là, donc on ne s'y connecte pas du tout — la visio reste totalement intacte.)
  const premiumRec = useSessionRecorder({
    getLocalStream: () => hostMicStream,
    getRemoteStreams: () => Array.from(document.querySelectorAll<HTMLAudioElement>('.bt-tribe-audio'))
      .map((el) => el.srcObject as MediaStream | null)
      .filter((s): s is MediaStream => !!s),
    // 🎵 Musique : flux post-gain du mixeur (son RÉEL). element.captureStream() est MUET car l'élément
    //    est routé via createMediaElementSource → c'était la cause de l'enregistrement silencieux.
    getMusicStream: () => getMusicStream(),
    download: false,
    onComplete: (blob, ext, meta) => {
      const sid = sessionIdRef.current;
      if (!sid) return;
      // 🚫 Aucun son capté → on n'upload PAS (évite une transcription Whisper hallucinée sur du silence).
      if (meta.silent) {
        setRecProcessing(false);
        setRecResult({ transcript: '', summary: '⚠️ Aucun audio capté pendant l\'enregistrement (niveau sonore nul). Vérifiez que votre micro est activé et que la musique joue, puis réessayez.' });
        showToast('Aucun audio capté — rien à transcrire', 'error');
        return;
      }
      setRecProcessing(true);
      uploadRecording(sid, blob, ext).then((r) => {
        setRecProcessing(false);
        if (r.ok) { setRecResult({ id: r.id, transcript: r.transcript, summary: r.summary }); refreshCredits(); showToast('Transcription IA prête ✅', 'success'); }
        else { showToast(r.error || 'Transcription échouée', 'error'); }
      });
    },
  });

  const handleStartPremiumRec = useCallback(async () => {
    if (!sessionId) return;
    const { ok, cost, insufficient, error } = await startRecording(sessionId);
    if (!ok) {
      // Crédits insuffisants → paywall avec lien « Acheter des crédits » (admin/coach illimité ne passent jamais ici).
      if (insufficient || /insuffisant/i.test(error || '')) { setCreditsBlocked('record'); return; }
      showToast(error || 'Activation impossible', 'error');
      return;
    }
    if (!premiumRec.start()) { showToast('Enregistrement non supporté par ce navigateur', 'error'); return; }
    setPremiumRecActive(true);
    setRecResult(null);
    broadcastRecording(true);   // avis "enregistrement" diffusé à tous (consentement)
    showToast(cost ? `🔴 Enregistrement complet + IA (${cost} crédits)` : '🔴 Enregistrement complet + IA activé', 'success');
  }, [sessionId, premiumRec, broadcastRecording, showToast]);

  const handleStopPremiumRec = useCallback(() => {
    premiumRec.stop();           // déclenche onComplete → upload + transcription
    setPremiumRecActive(false);
    broadcastRecording(false);
    if (sessionId) stopRecording(sessionId);
    showToast('Enregistrement arrêté — transcription en cours…', 'success');
  }, [premiumRec, broadcastRecording, sessionId, showToast]);

  // Heartbeat du bandeau d'enregistrement (late-join : un participant qui arrive voit l'avis de consentement).
  useEffect(() => {
    if (!isHost || !premiumRecActive || !sessionId || !supabase || !isSupabaseConfigured) return;
    const t = setInterval(() => {
      supabase!.channel(`playback:${sessionId}`).send({ type: 'broadcast', event: 'RECORDING_STATE', payload: { active: true } });
    }, 5000);
    return () => clearInterval(t);
  }, [isHost, premiumRecActive, sessionId]);

  // 🔊 « M'entendre » (#6) : monitoring local de la voix de l'hôte (anti-larsen, on/off).
  const [selfMonitorOn, setSelfMonitorOn] = useState(false);
  const handleToggleSelfMonitor = useCallback(() => {
    const next = !selfMonitorOn;
    setSelfMonitorOn(next);
    setSelfMonitor(next);
    showToast(next ? '🎧 Monitoring activé — vous vous entendez (attention au larsen)' : 'Monitoring désactivé', 'default');
  }, [selfMonitorOn, setSelfMonitor, showToast]);

  // Auto-play effect: when a new track is set via autoplay, force play
  useEffect(() => {
    if (autoPlayPending && selectedTrack && selectedTrack.src === autoPlayPending) {
      const timer = setTimeout(() => {
        const audioEl = getMusicEl();
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

  // 💳 ACCÈS « Ouverte (crédits) » : le contenu (playlist/lecteur/live) est BLOQUÉ tant que le
  //    participant n'a pas payé son crédit. Le débit est idempotent par session (déjà payé = OK,
  //    pas de re-débit). Exceptions : hôte / admin / coach illimité / privée / payante (billet).
  //    L'enforcement réel est côté BACKEND (RLS sur playlists) ; ici on gère l'UX (paywall + reload).
  const [playlistReloadKey, setPlaylistReloadKey] = useState(0);
  const joinDebitedRef = useRef<string | null>(null);
  useEffect(() => {
    if (isHost || isAdminUser) return;
    if (!sessionId) return;
    if (!accessInfo) return;                          // attendre le mode d'accès (open/paid/private)
    if (accessInfo.mode !== 'open') return;           // seul « open » est gaté ici (privée/payante ailleurs)
    if (!accessModeResolved) return;                  // 🚪 attendre le type (guest/account) → pas de faux paywall
    // 🚪 PARTIE 4 — Mode « sans inscription » (guest) = accès LIBRE : l'hôte a choisi l'entrée directe
    //    par pseudo → aucun crédit requis, même pour un participant anonyme (pas de paywall).
    if (accessMode === 'guest') { setCreditsBlocked(null); return; }
    // Mode « Ouverte (crédits) » : 1 crédit requis pour accéder au contenu.
    if (!user?.id) {                                  // anonyme → doit se connecter + se procurer un crédit
      setCreditsBlocked('join');                      // paywall À LA PLACE du contenu
      return;
    }
    if (!nickname) return;                            // attendre le pseudo
    if (joinDebitedRef.current === sessionId) return;
    joinDebitedRef.current = sessionId;
    (async () => {
      const res = await spendCredit('join', sessionId);
      if (res.insufficient) {
        joinDebitedRef.current = null;                // permet une nouvelle tentative après achat
        setCreditsBlocked('join');                    // paywall À LA PLACE du contenu
      } else if (res.ok) {
        setCreditsBlocked(null);
        refreshCredits();
        setPlaylistReloadKey((k) => k + 1);           // recharge la playlist désormais accessible (RLS)
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, user?.id, nickname, isHost, isAdminUser, accessInfo, accessMode, accessModeResolved]);

  // 🎟️ Infos d'accès de la session (mode/prix/capacité) — publiques, pour tous.
  const refreshAccess = useCallback(async () => {
    if (!sessionId) return;
    const { data } = await getSessionAccessInfo(sessionId);
    if (data) setAccessInfo(data);
  }, [sessionId]);
  useEffect(() => { refreshAccess(); }, [refreshAccess]);

  // 🎟️ Session payante : le participant non-hôte a besoin d'un billet valide pour accéder au live.
  useEffect(() => {
    if (isHost || isAdminUser) { setHasTicket(true); return; }
    if (!accessInfo) return;
    if (accessInfo.mode !== 'paid') { setHasTicket(true); return; }
    if (!sessionId) { setHasTicket(false); return; }
    // 🎫 Demande d'accès approuvée (?ar=) → un participant ANONYME approuvé entre sans compte.
    const arId = getApprovedRequestId(sessionId);
    if (!user?.id && !arId) { setHasTicket(false); return; }   // anonyme sans approbation → se connecter + acheter
    (async () => {
      const { has_ticket } = await checkTicket(sessionId, arId);
      setHasTicket(has_ticket);
    })();
  }, [accessInfo, isHost, isAdminUser, user?.id, sessionId]);

  // 🎟️ Retour de paiement (?ticket=success Stripe OU ?ticket=pp Mobile Money PawaPay) → re-vérifie le
  //    billet (le callback peut avoir un léger délai). Même re-poll pour les deux moyens de paiement.
  useEffect(() => {
    if (!sessionId || ppReturnHandledRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const t = params.get('ticket');
    let claimFlag = false;
    try { claimFlag = localStorage.getItem('bt_pp_claim') === '1'; } catch { /* ignore */ }
    if (t !== 'success' && t !== 'pp' && !claimFlag) return;

    // 📱 Retour mobile money SANS être connecté → écran « paiement reçu, crée ton compte » (email prérempli).
    if (t === 'pp' && !user?.id) {
      let em = ''; try { em = localStorage.getItem('bt_pp_pending_email') || ''; } catch { /* ignore */ }
      setPpEmail(em);
      setPaidAwaitingSignup(true);
      return;
    }
    if (!user?.id) return;  // besoin d'être connecté pour rattacher/vérifier

    ppReturnHandledRef.current = true;
    showToast('Paiement reçu — accès en cours d\'activation…', 'success');
    let tries = 0;
    const tick = async () => {
      tries += 1;
      const { has_ticket } = await checkTicket(sessionId);
      if (has_ticket) {
        setHasTicket(true); refreshAccess();
        try { localStorage.removeItem('bt_pp_claim'); localStorage.removeItem('bt_pp_pending_email'); } catch { /* ignore */ }
        return;
      }
      if (tries < 8) setTimeout(tick, 1500);  // mobile money : léger délai callback → on laisse plus d'essais
    };
    // Rattache d'abord un éventuel billet payé AVANT inscription (mobile money uniquement), puis vérifie l'accès.
    const needClaim = t === 'pp' || claimFlag;
    (async () => { if (needClaim) { try { await claimPendingAccess(); } catch { /* ignore */ } } tick(); })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, user?.id]);

  // 📱 Charge la config publique Mobile Money (PawaPay) quand la session est payante (masquée si absente).
  useEffect(() => {
    if (!accessInfo || accessInfo.mode !== 'paid') return;
    getPawapayConfig().then(({ data }) => {
      if (data?.configured) {
        setPpConfig(data);
        setPpCountry((prev) => prev || data.countries[0]?.code || '');
      }
    });
  }, [accessInfo]);

  // 🎟️ Achat d'une place → redirection Stripe Checkout (carte) OU PawaPay (mobile money, connecté OU non).
  const handleBuyTicket = useCallback(async (provider: 'stripe' | 'pawapay' = 'stripe') => {
    if (!sessionId) return;
    const anon = provider === 'pawapay' && !user?.id;
    const email = anon ? ppEmail.trim().toLowerCase() : undefined;
    if (provider === 'pawapay') {
      if (!ppCountry) { showToast('Choisis ton pays', 'warning'); return; }
      if (anon && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email || '')) { showToast('Entre un email valide', 'warning'); return; }
    }
    setTicketBusy(true);
    try {
      // Paiement AVANT inscription : on mémorise l'email pour préremplir l'inscription au retour.
      if (anon && email) { try { localStorage.setItem('bt_pp_pending_email', email); localStorage.setItem('bt_pp_claim', '1'); } catch { /* ignore */ } }
      const { url, already, error } = await buyTicket(sessionId, { provider, country: ppCountry, email });
      if (already) { setHasTicket(true); showToast('Tu as déjà ta place 🎟️', 'success'); return; }
      if (url) { window.location.href = url; return; }
      showToast(error || 'Achat impossible', 'error');
    } finally {
      setTicketBusy(false);
    }
  }, [sessionId, showToast, ppCountry, ppEmail, user?.id]);

  // 💱 Aperçu du montant converti (≈) pour le pays choisi, à partir des taux publics PawaPay.
  const ppTicketApprox = useMemo(() => {
    if (!ppConfig || !accessInfo?.price_chf) return null;
    const cur = ppConfig.countries.find((c) => c.code === ppCountry)?.currency;
    const rate = cur ? ppConfig.fx_rates[cur] : undefined;
    if (!cur || !rate) return null;
    const zeroDec = cur === 'XOF' || cur === 'XAF';
    const val = Number(accessInfo.price_chf) * rate;
    return `≈ ${zeroDec ? Math.round(val).toLocaleString('fr-FR') : val.toFixed(2)} ${cur}`;
  }, [ppConfig, ppCountry, accessInfo]);

  // 🎟️ Hôte : configurateur du mode d'accès (charge garde-fous + pré-remplit depuis l'état actuel).
  useEffect(() => {
    if (!isHost) return;
    getBilletterieConfig().then(({ data }) => {
      if (data) setBillConfig({ price_min_chf: data.price_min_chf, price_max_chf: data.price_max_chf });
    });
    // 💳 Type de paiement du coach : en « abonnement », pas de mode Payante (il encaisse hors plateforme).
    // ♾️ + statut illimité AUTORITAIRE (data.unlimited = is_coach_unlimited backend) → filet anti « limite essai ».
    getCoachPlan().then(({ data }) => {
      if (data) {
        setCoachPaymentType(data.payment_type);
        if (data.unlimited) setBackendUnlimited(true);
      }
    });
  }, [isHost]);
  const modeInitRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isHost || !accessInfo || !sessionId) return;
    if (modeInitRef.current === sessionId) return;  // n'écrase pas les éditions en cours de l'hôte
    modeInitRef.current = sessionId;
    setModeDraft({
      mode: accessInfo.mode,
      price: accessInfo.price_chf != null ? String(accessInfo.price_chf) : '',
      capacity: accessInfo.capacity != null ? String(accessInfo.capacity) : '',
    });
  }, [isHost, accessInfo, sessionId]);

  const handleSaveMode = useCallback(async () => {
    if (!sessionId) return;
    setSavingMode(true);
    try {
      const { ok, error } = await configureSession({
        session_id: sessionId,
        mode: modeDraft.mode,
        price_chf: modeDraft.mode === 'paid' ? Number(modeDraft.price) : null,
        capacity: modeDraft.mode === 'paid' && modeDraft.capacity ? Number(modeDraft.capacity) : null,
      });
      // 🚪 Persister AUSSI le type d'accès (guest/account) sur le MÊME bouton « Enregistrer »
      //    (avant : commité seulement au clic de carte, échec silencieux possible). Contrôle du retour.
      const accessOk = await saveAccessMode(sessionId, accessMode, user?.id);
      if (ok && accessOk) {
        showToast('Mode d\'accès enregistré', 'success');
        setShowSessionSettings(false);
        await refreshAccess();
      } else {
        showToast(error || (!accessOk ? 'Échec d\'enregistrement du type d\'accès (colonne DB ?)' : 'Échec'), 'error');
      }
    } finally {
      setSavingMode(false);
    }
  }, [sessionId, modeDraft, accessMode, user?.id, refreshAccess, showToast]);

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
      // La LISTE des pistes est toujours mise à jour ; la SÉLECTION/lecture est pilotée par la source
      // unique (HOST_COMMAND supabase) → en mode supabase on NE force PAS selectedTrack ici (2e transport
      // = va-et-vient) et on ne spamme plus le toast « Piste suivante ».
      const safeTracks = Array.isArray(payload.tracks) ? payload.tracks : [];
      setTracks(safeTracks as Track[]);
      if (safeTracks.length === 0) { setSelectedTrack(null); loadedTrackIdRef.current = null; return; }
      if (socket.isSupabaseMode) return; // HOST_COMMAND est l'autorité
      applyRemoteState({ trackId: payload.selectedTrackId as number, reason: 'playlistSync', source: 'socket' });
    });

    return unsubPlaylist;
  }, [socket, isHost, applyRemoteState]);

  // Listen for playback sync (for participants to auto-play new tracks) — inactif en mode supabase
  useEffect(() => {
    if (isHost) return;

    const unsubPlayback = socket.onPlaybackSync((payload) => {
      if (socket.isSupabaseMode) return; // source unique = HOST_COMMAND (évite le 2e transport concurrent)
      applyRemoteState({ trackId: payload.trackId as number, currentTime: payload.currentTime, isPlaying: payload.isPlaying, reason: 'playbackSync', source: 'socket' });
    });

    return unsubPlayback;
  }, [socket, isHost, applyRemoteState]);

  // 🩹 BUG 1 : refs vers les valeurs changeantes lues DANS l'effet realtime ci-dessous.
  // Elles permettent de ne dépendre QUE de [sessionId] → l'effet (fetch initial + abonnements)
  // s'exécute UNE SEULE FOIS au montage et ne se relance plus quand tracks/selectedTrack changent
  // (sinon : chaque setTracks/setSelectedTrack relançait le fetch → tempête de requêtes playlists).
  const isHostRef = useRef(isHost);
  useEffect(() => { isHostRef.current = isHost; }, [isHost]);
  const myUserIdRef = useRef(socket.userId);
  useEffect(() => { myUserIdRef.current = socket.userId; }, [socket.userId]);
  const selectedTrackRef = useRef(selectedTrack);
  useEffect(() => { selectedTrackRef.current = selectedTrack; }, [selectedTrack]);
  const showToastRef = useRef(showToast);
  useEffect(() => { showToastRef.current = showToast; }, [showToast]);
  const navigateRef = useRef(navigate);
  useEffect(() => { navigateRef.current = navigate; }, [navigate]);

  // 🔍 Vidéo partagée en vue agrandie (plein écran) → le chat est rendu À L'INTÉRIEUR du plein écran
  //    (sinon invisible en plein écran natif). Piloté par SharedMediaPlayer.onEnlargedChange.
  const [videoEnlarged, setVideoEnlarged] = useState(false);
  // 🐛 BUG 3 : cible de portail = élément plein écran courant (ou body). Permet d'afficher le chat
  //    PAR-DESSUS le plein écran Live Visio (comme le minuteur), sinon invisible (API Fullscreen).
  const fsChatPortalTarget = useFullscreenPortalTarget();
  // 💬 CHAT de session (Pro) — état éphémère (realtime uniquement, pas de DB en v1).
  const [chatOpen, setChatOpen] = useState(false);
  const [chatTab, setChatTab] = useState<'assistant' | 'group' | 'private'>('assistant');
  const [chatPartner, setChatPartner] = useState<string | null>(null); // conversation privée ouverte
  const [groupMessages, setGroupMessages] = useState<ChatMessage[]>([]);
  const [privateThreads, setPrivateThreads] = useState<Record<string, ChatMessage[]>>({});
  const [chatUnread, setChatUnread] = useState<Record<string, number>>({}); // clé 'group' | partnerId
  // Refs lues par les handlers Realtime (souscrits une seule fois) pour décider de l'incrément "non lu".
  const isProRef = useRef(isPro);
  useEffect(() => { isProRef.current = isPro; }, [isPro]);
  const chatOpenRef = useRef(chatOpen);
  useEffect(() => { chatOpenRef.current = chatOpen; }, [chatOpen]);
  const chatViewRef = useRef<string>(''); // conversation actuellement visible : '' | 'group' | partnerId | '__list__'
  useEffect(() => {
    chatViewRef.current = !chatOpen
      ? ''
      : (chatTab === 'group' ? 'group' : chatTab === 'private' ? (chatPartner || '__list__') : '__assistant__');
  }, [chatOpen, chatTab, chatPartner]);

  // 🔄 SUPABASE REALTIME: Sync playlist changes for participants
  useEffect(() => {
    if (!sessionId || !supabase || !isSupabaseConfigured) return;
    
    // ⚡ OPTIMISATION SRE: Exécuter fetch initial ET connexion Realtime EN PARALLÈLE
    
    // 📡 FETCH (initial + re-exécuté à l'abonnement Realtime → playlist/vidéo visibles SANS refresh)
    const doFetch = async () => {
      if (!supabase) return;

      try {
        const { data, error } = await supabase
          .from('playlists')
          .select('tracks, description, shared_media, host_id')
          .eq('session_id', sessionId)
          .maybeSingle();

        if (error) return;

        // 🔒 host_id est désormais DÉTERMINÉ (présent OU absent → session non revendiquée).
        // On mémorise sa valeur (null si absent) et on marque la résolution : le créateur légitime
        // pourra alors revendiquer une session dont host_id serait resté NULL (répare le blocage coach).
        {
          const fetchedHostId = (data as { host_id?: string } | null)?.host_id;
          setSessionHostId(typeof fetchedHostId === 'string' && fetchedHostId ? fetchedHostId : null);
          setHostResolved(true);
        }

        // C : charger la description ; E : média partagé courant ; 🔒 host_id (propriétaire)
        if (data) {
          if (typeof data.description === 'string') setDescription(data.description);
          if (data.shared_media) {
            const sm = data.shared_media as SharedMedia;
            setSharedMedia(sm);
            // Item 1 : late-join — se positionner immédiatement à l'état stocké (corrigé ensuite par heartbeat)
            mediaSeqRef.current += 1;
            setRemoteMediaState({ isPlaying: !!sm.isPlaying, currentTime: sm.currentTime || 0, seq: mediaSeqRef.current });
          }
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

        // 🚪 confidentialité (salle d'attente) — requête séparée TOLÉRANTE (colonne is_private optionnelle).
        // Si la colonne n'existe pas encore → public par défaut, sans casser le reste du fetch.
        try {
          const { data: pd, error: perr } = await supabase
            .from('playlists')
            .select('is_private')
            .eq('session_id', sessionId)
            .maybeSingle();
          if (!perr) setIsPrivate(!!(pd as { is_private?: boolean } | null)?.is_private);
        } catch { /* colonne is_private pas encore créée → public */ }
        setPrivacyChecked(true);

        // 🚪 Mode d'accès (guest/account) — requête séparée TOLÉRANTE (colonne access_mode optionnelle).
        //    ROBUSTE AUX DOUBLONS : on liste les lignes (jamais maybeSingle qui ERRE sur >1 ligne → défaut
        //    account) et on prend la PLUS RÉCENTE avec un access_mode valide. On marque toujours la résolution.
        try {
          const { data: adRows, error: aerr } = await supabase
            .from('playlists')
            .select('access_mode, updated_at')
            .eq('session_id', sessionId)
            .order('updated_at', { ascending: false }); // la plus récente en tête
          if (!aerr && Array.isArray(adRows)) {
            const rows = adRows as Array<{ access_mode?: string }>;
            const pick = rows.find((r) => r.access_mode === 'guest' || r.access_mode === 'account');
            if (pick?.access_mode === 'guest' || pick?.access_mode === 'account') setAccessMode(pick.access_mode);
          }
        } catch { /* colonne access_mode pas encore créée → défaut 'account' */ }
        setAccessModeResolved(true);

        if (data && data.tracks && Array.isArray(data.tracks) && data.tracks.length > 0) {
          setTracks(data.tracks as Track[]);
          setIsSyncActive(true);

          if (!selectedTrackRef.current) {
            setSelectedTrack(data.tracks[0] as Track);
          }
        } else {
          setIsSyncActive(true);
        }
      } catch (err) {
        setIsSyncActive(true);
      }
    };
    doFetch();

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
          // 🗑️ La ligne `playlists` (= la SESSION) a été supprimée → la session n'existe plus.
          // Pour un participant : notifier clairement, oublier le code mémorisé et revenir à l'accueil.
          if (!isHostRef.current) {
            setTracks([]);
            setSelectedTrack(null);
            try { localStorage.removeItem('bt_last_session_code'); } catch { /* ignore */ }
            showToastRef.current('La session a été fermée par l\'hôte.', 'warning');
            navigateRef.current('/');
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setIsSyncActive(true);
          // 🔄 Re-fetch à l'abonnement : récupère la playlist + la vidéo partagée enregistrées entre le
          //    fetch initial et la connexion Realtime → affichage IMMÉDIAT sans refresh manuel (#7).
          doFetch();
        }
      });

    // 🔄 CANAL BROADCAST MAÎTRE/ESCLAVE pour la synchronisation Play/Pause
    // L'hôte est le MAÎTRE : il envoie les commandes
    // Les participants sont ESCLAVES : ils obéissent instantanément
    const playbackChannel = supabase
      .channel(`playback:${sessionId}`)
      .on('broadcast', { event: 'HOST_COMMAND' }, (payload) => {
        // ⚠️ PARTICIPANT ESCLAVE : source UNIQUE = l'hôte. Tout passe par applyRemoteState (anti-boucle).
        if (isHostRef.current || !payload.payload) return;
        const command = payload.payload as { action: 'PLAY' | 'PAUSE' | 'SEEK' | 'STATE'; currentTime: number; trackId?: number; isPlaying?: boolean };
        // Mapping action → état voulu (PLAY/STATE portent isPlaying ; PAUSE=false ; SEEK=position pure).
        const isPlaying = command.action === 'PAUSE' ? false
          : command.action === 'PLAY' ? true
          : command.action === 'STATE' ? !!command.isPlaying
          : undefined; // SEEK
        applyRemoteState({ trackId: command.trackId ?? null, currentTime: command.currentTime, isPlaying, reason: command.action, source: 'HOST_COMMAND' });
        if (isPlaying != null) setHostIsPlaying(isPlaying);
        if (isPlaying === false) ensureVoiceAudible(); // 🔊 pause reçue → garantir la voix audible (musique en pause)
      })
      // E : média partagé (vidéo/image/lien) — identité du média (partage/retrait)
      .on('broadcast', { event: 'MEDIA_COMMAND' }, (payload) => {
        if (isHostRef.current || !payload.payload) return;
        const p = payload.payload as MediaCommandPayload;
        setSharedMedia(p.media);
        if (p.media) {
          mediaSeqRef.current += 1;
          setRemoteMediaState({ isPlaying: !!p.isPlaying, currentTime: p.currentTime || 0, seq: mediaSeqRef.current });
        } else {
          setRemoteMediaState(null);
        }
      })
      // 🎬 SYNCHRO VIDÉO (même canal/abonnement que l'audio) : le participant applique l'état de
      // lecture de l'hôte (play/pause/seek) reçu en continu (heartbeat 1s + à chaque action).
      .on('broadcast', { event: 'VIDEO_SYNC' }, (payload) => {
        if (isHostRef.current || !payload.payload) return;
        const p = payload.payload as { isPlaying: boolean; currentTime: number; mediaId?: string; ts?: number };
        const cur = sharedMediaRef.current;
        if (!cur) return;                                  // pas encore reçu l'identité du média
        if (p.mediaId && cur.url !== p.mediaId) return;    // sync pour un autre média → ignorer
        if (p.ts && p.ts < lastVideoTsRef.current) return; // message plus ancien que le dernier appliqué → ignorer
        if (p.ts) lastVideoTsRef.current = p.ts;
        console.log('[VIDEO] recv', p.isPlaying, p.currentTime);
        mediaSeqRef.current += 1;
        setRemoteMediaState({ isPlaying: !!p.isPlaying, currentTime: p.currentTime || 0, seq: mediaSeqRef.current });
      })
      // F : les co-animateurs ne sont PLUS dérivés d'un broadcast (spoofable) mais de la DB
      //     (playlists.cohosts), écrite par le backend host-only et reçue via postgres_changes.
      // C : mise à jour live de la description
      .on('broadcast', { event: 'DESC_UPDATE' }, (payload) => {
        if (isHostRef.current || !payload.payload) return;
        const p = payload.payload as DescPayload;
        setDescription(p.description || '');
      })
      // 🔴 POINT 3 : transparence — le participant voit le bandeau d'enregistrement
      .on('broadcast', { event: 'RECORDING_STATE' }, (payload) => {
        if (isHostRef.current || !payload.payload) return;
        const p = payload.payload as { active?: boolean };
        setRecordingActive(!!p.active);
        if (!p.active) setRecConsentAck(false); // ré-affiche le consentement si réactivé plus tard
      })
      // 🖥️ partage écran : le participant active son Peer visio pour recevoir le flux
      .on('broadcast', { event: 'SCREEN_SHARE_STATE' }, (payload) => {
        if (isHostRef.current || !payload.payload) return;
        const p = payload.payload as { active?: boolean };
        setRemoteScreenActive(!!p.active);
      })
      // 🚪 SALLE D'ATTENTE — l'hôte reçoit les demandes d'accès des participants
      .on('broadcast', { event: 'JOIN_REQUEST' }, (payload) => {
        if (!isHostRef.current || !payload.payload) return;
        const p = payload.payload as { userId?: string; name?: string; photoUrl?: string | null };
        if (!p.userId) return;
        if (admittedIdsRef.current.has(p.userId)) {
          // déjà admis (ex. reload) → ré-admission automatique
          if (supabase) supabase.channel(`playback:${sessionId}`).send({ type: 'broadcast', event: 'ADMIT', payload: { userId: p.userId } });
          return;
        }
        setAccessRequests((prev) => prev.some((r) => r.userId === p.userId)
          ? prev
          : [...prev, { userId: p.userId!, name: p.name || 'Invité', photoUrl: p.photoUrl || null }]);
      })
      // 🚪 le participant concerné est admis → il entre
      .on('broadcast', { event: 'ADMIT' }, (payload) => {
        const p = payload.payload as { userId?: string };
        if (!isHostRef.current && p?.userId && p.userId === myUserIdRef.current) {
          setAdmitted(true);
          setRefused(false);
        }
      })
      // 🚪 le participant concerné est refusé
      .on('broadcast', { event: 'REFUSE' }, (payload) => {
        const p = payload.payload as { userId?: string };
        if (!isHostRef.current && p?.userId && p.userId === myUserIdRef.current) {
          setRefused(true);
        }
      })
      // 🎤 SCÈNE — un spectateur demande à monter en vidéo → l'hôte/co-hôte collecte la demande
      .on('broadcast', { event: 'STAGE_REQUEST' }, (payload) => {
        if (!canManageStageRef.current || !payload.payload) return;
        const p = payload.payload as { userId?: string; name?: string; photoUrl?: string | null };
        if (!p.userId) return;
        setStageRequests((prev) => prev.some((r) => r.userId === p.userId)
          ? prev
          : [...prev, { userId: p.userId!, name: p.name || 'Invité', photoUrl: p.photoUrl || null }]);
        showToastRef.current(`${p.name || 'Un participant'} demande à monter en vidéo ✋`, 'default');
      })
      // 🎤 SCÈNE — le demandeur accepté : sa caméra s'active (l'hôte a fait la place → force)
      .on('broadcast', { event: 'STAGE_ACCEPT' }, (payload) => {
        const p = payload.payload as { userId?: string };
        if (p?.userId && p.userId === myUserIdRef.current) {
          setStageRequestPending(false);
          setLiveMode(true); // s'assurer d'être en Live Visio
          Promise.resolve(startCameraRef.current?.(true)).then((ok) => {
            if (ok === false) showToastRef.current('Autorisez la caméra pour monter à l\'écran', 'error');
            else showToastRef.current('Tu es à l\'écran 🎥', 'success');
          });
        }
      })
      // 🎤 SCÈNE — le demandeur refusé
      .on('broadcast', { event: 'STAGE_REFUSE' }, (payload) => {
        const p = payload.payload as { userId?: string };
        if (p?.userId && p.userId === myUserIdRef.current) {
          setStageRequestPending(false);
          showToastRef.current('Demande refusée', 'warning');
        }
      })
      // 🎤 SCÈNE — le participant retiré : sa caméra est coupée proprement + notification
      .on('broadcast', { event: 'STAGE_REMOVE' }, (payload) => {
        const p = payload.payload as { removedUserId?: string };
        if (p?.removedUserId && p.removedUserId === myUserIdRef.current) {
          stopCameraRef.current?.();
          setStageRequestPending(false);
          showToastRef.current('Tu n\'es plus à l\'écran', 'warning');
        }
      })
      // 🎤 L'HÔTE donne/coupe la parole à CE participant (additif — n'affecte que la cible non-hôte).
      .on('broadcast', { event: 'HOST_MIC_TOGGLE' }, (payload) => {
        const p = payload.payload as { userId?: string; on?: boolean };
        if (isHostRef.current) return;                              // l'hôte ne s'auto-cible pas
        if (!p?.userId || p.userId !== myUserIdRef.current) return; // seulement la cible réagit
        applyHostMicRef.current?.(!!p.on);
      })
      // 💬 CHAT GROUPÉ (Pro) — message visible par tout le groupe
      .on('broadcast', { event: 'CHAT_GROUP' }, (payload) => {
        if (!isProRef.current || !payload.payload) return;
        const m = payload.payload as ChatMessage;
        if (!m.id || !m.text) return;
        if (m.userId === myUserIdRef.current) return; // self-echo (déjà ajouté localement)
        setGroupMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
        if (!chatOpenRef.current || chatViewRef.current !== 'group') {
          setChatUnread((prev) => ({ ...prev, group: (prev.group || 0) + 1 }));
        }
      })
      // 💬 CHAT PRIVÉ (Pro) — 1-à-1, visible uniquement par expéditeur + destinataire
      .on('broadcast', { event: 'CHAT_PRIVATE' }, (payload) => {
        if (!isProRef.current || !payload.payload) return;
        const m = payload.payload as ChatMessage;
        if (!m.id || !m.text || !m.fromUserId || !m.toUserId) return;
        if (m.toUserId !== myUserIdRef.current) return; // destiné à quelqu'un d'autre → ignorer
        const key = m.fromUserId; // conversation indexée par l'interlocuteur
        setPrivateThreads((prev) => {
          const cur = prev[key] || [];
          if (cur.some((x) => x.id === m.id)) return prev;
          return { ...prev, [key]: [...cur, m] };
        });
        if (!chatOpenRef.current || chatViewRef.current !== key) {
          setChatUnread((prev) => ({ ...prev, [key]: (prev[key] || 0) + 1 }));
        }
      })
      // 💬 MODÉRATION — l'hôte supprime un message groupé pour tous
      .on('broadcast', { event: 'CHAT_DELETE' }, (payload) => {
        const p = payload.payload as { id?: string };
        if (!p?.id) return;
        setGroupMessages((prev) => prev.filter((x) => x.id !== p.id));
      })
      // ⏱️ INTERVAL TIMER — événement SÉPARÉ : n'affecte JAMAIS applyRemoteState ni la synchro musique.
      .on('broadcast', { event: 'TIMER' }, (payload) => {
        if (isHostRef.current) return; // l'hôte pilote son propre timer localement
        const p = (payload.payload || {}) as { action?: string; config?: IntervalConfig; startedAt?: number };
        if (p.action === 'START' && p.config && p.startedAt) {
          setIntervalRun({ config: p.config, startedAt: p.startedAt });
        } else if (p.action === 'STOP') {
          setIntervalRun(null);
        }
      })
      .subscribe();

    // Handler pour INSERT et UPDATE (playlist seulement)
    function handlePlaylistUpdate(payload: unknown) {
      const data = payload as PlaylistChangePayload;

      // 🔒 host_id (propriétaire) en live : si l'hôte revendique sa session après l'arrivée du
      // participant, on met à jour → l'effet de droits recalcule isHost (jamais "tout authentifié").
      if (data.new && typeof data.new.host_id === 'string') {
        setSessionHostId(data.new.host_id || null);
      }
      // F : co-animateurs depuis la DB (autorité). Tous les clients dérivent la liste de playlists.cohosts.
      if (data.new && Array.isArray(data.new.cohosts)) {
        setCoHostIds(new Set(data.new.cohosts));
      }
      // 🚪 confidentialité live : l'hôte (dé)active la salle d'attente → tous les clients suivent
      if (data.new && typeof data.new.is_private === 'boolean') {
        setIsPrivate(data.new.is_private);
        setPrivacyChecked(true);
      }
      // C : description live (participants)
      if (data.new && typeof data.new.description === 'string' && !isHostRef.current) {
        setDescription(data.new.description);
      }

      // Synchroniser la playlist uniquement
      if (data.new && 'tracks' in data.new) {
        const newTracks = data.new.tracks || [];

        if (!isHostRef.current) {
          setTracks(newTracks);
          showToastRef.current('Playlist synchronisée', 'default');

          if (newTracks.length > 0 && !selectedTrackRef.current) {
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
    // 🩹 BUG 1 : ne dépend QUE de [sessionId] → fetch initial + abonnements UNE SEULE FOIS au montage.
    // Les valeurs changeantes (isHost, selectedTrack, tracks, showToast) sont lues via refs ci-dessus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // 💳 Après paiement du crédit (session « Ouverte »), la playlist devient lisible (RLS) :
  //    on la recharge une fois, sans toucher aux canaux Realtime existants.
  useEffect(() => {
    if (playlistReloadKey === 0 || !sessionId || !supabase || !isSupabaseConfigured) return;
    (async () => {
      try {
        const { data } = await supabase
          .from('playlists')
          .select('tracks, description, shared_media')
          .eq('session_id', sessionId)
          .maybeSingle();
        if (data?.tracks && Array.isArray(data.tracks)) {
          setTracks(data.tracks as Track[]);
          if (!selectedTrackRef.current && data.tracks.length) setSelectedTrack(data.tracks[0] as Track);
        }
        if (typeof data?.description === 'string') setDescription(data.description);
      } catch { /* ignore */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playlistReloadKey]);

  // 📸 PARTIE 2 : photos de profil des participants chargées depuis la table `profiles`
  // (la presence ne transporte pas toujours l'avatar) → affichées dans la liste Participants.
  const [profileAvatars, setProfileAvatars] = useState<Record<string, string | null>>({});
  const profileAvatarsRef = useRef(profileAvatars);
  profileAvatarsRef.current = profileAvatars;
  useEffect(() => {
    if (!supabase) return;
    const ids = socket.presentUsers.map(u => u.userId).filter(id => id && !(id in profileAvatarsRef.current));
    if (ids.length === 0) return;
    // 🐛 BUG 3 : les invités (id `user_…`) ne sont pas des UUID → la requête profiles renverrait 400.
    //    On ne requête QUE les UUID valides ; les autres sont marqués « sans profil » (avatar par défaut).
    const uuidIds = ids.filter(isUuid);
    (async () => {
      try {
        const { data } = uuidIds.length > 0
          ? await supabase!.from('profiles').select('id, avatar_url').in('id', uuidIds)
          : { data: [] as { id: string; avatar_url: string | null }[] };
        setProfileAvatars(prev => {
          const next = { ...prev };
          (data as { id: string; avatar_url: string | null }[] | null || []).forEach(p => { next[p.id] = p.avatar_url; });
          ids.forEach(id => { if (!(id in next)) next[id] = null; }); // marquer "sans profil" → pas de re-fetch en boucle
          return next;
        });
      } catch { /* profils non lisibles → fallback initiales */ }
    })();
  }, [socket.presentUsers]);

  // 👥 POINT 2: Peupler la liste des participants depuis la Presence Realtime (temps réel).
  // On exclut soi-même (ajouté séparément dans le useMemo ci-dessous) et on applique
  // les overlays locaux (mute décidé par l'hôte, volume par participant).
  useEffect(() => {
    // 🧹 P6 : dédoublonnage. La presence peut contenir des entrées fantômes (reconnexion, double
    // souscription) → l'hôte apparaissait 2×  (« Coach (Vous) » + « Coach Hôte »). On :
    //  1) exclut soi-même (ajouté séparément) ;
    //  2) dédoublonne par userId ;
    //  3) si JE suis l'hôte, aucune AUTRE entrée ne peut être hôte → on retire les faux hôtes ;
    //     sinon (participant), on ne garde qu'UN seul hôte (le premier), pour ne jamais en afficher 2.
    const seenIds = new Set<string>();
    const seenNickLower = new Set<string>();
    let hostKept = false;
    const others: Participant[] = socket.presentUsers
      .filter(u => u.userId && u.userId !== socket.userId)
      .filter(u => { if (seenIds.has(u.userId)) return false; seenIds.add(u.userId); return true; })
      .filter(u => {
        if (!u.isHost) return true;
        if (isHost) return false;      // je suis l'hôte → tout autre « hôte » est un doublon fantôme
        if (hostKept) return false;    // un seul hôte affiché côté participant
        hostKept = true;
        return true;
      })
      // 🛡️ FILET ANTI-FANTÔME (conservateur) : deux entrées à userId DIFFÉRENTS mais MÊME pseudo, toutes
      //   deux NON-hôtes = fantômes de reconnexion d'un même invité (ancien id éphémère pas encore expiré).
      //   On ne garde que le premier. ⚠️ JAMAIS sur un hôte (on ne fusionne jamais hôte↔participant).
      //   Ce n'est qu'un filet : le VRAI correctif est l'id STABLE (localStorage, cf. SocketContext) qui
      //   fait que la présence remplace l'entrée au lieu d'en créer une nouvelle.
      .filter(u => {
        if (u.isHost) return true;
        const nick = (u.nickname || 'Invité').trim().toLowerCase();
        if (seenNickLower.has(nick)) return false;
        seenNickLower.add(nick);
        return true;
      })
      .map(u => ({
        id: u.userId,
        name: u.nickname || 'Invité',
        avatar: generateAvatar(u.nickname || 'Invité'),
        avatarUrl: profileAvatars[u.userId] ?? u.avatar, // 📸 photo profiles en priorité, sinon presence
        isSynced: true,
        isCurrentUser: false,
        isHost: u.isHost,
        isCoHost: coHostIds.has(u.userId),
        volume: userVolumes[u.userId] ?? 160, // 🔊 P4 : niveau par défaut relevé (gain 1.6) → au-dessus de la musique
        isMuted: mutedUserIds.has(u.userId),
      }));
    setParticipantsState(others);
  }, [socket.presentUsers, socket.userId, mutedUserIds, userVolumes, coHostIds, profileAvatars, isHost]);

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

  // 🔊 POINT 2 : un curseur "Volume — <pseudo>" pour CHAQUE autre participant présent (sauf soi
  // et sauf l'hôte), TOUJOURS visible ; micActive = il parle (voix relayée reçue) en ce moment.
  const remoteMicSliders = useMemo(
    () => participantsState
      .filter((p) => !p.isCurrentUser && !p.isHost)
      .map((p) => ({
        userId: p.id,
        name: p.name,
        volume: remoteMicVolumes[p.id] ?? 1.4, // 🔊 P4 : gain par défaut relevé (140%) → voix au-dessus de la musique
        micActive: peerState.remoteMicUsers.includes(p.id),
      })),
    [participantsState, peerState.remoteMicUsers, remoteMicVolumes],
  );

  // 🎤 Participants à qui l'hôte a DONNÉ la parole (INTENTION) — rend le bouton « Donner/Couper » toggle
  //    immédiatement, même avant que le participant ne tape l'invite (permission micro).
  const [micGivenIds, setMicGivenIds] = useState<Set<string>>(new Set());
  // 🎤 IDs affichés « micro actif » = parle réellement (remoteMicUsers) OU parole donnée par l'hôte.
  const micActiveIds = useMemo(
    () => new Set<string>([...peerState.remoteMicUsers, ...micGivenIds]),
    [peerState.remoteMicUsers, micGivenIds],
  );

  // FREE TRIAL TIME TRACKING
  useEffect(() => {
    if (!isFreeTrial || trialLimitReached) return;

    const checkPlayback = () => {
      const audioEl = getMusicEl();
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

    // 🔊 P4 : le slider (0..250%) pilote RÉELLEMENT le gain Web Audio de la voix de ce participant.
    setTribeUserVolume(id, volume / 100);

    if (isHost) {
      socket.setUserVolume(id, volume);
    }
  }, [isHost, socket, setTribeUserVolume]);

  const handleParticipantMuteToggle = useCallback((id: string) => {
    const participant = participantsState.find(p => p.id === id);
    const newMuted = !mutedUserIds.has(id);

    setMutedUserIds(prev => {
      const next = new Set(prev);
      if (newMuted) next.add(id); else next.delete(id);
      return next;
    });

    if (isHost) {
      // 🔇 P4 : coupe RÉELLEMENT l'audio de ce participant pour tout le monde (gain 0 + relais coupé)
      setTribeUserMuted(id, newMuted);
      if (newMuted) {
        socket.muteUser(id); // signale aussi au participant (courtoisie UX)
        showToast(`${participant?.name || 'Participant'} mis en sourdine`, 'warning');
      } else {
        socket.unmuteUser(id);
        showToast(`${participant?.name || 'Participant'} réactivé`, 'success');
      }
    }
  }, [isHost, participantsState, mutedUserIds, socket, showToast, setTribeUserMuted]);

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
  // - Hôte / co-host (canShare) : pilotent librement via le sélecteur (qui inclut "Audio").
  // - Participant : dérive le mode du média reçu (média ⇒ on cache lecteur audio + playlist).
  useEffect(() => {
    if (canShare) return; // hôte/co-host pilotent via le sélecteur
    if (!sharedMedia) { setShareMode('audio'); return; }
    setShareMode(sharedMedia.type === 'image' ? 'image' : sharedMedia.type === 'video' ? 'video' : 'link');
  }, [canShare, sharedMedia]);

  const sendPlaybackEvent = useCallback((event: string, payload: unknown) => {
    if (!sessionId || !supabase || !isSupabaseConfigured) return;
    supabase.channel(`playback:${sessionId}`).send({ type: 'broadcast', event, payload });
  }, [sessionId]);

  // 💬 CHAT — envoi (ajout optimiste local + diffusion realtime). Pro uniquement.
  const makeChatId = useCallback(
    () => `${socket.userId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    [socket.userId],
  );
  const handleSendGroupMessage = useCallback((text: string) => {
    if (!isPro || !text.trim()) return;
    const m: ChatMessage = {
      id: makeChatId(), userId: socket.userId, name: nickname || 'Invité',
      photoUrl: myAvatar || null, text: text.trim(), ts: Date.now(),
    };
    setGroupMessages((prev) => [...prev, m]);
    sendPlaybackEvent('CHAT_GROUP', m);
  }, [isPro, makeChatId, socket.userId, nickname, myAvatar, sendPlaybackEvent]);
  const handleSendPrivateMessage = useCallback((partnerId: string, text: string) => {
    if (!isPro || !partnerId || !text.trim()) return;
    const m: ChatMessage = {
      id: makeChatId(), userId: socket.userId, name: nickname || 'Invité',
      photoUrl: myAvatar || null, text: text.trim(), ts: Date.now(),
      fromUserId: socket.userId, toUserId: partnerId,
    };
    setPrivateThreads((prev) => ({ ...prev, [partnerId]: [...(prev[partnerId] || []), m] }));
    sendPlaybackEvent('CHAT_PRIVATE', m);
  }, [isPro, makeChatId, socket.userId, nickname, myAvatar, sendPlaybackEvent]);
  const handleDeleteGroupMessage = useCallback((id: string) => {
    if (!isHost) return;
    setGroupMessages((prev) => prev.filter((x) => x.id !== id));
    sendPlaybackEvent('CHAT_DELETE', { id });
  }, [isHost, sendPlaybackEvent]);
  // Lanceur de chat (bas-droite) : ouvre/ferme le panneau (le gating Pro est géré dans les onglets).
  const toggleChat = useCallback(() => setChatOpen((o) => !o), []);
  // Marquer comme lue la conversation actuellement visible (à l'ouverture / changement / nouveau message).
  const activePrivateLen = chatPartner ? (privateThreads[chatPartner]?.length || 0) : 0;
  useEffect(() => {
    if (!chatOpen) return;
    const key = chatTab === 'group' ? 'group' : chatTab === 'private' ? chatPartner : null;
    if (!key) return;
    setChatUnread((prev) => (prev[key] ? { ...prev, [key]: 0 } : prev));
  }, [chatOpen, chatTab, chatPartner, groupMessages.length, activePrivateLen]);
  const chatUnreadTotal = useMemo(
    () => Object.values(chatUnread).reduce((s, n) => s + (n || 0), 0),
    [chatUnread],
  );

  // 🎤 SCÈNE — actions (spectateur + hôte)
  // Spectateur : demander à monter en vidéo
  const handleRequestStage = useCallback(() => {
    if (!sessionId) return;
    sendPlaybackEvent('STAGE_REQUEST', { userId: socket.userId, name: nickname, photoUrl: myAvatar || null });
    setStageRequestPending(true);
    showToast('Demande envoyée à l\'hôte ✋', 'default');
  }, [sessionId, socket.userId, nickname, myAvatar, sendPlaybackEvent, showToast]);

  // Hôte : accepter (place libre) / refuser. Promotion LiveKit (droit de publier) AVANT l'accept Realtime.
  const handleAcceptStage = useCallback(async (userId: string) => {
    const res = await videoMesh.promote(userId);
    if (res === 'stage_full') { showToast('Scène pleine (10 max)', 'warning'); return; }
    sendPlaybackEvent('STAGE_ACCEPT', { userId });
    setStageRequests((prev) => prev.filter((r) => r.userId !== userId));
  }, [videoMesh, sendPlaybackEvent, showToast]);

  const handleRefuseStage = useCallback((userId: string) => {
    sendPlaybackEvent('STAGE_REFUSE', { userId });
    setStageRequests((prev) => prev.filter((r) => r.userId !== userId));
  }, [sendPlaybackEvent]);

  // 🎤 HÔTE — TOGGLE « donner la parole » / « couper le micro » d'un participant précis (à sa place).
  //    Mémorise l'intention (micGivenIds) → 2e clic sur le même participant = coupe sa parole.
  const handleToggleHostMic = useCallback((userId: string, on: boolean) => {
    sendPlaybackEvent('HOST_MIC_TOGGLE', { userId, on });
    setMicGivenIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(userId); else next.delete(userId);
      return next;
    });
    // 🎵 c'est l'hôte qui pilote la musique : donner la parole = AUTO-PAUSE synchro ; couper = AUTO-RESUME.
    if (on) addMicHold(userId); else removeMicHold(userId);
    showToast(on ? 'Parole donnée au participant 🎤' : 'Micro du participant coupé', 'default');
  }, [sendPlaybackEvent, showToast, addMicHold, removeMicHold]);

  // Hôte : scène pleine → retirer un participant choisi, puis faire monter le nouveau (anti-dépassement 10).
  const handleSwapStage = useCallback(async (acceptUserId: string, removedUserId: string) => {
    await videoMesh.demote(removedUserId);                         // retire le droit de publier côté SFU
    sendPlaybackEvent('STAGE_REMOVE', { removedUserId });
    if (removedUserId === socket.userId) videoMesh.stopCamera();   // l'hôte se retire lui-même → coupe localement
    setStageRequests((prev) => prev.filter((r) => r.userId !== acceptUserId));
    // Laisser la place se libérer avant de faire monter le demandeur.
    const res = await videoMesh.promote(acceptUserId);
    if (res === 'stage_full') { showToast('Scène pleine (10 max)', 'warning'); return; }
    setTimeout(() => sendPlaybackEvent('STAGE_ACCEPT', { userId: acceptUserId }), 400);
  }, [sendPlaybackEvent, socket.userId, videoMesh, showToast]);

  // 🎬 Participants actuellement À L'ÉCRAN (caméra active) — décompte du maillage, synchronisé pour tous.
  const onStageOccupants = useMemo(() => {
    const ids = [
      ...(videoMesh.cameraOn ? [socket.userId] : []),
      ...videoMesh.remoteCameras.map((c) => c.userId),
    ];
    return ids.map((id) => {
      const p = participants.find((pp) => pp.id === id);
      return { userId: id, name: p?.name || 'Participant', photoUrl: p?.avatarUrl || null, isSelf: id === socket.userId };
    });
  }, [videoMesh.cameraOn, videoMesh.remoteCameras, participants, socket.userId]);

  // 🚪 SALLE D'ATTENTE — persistance des admis (survit au reload de l'hôte)
  const admittedStorageKey = sessionId ? `bt_admitted_${sessionId}` : '';
  useEffect(() => {
    if (!isHost || !admittedStorageKey) return;
    try {
      const saved = JSON.parse(localStorage.getItem(admittedStorageKey) || '[]');
      if (Array.isArray(saved)) admittedIdsRef.current = new Set(saved as string[]);
    } catch { /* ignore */ }
  }, [isHost, admittedStorageKey]);
  const persistAdmitted = useCallback(() => {
    if (!admittedStorageKey) return;
    try { localStorage.setItem(admittedStorageKey, JSON.stringify(Array.from(admittedIdsRef.current))); } catch { /* ignore */ }
  }, [admittedStorageKey]);

  // 🚪 Hôte : admettre / refuser un participant en attente
  const handleAdmit = useCallback((userId: string) => {
    admittedIdsRef.current.add(userId);
    persistAdmitted();
    sendPlaybackEvent('ADMIT', { userId });
    setAccessRequests((prev) => prev.filter((r) => r.userId !== userId));
    showToast('Participant admis', 'success');
  }, [persistAdmitted, sendPlaybackEvent, showToast]);
  const handleRefuse = useCallback((userId: string) => {
    sendPlaybackEvent('REFUSE', { userId });
    setAccessRequests((prev) => prev.filter((r) => r.userId !== userId));
  }, [sendPlaybackEvent]);

  // 🚪 Hôte/co-hôte : activer/désactiver la salle d'attente (session privée)
  const handleTogglePrivacy = useCallback(() => {
    const next = !isPrivate;
    setIsPrivate(next);
    if (sessionId) saveSessionPrivacy(sessionId, next);
    showToast(next ? '🔒 Session privée : les participants passent par la salle d\'attente' : '🌐 Session publique : entrée directe', 'default');
  }, [isPrivate, sessionId, showToast]);

  // 🚪 Participant (session privée, non admis) : émet sa demande d'accès (+ heartbeat 3s)
  useEffect(() => {
    if (isHost || !isPrivate || admitted || refused || !privacyChecked || !nickname) return;
    if (!sessionId || !supabase || !isSupabaseConfigured) return;
    const emit = () => supabase!.channel(`playback:${sessionId}`).send({
      type: 'broadcast', event: 'JOIN_REQUEST',
      payload: { userId: socket.userId, name: nickname, photoUrl: myAvatar || null },
    });
    emit();
    const t = setInterval(emit, 3000);
    return () => clearInterval(t);
  }, [isHost, isPrivate, admitted, refused, privacyChecked, nickname, sessionId, socket.userId, myAvatar]);

  // E : partager un média (vidéo/image/lien)
  const handleShareMedia = useCallback((media: SharedMedia) => {
    setSharedMedia(media);
    if (sessionId) saveSharedMedia(sessionId, media);
    sendPlaybackEvent('MEDIA_COMMAND', { media, isPlaying: media.isPlaying ?? false, currentTime: media.currentTime ?? 0 });
  }, [sessionId, sendPlaybackEvent]);

  // 🎬 ÉMETTEUR VIDÉO UNIQUE : le SharedMediaPlayer (hôte) appelle ceci avec l'état LIVE du lecteur
  // (via son unique interval 700ms + à chaque action play/pause/seek). C'est la SEULE source qui
  // diffuse VIDEO_SYNC sur le canal audio (playback:<id>) → plus d'états contradictoires.
  const handleMediaState = useCallback((s: { isPlaying: boolean; currentTime: number }) => {
    const m = sharedMediaRef.current;
    if (!m) return;
    console.log('[VIDEO] emit', s.isPlaying, s.currentTime);
    sendPlaybackEvent('VIDEO_SYNC', { isPlaying: s.isPlaying, currentTime: s.currentTime, mediaId: m.url, ts: Date.now() });
  }, [sendPlaybackEvent]);

  // E : retirer le média partagé
  const handleCloseMedia = useCallback(() => {
    setSharedMedia(null);
    if (sessionId) saveSharedMedia(sessionId, null);
    sendPlaybackEvent('MEDIA_COMMAND', { media: null });
  }, [sessionId, sendPlaybackEvent]);

  // C : le champ « description courte » a été retiré de l'onglet Diffusion (P8). La description
  // reçue en temps réel (DESC_UPDATE / DB) reste stockée pour compatibilité, mais n'est plus éditable.

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

  // 🎙️ POINT 3 (hôte) : "Parler en privé" à une sélection de participants.
  // privateTargets vide = parler à TOUS. Sinon, seuls les userId sélectionnés entendent l'hôte.
  const [privateTargets, setPrivateTargetsState] = useState<Set<string>>(new Set());
  const handleTogglePrivateTalk = useCallback((id: string) => {
    setPrivateTargetsState((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      setPrivateTargets(next.size ? Array.from(next) : null);
      const p = participantsState.find(x => x.id === id);
      showToast(
        next.has(id) ? `🎙️ Conversation privée avec ${p?.name || 'le participant'}` : `${p?.name || 'Participant'} retiré du privé`,
        'default',
      );
      return next;
    });
  }, [setPrivateTargets, participantsState, showToast]);
  const handleTalkToAll = useCallback(() => {
    setPrivateTargetsState(new Set());
    setPrivateTargets(null);
    showToast('🔊 Vous parlez de nouveau à tout le monde', 'default');
  }, [setPrivateTargets, showToast]);

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
      host_id: user?.id, // 🔒 RLS : permet l'UPDATE de la ligne (sinon host_id NULL → UPDATE refusé)
    }).then((ok) => console.log('[PLAYLIST] save owner result:', ok));
  }, [isHost, ownerPlaylistKey, user?.id]);

  // Playlist reorder handler (syncs via socket for participants)
  const handlePlaylistReorder = useCallback((newTracks: Track[]) => {
    setTracks(newTracks);
    showToast('Playlist réorganisée', 'success');

    if (isHost && selectedTrack) {
      socket.syncPlaylist(newTracks, selectedTrack.id);
      persistOwnerPlaylist(newTracks, selectedTrack.id);
    }
  }, [showToast, isHost, socket, selectedTrack, persistOwnerPlaylist]);

  // ✏️ Renommer un titre : met à jour le nom + PERSISTE (ligne de session DB + playlist du compte) + sync.
  const handleRenameTrack = useCallback((trackId: number, title: string) => {
    if (!isHost) return;
    const clean = title.trim().slice(0, 120);
    if (!clean) return;
    const updated = tracks.map((t) => (t.id === trackId ? { ...t, title: clean } : t));
    setTracks(updated);
    if (selectedTrack?.id === trackId) setSelectedTrack({ ...selectedTrack, title: clean });
    const selId = selectedTrack?.id ?? updated[0]?.id ?? 0;
    socket.syncPlaylist(updated, selId);          // diffusion aux participants
    socket.savePlaylistToDb(updated, selId, user?.id); // ligne de session (DB)
    persistOwnerPlaylist(updated, selId);         // playlist du compte coach
    showToast('Titre renommé', 'success');
  }, [isHost, tracks, selectedTrack, socket, persistOwnerPlaylist, showToast, user?.id]);

  // 🙈 Masquer / ré-afficher un titre (booléen `hidden` dans le JSON tracks — AUCUN changement de schéma).
  //    Même persistance/diffusion que le renommage. Un titre masqué disparaît de la playlist des
  //    participants (filtré à l'affichage) mais reste visible/récupérable côté hôte.
  const handleToggleHidden = useCallback((trackId: number) => {
    if (!isHost) return;
    const updated = tracks.map((t) => (t.id === trackId ? { ...t, hidden: !t.hidden } : t));
    setTracks(updated);
    const selId = selectedTrack?.id ?? updated[0]?.id ?? 0;
    socket.syncPlaylist(updated, selId);
    socket.savePlaylistToDb(updated, selId, user?.id);
    persistOwnerPlaylist(updated, selId);
    showToast(updated.find((t) => t.id === trackId)?.hidden ? 'Titre masqué (invisible pour les participants)' : 'Titre ré-affiché', 'default');
  }, [isHost, tracks, selectedTrack, socket, persistOwnerPlaylist, showToast, user?.id]);

  // ⏱️ INTERVAL TRAINING (additif) — config stockée dans le JSON tracks (champ `interval`), même
  //    persistance/diffusion que le masquage. N'affecte NI l'audio musique, NI le micro, NI la visio.
  const handleSetInterval = useCallback((trackId: number, interval: IntervalConfig) => {
    if (!isHost) return;
    const updated = tracks.map((t) => (t.id === trackId ? { ...t, interval } : t));
    setTracks(updated);
    const selId = selectedTrack?.id ?? updated[0]?.id ?? 0;
    socket.syncPlaylist(updated, selId);
    socket.savePlaylistToDb(updated, selId, user?.id);
    persistOwnerPlaylist(updated, selId);
  }, [isHost, tracks, selectedTrack, socket, persistOwnerPlaylist, user?.id]);

  // Démarrage du décompte : local + broadcast SÉPARÉ 'TIMER' si « visible par tous ».
  const handleStartInterval = useCallback((config: IntervalConfig) => {
    if (!isHost) return;
    const startedAt = Date.now();
    setIntervalRun({ config, startedAt });
    setIntervalConfigTrackId(null);
    if (config.visibility === 'all') {
      sendPlaybackEvent('TIMER', { action: 'START', config, startedAt });
    }
  }, [isHost, sendPlaybackEvent]);

  const handleStopInterval = useCallback(() => {
    setIntervalRun((cur) => {
      if (isHostRef.current && cur && cur.config.visibility === 'all') {
        sendPlaybackEvent('TIMER', { action: 'STOP' });
      }
      return null;
    });
  }, [sendPlaybackEvent]);

  // Heartbeat : ré-émettre l'état du timer toutes les 5 s (participants qui rejoignent en cours d'essai).
  useEffect(() => {
    if (!intervalRun || !isHost || intervalRun.config.visibility !== 'all') return;
    const id = window.setInterval(() => {
      sendPlaybackEvent('TIMER', { action: 'START', config: intervalRun.config, startedAt: intervalRun.startedAt });
    }, 5000);
    return () => window.clearInterval(id);
  }, [intervalRun, isHost, sendPlaybackEvent]);

  // Track selection handler (syncs via socket)
  const handleTrackSelectWithSync = useCallback((track: Track) => {
    if (!isHost) return;
    setSelectedTrack(track);
    showToast(`Piste sélectionnée: ${track.title}`, 'success');
    socket.syncPlaylist(tracks, track.id);
    persistOwnerPlaylist(tracks, track.id);
  }, [showToast, isHost, socket, tracks, persistOwnerPlaylist]);

  // 🎚️ Chantier D : piste précédente / suivante depuis le mini-contrôle audio (hôte). Réutilise la même
  //    mécanique que l'enchaînement automatique (setAutoPlayPending + syncPlayback) → aucun 2ᵉ moteur audio.
  const handleMiniTrackNav = useCallback((delta: number) => {
    if (!canShare || tracks.length === 0) return;
    const idx = selectedTrack ? tracks.findIndex((t) => t.id === selectedTrack.id) : -1;
    const nextIdx = (((idx < 0 ? 0 : idx) + delta) % tracks.length + tracks.length) % tracks.length;
    const nt = tracks[nextIdx];
    if (!nt) return;
    setSelectedTrack(nt);
    setAutoPlayPending(nt.src);
    socket.syncPlaylist(tracks, nt.id);
    socket.syncPlayback(true, 0, nt.id);
  }, [canShare, tracks, selectedTrack, socket]);

  // ▶️⏸️ Chantier D : lecture / pause du mini-contrôle → agit sur L'UNIQUE élément #bt-music-audio
  //    (comme l'auto-pause/reprise voix) ; l'événement play/pause déclenche l'émission HOST_COMMAND existante.
  const handleMiniPlayPause = useCallback(() => {
    if (!canShare) return;
    const el = getMusicEl();
    if (!el) return;
    if (el.paused) el.play().catch(() => { /* geste requis : sera relancé au prochain tap */ });
    else el.pause();
  }, [canShare, getMusicEl]);

  // POINT 4b: non-abonné à la limite → notification puis redirection vers le paiement
  const handleUpgradeRequest = useCallback(() => {
    showToast('Passez Premium pour ajouter plusieurs titres', 'warning');
    navigate('/pricing');
  }, [showToast, navigate]);

  // Handle track upload
  const handleTrackUploaded = useCallback((newTrack: Track) => {
    // 🎵 Limite alignée sur l'affichage (20). Un NOUVEAU titre est VISIBLE par défaut (hidden non défini).
    if (tracks.length >= 20) {
      showToast('Limite de 20 titres atteinte', 'warning');
      return;
    }
    const added: Track = { ...newTrack, hidden: false }; // explicitement visible

    const updatedTracks = [...tracks, added];
    setTracks(updatedTracks);

    if (!selectedTrack) setSelectedTrack(added);

    const trackIdToSync = selectedTrack?.id || added.id;
    try {
      socket.syncPlaylist(updatedTracks, trackIdToSync);
      socket.savePlaylistToDb(updatedTracks, trackIdToSync, user?.id);
      persistOwnerPlaylist(updatedTracks, trackIdToSync);
      showToast(`"${added.title}" ajouté à la playlist`, 'success');
    } catch (e) {
      showToast("Échec de l'ajout du titre — réessayez", 'error');
    }
  }, [tracks, selectedTrack, socket, showToast, persistOwnerPlaylist, user?.id]);

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
    socket.savePlaylistToDb(updatedTracks, trackIdToSync, user?.id);
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
      socketRef.current.savePlaylistToDb(restored, sel.id, user?.id);
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
      setStoredLocalAvatar(url); // P2 : mémorisé pour les prochaines sessions
    }
    const next = pendingAfterAvatarRef.current;
    pendingAfterAvatarRef.current = null;
    if (next) next();
  }, [user?.id, refreshProfile]);

  // Handle nickname submission
  // - HÔTE : photo de profil requise (inchangé) → ensureAvatar avant de démarrer.
  // - PARTICIPANT (P2) : photo OPTIONNELLE → rejoint immédiatement (avatar = initiales par défaut).
  const handleNicknameSubmit = useCallback((newNickname: string) => {
    const finish = () => {
      setStoredNickname(newNickname);
      setNickname(newNickname);
      setShowNicknameModal(false);
      showToast(`Bienvenue ${newNickname} !`, 'success');
    };
    if (isHost) {
      ensureAvatar(finish);
    } else {
      finish();
    }
  }, [isHost, showToast, ensureAvatar]);

  // P2 : le participant ajoute (optionnellement) sa photo depuis le modal de pseudo
  const handleAddPhotoFromModal = useCallback(() => {
    pendingAfterAvatarRef.current = null; // ne pas enchaîner le join : on revient au modal avec la photo
    setShowAvatarCrop(true);
  }, []);

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
  // 💳 + débit du crédit d'animation (cost_host), atomique et idempotent par session côté backend.
  const claimedSessionRef = useRef<string | null>(null);
  useEffect(() => {
    if (!sessionId || !user?.id) return;

    // 🔑 CAUSE RACINE (admin vs coach) : l'admin devient TOUJOURS hôte (bypass), donc claimHost part
    // et host_id est écrit. Un coach non-admin ne devenait hôte QUE si host_id était déjà en DB — or
    // si host_id restait NULL (claim initial raté), il n'était JAMAIS reconnu hôte → claimHost jamais
    // appelé → deadlock → aucune diffusion (playlist/vidéo/commandes) vers les participants.
    // Correctif : on revendique aussi quand la session est NON revendiquée (host_id NULL, résolu) et
    // qu'on en est le CRÉATEUR (marqueur local) — le backend arbitre « 1er arrivé = hôte » et empêche
    // tout vol d'une session déjà revendiquée (retour host_id ≠ moi → je redeviens participant).
    const unclaimed = hostResolved && !sessionHostId;
    const iCreatedIt = hasActiveSessionMarker(user.id, sessionId);
    const shouldClaim = isHost || (unclaimed && iCreatedIt);
    if (!shouldClaim) return;
    if (claimedSessionRef.current === sessionId) return;
    claimedSessionRef.current = sessionId;
    (async () => {
      const r = await claimHost(sessionId);
      // 🔒 Auto-correction : la session appartient déjà à un AUTRE compte → je reste participant.
      if (r.host_id && r.host_id !== user.id) {
        setSessionHostId(r.host_id);
        setIsHost(false);
        return;
      }
      // ✅ Revendiquée par MOI → je suis bien l'hôte (rend le coach non-admin identique à l'admin).
      setSessionHostId(user.id);
      setIsHost(true);
      if (isAdminUser) return;  // admin : accès illimité, jamais débité
      const res = await spendCredit('host', sessionId);
      if (res.insufficient) {
        // Paywall clair (pas de redirection brutale).
        claimedSessionRef.current = null; // permet une nouvelle tentative après achat
        setCreditsBlocked('host');
      } else if (res.ok) {
        refreshCredits();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHost, sessionId, user?.id, isAdminUser, hostResolved, sessionHostId]);

  // Lien partageable (copie + QR) → PAGE PROMO d'abord (affiche + CTA). Si aucune promo publiée,
  // /promo redirige automatiquement vers la session (parcours transparent).
  const sessionUrl = useMemo(() => {
    if (!sessionId) return '';
    const baseUrl = window.location.origin;
    return `${baseUrl}/promo/${sessionId}`;
  }, [sessionId]);

  // Copy session link to clipboard
  const handleCopyLink = useCallback(async () => {
    if (!sessionUrl) return;
    
    try {
      await navigator.clipboard.writeText(sessionUrl);
      setLinkCopied(true);
      showToast('Lien copié ✅', 'success');
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
      savePlaylist({ session_id: newSessionId, tracks, selected_track_id: sel, host_id: user?.id });
    }

    if (user?.id) markActiveSession(user.id, newSessionId);

    setSessionId(newSessionId);
    navigate(`/session/${newSessionId}`, { replace: true });
    setCodeCopied(false);
    setLinkCopied(false);
    showToast('Nouveau code généré. Partagez-le avec vos participants.', 'success');
  }, [isHost, sessionId, tracks, selectedTrack, user?.id, navigate, showToast, disconnectPeer]);

  // 🔊 BUG 1: Le participant débloque TOUT le son en UN geste (musique + voix présentes ET futures).
  //   On marque débloqué IMMÉDIATEMENT (le clic est un vrai geste → la politique autoplay du navigateur
  //   est levée pour la suite) puis on relance musique + voix. AUCUN toast d'erreur (l'unlock est fait ;
  //   si la musique n'a pas encore de source, elle démarrera au prochain PLAY de l'hôte).
  const handleActivateSound = useCallback(() => {
    audioUnlockedRef.current = true;
    setAudioBlocked(false);
    // 🎚️ réveiller le mixeur (musique routée en Web Audio sur desktop) dans le geste
    try { initializeMixer(); } catch { /* ignore */ }
    // 🔓 voix : réveiller le contexte voix + relancer tous les <audio> voix (présents), et autoriser les futurs
    try { unlockAudio(); } catch { /* ignore */ }
    const audioEl = getMusicEl();
    if (audioEl && audioEl.src) audioEl.play().catch((err) => console.warn('[PARTICIPANT] musique:', err));
    // ⏱️ débloquer le moteur son du timer sur CE MÊME geste (participant qui n'a pas cliqué « Démarrer »).
    try { intervalTimerRef.current?.unlock(); } catch { /* ignore */ }
  }, [unlockAudio, initializeMixer, getMusicEl]);

  // Ref to track if "Go Live" toast has been shown (prevent infinite loop)
  const hasShownLiveToast = useRef(false);
  // Ref pour tracker le dernier état de lecture (éviter les envois redondants)
  const lastPlayingState = useRef<boolean | null>(null);

  // Handle audio state changes - L'HÔTE envoie des COMMANDES aux ESCLAVES
  const handleAudioStateChange = useCallback((state: AudioState) => {
    setAudioState(state);

    // 💓 POINT 3a: mémoriser le dernier état pour le heartbeat de resynchro.
    //   🔧 BUG 3 : trackId lu du ref FRAIS (pas de la closure selectedTrack qui traîne à la transition).
    heartbeatStateRef.current = {
      isPlaying: state.isPlaying,
      currentTime: state.currentTime,
      trackId: currentTrackIdRef.current,
    };

    // 🔄 MAÎTRE: L'hôte envoie des commandes PLAY/PAUSE explicites
    if (isHost && sessionId && supabase && isSupabaseConfigured) {
      // Détecter le changement d'état play/pause
      const playStateChanged = lastPlayingState.current !== state.isPlaying;
      
      if (playStateChanged) {
        lastPlayingState.current = state.isPlaying;
        console.log('[SYNC] hôte', state.isPlaying ? 'PLAY' : 'PAUSE', 'piste', currentTrackIdRef.current, 'position=', state.currentTime.toFixed(2));
        // Envoyer la commande appropriée (🔧 BUG 3 : trackId FRAIS via le ref)
        supabase.channel(`playback:${sessionId}`).send({
          type: 'broadcast',
          event: 'HOST_COMMAND',
          payload: {
            action: state.isPlaying ? 'PLAY' : 'PAUSE',
            currentTime: state.currentTime,
            trackId: currentTrackIdRef.current,
          },
        });
      }
      // Resynchro de position toutes les 5 s pendant la lecture — UNE SEULE émission par frontière de
      //   5 s (avant : la condition floor%5===0 était vraie ~60×/s → rafale de SEEK → gigue/re-seek chez
      //   le participant). On mémorise la dernière seconde émise.
      else if (state.isPlaying) {
        const sec = Math.floor(state.currentTime);
        if (sec % 5 === 0 && sec !== lastSeekSecRef.current) {
          lastSeekSecRef.current = sec;
          supabase.channel(`playback:${sessionId}`).send({
            type: 'broadcast',
            event: 'HOST_COMMAND',
            payload: {
              action: 'SEEK',
              currentTime: state.currentTime,
              trackId: currentTrackIdRef.current, // 🔧 BUG 3 : trackId FRAIS
            },
          });
        }
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

  // ℹ️ Plus de heartbeat vidéo séparé ici : l'ÉMETTEUR UNIQUE est l'interval 700ms du
  // SharedMediaPlayer (hôte) qui lit l'état LIVE du lecteur et appelle handleMediaState →
  // VIDEO_SYNC. Avoir deux émetteurs créait des états contradictoires (BUG B). Ne pas réintroduire.

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

  // 🚪 SALLE D'ATTENTE — un participant confirmé (ni hôte propriétaire, ni admin) d'une session
  // PRIVÉE n'entre pas tant qu'il n'est pas admis. Sessions publiques : isPrivate=false → jamais ici.
  const isConfirmedParticipant = privacyChecked && !isHost && !isAdminUser
    && (!user?.id || (sessionHostId != null && user.id !== sessionHostId));
  if (nickname && isConfirmedParticipant && refused) {
    return <WaitingRoomScreen name={nickname} photoUrl={myAvatar} refused />;
  }
  if (nickname && isConfirmedParticipant && isPrivate && !admitted) {
    return <WaitingRoomScreen name={nickname} photoUrl={myAvatar} />;
  }

  // ⏱️ Rappel LECTURE SEULE du décompte Interval (aucun bouton, aucun son) → injecté DANS les plein écran
  //    caméra (LiveVisioPanel) et vidéo partagée (SharedMediaPlayer). Le seul émetteur son reste <IntervalTimer/>.
  const visioTimerReminderNode = intervalTick ? (
    <div className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 z-[120]">
      <div
        className="flex items-center gap-2 px-4 py-2 rounded-2xl shadow-lg backdrop-blur-md"
        style={{ background: 'rgba(10,10,15,0.72)', border: `2px solid ${intervalTick.color}` }}
        data-testid="visio-timer-reminder"
      >
        <span className="text-xs font-semibold" style={{ color: intervalTick.color }}>
          {intervalTick.label}{!intervalTick.done && intervalTick.round > 0 ? ` · ${intervalTick.round}/${intervalTick.rounds}` : ''}
        </span>
        <span className="text-white font-bold" style={{ fontSize: 20, fontVariantNumeric: 'tabular-nums' }}>
          {intervalTick.done ? '✓' : intervalTick.mmss}
        </span>
      </div>
    </div>
  ) : null;

  // 🎥 Le panneau Live Visio (rendu UNE seule fois : soit flottant mobile, soit colonne droite desktop)
  const liveVisioNode = (
    <LiveVisioPanel
      participants={participants.map((p) => ({
        id: p.id,
        name: p.name,
        avatarUrl: p.avatarUrl,
        isHost: p.isHost,
        isCurrentUser: p.isCurrentUser,
        isMicActive: p.isCurrentUser ? (isHost ? hostMicActive : isTalking) : peerState.remoteMicUsers.includes(p.id),
      }))}
      myUserId={socket.userId}
      localStream={videoMesh.localStream}
      remoteCameras={videoMesh.remoteCameras}
      cameraOn={videoMesh.cameraOn}
      activeCameraCount={videoMesh.activeCameraCount}
      maxCameras={MAX_VISIO_CAMERAS}
      micActive={isHost ? hostMicActive : isTalking}
      onToggleMic={handleLiveMicToggle}
      hideMicButton={isHost}
      onToggleCamera={handleToggleCamera}
      onLeaveLive={() => setLiveMode(false)}
      canManageStage={canShare}
      stageRequestPending={stageRequestPending}
      onRequestStage={handleRequestStage}
      spotlightId={visioSpotlightId}
      onSpotlightChange={setVisioSpotlightId}
      onStartTimer={canShare ? () => setShowVisioTimerConfig(true) : undefined}
      timerNode={undefined /* BUG 3 : fenêtre interactive du minuteur visible en plein écran (portal) → pas de pilule rappel ici (évite le double timer) */}
      videoDevices={videoMesh.videoDevices}
      videoDeviceId={videoMesh.videoDeviceId}
      onSelectCamera={videoMesh.setCameraDevice}
      onFlipCamera={videoMesh.flipCamera}
      onRefreshDevices={videoMesh.refreshVideoDevices}
      onToggleScreenShare={handleToggleScreenShare}
      screenSharing={screenSharing}
      screenSupported={screenSupported}
      onOpenChat={sessionId && !isGuestRestricted ? () => setChatOpen(true) : undefined}
      chatUnread={chatUnreadTotal}
      onToggleStageRequests={canShare ? () => setStagePanelOpen((o) => !o) : undefined}
      stageRequestCount={stageRequests.length}
    />
  );

  // 🐛 BUG 4 : MÊME barre de contrôles Visio, injectée dans le plein écran de la VIDÉO partagée
  //    (Micro/Caméra/Scène/Interval/Chat). Réutilise exactement les handlers/états ci-dessus.
  const sharedVideoControlsNode = (
    <VisioControlBar
      micActive={isHost ? hostMicActive : isTalking}
      onToggleMic={handleLiveMicToggle}
      cameraOn={videoMesh.cameraOn}
      canManageStage={canShare}
      onToggleCamera={handleToggleCamera}
      onRequestStage={handleRequestStage}
      stageRequestPending={stageRequestPending}
      onStartTimer={canShare ? () => setShowVisioTimerConfig(true) : undefined}
      onOpenChat={sessionId && !isGuestRestricted ? () => setChatOpen(true) : undefined}
      chatUnread={chatUnreadTotal}
      onToggleStageRequests={canShare ? () => setStagePanelOpen((o) => !o) : undefined}
      stageRequestCount={stageRequests.length}
    />
  );

  // 🐛 BUG 5 : gestion de SCÈNE (accepter/refuser/faire descendre) réutilisée telle quelle. Rendue
  //    en flux (colonne) hors plein écran, ou PORTÉE dans l'élément plein écran (visio/vidéo partagée)
  //    pour rester atteignable par-dessus. isFsActive = un vrai élément est en plein écran natif.
  const isFsActive = typeof document !== 'undefined' && !!fsChatPortalTarget && fsChatPortalTarget !== document.body;
  const stageRequestsPanel = (
    <StageRequestsPanel
      requests={stageRequests}
      onStage={onStageOccupants}
      onStageCount={videoMesh.activeCameraCount}
      maxCameras={MAX_VISIO_CAMERAS}
      onAccept={handleAcceptStage}
      onRefuse={handleRefuseStage}
      onSwap={handleSwapStage}
    />
  );

  // 🎚️ Chantier D : mini-contrôle audio partagé (hôte / co-hôte) — play/pause + titre + préc./suiv.
  //    Réutilise l'UNIQUE élément musique (#bt-music-audio) et le HOST_COMMAND existant (aucun 2ᵉ <audio>).
  const miniAudioControlNode = (canShare && selectedTrack && shareMode === 'audio') ? (
    <div
      className="flex items-center gap-2 rounded-2xl border border-[rgb(var(--bt-accent-rgb)/0.25)] bg-[rgba(20,20,25,0.95)] px-3 py-2"
      data-testid="mini-audio-control"
    >
      <button onClick={() => handleMiniTrackNav(-1)} className="p-2 rounded-lg text-white/70 hover:bg-white/10 transition-colors" title="Piste précédente" data-testid="mini-audio-prev">
        <SkipBack className="w-4 h-4" />
      </button>
      <button
        onClick={handleMiniPlayPause}
        className="p-2 rounded-full text-white flex-shrink-0"
        style={{ background: 'linear-gradient(135deg,var(--bt-accent),var(--bt-accent-2))' }}
        title={audioState?.isPlaying ? 'Pause' : 'Lecture'}
        data-testid="mini-audio-playpause"
      >
        {audioState?.isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
      </button>
      <button onClick={() => handleMiniTrackNav(1)} className="p-2 rounded-lg text-white/70 hover:bg-white/10 transition-colors" title="Piste suivante" data-testid="mini-audio-next">
        <SkipForward className="w-4 h-4" />
      </button>
      <div className="min-w-0 flex-1">
        <p className="truncate text-white text-xs font-medium">{selectedTrack.title}</p>
        {selectedTrack.artist && <p className="truncate text-white/40 text-[11px]">{selectedTrack.artist}</p>}
      </div>
    </div>
  ) : null;

  // 🎥 Vignettes caméra COMPACTES (hôte + participants) pour la fenêtre flottante de la vue agrandie.
  //    + bouton « agrandir » (spotlight) par tuile — UI uniquement (même état que le panneau visio).
  const liveCamerasParticipants = participants;
  const liveCamerasSpotlight = visioSpotlightId
    ? liveCamerasParticipants.find((p) => p.id === visioSpotlightId) || null
    : null;
  const streamForCam = (p: { id: string }) => {
    const isMe = p.id === socket.userId;
    return isMe
      ? (videoMesh.cameraOn ? videoMesh.localStream : null)
      : (videoMesh.remoteCameras.find((c) => c.userId === p.id)?.stream || null);
  };
  const camTile = (p: typeof participants[number], large = false) => (
    <CameraTile
      name={p.name}
      stream={streamForCam(p)}
      isLocal={p.id === socket.userId}
      micActive={p.id === socket.userId ? (isHost ? hostMicActive : isTalking) : peerState.remoteMicUsers.includes(p.id)}
      isHost={p.isHost}
      avatarUrl={p.avatarUrl}
      large={large}
      className={large ? 'w-full h-full' : ''}
      onClick={() => setVisioSpotlightId(large ? null : p.id)}
      topRight={
        <button
          onClick={() => setVisioSpotlightId(large ? null : p.id)}
          className="p-1.5 rounded-lg bg-black/50 text-white/80 hover:bg-black/70 hover:text-white transition-colors"
          title={large ? 'Réduire' : 'Agrandir'}
          data-testid={large ? 'cam-tile-reduce' : 'cam-tile-enlarge'}
        >
          {large ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
      }
    />
  );
  const liveCamerasNode = liveCamerasSpotlight ? (
    <div className="space-y-1.5 p-2">
      <div className="relative aspect-video">{camTile(liveCamerasSpotlight, true)}</div>
      {liveCamerasParticipants.filter((p) => p.id !== liveCamerasSpotlight.id).length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {liveCamerasParticipants.filter((p) => p.id !== liveCamerasSpotlight.id).map((p) => (
            <div key={p.id} className="w-20 flex-shrink-0">{camTile(p)}</div>
          ))}
        </div>
      )}
    </div>
  ) : (
    <div className="grid grid-cols-2 gap-1.5 p-2">
      {liveCamerasParticipants.map((p) => (
        <div key={p.id}>{camTile(p)}</div>
      ))}
    </div>
  );

  // 💬 Panneau de chat — rendu soit au niveau page, soit À L'INTÉRIEUR de la vidéo plein écran (#3).
  //    🚪 Invité (accès sans inscription) → pas de chat (écoute/lecture seule).
  const chatPanelNode = (sessionId && !isGuestRestricted) ? (
    <ChatPanel
      open={chatOpen}
      onToggle={toggleChat}
      onClose={() => setChatOpen(false)}
      isPro={isPro}
      gradient={theme.colors.gradient.primary}
      unreadTotal={chatUnreadTotal}
      meUserId={socket.userId}
      isHost={isHost}
      participants={participants
        .filter((p) => !p.isCurrentUser && p.id !== socket.userId)
        .map((p) => ({ id: p.id, name: p.name, avatarUrl: p.avatarUrl || null }))}
      tab={chatTab}
      onTab={setChatTab}
      partner={chatPartner}
      onOpenPartner={setChatPartner}
      groupMessages={groupMessages}
      privateThreads={privateThreads}
      unread={chatUnread}
      onSendGroup={handleSendGroupMessage}
      onSendPrivate={handleSendPrivateMessage}
      onDeleteGroup={handleDeleteGroupMessage}
    />
  ) : null;

  return (
    <div
      // 💬 Quand le chat est ouvert, on libère 372px à droite sur desktop (lg+) → tout le contenu
      //    de session (vidéo/visio inclus) se redimensionne pour COEXISTER avec le panneau latéral.
      //    Sur mobile, le chat est une feuille basse → pas de décalage (la vidéo reste visible au-dessus).
      className={`min-h-screen overflow-x-hidden transition-[padding] duration-200 ${chatOpen ? 'lg:pr-[372px]' : ''}`}
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
        initialNickname={nickname || getStoredNickname() || ''}
        currentAvatar={myAvatar}
        onAddPhoto={handleAddPhotoFromModal}
      />

      {/* Photo de profil (upload + recadrage) — FACULTATIVE pour tout le monde (hôte inclus) : annulable. */}
      {showAvatarCrop && (
        <AvatarUploadCrop
          userId={user?.id || null}
          title="Votre photo de profil"
          subtitle={isHost ? 'Ajoutez une photo (facultatif)' : 'Ajoutez votre vraie photo (optionnel, recommandé)'}
          onComplete={handleAvatarComplete}
          onCancel={() => setShowAvatarCrop(false)}
        />
      )}

      {/* 💳 Paywall « crédits insuffisants » — remplace la redirection brutale. Clair + CTA d'achat. */}
      {creditsBlocked && (
        <div className="fixed inset-0 z-[140] flex items-center justify-center p-4 bg-black/90 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border-2 border-[rgb(var(--bt-accent-rgb)/0.5)] bg-[#15151b] p-6 sm:p-7 text-center shadow-2xl">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center" style={{ background: 'linear-gradient(135deg, var(--bt-accent) 0%, var(--bt-accent-2) 100%)' }}>
              <Coins className="w-8 h-8 text-white" />
            </div>
            <h2 className="text-xl sm:text-2xl font-bold text-white mb-2" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
              Crédits insuffisants
            </h2>
            <p className="text-white/70 text-sm mb-1">
              {creditsBlocked === 'host'
                ? "Il te faut 1 crédit pour animer ce live."
                : creditsBlocked === 'record'
                  ? "Tu n'as pas assez de crédits pour activer l'enregistrement + transcription IA."
                  : !user?.id
                    ? "Cette session « Ouverte » nécessite 1 crédit. Connecte-toi pour y accéder."
                    : "Il te faut 1 crédit pour accéder à cette session « Ouverte »."}
            </p>
            <p className="text-white/50 text-xs mb-6">
              {!user?.id
                ? "Connecte-toi puis procure-toi un crédit. 🎁 Ton 1er cours est offert à l'inscription."
                : "Achète un pack pour continuer. 🎁 Ton 1er cours est offert à l'inscription."}
            </p>
            <div className="flex flex-col gap-2">
              {!user?.id && creditsBlocked !== 'record' && (
                <button
                  onClick={() => navigate('/login', { state: { from: window.location.pathname } })}
                  className="w-full py-3 rounded-xl text-white font-semibold flex items-center justify-center gap-2 transition-transform hover:scale-[1.02]"
                  style={{ background: 'linear-gradient(135deg, var(--bt-accent) 0%, var(--bt-accent-2) 100%)' }}
                  data-testid="credits-paywall-login"
                >
                  <Lock className="w-5 h-5" /> Se connecter
                </button>
              )}
              <button
                onClick={() => navigate('/pricing')}
                className={`w-full py-3 rounded-xl text-white font-semibold flex items-center justify-center gap-2 transition-transform hover:scale-[1.02] ${!user?.id && creditsBlocked !== 'record' ? 'bg-white/10' : ''}`}
                style={!user?.id && creditsBlocked !== 'record' ? {} : { background: 'linear-gradient(135deg, var(--bt-accent) 0%, var(--bt-accent-2) 100%)' }}
                data-testid="credits-paywall-buy"
              >
                <Coins className="w-5 h-5" /> Acheter des crédits
              </button>
              <button
                onClick={() => { const wasRecord = creditsBlocked === 'record'; setCreditsBlocked(null); if (!wasRecord) navigate('/'); }}
                className="w-full py-2.5 rounded-xl text-white/60 hover:text-white text-sm transition-colors"
              >
                {creditsBlocked === 'record' ? 'Fermer' : "Retour à l'accueil"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 📱 Paiement mobile money reçu AVANT inscription → inviter à créer le compte (email prérempli).
          Priorité sur le paywall : l'accès s'active dès l'inscription via claimPendingAccess(). */}
      {paidAwaitingSignup && !user?.id && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/90 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border-2 border-[rgb(var(--bt-accent-rgb)/0.5)] bg-[#15151b] p-6 sm:p-7 text-center shadow-2xl">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center" style={{ background: 'linear-gradient(135deg, var(--bt-accent) 0%, var(--bt-accent-2) 100%)' }}>
              <Check className="w-8 h-8 text-white" />
            </div>
            <h2 className="text-xl sm:text-2xl font-bold text-white mb-2" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
              Paiement reçu ✅
            </h2>
            <p className="text-white/70 text-sm mb-1">Crée ton compte pour activer ton accès déjà payé.</p>
            <p className="text-white/40 text-xs mb-6">{ppEmail ? <>Utilise bien cet email : <span className="text-white/70 font-medium">{ppEmail}</span></> : 'Utilise le même email que celui saisi au paiement.'}</p>
            <button
              onClick={() => navigate('/login', { state: { from: `/session/${sessionId}?ticket=pp`, mode: 'signup', email: ppEmail } })}
              className="w-full py-3 rounded-xl text-white font-semibold inline-flex items-center justify-center gap-2 transition-transform hover:scale-[1.02]"
              style={{ background: 'linear-gradient(135deg, var(--bt-accent) 0%, var(--bt-accent-2) 100%)' }}
              data-testid="paid-awaiting-signup"
            >
              Créer mon compte et activer
            </button>
            <button
              onClick={() => navigate('/login', { state: { from: `/session/${sessionId}?ticket=pp`, email: ppEmail } })}
              className="w-full mt-2 py-2.5 rounded-xl text-white/70 hover:text-white text-sm transition-colors border border-white/15"
            >
              J'ai déjà un compte — me connecter
            </button>
          </div>
        </div>
      )}

      {/* 🎟️ Paywall « place payante » — participant sans billet sur une session payante. */}
      {accessInfo?.mode === 'paid' && !isHost && !isAdminUser && hasTicket === false && !paidAwaitingSignup && (
        <div className="fixed inset-0 z-[140] flex items-center justify-center p-4 bg-black/90 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border-2 border-[rgb(var(--bt-accent-rgb)/0.5)] bg-[#15151b] p-6 sm:p-7 text-center shadow-2xl">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center" style={{ background: 'linear-gradient(135deg, var(--bt-accent) 0%, var(--bt-accent-2) 100%)' }}>
              <Ticket className="w-8 h-8 text-white" />
            </div>
            <h2 className="text-xl sm:text-2xl font-bold text-white mb-2" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
              Session payante
            </h2>
            {accessInfo.sold_out ? (
              <p className="text-white/70 text-sm mb-6">Désolé, toutes les places sont vendues (complet).</p>
            ) : (
              <>
                <p className="text-white/70 text-sm mb-1">
                  Réserve ta place pour accéder à ce live.
                </p>
                <p className="text-3xl font-bold text-white mb-6">
                  {Number(accessInfo.price_chf || 0).toFixed(2)} <span className="text-lg text-white/60">CHF</span>
                  {accessInfo.capacity ? (
                    <span className="block text-xs font-normal text-white/40 mt-1">
                      {Math.max(0, accessInfo.capacity - accessInfo.sold)} place(s) restante(s)
                    </span>
                  ) : null}
                </p>
              </>
            )}
            <div className="flex flex-col gap-2">
              {!accessInfo.sold_out && (
                <button
                  onClick={() => handleBuyTicket('stripe')}
                  disabled={ticketBusy || !user?.id}
                  className="w-full py-3 rounded-xl text-white font-semibold flex items-center justify-center gap-2 transition-transform hover:scale-[1.02] disabled:opacity-60"
                  style={{ background: 'linear-gradient(135deg, var(--bt-accent) 0%, var(--bt-accent-2) 100%)' }}
                  data-testid="ticket-paywall-buy"
                >
                  <Ticket className="w-5 h-5" />
                  {!user?.id ? 'Connecte-toi pour acheter' : ticketBusy ? 'Redirection…' : `💳 Carte (${Number(accessInfo.price_chf || 0).toFixed(2)} CHF)`}
                </button>
              )}
              {/* 📱 Mobile Money (PawaPay) — visible même NON connecté (paiement avant inscription).
                  On choisit le PAYS (→ devise) ; l'opérateur + le numéro se saisissent sur la page PawaPay. */}
              {!accessInfo.sold_out && ppConfig?.configured && (
                showMobileMoney ? (
                  <div className="w-full rounded-xl border border-white/15 bg-white/5 p-3 flex flex-col gap-2" data-testid="ticket-mobilemoney">
                    {!user?.id && (
                      <div className="flex flex-col gap-1">
                        <label className="text-left text-xs text-white/60">Ton email</label>
                        <input
                          type="email"
                          value={ppEmail}
                          onChange={(e) => setPpEmail(e.target.value)}
                          placeholder="toi@email.com"
                          className="w-full rounded-lg bg-black/40 border border-white/15 text-white text-sm px-3 py-2"
                          data-testid="ticket-mobilemoney-email"
                        />
                        <p className="text-left text-[11px] text-white/40">On créera ton accès sur cet email — tu finaliseras ton inscription juste après le paiement.</p>
                      </div>
                    )}
                    <label className="text-left text-xs text-white/60">Ton pays</label>
                    <select
                      value={ppCountry}
                      onChange={(e) => setPpCountry(e.target.value)}
                      className="w-full rounded-lg bg-black/40 border border-white/15 text-white text-sm px-3 py-2"
                      data-testid="ticket-mobilemoney-country"
                    >
                      {ppConfig.countries.map((c) => (
                        <option key={c.code} value={c.code}>{c.label} ({c.currency})</option>
                      ))}
                    </select>
                    {ppTicketApprox && (
                      <p className="text-left text-xs text-white/50">Montant : <span className="text-white/80 font-medium">{ppTicketApprox}</span> <span className="text-white/40">(≈, converti depuis le CHF)</span></p>
                    )}
                    <p className="text-left text-[11px] text-white/40">Tu choisiras ton opérateur (Orange, MTN, Moov, Wave, M-Pesa…) sur la page sécurisée PawaPay.</p>
                    <button
                      onClick={() => handleBuyTicket('pawapay')}
                      disabled={ticketBusy || !ppCountry || (!user?.id && !ppEmail.trim())}
                      className="w-full py-3 rounded-xl text-white font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-60"
                      style={{ background: 'linear-gradient(135deg, var(--bt-accent) 0%, var(--bt-accent-2) 100%)' }}
                      data-testid="ticket-mobilemoney-pay"
                    >
                      <Smartphone className="w-4 h-4" /> {ticketBusy ? 'Redirection…' : 'Payer en Mobile Money'}
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowMobileMoney(true)}
                    className="w-full py-3 rounded-xl text-white font-semibold inline-flex items-center justify-center gap-2 border border-white/15 hover:bg-white/10 transition-colors"
                    data-testid="ticket-mobilemoney-toggle"
                  >
                    <Smartphone className="w-4 h-4" /> Mobile Money (Orange, MTN, Wave, M-Pesa…)
                  </button>
                )
              )}
              {!user?.id && !accessInfo.sold_out && (
                <button
                  onClick={() => navigate('/login', { state: { from: window.location.pathname } })}
                  className="w-full py-2.5 rounded-xl text-white/80 hover:text-white text-sm transition-colors border border-white/15"
                >
                  Se connecter
                </button>
              )}
              <button
                onClick={() => navigate('/')}
                className="w-full py-2.5 rounded-xl text-white/60 hover:text-white text-sm transition-colors"
              >
                Retour à l'accueil
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 🎟️ Hôte : configurateur du mode d'accès (ouverte / payante / privée). */}
      {showSessionSettings && isHost && (
        <div className="fixed inset-0 z-[140] flex items-center justify-center p-4 bg-black/90 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border-2 border-[rgb(var(--bt-accent-rgb)/0.4)] bg-[#15151b] p-6 shadow-2xl">
            <h2 className="text-xl font-bold text-white mb-1 flex items-center gap-2" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
              <Ticket size={20} style={{ color: 'var(--bt-accent-2)' }} /> Mode d'accès de la session
            </h2>
            <p className="text-white/50 text-sm mb-4">Choisis comment les participants accèdent à ce live.</p>
            <div className="space-y-2 mb-4">
              {(([
                { v: 'open', label: 'Ouverte (crédits)', desc: 'Le public dépense 1 crédit pour rejoindre.' },
                // 💳 « Payante (billet CHF) » réservée aux coachs en mode commission (argent via la plateforme).
                //    En abonnement, le coach encaisse lui-même via son lien/QR privé → on masque l'option.
                ...(coachPaymentType === 'commission'
                  ? [{ v: 'paid', label: 'Payante (billet CHF)', desc: 'Tu fixes un prix par place ; billet requis.' }]
                  : []),
                { v: 'private', label: 'Privée (lien/QR)', desc: 'Invités gratuits via le lien.' },
              ]) as { v: 'open' | 'paid' | 'private'; label: string; desc: string }[]).map((opt) => (
                <button
                  key={opt.v}
                  onClick={() => setModeDraft((d) => ({ ...d, mode: opt.v }))}
                  className={`w-full text-left p-3 rounded-xl border transition-colors ${
                    modeDraft.mode === opt.v ? 'border-[var(--bt-accent)] bg-[rgb(var(--bt-accent-rgb)/0.1)]' : 'border-white/15 hover:bg-white/5'
                  }`}
                >
                  <span className="text-white font-medium text-sm">{opt.label}</span>
                  <span className="block text-white/50 text-xs">{opt.desc}</span>
                </button>
              ))}
            </div>
            {modeDraft.mode === 'paid' && (
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div>
                  <label className="text-white/80 text-xs">Prix / place (CHF)</label>
                  <input type="number" min={billConfig?.price_min_chf ?? 0} max={billConfig?.price_max_chf ?? undefined}
                    value={modeDraft.price}
                    onChange={(e) => setModeDraft((d) => ({ ...d, price: e.target.value }))}
                    className="w-full mt-1 px-3 py-2 rounded-lg bg-black/30 border border-white/15 text-white text-sm" />
                  {billConfig && (
                    <span className="text-white/40 text-[11px]">{billConfig.price_min_chf}–{billConfig.price_max_chf} CHF</span>
                  )}
                </div>
                <div>
                  <label className="text-white/80 text-xs">Capacité (vide = illimité)</label>
                  <input type="number" min={1} value={modeDraft.capacity}
                    onChange={(e) => setModeDraft((d) => ({ ...d, capacity: e.target.value }))}
                    className="w-full mt-1 px-3 py-2 rounded-lg bg-black/30 border border-white/15 text-white text-sm" />
                </div>
              </div>
            )}
            {/* 🚪 Accès sans inscription (invité) OU avec inscription (chat + visio) */}
            <div className="mb-3">
              <p className="text-white/80 text-sm mb-2">Type d'accès des participants</p>
              <AccessModeSelector value={accessMode} onChange={handleAccessMode} />
              {savingAccessMode && <p className="text-white/40 text-[11px] mt-1">Enregistrement…</p>}
            </div>
            {/* 📣 Page promo / affiche partageable */}
            <button
              onClick={() => { setShowSessionSettings(false); setShowPromoEditor(true); }}
              className="w-full mb-3 py-2.5 rounded-xl text-white text-sm font-medium border border-[rgb(var(--bt-accent-rgb)/0.4)] bg-[rgb(var(--bt-accent-rgb)/0.1)] hover:bg-[rgb(var(--bt-accent-rgb)/0.2)] flex items-center justify-center gap-2"
              data-testid="open-promo-editor"
            >
              📣 Configurer la page promo (affiche + lien partageable)
            </button>
            <div className="flex gap-2">
              <button
                onClick={handleSaveMode}
                disabled={savingMode}
                className="flex-1 py-2.5 rounded-xl text-white font-semibold disabled:opacity-60"
                style={{ background: 'linear-gradient(135deg, var(--bt-accent) 0%, var(--bt-accent-2) 100%)' }}
              >
                {savingMode ? 'Enregistrement…' : 'Enregistrer'}
              </button>
              <button
                onClick={() => setShowSessionSettings(false)}
                className="px-4 py-2.5 rounded-xl text-white/60 hover:text-white text-sm border border-white/15"
              >
                Annuler
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 📣 Éditeur de la page promo (hôte) */}
      {showPromoEditor && isHost && sessionId && (
        <PromoEditor sessionId={sessionId} onClose={() => setShowPromoEditor(false)} />
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
                boxShadow: '0 4px 24px rgba(122, 92, 255, 0.4)',
              }}
              data-testid="activate-sound-btn"
            >
              <Volume2 className="w-6 h-6" />
              Activer le son
            </button>
          </div>
        </div>
      )}

      {/* 🔴 POINT D : consentement obligatoire — avis "session enregistrée + transcrite" aux participants */}
      {recordingActive && !isHost && !isAdminUser && !recConsentAck && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/90 backdrop-blur-sm" data-testid="recording-consent-modal">
          <div className="max-w-sm w-full rounded-2xl bg-[#0A0A0F] border border-red-500/40 p-6 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center bg-red-500/15">
              <Radio className="w-8 h-8 text-red-400" />
            </div>
            <h2 className="text-xl font-bold text-white mb-2" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
              Session enregistrée
            </h2>
            <p className="text-white/70 text-sm mb-6">
              Cette session est <strong>enregistrée et transcrite</strong> (audio + voix) afin de générer une transcription
              et un résumé pour l'organisateur. En continuant, tu acceptes cet enregistrement.
            </p>
            <button
              onClick={() => setRecConsentAck(true)}
              className="w-full h-12 rounded-xl text-white font-bold flex items-center justify-center gap-2 transition-transform hover:scale-105 active:scale-95"
              style={{ background: 'linear-gradient(135deg, var(--bt-accent) 0%, var(--bt-accent-2) 100%)' }}
              data-testid="recording-consent-accept"
            >
              <Check className="w-5 h-5" /> J'ai compris, continuer
            </button>
            <button
              onClick={() => navigate('/')}
              className="w-full h-10 mt-2 rounded-xl text-white/60 text-sm hover:text-white"
            >
              Quitter la session
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
          <div className="flex items-center justify-between h-16 gap-2">
            <div className="flex items-center gap-4 min-w-0">
              <Link to="/" className="flex items-center gap-2 flex-shrink-0">
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
                    backgroundImage: theme.colors.gradient.primary,
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                  }}
                >
                  {theme.name}
                </span>
              </Link>

              {/* Badges — desktop uniquement (sur mobile ils passent dans le menu hamburger) */}
              <div className="hidden md:flex items-center gap-4 min-w-0">
                {/* Role Badge */}
                <Badge
                  className={`flex items-center gap-1 ${isHost
                    ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
                    : 'bg-blue-500/20 text-blue-400 border-blue-500/30'
                  }`}
                >
                  {isHost ? <Radio className="w-3.5 h-3.5" /> : <Users className="w-3.5 h-3.5" />}
                  {isHost ? t('session.host') : t('session.participant')}
                </Badge>

                {/* Subscription Badge — POINT 1: réservé à l'hôte/admin, masqué pour les participants */}
                {isHost && <SubscriptionBadge />}
              </div>
            </div>

            {/* 📱 Bouton hamburger — mobile uniquement */}
            <button
              onClick={() => setSessionMenuOpen((v) => !v)}
              className="md:hidden flex-shrink-0 p-2 rounded-lg text-white/80 hover:bg-white/10 transition-colors"
              aria-label="Menu de la session"
              aria-expanded={sessionMenuOpen}
              data-testid="session-mobile-menu-toggle"
            >
              {sessionMenuOpen ? <X size={22} /> : <Menu size={22} />}
            </button>

            {/* Actions de l'en-tête — instance UNIQUE, repositionnée par CSS :
                desktop → barre inline ; mobile → panneau déroulant sous le hamburger. */}
            <div
              className={`
                ${sessionMenuOpen ? 'flex' : 'hidden'} md:flex
                flex-col md:flex-row items-stretch md:items-center gap-3
                absolute md:static left-0 right-0 top-16 md:top-auto
                z-50 p-4 md:p-0 border-t md:border-0 border-white/10
                bg-[rgba(8,8,12,0.98)] md:bg-transparent backdrop-blur-xl md:backdrop-blur-none
              `}
              data-testid="session-header-actions"
            >
              {/* Badges — copie mobile (cachée en desktop, déjà affichés à gauche) */}
              <div className="flex md:hidden items-center gap-2 flex-wrap">
                <Badge
                  className={`flex items-center gap-1 ${isHost
                    ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
                    : 'bg-blue-500/20 text-blue-400 border-blue-500/30'
                  }`}
                >
                  {isHost ? <Radio className="w-3.5 h-3.5" /> : <Users className="w-3.5 h-3.5" />}
                  {isHost ? t('session.host') : t('session.participant')}
                </Badge>
                {isHost && <SubscriptionBadge />}
              </div>

              {/* PARTIE D : sélecteur de langue (globe) — hôte ET participants */}
              <LanguageSelector />
              {/* 💬 Le chat de session (Assistant + Groupe + Privé) est désormais un lanceur flottant
                  en bas à droite — voir <ChatPanel> en bas de page. */}

              {/* 🎤 Le micro hôte est désormais SUR LE LECTEUR (barre d'actions hôte), plus dans le hamburger. */}

              {/* PARTICIPANT: Voice receiving indicator */}
              {!isHost && peerState.isReceivingVoice && (
                <span
                  className="text-xs px-2 py-0.5 rounded-full bg-[rgb(var(--bt-accent-rgb)/0.2)] text-[var(--bt-accent)] animate-pulse flex items-center gap-1 w-fit"
                  data-testid="voice-receiving-indicator"
                >
                  <span className="inline-block w-2 h-2 rounded-full bg-[var(--bt-accent)] animate-ping" />
                  <Volume2 className="w-3 h-3" />
                  Voix reçue
                </span>
              )}

              {/* User nickname display */}
              {nickname && (
                <button
                  onClick={handleChangeNickname}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 hover:bg-white/10 transition-colors w-fit"
                >
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium text-white"
                    style={{ background: theme.colors.gradient.primary }}
                  >
                    {generateAvatar(nickname)}
                  </div>
                  <span className="text-white/70 text-sm">{nickname}</span>
                </button>
              )}
              {/* 🎟️ Hôte : configurer le mode d'accès (ouverte / payante / privée) */}
              {isHost && (
                <Button
                  variant="outline" size="sm"
                  onClick={() => { setShowSessionSettings(true); setSessionMenuOpen(false); }}
                  className="border-[rgb(var(--bt-accent-rgb)/0.4)] text-white/80 hover:bg-[rgb(var(--bt-accent-rgb)/0.15)] inline-flex items-center justify-center gap-1 w-full md:w-auto"
                  data-testid="session-access-mode"
                >
                  <Ticket className="w-4 h-4" />
                  {accessInfo?.mode === 'paid'
                    ? `Payante · ${Number(accessInfo.price_chf || 0).toFixed(0)} CHF`
                    : accessInfo?.mode === 'private' ? 'Privée' : 'Mode d\'accès'}
                </Button>
              )}
              <Link to="/" onClick={() => setSessionMenuOpen(false)} className="w-full md:w-auto">
                <Button variant="outline" size="sm" className="border-white/20 text-white/70 hover:bg-white/10 inline-flex items-center justify-center gap-1 w-full md:w-auto">
                  <ArrowLeft className="w-4 h-4" /> Retour
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main data-mtab={mobileTab} className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 relative z-10">
        {/* 📱 MOBILE UNIQUEMENT — bascule d'onglets. Masque/affiche les blocs en CSS (jamais de
            démontage) ; ne s'applique PAS au desktop (≥1024px). Voir le <style> ci-dessous. */}
        <style>{`
          @media (max-width: 1023px) {
            /* 2 onglets : « player » révèle diffusion+live ; « controls » révèle access+mixer.
               Les classes par bloc sont inchangées (regroupées différemment). */
            [data-mtab="controls"] .bt-tab-diffusion,
            [data-mtab="controls"] .bt-tab-live,
            [data-mtab="player"] .bt-tab-access,
            [data-mtab="player"] .bt-tab-mixer { display: none !important; }
          }
        `}</style>
        <nav className="lg:hidden flex items-stretch gap-1 mb-6 overflow-x-auto -mx-1 px-1" data-testid="mobile-session-tabs">
          {([
            { id: 'player', label: 'Lecteur & Playlist', Icon: ListMusic },
            { id: 'controls', label: 'Mixeur & Participants', Icon: SlidersHorizontal },
          ] as const).map((tab) => {
            const isActive = mobileTab === tab.id;
            const TabIcon = tab.Icon;
            return (
              <button
                key={tab.id}
                onClick={() => setMobileTab(tab.id)}
                className="flex-1 whitespace-nowrap inline-flex items-center justify-center gap-1.5 px-3 py-2.5 text-sm font-medium border-b-2 transition-colors"
                style={{
                  color: isActive ? '#FFFFFF' : '#A9A9A9',
                  borderColor: isActive ? 'var(--bt-accent)' : 'transparent',
                }}
                data-testid={`mobile-tab-${tab.id}`}
              >
                <TabIcon size={16} aria-hidden="true" style={isActive ? { color: 'var(--bt-accent)' } : undefined} />
                {tab.label}
              </button>
            );
          })}
        </nav>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main Player */}
          <div className="lg:block lg:col-span-2 space-y-6">
            {/* 🎥 Interrupteur de mode : Écoute seule / Live Visio (additif, n'altère pas l'existant) */}
            {sessionId && (
              <div className="hidden lg:flex items-center gap-1.5 p-1 rounded-xl border border-white/10 bg-white/5 w-fit">
                <button
                  onClick={() => setLiveMode(false)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${!liveMode ? 'bg-[var(--bt-accent)] text-white' : 'text-white/60 hover:text-white'}`}
                  data-testid="mode-listen"
                >
                  <Headphones className="w-4 h-4" /> {t('session.mode.listen')}
                </button>
                <button
                  onClick={() => {
                    if (isFree) {
                      showToast('Live Visio : procurez-vous des crédits', 'warning');
                      navigate('/pricing');
                      return;
                    }
                    setLiveMode(true);
                  }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    isFree ? 'text-white/40 cursor-not-allowed' : liveMode ? 'text-white' : 'text-white/60 hover:text-white'
                  }`}
                  style={liveMode && !isFree ? { background: 'linear-gradient(135deg, var(--bt-accent) 0%, var(--bt-accent-2) 100%)' } : undefined}
                  title={isFree ? 'Live Visio : procurez-vous des crédits' : undefined}
                  data-testid="mode-live"
                >
                  {isFree ? <Lock className="w-4 h-4" /> : <Video className="w-4 h-4" />} {t('session.mode.live')}
                </button>
              </div>
            )}

            {/* 🔒 Plan gratuit : Live Visio verrouillé → invite Pro */}
            {isFree && sessionId && (
              <div className="bt-tab-diffusion flex items-center justify-between gap-2 flex-wrap px-3 py-2 rounded-xl bg-white/5 border border-white/10 w-fit">
                <span className="flex items-center gap-1.5 text-white/50 text-xs"><Lock className="w-3.5 h-3.5" /> Live Visio : nécessite des crédits</span>
                <button onClick={() => navigate('/pricing')} className="px-2.5 py-1 rounded-md text-white text-xs font-medium" style={{ background: 'linear-gradient(135deg, var(--bt-accent) 0%, var(--bt-accent-2) 100%)' }}>
                  Acheter des crédits
                </button>
              </div>
            )}

            {/* 🚪 Interrupteur "Session privée (salle d'attente)" — hôte + co-hôtes uniquement */}
            {canShare && sessionId && (
              <button
                onClick={handleTogglePrivacy}
                className={`bt-tab-access flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-medium w-fit transition-colors ${
                  isPrivate
                    ? 'bg-[rgb(var(--bt-accent-rgb)/0.15)] border-[rgb(var(--bt-accent-rgb)/0.4)] text-[var(--bt-accent)]'
                    : 'bg-white/5 border-white/10 text-white/60 hover:text-white'
                }`}
                title="Session privée : chaque participant doit être admis manuellement"
                data-testid="privacy-toggle"
              >
                {isPrivate ? <Lock className="w-4 h-4" /> : <Globe className="w-4 h-4" />}
                {isPrivate ? 'Session privée (salle d\'attente)' : 'Session publique (entrée directe)'}
                <span className={`ml-1 inline-flex h-4 w-7 items-center rounded-full p-0.5 transition-colors ${isPrivate ? 'bg-[var(--bt-accent)]' : 'bg-white/20'}`}>
                  <span className={`h-3 w-3 rounded-full bg-white transition-transform ${isPrivate ? 'translate-x-3' : ''}`} />
                </span>
              </button>
            )}

            {/* 🚪 Panneau "Demandes d'accès" — hôte uniquement, visible s'il y a des demandes */}
            {isHost && accessRequests.length > 0 && (
              <div className="bt-tab-access">
                <AccessRequestsPanel requests={accessRequests} onAdmit={handleAdmit} onRefuse={handleRefuse} />
              </div>
            )}

            {/* 🎤 Panneau "Demandes de prise de parole" — hôte + co-hôtes, visible s'il y a des demandes.
                📱 Mobile : épinglé en haut, AU-DESSUS de la visio flottante (z-[90] > DraggableWindow z-[80])
                pour rester lisible et cliquable. Desktop (lg) : flux normal dans la colonne (inchangé). */}
            {canShare && stageRequests.length > 0 && !isFsActive && (
              <div className="fixed inset-x-2 top-16 z-[90] max-h-[80vh] overflow-y-auto rounded-2xl shadow-2xl shadow-black/40 lg:static lg:inset-x-auto lg:top-auto lg:z-auto lg:max-h-none lg:overflow-visible lg:rounded-none lg:shadow-none">
                {stageRequestsPanel}
              </div>
            )}

            {/* 🎥 Live Visio — desktop : colonne de droite (inchangé) ; mobile : onglet « Live »
                (monté en permanence, masqué en CSS hors onglet → la connexion LiveKit ne se coupe pas). */}
            {!isDesktop && liveMode && sessionId && (
              <div className="bt-tab-live lg:hidden space-y-2">
                {/* 🎚️ Chantier D : contrôle audio partagé compact (hôte) accessible depuis l'onglet Live. */}
                {miniAudioControlNode}
                {liveVisioNode}
              </div>
            )}
            {/* 📱 Onglet « Live » sans visio active (mobile) : invite à démarrer / message plan gratuit. */}
            {!isDesktop && !(liveMode && sessionId) && (
              <div className="bt-tab-live lg:hidden rounded-2xl border border-white/10 bg-white/5 p-6 text-center">
                <p className="text-white/70 text-sm mb-3">
                  {isFree ? 'La Live Visio nécessite des crédits.' : 'Active la Live Visio pour afficher les caméras.'}
                </p>
                {isFree ? (
                  <button onClick={() => navigate('/pricing')} className="px-4 py-2 rounded-lg text-white text-sm font-medium" style={{ background: 'linear-gradient(135deg, var(--bt-accent) 0%, var(--bt-accent-2) 100%)' }}>
                    Acheter des crédits
                  </button>
                ) : (
                  <button onClick={() => sessionId && setLiveMode(true)} className="px-4 py-2 rounded-lg text-white text-sm font-medium inline-flex items-center gap-2" style={{ background: 'linear-gradient(135deg, var(--bt-accent) 0%, var(--bt-accent-2) 100%)' }}>
                    <Video className="w-4 h-4" /> Démarrer la Live Visio
                  </button>
                )}
              </div>
            )}

            {/* 🔴 POINT 3 : bandeau de transparence — visible par TOUS pendant l'enregistrement */}
            {recordingActive && (
              <div className="bt-tab-diffusion flex items-center gap-2 px-3 py-2 rounded-xl bg-red-500/15 border border-red-500/40 text-red-300 text-sm" data-testid="recording-banner">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
                </span>
                {t('session.recording.banner')}
              </div>
            )}

            {/* Session Title */}
            <div className="bt-tab-diffusion">
              <h1
                className="text-2xl sm:text-3xl font-bold text-white mb-2"
                style={{ fontFamily: "'Space Grotesk', sans-serif" }}
              >
                {t('session.title')}
              </h1>
              <p className="text-white/60 text-sm sm:text-base">
                {isHost
                  ? (isAdminUser
                      ? 'Mode Admin - Contrôle total de la session.'
                      : t('session.subtitle.host'))
                  : t('session.subtitle.listen')
                }
              </p>
            </div>

            {/* 🎛️ Barre d'actions HÔTE — TOUJOURS visible (pas d'onglet) : micro SUR LE LECTEUR + enregistrement.
                Un seul bouton micro clair, là où se passe le live (réutilisable sur tous les onglets). */}
            {isHost && (
              <div className="flex items-center gap-2 flex-wrap px-3 py-2 rounded-xl bg-white/5 border border-white/10">
                {/* 🎤 Micro hôte (toggle local d'activation — ne touche PAS LiveKit) */}
                <MicrophoneControl
                  ref={hostMicCtrlRef}
                  isHost={true}
                  onMicActive={setHostMicActive}
                  onStreamReady={setHostMicStream}
                  mode={micMode}
                  onToggleMode={handleToggleMicMode}
                />
                {/* 🎚️ MANUEL : contrôle visible pour couper/reprendre la musique (micro allumé) */}
                {micMode === 'manual' && hostMicActive && (
                  <button
                    onClick={handleToggleManualMusic}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
                      manualMusicPaused
                        ? 'bg-green-500/20 text-green-300 border border-green-500/40 hover:bg-green-500/30'
                        : 'bg-white/10 text-white/80 border border-white/20 hover:bg-white/20'
                    }`}
                    data-testid="manual-music-toggle"
                  >
                    {manualMusicPaused ? '▶️ Reprendre la musique' : '⏸️ Couper la musique'}
                  </button>
                )}
                <span className="w-px h-6 bg-white/10 mx-1 hidden sm:block" />
                {/* Principal : enregistrement complet + transcription IA */}
                {!premiumRecActive ? (
                  <button
                    onClick={handleStartPremiumRec}
                    disabled={recProcessing}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-white disabled:opacity-60 transition-transform hover:scale-105 active:scale-95"
                    style={{ background: 'linear-gradient(135deg, var(--bt-accent) 0%, var(--bt-accent-2) 100%)' }}
                    title={`Enregistrer la session (toutes les voix) + transcription IA${isAdminUser ? '' : ` — ${recCost} crédit${recCost > 1 ? 's' : ''}`}`}
                    data-testid="premium-record-start"
                  >
                    <Radio className="w-3.5 h-3.5" />
                    {recProcessing ? 'Traitement…' : `Enregistrer + IA${isAdminUser ? '' : ` (${recCost} cr.)`}`}
                  </button>
                ) : (
                  <button
                    onClick={handleStopPremiumRec}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-red-500/20 text-red-300 border border-red-500/40 hover:bg-red-500/30"
                    data-testid="premium-record-stop"
                  >
                    <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" /> Arrêter
                  </button>
                )}
                {/* 🔊 « M'entendre » : monitoring local de sa propre voix (anti-larsen, on/off) */}
                <button
                  onClick={handleToggleSelfMonitor}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
                    selfMonitorOn
                      ? 'bg-[rgb(var(--bt-accent-rgb)/0.25)] text-[var(--bt-accent)] border border-[rgb(var(--bt-accent-rgb)/0.5)] hover:bg-[rgb(var(--bt-accent-rgb)/0.35)]'
                      : 'bg-white/5 text-white/50 border border-white/10 hover:bg-white/10'
                  }`}
                  title={selfMonitorOn ? 'Couper le monitoring de ma voix' : 'M\'entendre (écouter ma propre voix — attention au larsen)'}
                  data-testid="self-monitor-toggle"
                >
                  <Headphones className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">M'entendre</span>
                </button>
              </div>
            )}

            {/* 🔴 Enregistrement premium : état/résultat — panneau discret (hôte) */}
            {isHost && (recProcessing || (recResult && (recResult.summary || recResult.transcript))) && (
              <div className="bt-tab-diffusion rounded-xl border border-[rgb(var(--bt-accent-rgb)/0.3)] bg-white/5 p-3 space-y-2">
                {recProcessing && (
                  <p className="text-white/70 text-xs flex items-center gap-2">
                    <span className="inline-block w-3 h-3 rounded-full border-2 border-white/30 border-t-[var(--bt-accent-2)] animate-spin" />
                    Transcription IA en cours…
                  </p>
                )}
                {recResult && (recResult.summary || recResult.transcript) && (
                  <div className="space-y-2 max-h-72 overflow-y-auto">
                    {recResult.summary && (
                      <div>
                        <p className="text-[var(--bt-accent-2)] text-xs font-semibold mb-1">Résumé / notes</p>
                        <p className="text-white/80 text-xs whitespace-pre-wrap">{recResult.summary}</p>
                      </div>
                    )}
                    {recResult.transcript && (
                      <details>
                        <summary className="text-white/70 text-xs cursor-pointer">Transcription complète</summary>
                        <p className="text-white/70 text-xs whitespace-pre-wrap mt-1">{recResult.transcript}</p>
                      </details>
                    )}
                    <p className="text-white/40 text-[11px]">Retrouve tes enregistrements dans l'Espace Coach (Portefeuille).</p>
                  </div>
                )}
              </div>
            )}

            {/* 🖥️ Partage d'écran en direct (au-dessus du média partagé) */}
            {videoMesh.localScreen && (
              <div className="bt-tab-diffusion">
                <ScreenShareView stream={videoMesh.localScreen} isLocal onStop={handleToggleScreenShare} />
              </div>
            )}
            {!videoMesh.localScreen && videoMesh.remoteScreen && (
              <div className="bt-tab-diffusion">
                <ScreenShareView stream={videoMesh.remoteScreen.stream} hostName="l'hôte" />
              </div>
            )}

            {/* E : Média partagé (vidéo/image/lien) — affiché UNIQUEMENT hors mode audio */}
            {shareMode !== 'audio' && sharedMedia && (
              <div className="bt-tab-diffusion">
              <SharedMediaPlayer
                ref={sharedMediaPlayerRef}
                media={sharedMedia}
                isHost={canShare}
                onState={canShare ? handleMediaState : undefined}
                remote={!canShare ? remoteMediaState : null}
                onClose={canShare ? handleCloseMedia : undefined}
                mediaVolume={mixerState.musicVolume}
                maxSeconds={isFree ? 30 : Infinity}
                onEnlargedChange={setVideoEnlarged}
                chatNode={chatPanelNode}
                liveCamerasNode={liveCamerasNode}
                timerNode={visioTimerReminderNode}
                controlsNode={canShare ? sharedVideoControlsNode : undefined}
              />
              </div>
            )}

            {/* E + item 6 : Panneau de partage (Audio | Vidéo | Image | Lien) — hôte + co-animateurs.
                📦 Accordéon REPLIÉ par défaut (aération). Le contenu reste MONTÉ (masqué en CSS) pour
                ne jamais couper un upload en cours. */}
            {canShare && sessionId && (
              <Card className="bt-tab-diffusion border-white/10 bg-white/5">
                <CardHeader className="p-0">
                  <button
                    type="button"
                    onClick={() => togglePanel('share')}
                    className="w-full flex items-center justify-between gap-2 px-6 py-4 text-left"
                    aria-expanded={panelOpen.share}
                    data-testid="panel-share-toggle"
                  >
                    <CardTitle className="text-white text-lg flex items-center gap-2">
                      <Plus className="w-5 h-5 text-[var(--bt-accent)]" />
                      Partager un média / Fichier
                    </CardTitle>
                    <ChevronDown className={`w-5 h-5 text-white/50 flex-shrink-0 transition-transform duration-300 ${panelOpen.share ? 'rotate-180' : ''}`} />
                  </button>
                </CardHeader>
                <div className={panelOpen.share ? '' : 'hidden'}>
                  <CardContent className="p-4 pt-0">
                    <MediaShareControls
                      sessionId={sessionId}
                      onShare={handleShareMedia}
                      showToast={showToast}
                      mode={shareMode}
                      onModeChange={setShareMode}
                      maxVideoSeconds={isFree ? 30 : undefined}
                      onToggleScreenShare={handleToggleScreenShare}
                      screenSharing={screenSharing}
                      screenSupported={screenSupported}
                      audioPanel={canShare ? (
                        <TrackUploader
                          sessionId={sessionId}
                          onTrackUploaded={handleTrackUploaded}
                          currentTrackCount={tracks.length}
                          maxTracks={20}
                          disabled={!canShare}
                          isSessionHost={isHost}
                          forceUnlimited={isUnlimitedHost}
                          onUpgradeRequest={handleUpgradeRequest}
                        />
                      ) : undefined}
                    />
                  </CardContent>
                </div>
              </Card>
            )}

            {/* Share Link Card (Host only) — Item 2 : repliable */}
            {isHost && sessionId && (
              <Card className="bt-tab-access border-white/10 bg-white/5">
                <CardHeader className="p-0">
                  <button
                    type="button"
                    onClick={() => togglePanel('code')}
                    className="w-full flex items-center justify-between gap-2 px-6 py-4 text-left"
                    aria-expanded={panelOpen.code}
                    data-testid="panel-code-toggle"
                  >
                    <CardTitle className="text-white text-lg flex items-center gap-2">
                      <KeyRound className="w-5 h-5 text-[var(--bt-accent)]" />
                      Code de la session
                    </CardTitle>
                    <ChevronDown className={`w-5 h-5 text-white/50 flex-shrink-0 transition-transform ${panelOpen.code ? 'rotate-180' : ''}`} />
                  </button>
                </CardHeader>
                {panelOpen.code && (
                <CardContent className="p-4 pt-0 space-y-4">
                  {/* 🔢 BUG 5: CODE de session bien visible + explication pour rejoindre */}
                  <div className="rounded-xl border border-[rgb(var(--bt-accent-rgb)/0.3)] bg-[rgb(var(--bt-accent-rgb)/0.1)] p-4 text-center">
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
                          <Copy className="w-4 h-4" />
                          Copier le lien
                        </span>
                      )}
                    </Button>
                  </div>

                  {/* QR code de l'URL complète → le participant scanne au lieu de taper le code */}
                  {sessionUrl && (
                    <div className="flex flex-col items-center gap-2 pt-1">
                      <div className="flex items-center gap-1.5 text-white/50 text-xs">
                        <QrCode className="w-4 h-4 text-[var(--bt-accent)]" />
                        Scannez pour rejoindre
                      </div>
                      <div className="rounded-xl bg-white p-3 shadow-lg shadow-[rgb(var(--bt-accent-rgb)/0.1)]">
                        <QRCodeCanvas
                          value={sessionUrl}
                          size={160}
                          level="M"
                          includeMargin={false}
                          fgColor="#1a1a2e"
                          bgColor="#ffffff"
                          data-testid="session-qr"
                        />
                      </div>
                    </div>
                  )}
                </CardContent>
                )}
              </Card>
            )}

            {/* Audio Player - Only show if there's a track selected */}
            {/* Item 6 : lecteur audio + playlist UNIQUEMENT en mode audio */}
            {shareMode === 'audio' && (<div className="bt-tab-diffusion">{selectedTrack ? (
              <>
                {/* Free Trial Timer Indicator */}
                {isFreeTrial && !trialLimitReached && (
                  <div className="bg-gradient-to-r from-[rgb(var(--bt-accent-rgb)/0.2)] to-[rgb(var(--bt-accent-2-rgb)/0.2)] border border-[rgb(var(--bt-accent-rgb)/0.3)] rounded-lg p-3 mb-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="flex items-center gap-1 text-[var(--bt-accent)] text-sm font-medium"><Clock className="w-3.5 h-3.5" /> Essai Gratuit</span>
                        <span className="text-white/70 text-sm">
                          {Math.floor((FREE_TRIAL_LIMIT_SECONDS - totalPlayTime) / 60)}:{String((FREE_TRIAL_LIMIT_SECONDS - totalPlayTime) % 60).padStart(2, '0')} restant
                        </span>
                      </div>
                      <Link
                        to="/pricing"
                        className="text-xs bg-[var(--bt-accent)] hover:bg-[var(--bt-accent)] text-white px-3 py-1 rounded-full transition-colors"
                      >
                        Acheter des crédits
                      </Link>
                    </div>
                    <div className="mt-2 bg-white/10 rounded-full h-1.5 overflow-hidden">
                      <div 
                        className="bg-gradient-to-r from-[var(--bt-accent)] to-[var(--bt-accent-2)] h-full transition-all duration-1000"
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
                        Utilisez un crédit pour une écoute <strong className="text-[var(--bt-accent)]">illimitée</strong> !
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
                        Acheter des crédits
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
                  <div className="mb-4 px-4 py-3 rounded-lg bg-[rgb(var(--bt-accent-rgb)/0.1)] border border-[rgb(var(--bt-accent-rgb)/0.2)]">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <Headphones className="w-6 h-6 text-[var(--bt-accent)] flex-shrink-0" />
                        <div className="min-w-0">
                          <p className="text-[var(--bt-accent)] font-medium text-sm truncate">Mode écoute seule - Synchronisé avec l'hôte</p>
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

                    {/* 🎤 Le coach t'a donné la parole mais le micro n'est pas encore autorisé → un tap suffit */}
                    {coachMicInvite && !isTalking && (
                      <button
                        onClick={() => { setCoachMicInvite(false); handleToggleTalk(); }}
                        className="mt-2 w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold bg-[rgb(var(--bt-accent-rgb)/0.2)] text-[var(--bt-accent)] border border-[rgb(var(--bt-accent-rgb)/0.4)] hover:bg-[rgb(var(--bt-accent-rgb)/0.3)] transition-colors animate-pulse"
                        data-testid="coach-mic-invite"
                      >
                        <Mic className="w-4 h-4 flex-shrink-0" />
                        <span>🎤 Le coach t'invite à parler — appuie pour activer ton micro</span>
                      </button>
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
                  onBeforePlay={async () => { initializeMixer(); try { await getMixerContext()?.resume(); } catch { /* ignore */ } }}
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
            )}</div>)}

            {/* Track Selection (Host only) */}
            {shareMode === 'audio' && isHost && (
              <Card className="bt-tab-diffusion border-white/10 bg-white/5">
                <CardHeader className="pb-3">
                  <CardTitle className="text-white text-lg">
                    Playlist
                  </CardTitle>
                  <CardDescription className="text-white/50">
                    Glissez pour réorganiser • {tracks.length}/20 titres
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-0 space-y-4">
                  {/* L'ajout de pistes se fait via le panneau de partage (mode Audio) ci-dessus */}
                  {/* Playlist with DnD — hauteur limitée + scroll interne (évite d'étirer la page). */}
                  <div className="max-h-64 overflow-y-auto -mr-1 pr-1">
                  <PlaylistDnD
                    tracks={tracks}
                    selectedTrack={selectedTrack}
                    onTrackSelect={handleTrackSelectWithSync}
                    onReorder={handlePlaylistReorder}
                    onDeleteTracks={handleDeleteTracks}
                    onRenameTrack={handleRenameTrack}
                    onToggleHidden={handleToggleHidden}
                    onOpenInterval={setIntervalConfigTrackId}
                    isHost={isHost}
                    maxTracks={20}
                  />
                  </div>
                  
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
              <Card className="bt-tab-diffusion border-white/10 bg-white/5">
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
                  <div className="max-h-64 overflow-y-auto -mr-1 pr-1">
                  <PlaylistDnD
                    tracks={tracks}
                    selectedTrack={selectedTrack}
                    onTrackSelect={() => {}} // Disabled for participants
                    onReorder={() => {}} // Disabled for participants
                    onDeleteTracks={() => {}} // Disabled for participants
                    isHost={false}
                    maxTracks={20}
                  />
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Sidebar */}
          <div className={`${mobileTab === 'player' ? 'hidden' : ''} lg:block space-y-6`}>
            {/* 🎥 Desktop : Live Visio à côté de la vidéo partagée (en haut de la colonne de droite) */}
            {liveMode && sessionId && isDesktop && liveVisioNode}

            {/* Session Info — Item 2 : repliable */}
            <Card className="bt-tab-access border-white/10 bg-white/5">
              <CardHeader className="p-0">
                <button
                  type="button"
                  onClick={() => togglePanel('status')}
                  className="w-full flex items-center justify-between gap-2 px-6 py-4 text-left"
                  aria-expanded={panelOpen.status}
                  data-testid="panel-status-toggle"
                >
                  <CardTitle className="text-white text-lg flex items-center gap-2">
                    <span className="relative flex h-3 w-3">
                      <span
                        className={`absolute inline-flex h-full w-full rounded-full opacity-75 ${
                          syncState?.isLive ? 'animate-ping' : ''
                        }`}
                        style={{ background: syncState?.isLive ? 'var(--bt-accent)' : '#666' }}
                      />
                      <span
                        className="relative inline-flex rounded-full h-3 w-3"
                        style={{ background: syncState?.isLive ? 'var(--bt-accent)' : '#666' }}
                      />
                    </span>
                    {t('session.status')}
                  </CardTitle>
                  <ChevronDown className={`w-5 h-5 text-white/50 flex-shrink-0 transition-transform ${panelOpen.status ? 'rotate-180' : ''}`} />
                </button>
              </CardHeader>
              {panelOpen.status && (
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
              )}
            </Card>

            {/* 🎧 Audio Mixer Panel - Escamotable sur mobile */}
            <div className="bt-tab-mixer">
            <AudioMixerPanel
              isHost={isHost}
              musicVolume={mixerState.musicVolume}
              micVolume={mixerState.micVolume}
              tribeVolume={mixerState.tribeVolume}
              hostVoiceVolume={mixerState.hostVoiceVolume}
              onMusicVolumeChange={handleMusicVolumeChange}
              onMicVolumeChange={setMicVolume}
              onTribeVolumeChange={handleTribeVolumeChange}
              onHostVoiceVolumeChange={handleHostVoiceVolumeChange}
              timerVolume={mixerState.timerVolume}
              onTimerVolumeChange={handleTimerVolumeChange}
              isMicActive={hostMicActive}
              defaultCollapsed={!isDesktop}
              isVideoShared={isVideoShared}
              remoteMicSliders={remoteMicSliders}
              onRemoteMicVolumeChange={handleRemoteMicVolumeChange}
              participantMicActive={isTalking}
              participantMicVolume={(participantMic.state.volume ?? 100) / 100}
              onParticipantMicToggle={handleToggleTalk}
              onParticipantMicVolumeChange={(v) => participantMic.setVolume(Math.round(v * 100))}
            />
            </div>

            {/* Participants — rétractable si la liste dépasse 5 personnes (aération). */}
            <Card className="bt-tab-access border-white/10 bg-white/5">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <CardTitle className="text-white text-lg">
                      Participants ({participants.length})
                    </CardTitle>
                    {isHost && (
                      <CardDescription className="text-white/50 text-xs">
                        Contrôlez le volume de chaque participant
                      </CardDescription>
                    )}
                  </div>
                  {participants.length > 5 && (
                    <button
                      type="button"
                      onClick={() => setParticipantsCollapsed((v) => !v)}
                      aria-expanded={!participantsCollapsed}
                      data-testid="participants-toggle"
                      className="flex-shrink-0 flex items-center gap-1 px-2 py-1 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors text-xs"
                    >
                      {participantsCollapsed ? 'Afficher' : 'Réduire'}
                      <ChevronDown className={`w-4 h-4 transition-transform duration-300 ${participantsCollapsed ? '' : 'rotate-180'}`} />
                    </button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="pt-0 space-y-2">
                {/* 🎙️ POINT 3 : bandeau "conversation privée" + retour à tous (hôte) */}
                {isHost && privateTargets.size > 0 && (
                  <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-lg bg-[rgb(var(--bt-accent-rgb)/0.15)] border border-[rgb(var(--bt-accent-rgb)/0.3)]">
                    <span className="flex items-center gap-1.5 text-[var(--bt-accent)] text-xs min-w-0">
                      <Mic className="w-3.5 h-3.5 flex-shrink-0" />
                      <span className="truncate">Conversation privée — {privateTargets.size} participant{privateTargets.size > 1 ? 's' : ''}</span>
                    </span>
                    <button
                      onClick={handleTalkToAll}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-white/10 text-white text-xs font-medium hover:bg-white/20 flex-shrink-0"
                      data-testid="talk-to-all-btn"
                    >
                      <Volume2 className="w-3.5 h-3.5" /> Parler à tous
                    </button>
                  </div>
                )}
                {/* >5 participants : scroll interne + rétractable (monté en permanence). */}
                <div className={`${participants.length > 5 ? 'max-h-96 overflow-y-auto -mr-1 pr-1' : ''} ${participantsCollapsed ? 'hidden' : ''}`}>
                  <ParticipantControls
                    participants={participants}
                    isHost={isHost}
                    onVolumeChange={handleParticipantVolumeChange}
                    onMuteToggle={handleParticipantMuteToggle}
                    onEject={handleParticipantEject}
                    onToggleCoHost={isHost ? handleToggleCoHost : undefined}
                    privateTargetIds={privateTargets}
                    onTogglePrivate={isHost ? handleTogglePrivateTalk : undefined}
                    micActiveIds={micActiveIds}
                    onToggleHostMic={isHost ? handleToggleHostMic : undefined}
                    theme={theme}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Item 8 : Likes + commentaires de session (temps réel) */}
            {sessionId && <div className="bt-tab-access"><SessionSocial sessionId={sessionId} /></div>}

            {/* Instructions — Item 2 : repliable */}
            <Card className="bt-tab-access border-white/10 bg-white/5">
              <CardHeader className="p-0">
                <button
                  type="button"
                  onClick={() => togglePanel('instructions')}
                  className="w-full flex items-center justify-between gap-2 px-6 py-4 text-left"
                  aria-expanded={panelOpen.instructions}
                  data-testid="panel-instructions-toggle"
                >
                  <CardTitle className="flex items-center gap-2 text-white text-lg">
                    <Lightbulb className="w-5 h-5 text-[var(--bt-accent)]" />
                    {t('session.instructions')}
                  </CardTitle>
                  <ChevronDown className={`w-5 h-5 text-white/50 flex-shrink-0 transition-transform ${panelOpen.instructions ? 'rotate-180' : ''}`} />
                </button>
              </CardHeader>
              {panelOpen.instructions && (
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
              )}
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

      {/* 🙋 HÔTE — demandes d'accès gratuit (temps réel) : Approuver / Refuser */}
      {isHost && promoAccessReqs.length > 0 && (
        <div className="fixed top-3 left-1/2 -translate-x-1/2 z-[145] w-[min(92vw,420px)] space-y-2" data-testid="access-requests">
          {promoAccessReqs.map((r) => (
            <div key={r.id} className="flex items-center gap-2 rounded-2xl border border-[rgb(var(--bt-accent-rgb)/0.4)] bg-[#15151b] shadow-2xl px-3 py-2.5">
              <span className="flex-1 min-w-0 text-sm text-white truncate">
                <span className="text-white/50">Demande d'accès : </span><span className="font-medium">{r.requester_name}</span>
              </span>
              <button onClick={() => handleAccessDecision(r.id, true)} className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white" style={{ background: 'linear-gradient(135deg,#16a34a,#22c55e)' }}>Approuver</button>
              <button onClick={() => handleAccessDecision(r.id, false)} className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white/70 border border-white/15 hover:bg-white/10">Refuser</button>
            </div>
          ))}
        </div>
      )}

      {/* ⏱️ Interval training — overlay du décompte (tous) + modale de config (hôte). Additif, isolé.
          onTick : rapport LECTURE SEULE du décompte → rappel affiché dans les plein écran caméra/vidéo
          (UN SEUL émetteur son : ce composant ; les rappels ne font qu'afficher). */}
      <IntervalTimer
        ref={intervalTimerRef}
        run={intervalRun}
        isHost={isHost}
        onStop={handleStopInterval}
        getMixerContext={getMixerContext}
        getTimerOutput={getTimerOutput}
        onTick={setIntervalTick}
      />
      {isHost && intervalConfigTrackId != null && (() => {
        const t = tracks.find((tr) => tr.id === intervalConfigTrackId);
        if (!t) return null;
        const dur = selectedTrack?.id === t.id ? getMusicEl()?.duration : undefined;
        return (
          <IntervalConfigModal
            trackTitle={t.title}
            sessionId={sessionId}
            initial={t.interval}
            musicDuration={dur && isFinite(dur) ? dur : undefined}
            onClose={() => setIntervalConfigTrackId(null)}
            onSave={(cfg) => handleSetInterval(t.id, cfg)}
            onStart={(cfg) => { handleSetInterval(t.id, cfg); handleStartInterval(cfg); }}
            onNotify={showToast}
          />
        );
      })()}
      {/* ⏱️ Chantier C : lancer l'Interval training PENDANT la visio, SANS musique (aucune piste requise). */}
      {isHost && showVisioTimerConfig && (
        <IntervalConfigModal
          trackTitle="Interval training"
          sessionId={sessionId || ''}
          initial={visioTimerConfig || selectedTrack?.interval || intervalRun?.config}
          onClose={() => setShowVisioTimerConfig(false)}
          onSave={(cfg) => persistVisioTimerConfig(cfg)}
          onStart={(cfg) => { persistVisioTimerConfig(cfg); setShowVisioTimerConfig(false); handleStartInterval(cfg); }}
          onNotify={showToast}
        />
      )}

      {/* 🎥 Chantier B : sur mobile, quand une vidéo est partagée ET que le Live est actif (hors plein écran),
          un bouton ouvre les caméras dans une fenêtre flottante PAR-DESSUS la vidéo. En plein écran, les caméras
          sont déjà injectées dans le lecteur (liveCamerasNode) → on ne l'affiche donc pas en double. */}
      {!isDesktop && liveMode && sessionId && sharedMedia && shareMode !== 'audio' && !videoEnlarged && (
        <>
          <button
            onClick={() => setShowMobileCameras((v) => !v)}
            className="fixed bottom-24 right-4 z-[95] flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-semibold text-white shadow-lg"
            style={{ background: 'linear-gradient(135deg,var(--bt-accent),var(--bt-accent-2))' }}
            data-testid="mobile-see-cameras"
          >
            <Video className="w-4 h-4" /> {showMobileCameras ? 'Masquer' : 'Voir'} les caméras
          </button>
          {showMobileCameras && (
            <DraggableWindow title="Caméras live" storageKey="bt_visio_over_video_pos" defaultWidth={240} zClass="z-[96]">
              {liveCamerasNode}
            </DraggableWindow>
          )}
        </>
      )}

      {/* 💬 Lanceur + panneau de CHAT — au niveau page SAUF quand la vidéo est agrandie (alors il est
          rendu À L'INTÉRIEUR du plein écran de la vidéo, cf. SharedMediaPlayer chatNode). */}
      {/* 🐛 BUG 3 : chat porté dans l'élément plein écran (visio) s'il y en a un → visible/utilisable
          par-dessus le plein écran ; sinon dans body (comportement inchangé). Rendu inside video plein écran = SharedMediaPlayer. */}
      {!videoEnlarged && fsChatPortalTarget && createPortal(chatPanelNode, fsChatPortalTarget)}

      {/* 🐛 BUG 5 : demandes de scène PORTÉES dans l'élément plein écran → accepter/refuser/faire descendre
          par-dessus le plein écran (visio ET vidéo partagée), sans quitter le plein écran. */}
      {canShare && stageRequests.length > 0 && stagePanelOpen && isFsActive && fsChatPortalTarget && createPortal(
        <div className="fixed inset-x-2 top-3 z-[125] max-h-[70vh] overflow-y-auto rounded-2xl shadow-2xl shadow-black/40">
          {stageRequestsPanel}
        </div>,
        fsChatPortalTarget,
      )}
    </div>
  );
};

export default SessionPage;
