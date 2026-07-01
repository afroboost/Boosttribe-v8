import React, { useState, useCallback, useEffect } from 'react';
import { Mic, MicOff, Volume2, AlertCircle, Lock, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { VuMeterSegmented } from './VuMeter';
import { useMicrophone } from '@/hooks/useMicrophone';

interface MicrophoneControlProps {
  isHost?: boolean;
  onMicActive?: (active: boolean) => void;
  onAudioLevel?: (level: number) => void;
  onStreamReady?: (stream: MediaStream | null) => void;
  className?: string;
}

/**
 * Microphone control component
 * Calls getUserMedia DIRECTLY on button click (user gesture required)
 */
export const MicrophoneControl: React.FC<MicrophoneControlProps> = ({
  isHost = false,
  onMicActive,
  onAudioLevel,
  onStreamReady,
  className = '',
}) => {
  const [showDevices, setShowDevices] = useState(false);

  // Handle audio level (no ducking - independent mixer channels)
  const handleAudioLevel = useCallback((level: number) => {
    onAudioLevel?.(level);
  }, [onAudioLevel]);

  const {
    state,
    startCapture,
    stopCapture,
    toggleMute,
    setDevice,
    refreshDevices,
    retryCapture,
    audioStream,
  } = useMicrophone({
    // 🎧 MIXAGE MANUEL STRICT: Désactiver TOUS les traitements audio automatiques
    // L'hôte contrôle tout manuellement via les sliders du mixeur
    echoCancellation: false,   // Désactivé - la musique ne doit pas être étouffée
    noiseSuppression: false,   // Désactivé - mixage manuel uniquement
    autoGainControl: false,    // Désactivé - le niveau est contrôlé par le slider
    onAudioLevel: handleAudioLevel,
  });

  // Notify parent of mic state changes
  useEffect(() => {
    onMicActive?.(state.isCapturing && !state.isMuted);
  }, [state.isCapturing, state.isMuted, onMicActive]);

  // Notify parent of stream changes for WebRTC.
  // 🎤 STABILITÉ : on garde le MÊME flux tant que le micro est capté, INDÉPENDAMMENT du mute. Couper le
  //    micro = track.enabled=false (via toggleMute) → le peer reçoit un flux silencieux SANS renégociation
  //    (avant : envoyer null au mute déclenchait stopBroadcast → renégociation WebRTC fragile qui cassait).
  //    Le flux n'est retiré (null) QUE lorsqu'on arrête réellement la capture.
  useEffect(() => {
    if (state.isCapturing && audioStream) {
      onStreamReady?.(audioStream);
    } else {
      onStreamReady?.(null);
    }
  }, [state.isCapturing, audioStream, onStreamReady]);

  // Toggle capture - DIRECT getUserMedia call on click
  // 🎤 STABILITÉ : on capte le micro UNE SEULE FOIS (au 1er clic), puis On/Off = MUTE/UNMUTE
  //    (track.enabled) sans arrêter la capture ni renégocier le WebRTC → micro fiable à chaque bascule.
  //    (L'arrêt réel de la capture a lieu au démontage / à la sortie de session.)
  const handleToggleCapture = useCallback(async () => {
    if (!state.isCapturing) {
      await startCapture(); // 1re activation : déclenche la permission navigateur
    } else {
      toggleMute();         // bascules suivantes : mute/unmute sans couper le flux
    }
  }, [state.isCapturing, startCapture, toggleMute]);

  // Retry permission
  const handleRetry = useCallback(async () => {
    // Production: log removed
    await retryCapture();
  }, [retryCapture]);

  // Show device selector
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

        {/* VU Meter (when capturing and not muted) */}
        {state.isCapturing && !state.isMuted && (
          <VuMeterSegmented 
            level={state.audioLevel} 
            size="sm"
            className="ml-1"
          />
        )}
      </div>

      {/* Error message with Retry button */}
      {state.error && (
        <div className={`
          absolute top-full left-0 mt-2 p-3 rounded-lg z-50 max-w-xs
          ${state.errorType === 'https' 
            ? 'bg-yellow-500/10 border border-yellow-500/30' 
            : 'bg-red-500/10 border border-red-500/30'
          }
        `}>
          <div className="flex items-start gap-2">
            {state.errorType === 'permission' ? (
              <Lock size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
            ) : state.errorType === 'https' ? (
              <Lock size={16} className="text-yellow-400 flex-shrink-0 mt-0.5" />
            ) : (
              <AlertCircle size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
            )}
            <div className="flex-1">
              <span className={`text-xs ${state.errorType === 'https' ? 'text-yellow-400' : 'text-red-400'}`}>
                {state.error}
              </span>
              
              {/* Retry button */}
              {state.canRetry && (
                <button
                  onClick={handleRetry}
                  className="mt-2 flex items-center gap-1.5 px-3 py-1.5 rounded bg-white/10 hover:bg-white/20 text-white/80 text-xs transition-colors"
                  data-testid="mic-retry-btn"
                >
                  <RefreshCw size={12} />
                  Réessayer la permission
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Device selector */}
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
