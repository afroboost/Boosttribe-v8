import React, { useState } from 'react';
import { Volume2, VolumeX, X, MoreHorizontal, Mic } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Slider } from '@/components/ui/slider';

export interface Participant {
  id: string;
  name: string;
  avatar: string;
  isSynced: boolean;
  isCurrentUser?: boolean;
  isHost?: boolean;
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
      {/* Avatar */}
      <div 
        className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium text-white relative flex-shrink-0"
        style={{ 
          background: participant.isCurrentUser 
            ? theme.colors.gradient.primary 
            : 'linear-gradient(135deg, #666 0%, #444 100%)',
          opacity: isMuted ? 0.5 : 1,
        }}
      >
        {participant.avatar}
        {participant.isHost && (
          <span className="absolute -top-1 -right-1 text-xs">👑</span>
        )}
        {/* Mic active indicator */}
        {participant.isMicActive && (
          <span className="absolute -bottom-0.5 -right-0.5 p-0.5 rounded-full bg-green-500 border border-black">
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
      </div>

      {/* Sync Status */}
      <div 
        className={`w-2 h-2 rounded-full flex-shrink-0 ${
          participant.isSynced ? 'bg-green-400' : 'bg-yellow-400'
        }`}
        title={participant.isSynced ? 'Synchronisé' : 'En synchronisation...'}
      />

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
                className="absolute right-0 top-full mt-1 z-50 min-w-[120px] rounded-lg border border-white/10 bg-[#14141A]/95 backdrop-blur-xl shadow-xl"
              >
                <button
                  onClick={() => {
                    onEject(participant.id);
                    setShowMenu(false);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 transition-colors rounded-lg"
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
            theme={theme}
          />
        ))}
      </div>
    </ScrollArea>
  );
};

export default ParticipantControls;
