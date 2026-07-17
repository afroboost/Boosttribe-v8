import React, { useState } from 'react';
import { Hand, UserCheck, UserX, LogOut, Users } from 'lucide-react';
import { ProfilePhoto } from '@/components/session/ProfilePhoto';

export interface StageRequest {
  userId: string;
  name: string;
  photoUrl?: string | null;
}

export interface StageOccupant {
  userId: string;
  name: string;
  photoUrl?: string | null;
  isSelf?: boolean;
}

interface StageRequestsPanelProps {
  requests: StageRequest[];
  onStage: StageOccupant[];     // participants actuellement à l'écran (caméra active)
  onStageCount: number;         // = onStage.length (décompte mesh)
  maxCameras: number;           // 6
  onAccept: (userId: string) => void;                              // place libre → accepter direct
  onRefuse: (userId: string) => void;
  onSwap: (acceptUserId: string, removedUserId: string) => void;   // scène pleine → retirer X puis accepter
}

// 🎤 Panneau hôte/co-hôte : demandes de prise de parole (monter en vidéo).
// Quand la scène est pleine (6/6), l'acceptation demande de CHOISIR qui retirer.
export const StageRequestsPanel: React.FC<StageRequestsPanelProps> = ({
  requests, onStage, onStageCount, maxCameras, onAccept, onRefuse, onSwap,
}) => {
  const [pickFor, setPickFor] = useState<string | null>(null); // userId de la demande qui attend le choix de retrait
  if (requests.length === 0) return null;

  const full = onStageCount >= maxCameras;

  const handleAccept = (userId: string) => {
    if (full) setPickFor((cur) => (cur === userId ? null : userId)); // scène pleine → choisir qui retirer
    else onAccept(userId);
  };

  return (
    <div className="rounded-2xl border border-[rgb(var(--bt-accent-rgb)/0.4)] bg-[rgba(20,20,25,0.95)] overflow-hidden" data-testid="stage-requests-panel">
      <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-white/10">
        <h3 className="flex items-center gap-2 text-white text-sm font-semibold min-w-0">
          <span className="relative flex-shrink-0">
            <Hand className="w-4 h-4 text-[var(--bt-accent)]" />
            <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-[var(--bt-accent)] text-white text-[10px] font-bold flex items-center justify-center">
              {requests.length}
            </span>
          </span>
          <span className="truncate">Demandes de prise de parole ({requests.length})</span>
        </h3>
        <span className="flex items-center gap-1 text-xs flex-shrink-0 text-white/50">
          <Users className="w-3.5 h-3.5" /> {onStageCount}/{maxCameras} à l'écran
        </span>
      </div>

      <div className="p-3 space-y-2 max-h-72 overflow-y-auto">
        {requests.map((r) => (
          <div key={r.userId} className="rounded-lg bg-white/5 border border-white/10">
            <div className="flex flex-wrap items-center gap-2 p-2">
              <ProfilePhoto url={r.photoUrl} name={r.name} size={36} />
              <span className="flex-1 min-w-[80px] text-white text-sm truncate">{r.name}</span>
              <button
                onClick={() => handleAccept(r.userId)}
                className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors flex-shrink-0 ${
                  pickFor === r.userId
                    ? 'bg-[rgb(var(--bt-accent-rgb)/0.3)] text-[var(--bt-accent)]'
                    : 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
                }`}
                title={full ? 'Scène pleine — choisir qui retirer' : 'Accepter'}
                data-testid="stage-accept-btn"
              >
                <UserCheck size={14} /> Accepter
              </button>
              <button
                onClick={() => { onRefuse(r.userId); if (pickFor === r.userId) setPickFor(null); }}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-white/10 text-white/60 hover:bg-red-500/20 hover:text-red-400 transition-colors flex-shrink-0"
                data-testid="stage-refuse-btn"
              >
                <UserX size={14} /> Refuser
              </button>
            </div>

            {/* Sous-étape : scène pleine → choisir le participant à retirer pour faire monter le demandeur */}
            {pickFor === r.userId && (
              <div className="px-2 pb-2 pt-1 border-t border-white/10 mt-1">
                <p className="text-[11px] text-white/50 mb-2">
                  Scène pleine ({onStageCount}/{maxCameras}) — choisissez qui retirer pour faire monter {r.name} :
                </p>
                <div className="space-y-1.5">
                  {onStage.map((o) => (
                    <button
                      key={o.userId}
                      onClick={() => { onSwap(r.userId, o.userId); setPickFor(null); }}
                      className="w-full flex items-center gap-2 p-1.5 rounded-lg bg-white/5 hover:bg-red-500/15 border border-white/10 hover:border-red-500/30 transition-colors text-left"
                      data-testid="stage-remove-pick"
                    >
                      <ProfilePhoto url={o.photoUrl} name={o.name} size={28} />
                      <span className="flex-1 min-w-0 text-white/90 text-xs truncate">
                        {o.name}{o.isSelf ? ' (vous)' : ''}
                      </span>
                      <span className="flex items-center gap-1 text-red-400 text-[11px] font-medium flex-shrink-0">
                        <LogOut size={12} /> Retirer
                      </span>
                    </button>
                  ))}
                  {onStage.length === 0 && (
                    <p className="text-[11px] text-white/40">Aucun participant à l'écran.</p>
                  )}
                </div>
                <button
                  onClick={() => setPickFor(null)}
                  className="mt-2 text-[11px] text-white/40 hover:text-white/70"
                >
                  Annuler
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default StageRequestsPanel;
