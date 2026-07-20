import React from 'react';
import { Mic, MicOff, Video, VideoOff, Hand, Timer, Minimize2, MessageCircle } from 'lucide-react';

/**
 * 🎛️ Barre de contrôles VERTICALE (façon TikTok/Reels) ancrée à droite, réutilisée dans TOUS les
 *    plein écran (Live Visio ET vidéo partagée) : Micro, Caméra/scène, Interval, Chat, (Réduire).
 *    Boutons ronds, accent --bt-accent, safe-area. 100 % piloté par les props du parent (SessionPage)
 *    → aucun nouveau comportement, juste rendre les contrôles ATTEIGNABLES en plein écran.
 */
export interface VisioControlBarProps {
  micActive?: boolean;
  onToggleMic?: () => void;
  cameraOn?: boolean;
  canManageStage?: boolean;
  onToggleCamera?: () => void;
  onRequestStage?: () => void;
  stageRequestPending?: boolean;
  onStartTimer?: () => void;
  onOpenChat?: () => void;
  chatUnread?: number;
  onToggleStageRequests?: () => void; // 🙋 gestion de scène (demandes de prise de caméra)
  stageRequestCount?: number;
  onReduce?: () => void; // bouton « Réduire » (plein écran caméra) — optionnel
}

const ROUND = 'w-12 h-12 rounded-full flex items-center justify-center shadow-lg transition-colors';
const DARK = 'bg-black/50 text-white/90 hover:bg-black/70';
const GREEN = 'bg-green-500/40 text-green-100 hover:bg-green-500/50';
const ACCENT = 'bg-[rgb(var(--bt-accent-rgb)/0.4)] text-[var(--bt-accent)] hover:bg-[rgb(var(--bt-accent-rgb)/0.5)]';

export const VisioControlBar: React.FC<VisioControlBarProps> = ({
  micActive, onToggleMic, cameraOn, canManageStage, onToggleCamera, onRequestStage,
  stageRequestPending, onStartTimer, onOpenChat, chatUnread,
  onToggleStageRequests, stageRequestCount, onReduce,
}) => {
  return (
    <div
      className="absolute z-[115] flex flex-col items-center gap-3 top-1/2 -translate-y-1/2"
      style={{ right: 'max(0.75rem, env(safe-area-inset-right))' }}
      data-testid="visio-fs-controls"
    >
      {/* 🎤 Micro (même handler que hors plein écran) */}
      {onToggleMic && (
        <button
          onClick={onToggleMic}
          className={`${ROUND} ${micActive ? GREEN : DARK}`}
          title={micActive ? 'Couper le micro' : 'Activer le micro'}
          aria-label={micActive ? 'Couper le micro' : 'Activer le micro'}
          data-testid="visio-fs-mic"
        >
          {micActive ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
        </button>
      )}

      {/* 🎥 Caméra / scène — hôte : on/off ; spectateur à l'écran : descendre ; spectateur : monter. */}
      {onToggleCamera && (canManageStage ? (
        <button
          onClick={onToggleCamera}
          className={`${ROUND} ${cameraOn ? ACCENT : DARK}`}
          title={cameraOn ? 'Couper la caméra' : 'Allumer la caméra'}
          aria-label={cameraOn ? 'Couper la caméra' : 'Allumer la caméra'}
          data-testid="visio-fs-camera"
        >
          {cameraOn ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
        </button>
      ) : cameraOn ? (
        <button
          onClick={onToggleCamera}
          className={`${ROUND} ${ACCENT}`}
          title="Descendre de la scène"
          aria-label="Descendre de la scène"
          data-testid="visio-fs-camera"
        >
          <VideoOff className="w-5 h-5" />
        </button>
      ) : onRequestStage ? (
        <button
          onClick={onRequestStage}
          disabled={stageRequestPending}
          className={`${ROUND} ${DARK} disabled:opacity-60`}
          title={stageRequestPending ? 'Demande envoyée…' : 'Monter en vidéo'}
          aria-label={stageRequestPending ? 'Demande envoyée' : 'Monter en vidéo'}
          data-testid="visio-fs-stage"
        >
          <Hand className="w-5 h-5" />
        </button>
      ) : null)}

      {/* 🙋 Demandes de scène (hôte/co-hôte) — badge = nombre en attente ; ouvre/ferme le panneau. */}
      {canManageStage && onToggleStageRequests && (stageRequestCount ?? 0) > 0 && (
        <button
          onClick={onToggleStageRequests}
          className={`${ROUND} ${ACCENT} relative`}
          title="Demandes de prise de caméra"
          aria-label="Demandes de scène"
          data-testid="visio-fs-stage-requests"
        >
          <Hand className="w-5 h-5" />
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[var(--bt-accent-2)] text-white text-[10px] font-bold flex items-center justify-center">
            {(stageRequestCount ?? 0) > 9 ? '9+' : stageRequestCount}
          </span>
        </button>
      )}

      {/* ⏱️ Interval training (hôte) */}
      {onStartTimer && (
        <button
          onClick={onStartTimer}
          className={`${ROUND} ${DARK}`}
          title="Interval training"
          aria-label="Interval training"
          data-testid="visio-fs-timer"
        >
          <Timer className="w-5 h-5" />
        </button>
      )}

      {/* 💬 Chat (ouvre le panneau par-dessus le plein écran) + badge non-lus */}
      {onOpenChat && (
        <button
          onClick={onOpenChat}
          className={`${ROUND} ${DARK} relative`}
          title="Chat"
          aria-label="Ouvrir le chat"
          data-testid="visio-fs-chat"
        >
          <MessageCircle className="w-5 h-5" />
          {chatUnread ? (
            <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[var(--bt-accent-2)] text-white text-[10px] font-bold flex items-center justify-center">
              {chatUnread > 9 ? '9+' : chatUnread}
            </span>
          ) : null}
        </button>
      )}

      {/* 🔽 Réduire (sortir du plein écran caméra) */}
      {onReduce && (
        <button
          onClick={onReduce}
          className={`${ROUND} ${DARK}`}
          title="Réduire"
          aria-label="Quitter le plein écran"
          data-testid="visio-camera-fs-reduce"
        >
          <Minimize2 className="w-5 h-5" />
        </button>
      )}
    </div>
  );
};

export default VisioControlBar;
