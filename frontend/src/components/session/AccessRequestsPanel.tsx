import React from 'react';
import { UserCheck, UserX, BellRing } from 'lucide-react';
import { ProfilePhoto } from '@/components/session/ProfilePhoto';

export interface AccessRequest {
  userId: string;
  name: string;
  photoUrl?: string | null;
}

interface AccessRequestsPanelProps {
  requests: AccessRequest[];
  onAdmit: (userId: string) => void;
  onRefuse: (userId: string) => void;
}

// Panneau hôte : liste des participants en attente d'admission (session privée).
export const AccessRequestsPanel: React.FC<AccessRequestsPanelProps> = ({ requests, onAdmit, onRefuse }) => {
  if (requests.length === 0) return null;
  return (
    <div className="rounded-2xl border border-[#FF2FB3]/30 bg-[rgba(20,20,25,0.95)] overflow-hidden" data-testid="access-requests-panel">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/10">
        <span className="relative">
          <BellRing className="w-4 h-4 text-[#FF2FB3]" />
          <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-[#FF2FB3] text-white text-[10px] font-bold flex items-center justify-center">
            {requests.length}
          </span>
        </span>
        <h3 className="text-white text-sm font-semibold">Demandes d'accès ({requests.length})</h3>
      </div>

      <div className="p-3 space-y-2 max-h-64 overflow-y-auto">
        {requests.map((r) => (
          <div key={r.userId} className="flex items-center gap-3 p-2 rounded-lg bg-white/5 border border-white/10">
            <ProfilePhoto url={r.photoUrl} name={r.name} size={36} />
            <span className="flex-1 min-w-0 text-white text-sm truncate">{r.name}</span>
            <button
              onClick={() => onAdmit(r.userId)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-green-500/20 text-green-400 hover:bg-green-500/30 transition-colors flex-shrink-0"
              data-testid="admit-btn"
            >
              <UserCheck size={14} /> Admettre
            </button>
            <button
              onClick={() => onRefuse(r.userId)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-white/10 text-white/60 hover:bg-red-500/20 hover:text-red-400 transition-colors flex-shrink-0"
              data-testid="refuse-btn"
            >
              <UserX size={14} /> Refuser
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

export default AccessRequestsPanel;
