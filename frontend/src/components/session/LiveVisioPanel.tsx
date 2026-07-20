import React, { useRef, useState } from 'react';
import { Video, VideoOff, Mic, MicOff, LayoutGrid, Rows3, LogOut, Users, Hand, Maximize2, Minimize2, Timer, SwitchCamera, MonitorUp, MonitorX, RefreshCw } from 'lucide-react';
import { CameraTile } from '@/components/session/CameraTile';
import { VisioControlBar } from '@/components/session/VisioControlBar';
import { useFullscreen } from '@/hooks/useFullscreen';
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
  // Masque le bouton micro du panneau (ex. hôte : un seul micro, celui de l'en-tête de session).
  hideMicButton?: boolean;
  onToggleCamera: () => void;
  onLeaveLive: () => void;
  // 🎤 Scène : l'hôte/co-hôte gère librement sa caméra ; le spectateur DEMANDE à monter.
  canManageStage?: boolean;
  stageRequestPending?: boolean;
  onRequestStage?: () => void;
  // 🔍 Spotlight CONTRÔLÉ par le parent (UI pure) → persiste même si ce panneau est remonté /
  //    repositionné (fenêtre flottante mobile ↔ colonne desktop). Optionnel : repli en interne.
  spotlightId?: string | null;
  onSpotlightChange?: (id: string | null) => void;
  // ⏱️ Chantier C : bouton hôte pour lancer l'Interval training pendant la visio (ouvre la modale de config côté parent).
  onStartTimer?: () => void;
  // ⏱️ Overlay du décompte (lecture seule) à afficher DANS le plein écran caméra — un seul émetteur son (géré au parent).
  timerNode?: React.ReactNode;
  // 🎥 Sélection de caméra (externe) — additif. Fournis par le hook LiveKit (sans reconnexion).
  videoDevices?: MediaDeviceInfo[];
  videoDeviceId?: string | null;
  onSelectCamera?: (deviceId: string) => void;
  onFlipCamera?: () => void;
  onRefreshDevices?: (probe?: boolean) => void;
  // 🖥️ Partage d'écran — réutilise la logique existante (getDisplayMedia + LiveKit ScreenShare).
  onToggleScreenShare?: () => void;
  screenSharing?: boolean;
  screenSupported?: boolean;
  // 💬 Chat accessible depuis le plein écran (BUG 3) : ouvre le panneau + badge non-lus.
  onOpenChat?: () => void;
  chatUnread?: number;
  // 🙋 Demandes de scène (badge + toggle) accessibles depuis le plein écran.
  onToggleStageRequests?: () => void;
  stageRequestCount?: number;
}

type Layout = 'grid' | 'spotlight';

// 📷 Caméra INTÉGRÉE avant/arrière du téléphone (déjà couverte par le bouton flip) → à masquer du
//    menu sur mobile pour ne garder que les VRAIES caméras externes (GoPro, reflex, USB, carte de capture).
function isBuiltInFacingCamera(label: string): boolean {
  return /facing\s*(front|back)|front camera|back camera|caméra\s*(avant|arrière)|\buser\b|\benvironment\b/i.test(label || '');
}
// Nom lisible : retire le suffixe « , facing front/back » ; repli si le label est vide/bruité.
function cleanCameraLabel(label: string, index: number): string {
  const s = (label || '').replace(/,?\s*facing\s*(front|back)\b/i, '').trim();
  return s || `Caméra externe ${index + 1}`;
}

