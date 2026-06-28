import React, { useEffect, useRef } from 'react';
import { Mic, MicOff, VideoOff, Crown } from 'lucide-react';

interface CameraTileProps {
  name: string;
  stream?: MediaStream | null;
  isLocal?: boolean;     // aperçu local → muet + miroir (anti-écho)
  micActive?: boolean;
  isHost?: boolean;
  avatarUrl?: string | null;
  large?: boolean;       // vignette mise en avant (disposition "vidéo en grand")
  onClick?: () => void;          // clic sur la vignette (ex. agrandir/épingler)
  className?: string;            // classes additionnelles sur le conteneur
  topRight?: React.ReactNode;    // emplacement bouton coin haut-droit (ex. Agrandir/Réduire)
}

// Vignette d'une personne : flux vidéo si caméra allumée, sinon initiales (caméra coupée).
export const CameraTile: React.FC<CameraTileProps> = ({
  name, stream, isLocal, micActive, isHost, avatarUrl, large, onClick, className = '', topRight,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const v = videoRef.current;
    if (v && stream && v.srcObject !== stream) {
      v.srcObject = stream;
      v.play().catch(() => { /* autoplay : flux muet, devrait passer */ });
    }
    if (v && !stream) v.srcObject = null;
  }, [stream]);

  const initials = (name || '?').slice(0, 2).toUpperCase();

  return (
    <div
      className={`relative rounded-xl overflow-hidden bg-[#14141A] border border-white/10 ${large ? '' : 'aspect-video'} ${onClick ? 'cursor-pointer' : ''} ${className}`}
      data-testid="camera-tile"
      onClick={onClick}
    >
      {topRight && (
        <div className="absolute top-1.5 right-1.5 z-10" onClick={(e) => e.stopPropagation()}>
          {topRight}
        </div>
      )}
      {stream ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={isLocal}
          className="w-full h-full object-cover bg-black"
          style={isLocal ? { transform: 'scaleX(-1)' } : undefined}
        />
      ) : (
        <div className="w-full h-full min-h-[96px] flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-[#1a1a2e] to-[#0a0a15]">
          {avatarUrl ? (
            <img src={avatarUrl} alt={name} className="w-12 h-12 rounded-full object-cover opacity-80" />
          ) : (
            <div className="w-12 h-12 rounded-full flex items-center justify-center text-white/80 text-sm font-semibold"
              style={{ background: 'linear-gradient(135deg, #8A2EFF 0%, #FF2FB3 100%)' }}>
              {initials}
            </div>
          )}
          <span className="flex items-center gap-1 text-white/30 text-[11px]"><VideoOff className="w-3 h-3" /> Caméra coupée</span>
        </div>
      )}

      {/* Bandeau bas : nom + état micro */}
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 px-2 py-1 bg-gradient-to-t from-black/70 to-transparent">
        <span className="flex items-center gap-1 text-white text-xs font-medium truncate">
          {isHost && <Crown size={11} className="text-yellow-400 flex-shrink-0" fill="currentColor" />}
          <span className="truncate">{name}{isLocal ? ' (vous)' : ''}</span>
        </span>
        <span className={`flex-shrink-0 p-1 rounded-full ${micActive ? 'text-green-400' : 'text-red-400'}`} title={micActive ? 'Micro actif' : 'Micro coupé'}>
          {micActive ? <Mic size={12} /> : <MicOff size={12} />}
        </span>
      </div>
    </div>
  );
};

export default CameraTile;
