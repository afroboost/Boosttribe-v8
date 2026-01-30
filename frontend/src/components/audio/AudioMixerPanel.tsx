import React from 'react';
import { Volume2, Mic, Users, Headphones } from 'lucide-react';

/**
 * 🎚️ AUDIO MIXER PANEL - Boosttribe v8
 * 
 * Panneau de mixage avec sliders indépendants pour :
 * - Host: Volume Musique, Mon Micro, Volume Tribu
 * - Participant: Volume Musique, Volume Hôte
 */

interface MixerSliderProps {
  label: string;
  icon: React.ReactNode;
  value: number;
  onChange: (value: number) => void;
  color?: string;
  disabled?: boolean;
}

const MixerSlider: React.FC<MixerSliderProps> = ({
  label,
  icon,
  value,
  onChange,
  color = '#8A2EFF',
  disabled = false,
}) => {
  const percentage = Math.round(value * 100);
  
  return (
    <div className={`flex items-center gap-3 ${disabled ? 'opacity-50' : ''}`}>
      {/* Icon */}
      <div 
        className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{ backgroundColor: `${color}20` }}
      >
        <span style={{ color }}>{icon}</span>
      </div>
      
      {/* Label & Value */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-white/70 truncate">{label}</span>
          <span className="text-xs font-mono text-white/50">{percentage}%</span>
        </div>
        
        {/* Slider */}
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          disabled={disabled}
          className="w-full h-1.5 rounded-full appearance-none cursor-pointer disabled:cursor-not-allowed"
          style={{
            background: `linear-gradient(to right, ${color} ${percentage}%, rgba(255,255,255,0.1) ${percentage}%)`,
          }}
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
}) => {
  return (
    <div 
      className={`rounded-xl border border-white/10 bg-white/5 backdrop-blur-sm ${className}`}
      data-testid="audio-mixer-panel"
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/10">
        <div className="flex items-center gap-2">
          <div 
            className="w-6 h-6 rounded-md flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #8A2EFF 0%, #FF2FB3 100%)' }}
          >
            <Headphones size={14} className="text-white" />
          </div>
          <h3 className="text-sm font-medium text-white">
            Mixeur Audio
          </h3>
          {isHost && (
            <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-400">
              Hôte
            </span>
          )}
        </div>
      </div>
      
      {/* Sliders */}
      <div className="p-4 space-y-4">
        {/* Volume Musique - Toujours visible */}
        <MixerSlider
          label="Volume Musique"
          icon={<Volume2 size={16} />}
          value={musicVolume}
          onChange={onMusicVolumeChange}
          color="#8A2EFF"
        />
        
        {isHost ? (
          <>
            {/* Mon Micro - Host only */}
            <MixerSlider
              label="Mon Micro"
              icon={<Mic size={16} />}
              value={micVolume}
              onChange={onMicVolumeChange}
              color="#10B981"
              disabled={!isMicActive}
            />
            
            {/* Volume Tribu - Host only */}
            <MixerSlider
              label="Volume Tribu"
              icon={<Users size={16} />}
              value={tribeVolume}
              onChange={onTribeVolumeChange}
              color="#F59E0B"
            />
          </>
        ) : (
          /* Volume Hôte - Participant only */
          <MixerSlider
            label="Volume Hôte"
            icon={<Mic size={16} />}
            value={hostVoiceVolume}
            onChange={onHostVoiceVolumeChange}
            color="#10B981"
          />
        )}
      </div>
      
      {/* Info */}
      <div className="px-4 pb-3">
        <p className="text-[10px] text-white/40 text-center">
          {isHost 
            ? '🎧 Canaux indépendants - La musique ne se coupe pas quand vous parlez'
            : '🎧 Ajustez les volumes selon vos préférences'
          }
        </p>
      </div>
    </div>
  );
};

export default AudioMixerPanel;