// 🎥 Panneau "Live / Visio" — grille de caméras (façon Zoom) + barre de contrôle.
// Additif : ne touche PAS la vidéo partagée (qui reste affichée/synchronisée à sa place).
export const LiveVisioPanel: React.FC<LiveVisioPanelProps> = ({
  participants, myUserId, localStream, remoteCameras, cameraOn, activeCameraCount, maxCameras,
  micActive, onToggleMic, hideMicButton = false, onToggleCamera, onLeaveLive,
  canManageStage = true, stageRequestPending = false, onRequestStage,
  spotlightId: spotlightIdProp, onSpotlightChange,
  onStartTimer, timerNode,
  videoDevices = [], videoDeviceId = null, onSelectCamera, onFlipCamera, onRefreshDevices,
  onToggleScreenShare, screenSharing = false, screenSupported = false,
  onOpenChat, chatUnread, onToggleStageRequests, stageRequestCount,
}) => {
  const [layout, setLayout] = useState<Layout>('grid');
  // 🎥 Menu de sélection caméra (repliable) — toujours accessible pour l'hôte/co-hôte.
  const [camMenuOpen, setCamMenuOpen] = useState(false);
  // À l'ouverture du panneau : énumération silencieuse (sans demander la permission) + suivi du
  // branchement/débranchement à chaud. La sonde (permission) n'a lieu qu'au clic explicite « Caméra ».
  React.useEffect(() => {
    onRefreshDevices?.(false);
    const onChange = () => onRefreshDevices?.(false);
    try { navigator.mediaDevices.addEventListener('devicechange', onChange); } catch { /* ignore */ }
    return () => { try { navigator.mediaDevices.removeEventListener('devicechange', onChange); } catch { /* ignore */ } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // 📷 Classement des caméras : si des caméras « facing » (avant/arrière intégrées) existent → on est
  //    sur mobile ; le menu ne liste alors QUE les caméras externes (le flip couvre l'intégré). Sur PC
  //    (aucune « facing ») → on liste toutes les caméras par leur vrai label.
  const hasFacingCam = videoDevices.some((d) => isBuiltInFacingCamera(d.label));
  const menuDevices = hasFacingCam ? videoDevices.filter((d) => !isBuiltInFacingCamera(d.label)) : videoDevices;
  // 🔍 Chantier A : VRAI plein écran d'UNE caméra (Fullscreen API + repli overlay iOS), orientation AUTO (pas de rotation forcée).
  // Le conteneur de la zone caméras est TOUJOURS monté et visible → requestFullscreen fiable (aucun remontage des flux).
  const camAreaRef = useRef<HTMLDivElement>(null);
  const { fullscreen: camFullscreen, enter: enterCamFullscreen, exit: exitCamFullscreen } = useFullscreen(camAreaRef);
  // 🔍 Agrandir (épingler) UNE caméra — action LOCALE (chacun choisit sur SON écran).
  // Contrôlé par le parent si fourni (persiste au remontage) ; sinon état interne (repli).
  const [spotlightInternal, setSpotlightInternal] = useState<string | null>(null);
  const spotlightId = spotlightIdProp !== undefined ? spotlightIdProp : spotlightInternal;
  const setSpotlightId = (id: string | null) => {
    if (onSpotlightChange) onSpotlightChange(id);
    else setSpotlightInternal(id);
  };

  const streamFor = (p: VisioParticipant): MediaStream | null => {
    if (p.id === myUserId) return cameraOn ? localStream : null;
    return remoteCameras.find((c) => c.userId === p.id)?.stream || null;
  };

  // Bouton coin haut-droit d'une vignette : agrandir (vignette normale) / réduire (grande vue).
  const pinButton = (active: boolean, onClick: () => void) => (
    <button
      onClick={onClick}
      className="p-1.5 rounded-lg bg-black/50 text-white/80 hover:bg-black/70 hover:text-white transition-colors"
      title={active ? 'Réduire' : 'Agrandir'}
      data-testid={active ? 'visio-tile-reduce' : 'visio-tile-enlarge'}
    >
      {active ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
    </button>
  );

  // 🔍 « Agrandir » = épingler cette caméra ET passer en VRAI plein écran (chantier A). « Réduire » = sortir du plein écran.
  const enlarge = (id: string) => { setSpotlightId(id); enterCamFullscreen(); };

  // Rendu d'une vignette cliquable (clic = agrandir ; sur la grande vue, clic = réduire).
  const tileFor = (p: VisioParticipant, large = false) => (
    <CameraTile
      name={p.name}
      stream={streamFor(p)}
      isLocal={p.id === myUserId}
      micActive={p.isMicActive}
      isHost={p.isHost}
      avatarUrl={p.avatarUrl}
      large={large}
      className={large ? 'w-full h-full' : ''}
      onClick={() => (large ? setSpotlightId(null) : enlarge(p.id))}
      topRight={pinButton(large, () => (large ? setSpotlightId(null) : enlarge(p.id)))}
    />
  );

  // Participant actuellement agrandi (s'il est toujours présent), + les autres en miniatures.
  const spotlightP = spotlightId ? participants.find((p) => p.id === spotlightId) || null : null;
  const otherParticipants = spotlightP ? participants.filter((p) => p.id !== spotlightP.id) : [];

  // Plein écran caméra : la « grande » = celle épinglée, sinon la 1ʳᵉ ; les autres en bande de vignettes.
  const fsBig = spotlightP || participants[0] || null;
  const fsOthers = fsBig ? participants.filter((p) => p.id !== fsBig.id) : [];

  return (
    <div className="rounded-2xl border border-[rgb(var(--bt-accent-rgb)/0.25)] bg-[rgba(20,20,25,0.95)] overflow-hidden" data-testid="live-visio-panel">
      {/* En-tête */}
      <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-white/10">
        <h3 className="flex items-center gap-2 text-white text-sm font-semibold">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--bt-accent-2)] opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[var(--bt-accent-2)]" />
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
            className={`p-1.5 rounded-md ${layout === 'grid' ? 'bg-[var(--bt-accent)] text-white' : 'text-white/50 hover:text-white'}`}
            title="Grille égale"
            data-testid="visio-layout-grid"
          >
            <LayoutGrid className="w-4 h-4" />
          </button>
          <button
            onClick={() => setLayout('spotlight')}
            className={`p-1.5 rounded-md ${layout === 'spotlight' ? 'bg-[var(--bt-accent)] text-white' : 'text-white/50 hover:text-white'}`}
            title="Bandeau caméras (laisse la place à la vidéo partagée)"
            data-testid="visio-layout-spotlight"
          >
            <Rows3 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Grille / bandeau de caméras — ou vue agrandie (spotlight) si une caméra est épinglée.
          Ce conteneur EST la cible du plein écran (chantier A) : en plein écran il devient une surface fixe noire. */}
      <div
        ref={camAreaRef}
        className={camFullscreen ? 'fixed inset-0 z-[100] bg-black flex flex-col' : 'p-3'}
        data-testid="visio-camera-area"
      >
        {camFullscreen ? (
          /* 🔍 PLEIN ÉCRAN : une caméra en grand (object-contain → jamais rogner le visage), orientation auto,
             bande de vignettes en bas (taper = elle passe en grand), bouton Réduire + timer overlay (lecture seule). */
          <>
            {/* 🎛️ Barre de contrôles verticale à droite (composant réutilisable, partagée avec le plein
                écran de la vidéo partagée). Micro toujours accessible en plein écran (hôte inclus). */}
            <VisioControlBar
              micActive={micActive}
              onToggleMic={onToggleMic}
              cameraOn={cameraOn}
              canManageStage={canManageStage}
              onToggleCamera={onToggleCamera}
              onRequestStage={onRequestStage}
              stageRequestPending={stageRequestPending}
              onStartTimer={onStartTimer && canManageStage ? onStartTimer : undefined}
              onOpenChat={onOpenChat}
              chatUnread={chatUnread}
              onToggleStageRequests={onToggleStageRequests}
              stageRequestCount={stageRequestCount}
              onReduce={exitCamFullscreen}
            />
            <div className="flex-1 min-h-0 flex items-center justify-center">
              {fsBig ? (
                <CameraTile
                  name={fsBig.name}
                  stream={streamFor(fsBig)}
                  isLocal={fsBig.id === myUserId}
                  micActive={fsBig.isMicActive}
                  isHost={fsBig.isHost}
                  avatarUrl={fsBig.avatarUrl}
                  large
                  fit="contain"
                  className="w-full h-full rounded-none border-0"
                  hideMicBadge={fsBig.id === myUserId}
                />
              ) : (
                <p className="text-white/50 text-sm">Aucune caméra allumée</p>
              )}
            </div>
            {fsOthers.length > 0 && (
              <div className="flex gap-2 overflow-x-auto p-2 bg-black/40">
                {fsOthers.map((p) => (
                  <button
                    key={p.id}
                    className="w-24 flex-shrink-0"
                    onClick={() => setSpotlightId(p.id)}
                    data-testid="visio-fs-thumb"
                  >
                    <CameraTile
                      name={p.name}
                      stream={streamFor(p)}
                      isLocal={p.id === myUserId}
                      micActive={p.isMicActive}
                      isHost={p.isHost}
                      avatarUrl={p.avatarUrl}
                    />
                  </button>
                ))}
              </div>
            )}
            {timerNode}
          </>
        ) : spotlightP ? (
          /* 🔍 Vue agrandie : une grande caméra + les autres en miniatures (clic sur une miniature = l'agrandir) */
          <div className="space-y-2">
            <div className="relative aspect-video">
              {tileFor(spotlightP, true)}
            </div>
            {otherParticipants.length > 0 && (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {otherParticipants.map((p) => (
                  <div key={p.id} className="w-24 sm:w-32 flex-shrink-0">
                    {tileFor(p)}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : layout === 'grid' ? (
          <div className="grid grid-cols-1 xs:grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {participants.map((p) => (
              <div key={p.id}>{tileFor(p)}</div>
            ))}
          </div>
        ) : (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {participants.map((p) => (
              <div key={p.id} className="w-32 sm:w-40 flex-shrink-0">
                {tileFor(p)}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Barre de contrôle — accessible au pouce sur mobile */}
      <div className="flex flex-wrap items-center justify-center gap-2 px-3 py-2.5 border-t border-white/10 bg-black/20">
        {!hideMicButton && (
          <button
            onClick={onToggleMic}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
              micActive ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30' : 'bg-white/10 text-white/70 hover:bg-white/20'
            }`}
            data-testid="visio-mic-toggle"
          >
            {micActive ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
            <span className="hidden xs:inline">Micro</span>
          </button>
        )}

        {canManageStage ? (
          /* Hôte / co-hôte : gère librement sa caméra */
          <button
            onClick={onToggleCamera}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
              cameraOn ? 'bg-[rgb(var(--bt-accent-rgb)/0.25)] text-[var(--bt-accent)] hover:bg-[rgb(var(--bt-accent-rgb)/0.35)]' : 'bg-white/10 text-white/70 hover:bg-white/20'
            }`}
            data-testid="visio-camera-toggle"
          >
            {cameraOn ? <Video className="w-4 h-4" /> : <VideoOff className="w-4 h-4" />}
            {cameraOn ? 'Couper la caméra' : 'Allumer la caméra'}
          </button>
        ) : cameraOn ? (
          /* Spectateur à l'écran : peut quitter la scène lui-même */
          <button
            onClick={onToggleCamera}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-[rgb(var(--bt-accent-rgb)/0.25)] text-[var(--bt-accent)] hover:bg-[rgb(var(--bt-accent-rgb)/0.35)] transition-colors"
            data-testid="visio-leave-stage"
          >
            <VideoOff className="w-4 h-4" /> Quitter la scène
          </button>
        ) : stageRequestPending ? (
          /* Spectateur : demande envoyée, en attente de validation */
          <button
            disabled
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-[rgb(var(--bt-accent-rgb)/0.15)] text-[rgb(var(--bt-accent-rgb)/0.7)] cursor-default"
            data-testid="visio-request-pending"
          >
            <Hand className="w-4 h-4" /> Demande envoyée…
          </button>
        ) : (
          /* Spectateur : demander à monter en vidéo */
          <button
            onClick={onRequestStage}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-white/10 text-white/70 hover:bg-[rgb(var(--bt-accent-rgb)/0.25)] hover:text-[var(--bt-accent)] transition-colors"
            data-testid="visio-request-stage"
          >
            <Hand className="w-4 h-4" /> Demander à monter en vidéo
          </button>
        )}

        {/* 🎥 Choisir une caméra (externe) — hôte/co-hôte. Bouton TOUJOURS visible ; le clic demande
            la permission puis liste les caméras (webcam externe incluse). Bascule sans reconnexion. */}
        {canManageStage && onSelectCamera && (
          <button
            onClick={() => { onRefreshDevices?.(true); setCamMenuOpen((o) => !o); }}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
              camMenuOpen ? 'bg-[rgb(var(--bt-accent-rgb)/0.25)] text-[var(--bt-accent)]' : 'bg-white/10 text-white/70 hover:bg-white/20'
            }`}
            title="Choisir une caméra externe (USB / carte de capture)"
            data-testid="visio-camera-menu"
          >
            <SwitchCamera className="w-4 h-4" /> Caméra externe
          </button>
        )}

        {/* Bascule rapide avant/arrière (mobile) quand ≥ 2 caméras. */}
        {canManageStage && onFlipCamera && videoDevices.length > 1 && (
          <button
            onClick={onFlipCamera}
            className="sm:hidden flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-white/10 text-white/70 hover:bg-white/20 transition-colors"
            title="Changer de caméra (avant/arrière)"
            data-testid="visio-camera-flip"
          >
            <SwitchCamera className="w-4 h-4" />
          </button>
        )}

        {/* 🖥️ Partager l'écran — hôte/co-hôte, desktop (getDisplayMedia supporté). Réutilise l'existant. */}
        {canManageStage && screenSupported && onToggleScreenShare && (
          <button
            onClick={onToggleScreenShare}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
              screenSharing
                ? 'bg-[rgb(var(--bt-accent-rgb)/0.25)] text-[var(--bt-accent)] hover:bg-[rgb(var(--bt-accent-rgb)/0.35)]'
                : 'bg-white/10 text-white/70 hover:bg-[rgb(var(--bt-accent-rgb)/0.25)] hover:text-[var(--bt-accent)]'
            }`}
            title={screenSharing ? 'Arrêter le partage d\'écran' : 'Partager mon écran'}
            data-testid="visio-screen-share"
          >
            {screenSharing ? <MonitorX className="w-4 h-4" /> : <MonitorUp className="w-4 h-4" />}
            {screenSharing ? 'Arrêter le partage' : "Partager l'écran"}
          </button>
        )}

        {/* 🔍 Chantier A : passer UNE caméra en vrai plein écran (celle épinglée, sinon la 1ʳᵉ). */}
        {participants.length > 0 && (
          <button
            onClick={() => enlarge(spotlightId || fsBig?.id || myUserId)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-white/10 text-white/70 hover:bg-[rgb(var(--bt-accent-rgb)/0.25)] hover:text-[var(--bt-accent)] transition-colors"
            data-testid="visio-camera-fullscreen"
          >
            <Maximize2 className="w-4 h-4" /> Plein écran
          </button>
        )}

        {/* ⏱️ Chantier C : l'hôte lance l'Interval training pendant la visio (fonctionne sans musique). */}
        {onStartTimer && canManageStage && (
          <button
            onClick={onStartTimer}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-white/10 text-white/70 hover:bg-[rgb(var(--bt-accent-rgb)/0.25)] hover:text-[var(--bt-accent)] transition-colors"
            data-testid="visio-start-timer"
          >
            <Timer className="w-4 h-4" /> Interval training
          </button>
        )}

        <button
          onClick={onLeaveLive}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-white/10 text-white/70 hover:bg-red-500/20 hover:text-red-400 transition-colors"
          data-testid="visio-leave"
        >
          <LogOut className="w-4 h-4" /> Quitter le live
        </button>
      </div>

      {/* 🎥 Menu caméra (en flux, pas en overlay → jamais rogné par overflow-hidden du panneau). */}
      {camMenuOpen && canManageStage && onSelectCamera && (
        <div className="border-t border-white/10 bg-black/30 px-3 py-2.5" data-testid="visio-camera-list">
          <div className="flex items-center justify-between mb-2">
            <span className="text-white/60 text-xs font-medium">{hasFacingCam ? 'Caméra externe' : 'Choisir la caméra'}</span>
            <button
              onClick={() => onRefreshDevices?.(true)}
              className="flex items-center gap-1 text-xs text-white/60 hover:text-white transition-colors"
              data-testid="visio-camera-refresh"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Rafraîchir
            </button>
          </div>
          {menuDevices.length === 0 ? (
            <span className="text-white/40 text-xs">
              {hasFacingCam
                ? 'Branche une caméra externe (USB / carte de capture) puis « Rafraîchir ». Utilise l\'icône ⟲ pour l\'avant/arrière du téléphone.'
                : 'Aucune caméra détectée — branche ta webcam puis « Rafraîchir ».'}
            </span>
          ) : (
            /* Menu compact (select stylé) — beaucoup moins encombrant que la grille de boutons. */
            <select
              value={menuDevices.some((d) => d.deviceId === videoDeviceId) ? (videoDeviceId || '') : ''}
              onChange={(e) => { if (e.target.value) { onSelectCamera(e.target.value); setCamMenuOpen(false); } }}
              className="w-full px-3 py-2 rounded-lg text-sm bg-white/10 text-white/85 border border-white/15 focus:outline-none focus:border-[rgb(var(--bt-accent-rgb)/0.5)] cursor-pointer"
              data-testid="visio-camera-select"
            >
              <option value="" className="bg-[#15151b] text-white">{hasFacingCam ? 'Choisir une caméra externe…' : 'Choisir une caméra…'}</option>
              {menuDevices.map((d, i) => (
                <option key={d.deviceId} value={d.deviceId} className="bg-[#15151b] text-white" data-testid="visio-camera-option">
                  {cleanCameraLabel(d.label, i)}{d.deviceId === videoDeviceId ? ' ✓' : ''}
                </option>
              ))}
            </select>
          )}
        </div>
      )}
    </div>
  );
};

export default LiveVisioPanel;
