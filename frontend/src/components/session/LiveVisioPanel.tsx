import React, { useState } from 'react';
import { Video, VideoOff, Mic, MicOff, LayoutGrid, Rows3, LogOut, Users } from 'lucide-react';
import { CameraTile } from '@/components/session/CameraTile';
import type { RemoteCamera } from '@/hooks/useVideoMesh';

export interface VisioParticipant {
  id: string;
  name: string;
  avatarUrl?: string | null;
  isHost?: boolean;
  isCurrentUser?: boolean;
  isMicActive?: boolean;
}

interface LiveVisioPanelProps {
  participants: VisioParticipant[];
  myUserId: string;
  localStream: MediaStream | null;
  remoteCameras: RemoteCamera[];
  cameraOn: boolean;
  activeCameraCount: number;
  maxCameras: number;
  micActive: boolean;
  onToggleMic: () => void;
  onToggleCamera: () => void;
  onLeaveLive: () => void;
}

type Layout = 'grid' | 'spotlight';

// 🎥 Panneau "Live / Visio" — grille de caméras (façon Zoom) + barre de contrôle.
// Additif : ne touche PAS la vidéo partagée (qui reste affichée/synchronisée à sa place).
export const LiveVisioPanel: React.FC<LiveVisioPanelProps> = ({
  participants, myUserId, localStream, remoteCameras, cameraOn, activeCameraCount, maxCameras,
  micActive, onToggleMic, onToggleCamera, onLeaveLive,
}) => {
  const [layout, setLayout] = useState<Layout>('grid');

  const streamFor = (p: VisioParticipant): MediaStream | null => {
    if (p.id === myUserId) return cameraOn ? localStream : null;
    return remoteCameras.find((c) => c.userId === p.id)?.stream || null;
  };

  const tiles = participants.map((p) => (
    <CameraTile
      key={p.id}
      name={p.name}
      stream={streamFor(p)}
      isLocal={p.id === myUserId}
      micActive={p.isMicActive}
      isHost={p.isHost}
      avatarUrl={p.avatarUrl}
    />
  ));

  return (
    <div className="rounded-2xl border border-[#8A2EFF]/25 bg-[rgba(20,20,25,0.95)] overflow-hidden" data-testid="live-visio-panel">
      {/* En-tête */}
      <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-white/10">
        <h3 className="flex items-center gap-2 text-white text-sm font-semibold">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#FF2FB3] opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#FF2FB3]" />
          </span>
          Live Visio
          <span className="flex items-center gap-1 text-white/40 text-xs font-normal">
            <Users className="w-3.5 h-3.5" /> {activeCameraCount}/{maxCameras} caméras
          </span>
        </h3>
        {/* Bascule de disposition */}
        <div className="flex items-center gap-1 bg-white/5 rounded-lg p-0.5">
          <button
            onClick={() => setLayout('grid')}
            className={`p-1.5 rounded-md ${layout === 'grid' ? 'bg-[#8A2EFF] text-white' : 'text-white/50 hover:text-white'}`}
            title="Grille égale"
            data-testid="visio-layout-grid"
          >
            <LayoutGrid className="w-4 h-4" />
          </button>
          <button
            onClick={() => setLayout('spotlight')}
            className={`p-1.5 rounded-md ${layout === 'spotlight' ? 'bg-[#8A2EFF] text-white' : 'text-white/50 hover:text-white'}`}
            title="Bandeau caméras (laisse la place à la vidéo partagée)"
            data-testid="visio-layout-spotlight"
          >
            <Rows3 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Grille / bandeau de caméras */}
      <div className="p-3">
        {layout === 'grid' ? (
          <div className="grid grid-cols-1 xs:grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {tiles}
          </div>
        ) : (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {participants.map((p) => (
              <div key={p.id} className="w-32 sm:w-40 flex-shrink-0">
                <CameraTile
                  name={p.name}
                  stream={streamFor(p)}
                  isLocal={p.id === myUserId}
                  micActive={p.isMicActive}
                  isHost={p.isHost}
                  avatarUrl={p.avatarUrl}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Barre de contrôle — accessible au pouce sur mobile */}
      <div className="flex flex-wrap items-center justify-center gap-2 px-3 py-2.5 border-t border-white/10 bg-black/20">
        <button
          onClick={onToggleMic}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
            micActive ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30' : 'bg-white/10 text-white/70 hover:bg-white/20'
          }`}
          data-testid="visio-mic-toggle"
        >
          {micActive ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
          <span className="hidden xs:inline">{micActive ? 'Micro' : 'Micro'}</span>
        </button>

        <button
          onClick={onToggleCamera}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
            cameraOn ? 'bg-[#8A2EFF]/25 text-[#c9a3ff] hover:bg-[#8A2EFF]/35' : 'bg-white/10 text-white/70 hover:bg-white/20'
          }`}
          data-testid="visio-camera-toggle"
        >
          {cameraOn ? <Video className="w-4 h-4" /> : <VideoOff className="w-4 h-4" />}
          {cameraOn ? 'Couper la caméra' : 'Allumer la caméra'}
        </button>

        <button
          onClick={onLeaveLive}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-white/10 text-white/70 hover:bg-red-500/20 hover:text-red-400 transition-colors"
          data-testid="visio-leave"
        >
          <LogOut className="w-4 h-4" /> Quitter le live
        </button>
      </div>
    </div>
  );
};

export default LiveVisioPanel;
