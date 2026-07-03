import React from 'react';
import { Volume2, VolumeX, X, Mic, Crown, Share2 } from 'lucide-react';
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
  isPrivateTarget?: boolean;
  onTogglePrivate?: (id: string) => void;
  isMicOn?: boolean; // le micro de ce participant est-il actif (parle) en ce moment
  onToggleHostMic?: (id: string, on: boolean) => void; // hôte : donner/couper la parole
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
  isPrivateTarget,
  onTogglePrivate,
  isMicOn,
  onToggleHostMic,
  theme,
}) => {
  const volume = participant.volume ?? 100;
  const isMuted = participant.isMuted ?? false;

  // Don't show moderation controls for current user or host
  const canModerate = isHostView && !participant.isCurrentUser && !participant.isHost;

  return (
    <div
      className={`
        relative flex flex-col gap-2 p-2.5 rounded-lg transition-all
        ${participant.isCurrentUser
          ? 'bg-[#8A2EFF]/10 border border-[#8A2EFF]/30'
          : 'bg-[var(--bt-surface-alpha)] border border-white/10'
        }
      `}
    >
      {/* Ligne 1 : avatar + nom + statut sync */}
      <div className="flex items-center gap-3">
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
          {(participant.isMicActive || isMicOn) && (
            <span className="absolute -bottom-0.5 -right-0.5 p-0.5 rounded-full bg-green-500 border border-black pointer-events-none">
              <Mic size={8} strokeWidth={2} className="text-white" />
            </span>
          )}
        </div>

        {/* Nom + badges */}
        <div className="flex-1 min-w-0">
          <span className={`text-sm truncate block ${isMuted ? 'text-white/40' : 'text-white'}`}>
            {participant.name}
            {participant.isCurrentUser && <span className="text-[#8A2EFF] ml-1">(Vous)</span>}
          </span>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            {participant.isHost && !participant.isCurrentUser && (
              <span className="text-yellow-400 text-xs">Hôte</span>
            )}
            {participant.isCoHost && !participant.isHost && (
              <span className="text-[#8A2EFF] text-xs flex items-center gap-1"><Share2 size={10} /> Co-animateur</span>
            )}
            {isPrivateTarget && (
              <span className="text-pink-400 text-xs flex items-center gap-1"><Mic size={10} /> Privé</span>
            )}
          </div>
        </div>

        {/* Statut de sync */}
        <div
          className={`w-2 h-2 rounded-full flex-shrink-0 ${participant.isSynced ? 'bg-green-400' : 'bg-yellow-400'}`}
          title={participant.isSynced ? 'Synchronisé' : 'En synchronisation...'}
        />
      </div>

      {/* Ligne 2 : actions de modération (hôte) — flex-wrap, passent à la ligne sur mobile */}
      {canModerate && (
        <div className="flex flex-wrap items-center gap-1.5 pl-11">
          {onToggleCoHost && (
            <button
              onClick={() => onToggleCoHost(participant.id, !participant.isCoHost)}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                participant.isCoHost
                  ? 'bg-[#8A2EFF]/20 text-[#8A2EFF] hover:bg-[#8A2EFF]/30'
                  : 'bg-white/10 text-white/70 hover:bg-white/20'
              }`}
              title={participant.isCoHost ? 'Retirer l\'autorisation de partager' : 'Autoriser ce participant à partager'}
              data-testid="cohost-toggle"
            >
              <Share2 size={13} strokeWidth={2} />
              <span>{participant.isCoHost ? 'Retirer partage' : 'Partager'}</span>
            </button>
          )}

          {onTogglePrivate && (
            <button
              onClick={() => onTogglePrivate(participant.id)}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                isPrivateTarget
                  ? 'bg-pink-500/20 text-pink-400 hover:bg-pink-500/30'
                  : 'bg-white/10 text-white/70 hover:bg-white/20'
              }`}
              title={isPrivateTarget ? 'Retirer de la conversation privée' : 'Parler en privé à ce participant'}
              data-testid="private-talk-toggle"
            >
              <Mic size={13} strokeWidth={2} />
              <span>{isPrivateTarget ? 'Privé ✓' : 'Privé'}</span>
            </button>
          )}

          {/* 🎤 Donner la parole / Couper le micro de ce participant (hôte agit à sa place) */}
          {onToggleHostMic && (
            <button
              onClick={() => onToggleHostMic(participant.id, !isMicOn)}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                isMicOn
                  ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
                  : 'bg-white/10 text-white/70 hover:bg-white/20'
              }`}
              title={isMicOn ? 'Couper le micro de ce participant' : 'Donner la parole à ce participant'}
              data-testid="host-mic-toggle"
            >
              <Mic size={13} strokeWidth={2} />
              <span>{isMicOn ? 'Couper le micro' : 'Donner la parole'}</span>
            </button>
          )}

          {/* Couper / réactiver */}
          <button
            onClick={() => onMuteToggle(participant.id)}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              isMuted ? 'bg-red-500/15 text-red-400 hover:bg-red-500/25' : 'bg-white/10 text-white/70 hover:bg-white/20'
            }`}
            title={isMuted ? 'Réactiver' : 'Couper'}
          >
            {isMuted ? <VolumeX size={13} strokeWidth={2} /> : <Volume2 size={13} strokeWidth={2} />}
            <span>{isMuted ? 'Réactiver' : 'Couper'}</span>
          </button>

          {/* Éjecter */}
          <button
            onClick={() => onEject(participant.id)}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-white/10 text-white/50 hover:bg-red-500/20 hover:text-red-400 transition-colors"
            title="Éjecter ce participant"
          >
            <X size={13} strokeWidth={2} />
            <span>Éjecter</span>
          </button>

          {/* Volume du participant (slider) — pleine largeur, passe à la ligne */}
          <div className="flex items-center gap-2 w-full sm:w-auto sm:flex-1 min-w-[140px] px-1">
            <Volume2 size={13} className="text-white/40 flex-shrink-0" />
            <Slider
              value={[isMuted ? 0 : volume]}
              min={0}
              max={250}
              step={5}
              onValueChange={([val]) => onVolumeChange(participant.id, val)}
              className="volume-slider-mini flex-1"
            />
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
  privateTargetIds?: Set<string>;
  onTogglePrivate?: (id: string) => void;
  micActiveIds?: Set<string>; // participants dont le micro est actif (parle)
  onToggleHostMic?: (id: string, on: boolean) => void; // hôte : donner/couper la parole
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
  privateTargetIds,
  onTogglePrivate,
  micActiveIds,
  onToggleHostMic,
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
            isPrivateTarget={privateTargetIds?.has(participant.id)}
            onTogglePrivate={onTogglePrivate}
            isMicOn={micActiveIds?.has(participant.id)}
            onToggleHostMic={onToggleHostMic}
            theme={theme}
          />
        ))}
      </div>
    </ScrollArea>
  );
};

export default ParticipantControls;
