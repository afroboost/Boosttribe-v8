import React, { useEffect, useCallback, useState, useRef } from 'react';
import { Repeat, Repeat1 } from 'lucide-react';
import { useAudioSync, AudioState, SyncState, RepeatMode } from '@/hooks/useAudioSync';

// Format time helper
function formatTime(seconds: number): string {
  if (isNaN(seconds) || !isFinite(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Props interface
interface AudioPlayerProps {
  src?: string;
  title?: string;
  artist?: string;
  coverArt?: string;
  isHost?: boolean;
  sessionId?: string | null;
  onStateChange?: (state: AudioState) => void;
  onSyncUpdate?: (syncState: SyncState) => void;
  onTrackEnded?: () => void;
  onRepeatModeChange?: (mode: RepeatMode) => void;
  className?: string;
  disabled?: boolean;
}

export const AudioPlayer: React.FC<AudioPlayerProps> = ({
  src,
  title = 'Titre inconnu',
  artist = 'Artiste inconnu',
  coverArt,
  isHost = true,
  sessionId = null,
  onStateChange,
  onSyncUpdate,
  onTrackEnded,
  onRepeatModeChange,
  className = '',
  disabled = false,
}) => {
  const {
    audioRef,
    audioState,
    syncState,
    repeatMode,
    cycleRepeatMode,
    play,
    pause,
    seek,
    setVolume,
    toggleMute,
    getTimestamp,
    startLiveSession,
    endLiveSession,
    loadAudio,
  } = useAudioSync({ isHost, sessionId, onStateChange, onSyncUpdate, onTrackEnded });

  const [showVolume, setShowVolume] = useState(false);
  const isFirstRender = useRef(true);

  // Notify parent of repeat mode changes (skip initial render)
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    onRepeatModeChange?.(repeatMode);
  }, [repeatMode, onRepeatModeChange]);

  // Load audio when src changes
  useEffect(() => {
    if (src) {
      loadAudio(src);
    }
  }, [src, loadAudio]);

  // Handle play/pause toggle
  const handlePlayPause = useCallback(async () => {
    if (!isHost || disabled) return;
    
    if (audioState.isPlaying) {
      pause();
    } else {
      await play();
    }
  }, [isHost, audioState.isPlaying, play, pause, disabled]);

  // Handle progress bar click/drag
  const handleProgressClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!isHost || !audioState.duration || disabled) return;
    
    const rect = e.currentTarget.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    const newTime = percent * audioState.duration;
    seek(newTime);
  }, [isHost, audioState.duration, seek, disabled]);

  // Handle volume change
  const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setVolume(parseFloat(e.target.value));
  }, [setVolume]);

  // Calculate progress percentage
  const progressPercent = audioState.duration > 0 
    ? (audioState.currentTime / audioState.duration) * 100 
    : 0;

  // Volume icon based on level
  const VolumeIcon = () => {
    if (audioState.isMuted || audioState.volume === 0) {
      return (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
        </svg>
      );
    }
    if (audioState.volume < 0.5) {
      return (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
        </svg>
      );
    }
    return (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
      </svg>
    );
  };

  return (
    <div 
      className={`relative rounded-2xl overflow-hidden ${className}`}
      style={{
        background: 'rgba(20, 20, 25, 0.95)',
        backdropFilter: 'blur(20px)',
        border: '1px solid rgba(255,255,255,0.1)',
      }}
    >
      {/* Hidden audio element */}
      <audio ref={audioRef} preload="metadata" />

      {/* Live/Sync Badge */}
      {syncState.isLive && (
        <div className="absolute top-4 right-4 z-10">
          <div 
            className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium"
            style={{
              background: 'rgba(138, 46, 255, 0.2)',
              border: '1px solid rgba(138, 46, 255, 0.4)',
              color: '#8A2EFF',
            }}
          >
            <span className="relative flex h-2 w-2">
              <span 
                className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
                style={{ background: '#8A2EFF' }}
              />
              <span 
                className="relative inline-flex rounded-full h-2 w-2"
                style={{ background: '#8A2EFF' }}
              />
            </span>
            {isHost ? 'LIVE' : 'SYNC'}
          </div>
        </div>
      )}

      {/* Player Content */}
      <div className="p-6">
        {/* Track Info */}
        <div className="flex items-center gap-4 mb-6">
          {/* Cover Art */}
          <div 
            className="w-20 h-20 rounded-xl flex-shrink-0 flex items-center justify-center overflow-hidden"
            style={{
              background: coverArt 
                ? `url(${coverArt}) center/cover`
                : 'linear-gradient(135deg, #8A2EFF 0%, #FF2FB3 100%)',
            }}
          >
            {!coverArt && (
              <svg className="w-10 h-10 text-white/80" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
              </svg>
            )}
          </div>

          {/* Title & Artist */}
          <div className="flex-1 min-w-0">
            <h3 
              className="text-lg font-semibold text-white truncate"
              style={{ fontFamily: "'Space Grotesk', sans-serif" }}
            >
              {title}
            </h3>
            <p className="text-white/60 text-sm truncate">{artist}</p>
            
            {/* Participant Mode Indicator */}
            {!isHost && (
              <div className="flex items-center gap-1.5 mt-2">
                <svg className="w-3.5 h-3.5 text-white/40" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z"/>
                </svg>
                <span className="text-xs text-white/40">Mode écoute</span>
              </div>
            )}
          </div>
        </div>

        {/* Progress Bar */}
        <div className="mb-4">
          <div 
            className={`relative h-2 rounded-full overflow-hidden ${isHost ? 'cursor-pointer' : 'cursor-default'}`}
            style={{ background: 'rgba(255,255,255,0.1)' }}
            onClick={handleProgressClick}
          >
            {/* Buffered */}
            <div 
              className="absolute inset-y-0 left-0 rounded-full"
              style={{ 
                width: `${progressPercent}%`,
                background: 'rgba(255,255,255,0.2)',
              }}
            />
            {/* Progress */}
            <div 
              className="absolute inset-y-0 left-0 rounded-full transition-all duration-100"
              style={{ 
                width: `${progressPercent}%`,
                background: 'linear-gradient(90deg, #8A2EFF 0%, #FF2FB3 100%)',
              }}
            />
            {/* Thumb */}
            {isHost && (
              <div 
                className="absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full shadow-lg transition-transform hover:scale-110"
                style={{ 
                  left: `calc(${progressPercent}% - 8px)`,
                  background: '#FFFFFF',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                }}
              />
            )}
          </div>
          
          {/* Time Display */}
          <div className="flex justify-between mt-2 text-xs text-white/50">
            <span>{formatTime(audioState.currentTime)}</span>
            <span>{formatTime(audioState.duration)}</span>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center justify-between">
          {/* Left: Volume + Repeat */}
          <div className="relative flex items-center gap-1">
            {/* Volume Button */}
            <button
              onClick={toggleMute}
              onMouseEnter={() => setShowVolume(true)}
              className="p-2 text-white/60 hover:text-white transition-colors"
              data-testid="volume-btn"
            >
              <VolumeIcon />
            </button>
            
            {/* Volume Slider */}
            <div 
              className={`absolute left-10 flex items-center transition-all duration-200 ${
                showVolume ? 'opacity-100 visible' : 'opacity-0 invisible'
              }`}
              onMouseEnter={() => setShowVolume(true)}
              onMouseLeave={() => setShowVolume(false)}
            >
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={audioState.isMuted ? 0 : audioState.volume}
                onChange={handleVolumeChange}
                className="w-20 h-1 rounded-full appearance-none cursor-pointer"
                style={{
                  background: `linear-gradient(to right, #8A2EFF ${audioState.volume * 100}%, rgba(255,255,255,0.2) ${audioState.volume * 100}%)`,
                }}
              />
            </div>
            
            {/* Repeat Button (Host only) */}
            {isHost && (
              <button
                onClick={cycleRepeatMode}
                className={`p-2 transition-colors ${
                  repeatMode === 'none' 
                    ? 'text-white/40 hover:text-white/60' 
                    : 'text-[#8A2EFF] hover:text-[#FF2FB3]'
                }`}
                title={
                  repeatMode === 'none' ? 'Répétition désactivée' :
                  repeatMode === 'one' ? 'Répéter ce titre' :
                  'Répéter la playlist'
                }
                data-testid="repeat-btn"
              >
                {repeatMode === 'one' ? (
                  <Repeat1 size={18} strokeWidth={2} />
                ) : (
                  <Repeat size={18} strokeWidth={repeatMode === 'all' ? 2.5 : 1.5} />
                )}
              </button>
            )}
          </div>

          {/* Center: Play/Pause */}
          <button
            onClick={handlePlayPause}
            disabled={!isHost || audioState.isLoading}
            className={`
              w-14 h-14 rounded-full flex items-center justify-center
              transition-all duration-200 
              ${isHost ? 'hover:scale-105 active:scale-95' : 'opacity-50 cursor-not-allowed'}
            `}
            style={{
              background: 'linear-gradient(135deg, #8A2EFF 0%, #FF2FB3 100%)',
              boxShadow: '0 4px 24px rgba(138, 46, 255, 0.4)',
            }}
          >
            {audioState.isLoading || audioState.isBuffering ? (
              <svg className="w-6 h-6 text-white animate-spin" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            ) : audioState.isPlaying ? (
              <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/>
              </svg>
            ) : (
              <svg className="w-6 h-6 text-white ml-1" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z"/>
              </svg>
            )}
          </button>

          {/* Right: Live Toggle (Host) or Timestamp (Participant) */}
          <div className="flex items-center gap-2">
            {isHost ? (
              <button
                onClick={syncState.isLive ? endLiveSession : startLiveSession}
                className={`
                  px-4 py-2 rounded-full text-xs font-medium transition-all
                  ${syncState.isLive 
                    ? 'bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30'
                    : 'bg-white/10 text-white/70 border border-white/20 hover:bg-white/20'
                  }
                `}
              >
                {syncState.isLive ? 'Arrêter' : 'Go Live'}
              </button>
            ) : (
              <div className="text-xs text-white/40">
                <span className="font-mono">{getTimestamp()}ms</span>
              </div>
            )}
          </div>
        </div>

        {/* Error Display */}
        {audioState.error && (
          <div className="mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
            ⚠️ {audioState.error}
          </div>
        )}
      </div>

      {/* Waveform Visualization (decorative) */}
      <div className="h-12 px-6 pb-4 flex items-end justify-center gap-0.5">
        {Array.from({ length: 40 }).map((_, i) => {
          const height = audioState.isPlaying 
            ? 20 + Math.sin((Date.now() / 100) + i * 0.5) * 15
            : 8;
          return (
            <div
              key={i}
              className="w-1 rounded-full transition-all duration-150"
              style={{
                height: `${height}px`,
                background: `linear-gradient(to top, #8A2EFF, #FF2FB3)`,
                opacity: audioState.isPlaying ? 0.8 : 0.3,
              }}
            />
          );
        })}
      </div>
    </div>
  );
};

export default AudioPlayer;
