import React, { useState } from 'react';
import { Volume2, Mic, MicOff, Users, Headphones, ChevronDown, ChevronUp, Music, Video } from 'lucide-react';

/**
 * 🎚️ AUDIO MIXER PANEL - Boosttribe V8 Stable Gold
 * 
 * Panneau de mixage avec sliders indépendants :
 * - Host: Volume Musique (80%), Mon Micro (100%), Volume Tribu (100%)
 * - Participant: Volume Musique (80%), Volume Hôte (100%)
 * 
 * Optimisé mobile : escamotable + touch-friendly
 */

interface MixerSliderProps {
  label: string;
  icon: React.ReactNode;
  value: number;
  onChange: (value: number) => void;
  color?: string;
  disabled?: boolean;
  compact?: boolean;
  maxValue?: number; // 🔊 P4 : plafond du curseur (1 = 100%, 2.5 = 250% pour amplifier les voix)
}

const MixerSlider: React.FC<MixerSliderProps> = ({
  label,
  icon,
  value,
  onChange,
  color = '#8A2EFF',
  disabled = false,
  compact = false,
  maxValue = 1,
}) => {
  const percentage = Math.round(value * 100);
  const fill = Math.min(100, Math.round((value / maxValue) * 100)); // remplissage visuel (0..100%)

  return (
    <div className={`flex items-center gap-2 sm:gap-3 ${disabled ? 'opacity-50' : ''}`}>
      {/* Icon - Touch-friendly size */}
      <div 
        className={`${compact ? 'w-7 h-7' : 'w-8 h-8'} rounded-lg flex items-center justify-center flex-shrink-0`}
        style={{ backgroundColor: `${color}20` }}
      >
        <span style={{ color }}>{icon}</span>
      </div>
      
      {/* Label & Value */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1">
          <span className={`${compact ? 'text-[10px]' : 'text-xs'} text-white/70 truncate`}>{label}</span>
          <span className={`${compact ? 'text-[10px]' : 'text-xs'} font-mono text-white/50`}>{percentage}%</span>
        </div>
        
        {/* Slider - Touch-friendly height (min 44px touch target) */}
        <input
          type="range"
          min="0"
          max={maxValue}
          step="0.01"
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          disabled={disabled}
          className={`w-full ${compact ? 'h-2' : 'h-2.5'} rounded-full appearance-none cursor-pointer disabled:cursor-not-allowed touch-manipulation`}
          style={{
            background: `linear-gradient(to right, ${color} ${fill}%, rgba(255,255,255,0.1) ${fill}%)`,
            // Touch-friendly: larger touch target
            padding: '8px 0',
            margin: '-8px 0',
          }}
          data-testid={`mixer-slider-${label.toLowerCase().replace(/\s/g, '-')}`}
        />
      </div>
    </div>
  );
};

interface AudioMixerPanelProps {
  isHost: boolean;
  musicVolume: number;
  micVolume: number;
  tribeVolume: number;
  hostVoiceVolume: number;
  onMusicVolumeChange: (volume: number) => void;
  onMicVolumeChange: (volume: number) => void;
  onTribeVolumeChange: (volume: number) => void;
  onHostVoiceVolumeChange: (volume: number) => void;
  isMicActive?: boolean;
  className?: string;
  defaultCollapsed?: boolean;
  isVideoShared?: boolean; // si une vidéo est partagée → le 1er curseur devient "Volume Vidéo"
  // POINT 2 : un curseur par AUTRE participant présent (toujours visible) ; micActive = parle en ce moment
  remoteMicSliders?: { userId: string; name: string; volume: number; micActive: boolean }[];
  onRemoteMicVolumeChange?: (userId: string, volume: number) => void;
  // POINT 1 (participant) : "Mon micro" — activer/couper + gain d'entrée
  participantMicActive?: boolean;
  participantMicVolume?: number;
  onParticipantMicToggle?: () => void;
  onParticipantMicVolumeChange?: (volume: number) => void;
}

export const AudioMixerPanel: React.FC<AudioMixerPanelProps> = ({
  isHost,
  musicVolume,
  micVolume,
  tribeVolume,
  hostVoiceVolume,
  onMusicVolumeChange,
  onMicVolumeChange,
  onTribeVolumeChange,
  onHostVoiceVolumeChange,
  isMicActive = false,
  className = '',
  defaultCollapsed = false,
  isVideoShared = false,
  remoteMicSliders = [],
  onRemoteMicVolumeChange,
  participantMicActive = false,
  participantMicVolume = 1,
  onParticipantMicToggle,
  onParticipantMicVolumeChange,
}) => {
  // 📱 Mobile: Panneau escamotable par défaut sur mobile
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);
  
  return (
    <div 
      className={`rounded-xl border border-white/10 bg-white/5 backdrop-blur-sm ${className}`}
      data-testid="audio-mixer-panel"
    >
      {/* Header - Cliquable pour expand/collapse */}
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="w-full px-3 sm:px-4 py-2.5 sm:py-3 border-b border-white/10 flex items-center justify-between hover:bg-white/5 transition-colors"
        data-testid="mixer-toggle"
      >
        <div className="flex items-center gap-2">
          <div 
            className="w-5 h-5 sm:w-6 sm:h-6 rounded-md flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #8A2EFF 0%, #FF2FB3 100%)' }}
          >
            <Headphones size={12} className="text-white sm:w-3.5 sm:h-3.5" />
          </div>
          <h3 className="text-xs sm:text-sm font-medium text-white">
            Mixeur
          </h3>
          {isHost && (
            <span className="text-[9px] sm:text-[10px] px-1.5 sm:px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-400">
              Hôte
            </span>
          )}
        </div>
        
        {/* Expand/Collapse indicator */}
        <div className="flex items-center gap-2">
          {/* Quick volume indicator when collapsed */}
          {isCollapsed && (
            <span className="flex items-center gap-1 text-[10px] text-white/40 font-mono hidden sm:flex">
              <Music className="w-3 h-3" />
              {Math.round(musicVolume * 100)}%
            </span>
          )}
          {isCollapsed ? (
            <ChevronDown size={16} className="text-white/50" />
          ) : (
            <ChevronUp size={16} className="text-white/50" />
          )}
        </div>
      </button>
      
      {/* Sliders - Escamotable */}
      {!isCollapsed && (
        <div className="p-3 sm:p-4 space-y-3 sm:space-y-4">
          {/* Volume Musique → "Volume Vidéo" si une vidéo est partagée */}
          <MixerSlider
            label={isVideoShared ? 'Volume Vidéo' : 'Volume Musique'}
            icon={isVideoShared ? <Video size={14} className="sm:w-4 sm:h-4" /> : <Volume2 size={14} className="sm:w-4 sm:h-4" />}
            value={musicVolume}
            onChange={onMusicVolumeChange}
            color="#8A2EFF"
            compact={true}
          />
          
          {isHost ? (
            <>
              {/* Mon Micro - Host only */}
              <MixerSlider
                label="Mon Micro"
                icon={<Mic size={14} className="sm:w-4 sm:h-4" />}
                value={micVolume}
                onChange={onMicVolumeChange}
                color="#10B981"
                disabled={!isMicActive}
                compact={true}
              />
              
              {/* Volume Tribu - Host only — amplifiable jusqu'à 250% (au-dessus de la musique) */}
              <MixerSlider
                label="Volume Tribu"
                icon={<Users size={14} className="sm:w-4 sm:h-4" />}
                value={tribeVolume}
                onChange={onTribeVolumeChange}
                color="#F59E0B"
                compact={true}
                maxValue={2.5}
              />
            </>
          ) : (
            /* Participant : Mon micro + Volume Hôte + voix des autres participants */
            <>
              {/* POINT 1 : "Mon micro" — bouton activer/couper + gain d'entrée */}
              {onParticipantMicToggle && (
                <div className="space-y-2">
                  <button
                    onClick={onParticipantMicToggle}
                    className={`w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
                      participantMicActive
                        ? 'bg-green-500/20 text-green-400 border border-green-500/40 hover:bg-green-500/30'
                        : 'bg-white/10 text-white/70 border border-white/15 hover:bg-white/20'
                    }`}
                    data-testid="participant-mic-toggle"
                  >
                    {participantMicActive ? <Mic size={14} /> : <MicOff size={14} />}
                    {participantMicActive ? 'Mon micro : actif (couper)' : 'Activer mon micro'}
                  </button>
                  {participantMicActive && onParticipantMicVolumeChange && (
                    <MixerSlider
                      label="Mon micro"
                      icon={<Mic size={14} className="sm:w-4 sm:h-4" />}
                      value={participantMicVolume}
                      onChange={onParticipantMicVolumeChange}
                      color="#10B981"
                      compact={true}
                    />
                  )}
                </div>
              )}

              <MixerSlider
                label="Volume Hôte"
                icon={<Volume2 size={14} className="sm:w-4 sm:h-4" />}
                value={hostVoiceVolume}
                onChange={onHostVoiceVolumeChange}
                color="#8A2EFF"
                compact={true}
              />

              {/* POINT 2 : un curseur par AUTRE participant présent, TOUJOURS visible (scrollable mobile) */}
              {remoteMicSliders.length > 0 && onRemoteMicVolumeChange && (
                <div className="pt-2 mt-1 border-t border-white/10 space-y-2.5 sm:space-y-3 max-h-44 overflow-y-auto pr-0.5">
                  <p className="text-[10px] uppercase tracking-wider text-white/30">Voix des participants</p>
                  {remoteMicSliders.map((s) => (
                    <MixerSlider
                      key={s.userId}
                      label={`Volume — ${s.name}`}
                      icon={s.micActive
                        ? <Mic size={14} className="sm:w-4 sm:h-4" />
                        : <MicOff size={14} className="sm:w-4 sm:h-4 text-white/30" />}
                      value={s.volume}
                      onChange={(v) => onRemoteMicVolumeChange(s.userId, v)}
                      color={s.micActive ? '#FF2FB3' : '#666'}
                      compact={true}
                      maxValue={2.5}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
      
      {/* Info footer - Compact on mobile */}
      {!isCollapsed && (
        <div className="px-3 sm:px-4 pb-2 sm:pb-3">
          <p className="flex items-center justify-center gap-1.5 text-[9px] sm:text-[10px] text-white/40 text-center">
            <Headphones className="w-3 h-3" />
            {isHost
              ? 'Canaux indépendants'
              : 'Ajustez selon vos préférences'
            }
          </p>
        </div>
      )}
    </div>
  );
};

export default AudioMixerPanel;
