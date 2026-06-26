import React, { useState } from 'react';
import { Volume2, VolumeX, X, MoreHorizontal, Mic, Crown, Share2 } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Slider } from '@/components/ui/slider';
import { ProfilePhoto } from '@/components/session/ProfilePhoto';

export interface Participant {
  id: string;
  name: string;
  avatar: string;
  avatarUrl?: string;     // Photo de profil (URL ou data URL)
  isSynced: boolean;
  isCurrentUser?: boolean;
  isHost?: boolean;
  isCoHost?: boolean;     // Co-animateur autorisé à partager
  volume?: number;
  isMuted?: boolean;
  isMicActive?: boolean; // Indicates if mic is active
  audioLevel?: number; // For VU meter display
}

interface ParticipantItemProps {
  participant: Participant;
  isHostView: boolean;
  onVolumeChange: (id: string, volume: number) => void;
  onMuteToggle: (id: string) => void;
  onEject: (id: string) => void;
  onToggleCoHost?: (id: string, makeCoHost: boolean) => void;
  theme: {
    colors: {
      gradient: {
        primary: string;
      };
    };
  };
}

const ParticipantItem: React.FC<ParticipantItemProps> = ({
  participant,
  isHostView,
  onVolumeChange,
  onMuteToggle,
  onEject,
  onToggleCoHost,
  theme,
}) => {
  const [showControls, setShowControls] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const volume = participant.volume ?? 100;
  const isMuted = participant.isMuted ?? false;

  // Don't show moderation controls for current user or host
  const canModerate = isHostView && !participant.isCurrentUser && !participant.isHost;

  return (
    <div 
      className={`
        relative flex items-center gap-3 p-2 rounded-lg transition-all
        ${participant.isCurrentUser 
          ? 'bg-[#8A2EFF]/10 border border-[#8A2EFF]/30' 
          : 'bg-[var(--bt-surface-alpha)] border border-white/10'
        }
      `}
      onMouseEnter={() => setShowControls(true)}
      onMouseLeave={() => {
        setShowControls(false);
        setShowMenu(false);
      }}
    >
      {/* Avatar — photo cliquable (lightbox) si dispo, sinon avatar généré */}
      <div className="relative flex-shrink-0" style={{ opacity: isMuted ? 0.5 : 1 }}>
        {participant.avatarUrl ? (
          <ProfilePhoto url={participant.avatarUrl} name={participant.name} size={32} />
        ) : (
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium text-white overflow-hidden"
            style={{
              background: participant.isCurrentUser
                ? theme.colors.gradient.primary
                : 'linear-gradient(135deg, #666 0%, #444 100%)',
            }}
          >
            {participant.avatar}
          </div>
        )}
        {participant.isHost && (
          <span className="absolute -top-1 -right-1 text-yellow-400 pointer-events-none">
            <Crown size={10} strokeWidth={2} fill="currentColor" />
          </span>
        )}
        {/* Mic active indicator */}
        {participant.isMicActive && (
          <span className="absolute -bottom-0.5 -right-0.5 p-0.5 rounded-full bg-green-500 border border-black pointer-events-none">
            <Mic size={8} strokeWidth={2} className="text-white" />
          </span>
        )}
      </div>

      {/* Name & Status */}
      <div className="flex-1 min-w-0">
        <span className={`text-sm truncate block ${isMuted ? 'text-white/40' : 'text-white'}`}>
          {participant.name}
          {participant.isCurrentUser && (
            <span className="text-[#8A2EFF] ml-1">(Vous)</span>
          )}
        </span>
        {participant.isHost && !participant.isCurrentUser && (
          <span className="text-yellow-400 text-xs">Hôte</span>
        )}
        {participant.isCoHost && !participant.isHost && (
          <span className="text-[#8A2EFF] text-xs flex items-center gap-1"><Share2 size={10} /> Co-animateur</span>
        )}
      </div>

      {/* Sync Status */}
      <div
        className={`w-2 h-2 rounded-full flex-shrink-0 ${
          participant.isSynced ? 'bg-green-400' : 'bg-yellow-400'
        }`}
        title={participant.isSynced ? 'Synchronisé' : 'En synchronisation...'}
      />

      {/* PARTIE 3 : bouton "Autoriser à partager" TOUJOURS visible (y compris mobile, sans survol) */}
      {canModerate && onToggleCoHost && (
        <button
          onClick={() => onToggleCoHost(participant.id, !participant.isCoHost)}
          className={`flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium flex-shrink-0 transition-colors ${
            participant.isCoHost
              ? 'bg-[#8A2EFF]/20 text-[#8A2EFF] hover:bg-[#8A2EFF]/30'
              : 'bg-white/10 text-white/70 hover:bg-white/20'
          }`}
          title={participant.isCoHost ? 'Retirer l\'autorisation de partager' : 'Autoriser ce participant à partager'}
          data-testid="cohost-toggle"
        >
          <Share2 size={13} strokeWidth={2} />
          <span>{participant.isCoHost ? 'Retirer' : 'Partager'}</span>
        </button>
      )}

      {/* Moderation Controls (Host View Only) */}
      {canModerate && (
        <div className={`flex items-center gap-1 transition-opacity ${showControls ? 'opacity-100' : 'opacity-0'}`}>
          {/* Volume Slider (mini) */}
          <div className="w-16 hidden sm:block">
            <Slider
              value={[isMuted ? 0 : volume]}
              min={0}
              max={100}
              step={1}
              onValueChange={([val]) => onVolumeChange(participant.id, val)}
              className="volume-slider-mini"
            />
          </div>

          {/* Mute Toggle */}
          <button
            onClick={() => onMuteToggle(participant.id)}
            className={`p-1.5 rounded transition-colors ${
              isMuted 
                ? 'text-red-400 bg-red-500/10' 
                : 'text-white/40 hover:text-white/70 hover:bg-white/5'
            }`}
            title={isMuted ? 'Réactiver' : 'Couper'}
          >
            {isMuted ? (
              <VolumeX size={14} strokeWidth={1.5} />
            ) : (
              <Volume2 size={14} strokeWidth={1.5} />
            )}
          </button>

          {/* More Menu (contains Eject) */}
          <div className="relative">
            <button
              onClick={() => setShowMenu(!showMenu)}
              className="p-1.5 rounded text-white/30 hover:text-white/60 hover:bg-white/5 transition-colors"
            >
              <MoreHorizontal size={14} strokeWidth={1.5} />
            </button>

            {/* Dropdown Menu */}
            {showMenu && (
              <div
                className="absolute right-0 top-full mt-1 z-50 min-w-[150px] rounded-lg border border-white/10 bg-[#14141A]/95 backdrop-blur-xl shadow-xl overflow-hidden"
              >
                {/* (Le toggle co-animateur est désormais un bouton dédié toujours visible.) */}
                <button
                  onClick={() => {
                    onEject(participant.id);
                    setShowMenu(false);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
                >
                  <X size={14} strokeWidth={1.5} />
                  Éjecter
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

interface ParticipantControlsProps {
  participants: Participant[];
  isHost: boolean;
  onVolumeChange: (id: string, volume: number) => void;
  onMuteToggle: (id: string) => void;
  onEject: (id: string) => void;
  onToggleCoHost?: (id: string, makeCoHost: boolean) => void;
  theme: {
    colors: {
      gradient: {
        primary: string;
      };
    };
  };
}

export const ParticipantControls: React.FC<ParticipantControlsProps> = ({
  participants,
  isHost,
  onVolumeChange,
  onMuteToggle,
  onEject,
  onToggleCoHost,
  theme,
}) => {
  return (
    <ScrollArea className="h-[280px] pr-2 participants-scroll">
      <div className="space-y-2">
        {participants.map((participant) => (
          <ParticipantItem
            key={participant.id}
            participant={participant}
            isHostView={isHost}
            onVolumeChange={onVolumeChange}
            onMuteToggle={onMuteToggle}
            onEject={onEject}
            onToggleCoHost={onToggleCoHost}
            theme={theme}
          />
        ))}
      </div>
    </ScrollArea>
  );
};

export default ParticipantControls;
