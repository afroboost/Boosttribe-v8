import React, { useState, useCallback, useEffect } from 'react';
import { Mic, MicOff, Volume2, AlertCircle, Wifi, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { VuMeterSegmented } from './VuMeter';
import { useMicrophone } from '@/hooks/useMicrophone';

interface MicrophoneControlProps {
  isHost?: boolean;
  onMicActive?: (active: boolean) => void;
  onAudioLevel?: (level: number) => void;
  onDuckMusic?: (duck: boolean) => void;
  onStreamReady?: (stream: MediaStream | null) => void; // For WebRTC broadcasting
  duckThreshold?: number;
  className?: string;
}

/**
 * Microphone control component with capture, VU meter, and duck effect
 */
export const MicrophoneControl: React.FC<MicrophoneControlProps> = ({
  isHost = false,
  onMicActive,
  onAudioLevel,
  onDuckMusic,
  onStreamReady,
  duckThreshold = 30,
  className = '',
}) => {
  const [isDucking, setIsDucking] = useState(false);
  const [showDevices, setShowDevices] = useState(false);

  // Handle audio level for duck effect
  const handleAudioLevel = useCallback((level: number) => {
    onAudioLevel?.(level);
    
    // Duck effect: lower music when speaking
    if (isHost && onDuckMusic) {
      const shouldDuck = level > duckThreshold;
      if (shouldDuck !== isDucking) {
        setIsDucking(shouldDuck);
        onDuckMusic(shouldDuck);
      }
    }
  }, [isHost, onDuckMusic, duckThreshold, isDucking, onAudioLevel]);

  const {
    state,
    startCapture,
    stopCapture,
    toggleMute,
    setDevice,
    refreshDevices,
    audioStream,
  } = useMicrophone({
    echoCancellation: true,
    noiseSuppression: true,
    onAudioLevel: handleAudioLevel,
  });

  // Notify parent of mic state changes
  useEffect(() => {
    onMicActive?.(state.isCapturing && !state.isMuted);
  }, [state.isCapturing, state.isMuted, onMicActive]);

  // Notify parent of stream changes for WebRTC
  useEffect(() => {
    if (state.isCapturing && !state.isMuted && audioStream) {
      onStreamReady?.(audioStream);
    } else {
      onStreamReady?.(null);
    }
  }, [state.isCapturing, state.isMuted, audioStream, onStreamReady]);

  // Toggle capture
  const handleToggleCapture = useCallback(async () => {
    if (state.isCapturing) {
      stopCapture();
    } else {
      await startCapture();
    }
  }, [state.isCapturing, startCapture, stopCapture]);

  // Refresh devices when expanding
  const handleShowDevices = useCallback(async () => {
    if (!showDevices) {
      await refreshDevices();
    }
    setShowDevices(!showDevices);
  }, [showDevices, refreshDevices]);

  return (
    <div className={`relative ${className}`}>
      <div className="flex items-center gap-2">
        {/* Main Mic Button */}
        <Button
          onClick={handleToggleCapture}
          variant="outline"
          size="sm"
          data-testid="mic-toggle-btn"
          className={`
            relative overflow-hidden transition-all
            ${state.isCapturing
              ? state.isMuted
                ? 'border-red-500/50 text-red-400 bg-red-500/10'
                : 'border-green-500/50 text-green-400 bg-green-500/10'
              : 'border-white/20 text-white/70 hover:bg-white/10'
            }
          `}
        >
          {state.isCapturing ? (
            state.isMuted ? (
              <MicOff size={16} strokeWidth={1.5} />
            ) : (
              <Mic size={16} strokeWidth={1.5} />
            )
          ) : (
            <Mic size={16} strokeWidth={1.5} />
          )}
          <span className="ml-1.5 text-xs">
            {state.isCapturing ? (state.isMuted ? 'Muet' : 'On') : 'Micro'}
          </span>
          
          {/* Active indicator */}
          {state.isCapturing && !state.isMuted && (
            <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
          )}
        </Button>

        {/* Mute button (when capturing) */}
        {state.isCapturing && (
          <button
            onClick={toggleMute}
            data-testid="mic-mute-btn"
            className={`
              p-1.5 rounded transition-all
              ${state.isMuted
                ? 'text-red-400 bg-red-500/10'
                : 'text-white/50 hover:text-white/70 hover:bg-white/10'
              }
            `}
            title={state.isMuted ? 'Réactiver' : 'Couper'}
          >
            {state.isMuted ? (
              <MicOff size={14} strokeWidth={1.5} />
            ) : (
              <Volume2 size={14} strokeWidth={1.5} />
            )}
          </button>
        )}

        {/* VU Meter (when capturing) */}
        {state.isCapturing && !state.isMuted && (
          <VuMeterSegmented 
            level={state.audioLevel} 
            size="sm"
            className="ml-1"
          />
        )}

        {/* Duck indicator */}
        {isDucking && (
          <span className="text-xs text-yellow-400 animate-pulse">
            🔉
          </span>
        )}
      </div>

      {/* Error message */}
      {state.error && (
        <div className="absolute top-full left-0 mt-2 p-2 rounded-lg bg-red-500/10 border border-red-500/30 flex items-center gap-2 whitespace-nowrap z-50">
          <AlertCircle size={14} className="text-red-400" />
          <span className="text-xs text-red-400">{state.error}</span>
        </div>
      )}

      {/* Device selector (optional) */}
      {showDevices && state.devices.length > 0 && (
        <div className="absolute top-full left-0 mt-2 p-2 rounded-lg bg-black/90 border border-white/10 z-50 min-w-[200px]">
          <p className="text-xs text-white/50 mb-2">Sélectionner un micro :</p>
          {state.devices.map(device => (
            <button
              key={device.deviceId}
              onClick={() => {
                setDevice(device.deviceId);
                setShowDevices(false);
              }}
              className={`
                w-full text-left p-2 rounded text-xs transition-colors
                ${device.deviceId === state.deviceId
                  ? 'bg-[#8A2EFF]/20 text-white'
                  : 'text-white/70 hover:bg-white/10'
                }
              `}
            >
              {device.label || `Microphone ${device.deviceId.slice(0, 8)}`}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default MicrophoneControl;
