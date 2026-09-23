import React, { useRef, useState } from 'react';
import { Video, VideoOff, Mic, MicOff, LayoutGrid, Rows3, LogOut, Users, Hand, Maximize2, Minimize2, Timer, SwitchCamera, MonitorUp, MonitorX, ScrollText, SlidersHorizontal, X, RefreshCw, Sparkles, Clapperboard, Radio, Disc, Square } from 'lucide-react';
import { SourcesDrawer, type SourcesDrawerProps } from '@/components/session/SourcesDrawer';
import { CameraTile } from '@/components/session/CameraTile';
import { VisioControlBar } from '@/components/session/VisioControlBar';
import { MenuActions } from '@/components/session/MenuActions';
import { libelleItemRecord, formatDureeRec, badgeVisible } from '@/lib/recordUi';
import type { RecEtat } from '@/components/session/RecordTypes';
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
  // 🎛️ Phase 1 Sources : tiroir Caméra/Audio (remplace l'ancien menu « Caméra externe »).
  //    Optionnel : sans `sources`, l'ancien menu déroulant reste (compatibilité).
  sources?: Omit<SourcesDrawerProps, 'ouvert' | 'onFermer' | 'videoDevices' | 'videoDeviceId' | 'cameraOn' | 'onSelectCamera' | 'onRefreshDevices'>;
  // Avis caméra discret (aucune caméra / retour à l'interne / caméra perdue) + fermeture.
  cameraNotice?: 'aucune-camera' | 'retour-interne' | 'camera-perdue' | null;
  onDismissCameraNotice?: () => void;
  // 🖥️ Partage d'écran — réutilise la logique existante (getDisplayMedia + LiveKit ScreenShare).
  onToggleScreenShare?: () => void;
  screenSharing?: boolean;
  screenSupported?: boolean;
  // ✨ Embellir le visage (agent beauté) : réglage rendu dans le menu ⋮ — optionnel.
  embellirNode?: React.ReactNode;
  // 🎬 Studio (Phase 2) : mini régie Preview / Programme / scènes. Fermée = rien de visible.
  //    Entrée : item « Studio » du menu ⋮ (partout) + icône ronde discrète sur desktop.
  //    `studioNode` est le panneau lui-même (rendu sous la barre quand `studioOpen`).
  studioNode?: React.ReactNode;
  studioOpen?: boolean;
  onToggleStudio?: () => void;
  // 📡 Diffuser en direct (multistream) : icône Radio dans la barre + item ⋮ ; le tiroir des
  //    réseaux est `broadcastNode` (rendu quand `broadcastOpen`). Fuchsia quand `broadcastLive`.
  //    L'UI ne reçoit jamais de clé/URL/jeton : seulement ces quatre props.
  broadcastNode?: React.ReactNode;
  broadcastOpen?: boolean;
  broadcastLive?: boolean;
  onToggleBroadcast?: () => void;
  // 🖥️ Capacité réelle du partage d'écran sur l'appareil (getDisplayMedia). `false` = bouton
  //    désactivé « Indisponible sur cet appareil » (desktop), masqué sur mobile — sans toucher
  //    à la caméra du téléphone.
  screenShareDisponible?: boolean;
  // ⏺ Enregistrement local du Programme (Phase 4) : item ⋮ « Enregistrer » ; le panneau est
  //    `recordNode` (rendu quand `recordOpen`). Sur la vidéo : seulement un badge « ● REC » en
  //    enregistrement. Aucune donnée de fichier ici : états, durée, capacité, rappel.
  recordNode?: React.ReactNode;
  recordOpen?: boolean;
  recordEtat?: RecEtat;
  recordDureeSec?: number;
  recordSupporte?: boolean;
  recordMotif?: string;
  onToggleRecord?: () => void;
  // 🙋 Demandes de scène (badge + toggle) accessibles depuis le plein écran.
  onToggleStageRequests?: () => void;
  stageRequestCount?: number;
  // 📜 PROMPTEUR SUR LA VIDÉO. `prompteurNode` est une surface DOM LOCALE posée par-dessus
  //    les caméras : elle n'entre dans aucun MediaStream, aucune piste WebRTC, aucune synchro.
  //    Elle est rendue DANS la zone caméra — donc elle suit le plein écran, qui prend cette
  //    zone pour cible. Le coach lit son texte sans jamais quitter son direct.
  prompteurNode?: React.ReactNode;
  /**
   * ✍️ Tiroir d'écriture du prompteur. Rendu DANS la zone caméra pour la même raison
   * que l'overlay : c'est la cible du plein écran, et rien d'autre n'y est visible.
   * Sans lui, écrire son texte obligeait à quitter le plein écran — donc le direct.
   */
  prompteurTiroirNode?: React.ReactNode;
  prompteurOuvert?: boolean;
  onTogglePrompteur?: () => void;
  /** État de la connexion au serveur vidéo — affiché, jamais tu. */
  connexionScene?: 'inactive' | 'en-cours' | 'connectee' | 'echec' | 'refus-publication';
  // 🎵 Commandes musique compactes (⏮ ▶/⏸ ⏭ + titre) — LE lecteur existant, pas un second.
  //    Rendues dans le panneau ET dans le plein écran : changer de morceau ne doit pas
  //    obliger à sortir de la vue caméra.
  audioNode?: React.ReactNode;
}

type Layout = 'grid' | 'spotlight';

// Boutons ronds de la barre du bas — mêmes classes que la colonne plein écran (VisioControlBar).
const ROUND = 'w-12 h-12 rounded-full flex items-center justify-center shadow-lg transition-colors';
const DARK = 'bg-black/50 text-white/90 hover:bg-black/70';
const GREEN = 'bg-green-500/40 text-green-100 hover:bg-green-500/50';
const ACCENT = 'bg-[rgb(var(--bt-accent-rgb)/0.4)] text-[var(--bt-accent)] hover:bg-[rgb(var(--bt-accent-rgb)/0.5)]';

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
  sources, cameraNotice = null, onDismissCameraNotice,
  onToggleScreenShare, screenSharing = false, screenSupported = false,
  embellirNode, studioNode, studioOpen = false, onToggleStudio, onToggleStageRequests, stageRequestCount,
  broadcastNode, broadcastOpen = false, broadcastLive = false, onToggleBroadcast, screenShareDisponible = true,
  recordNode, recordOpen = false, recordEtat = 'inactif', recordDureeSec = 0, recordSupporte = true, recordMotif, onToggleRecord,
  prompteurNode, prompteurTiroirNode, prompteurOuvert = false, onTogglePrompteur, audioNode,
  connexionScene,
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

      {/* ⚠️ SERVEUR VIDÉO INJOIGNABLE — à dire, et à dire ICI. Sans ce bandeau, « Allumer la
          caméra » ne produisait rien du tout : ni image, ni erreur. Une panne du SFU était
          alors indiscernable d'un bouton mort, et se cherchait dans le code de la caméra. */}
      {connexionScene === 'echec' && (
        <div className="px-4 py-2 text-xs leading-snug text-red-300 bg-red-500/10 border-b border-red-500/25"
             role="status" data-testid="visio-connexion-echec">
          Serveur vidéo injoignable : les caméras ne peuvent pas démarrer. Ce n'est pas une
          autorisation à donner — le problème est côté serveur.
        </div>
      )}

      {/* ⛔ DROIT DE DIFFUSER REFUSÉ — une panne de réseau et un refus d'autorisation ne se
          soignent pas pareil, donc ils ne se disent pas pareil. Le serveur n'accorde la
          scène qu'à l'hôte enregistré de la session : si l'autorité n'a pas pu être écrite
          (session revendiquée par un autre compte, session expirée, connexion perdue), on
          l'écrit noir sur blanc au lieu de laisser croire que la caméra diffuse. */}
      {connexionScene === 'refus-publication' && (
        <div className="px-4 py-2 text-xs leading-snug text-amber-300 bg-amber-500/10 border-b border-amber-500/25"
             role="status" data-testid="visio-refus-publication">
          Le serveur n'a pas accordé le droit de diffuser sur cette session : ta caméra n'est
          PAS envoyée aux participants. Recharge la page ; si cela persiste, la session
          appartient à un autre compte.
        </div>
      )}

      {/* Grille / bandeau de caméras — ou vue agrandie (spotlight) si une caméra est épinglée.
          Ce conteneur EST la cible du plein écran (chantier A) : en plein écran il devient une surface fixe noire. */}
      <div
        ref={camAreaRef}
        className={camFullscreen ? 'fixed inset-0 z-[100] bg-black flex flex-col' : 'relative p-3'}
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
              onToggleStageRequests={onToggleStageRequests}
              stageRequestCount={stageRequestCount}
              onTogglePrompteur={onTogglePrompteur}
              prompteurOuvert={prompteurOuvert}
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
            {/* 📜 Le texte reste SUR la vidéo en plein écran : c'est justement là qu'on parle. */}
            {prompteurNode}
            {/* ✍️ …et on peut l'ÉCRIRE là aussi, sans sortir du plein écran. */}
            {prompteurTiroirNode}
            {/* 🎵 Musique atteignable sans sortir du plein écran, au-dessus de la safe-area. */}
            {audioNode && (
              <div
                className="pointer-events-none absolute inset-x-0 z-[116] flex justify-center px-3"
                style={{ bottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
                data-testid="visio-fs-audio"
              >
                <div className="pointer-events-auto w-full max-w-sm">{audioNode}</div>
              </div>
            )}
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
        {/* Hors plein écran aussi : le texte se lit SUR l'aperçu, jamais à côté. */}
        {!camFullscreen && prompteurNode}
        {/* ⏺ Badge discret « ● REC 00:12:34 » — seule trace de l'enregistrement sur la vidéo. */}
        {badgeVisible(recordEtat) && (
          <span className="pointer-events-none absolute top-4 left-4 z-20 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-black/55 backdrop-blur text-[11px] font-semibold text-[var(--bt-accent)] tabular-nums" role="status" aria-live="off" data-testid="record-badge">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--bt-accent)] animate-pulse" aria-hidden="true" /> REC {formatDureeRec(recordDureeSec)}
          </span>
        )}
        {!camFullscreen && prompteurTiroirNode}
      </div>

      {/* 🎵 Commandes musique — dans le panneau, juste sous les caméras. */}
      {audioNode && !camFullscreen && (
        <div className="px-3 pb-1" data-testid="visio-audio">{audioNode}</div>
      )}

      {/* Barre de contrôle — UNE rangée d'icônes rondes, accessible au pouce sur mobile.
          Épurée (17/09) : la vidéo domine ; ici seulement l'essentiel (micro si demandé, caméra,
          bascule/partage) ; tout le secondaire vit dans le menu ⋮ (Sources, Prompteur, Interval,
          Embellir, Quitter). « Plein écran » n'y est plus : la vignette porte déjà Agrandir. */}
      <div className="flex items-center justify-center gap-3 px-3 py-2 border-t border-white/10 bg-black/20"
        style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}>
        {!hideMicButton && (
          <button
            onClick={onToggleMic}
            className={`${ROUND} ${micActive ? GREEN : DARK}`}
            title={micActive ? 'Couper le micro' : 'Activer le micro'}
            aria-label={micActive ? 'Couper le micro' : 'Activer le micro'}
            data-testid="visio-mic-toggle"
          >
            {micActive ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
          </button>
        )}

        {canManageStage ? (
          /* Hôte / co-hôte : gère librement sa caméra */
          <button
            onClick={onToggleCamera}
            className={`${ROUND} ${cameraOn ? ACCENT : DARK}`}
            title={cameraOn ? 'Couper la caméra' : 'Allumer la caméra'}
            aria-label={cameraOn ? 'Couper la caméra' : 'Allumer la caméra'}
            data-testid="visio-camera-toggle"
          >
            {cameraOn ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
          </button>
        ) : cameraOn ? (
          /* Spectateur à l'écran : peut quitter la scène lui-même (reste VISIBLE, pas dans le menu) */
          <button
            onClick={onToggleCamera}
            className="flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-medium bg-[rgb(var(--bt-accent-rgb)/0.25)] text-[var(--bt-accent)] hover:bg-[rgb(var(--bt-accent-rgb)/0.35)] transition-colors"
            data-testid="visio-leave-stage"
          >
            <VideoOff className="w-4 h-4" /> Quitter la scène
          </button>
        ) : stageRequestPending ? (
          /* Spectateur : demande envoyée, en attente de validation */
          <button
            disabled
            className="flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-medium bg-[rgb(var(--bt-accent-rgb)/0.15)] text-[rgb(var(--bt-accent-rgb)/0.7)] cursor-default"
            data-testid="visio-request-pending"
          >
            <Hand className="w-4 h-4" /> Demande envoyée…
          </button>
        ) : (
          /* Spectateur : demander à monter en vidéo */
          <button
            onClick={onRequestStage}
            className="flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-medium bg-white/10 text-white/70 hover:bg-[rgb(var(--bt-accent-rgb)/0.25)] hover:text-[var(--bt-accent)] transition-colors"
            data-testid="visio-request-stage"
          >
            <Hand className="w-4 h-4" /> Demander à monter en vidéo
          </button>
        )}

        {/* Bascule rapide avant/arrière (mobile) quand ≥ 2 caméras — icône seule, ronde. */}
        {canManageStage && onFlipCamera && videoDevices.length > 1 && (
          <button
            onClick={onFlipCamera}
            className={`sm:hidden ${ROUND} ${DARK}`}
            title="Changer de caméra (avant/arrière)"
            aria-label="Changer de caméra (avant/arrière)"
            data-testid="visio-camera-flip"
          >
            <SwitchCamera className="w-5 h-5" />
          </button>
        )}

        {/* 🖥️ Partager l'écran — hôte/co-hôte, desktop (getDisplayMedia supporté). Réutilise l'existant. */}
        {canManageStage && screenSupported && onToggleScreenShare && (
          <button
            onClick={screenShareDisponible ? onToggleScreenShare : undefined}
            disabled={!screenShareDisponible}
            className={`${screenShareDisponible ? '' : 'hidden sm:inline-flex opacity-40 cursor-not-allowed '}${ROUND} ${screenSharing ? ACCENT : DARK}`}
            title={!screenShareDisponible ? 'Indisponible sur cet appareil' : screenSharing ? 'Arrêter le partage d\'écran' : 'Partager mon écran'}
            aria-label={!screenShareDisponible ? 'Partage d\'écran indisponible sur cet appareil' : screenSharing ? 'Arrêter le partage d\'écran' : 'Partager mon écran'}
            aria-pressed={screenSharing}
            aria-disabled={!screenShareDisponible}
            data-testid="visio-screen-share"
          >
            {screenSharing ? <MonitorX className="w-5 h-5" /> : <MonitorUp className="w-5 h-5" />}
          </button>
        )}

        {/* 📡 Diffuser en direct — icône ronde (mobile et desktop), fuchsia quand un direct tourne. */}
        {canManageStage && onToggleBroadcast && (
          <button
            type="button"
            onClick={onToggleBroadcast}
            className={`relative ${ROUND} ${broadcastLive ? ACCENT : DARK}`}
            title={broadcastLive ? 'En direct — gérer la diffusion' : 'Diffuser en direct'}
            aria-label={broadcastLive ? 'En direct — gérer la diffusion' : 'Diffuser en direct'}
            aria-pressed={broadcastOpen}
            data-testid="visio-broadcast"
            data-broadcast-live={broadcastLive ? 'true' : 'false'}
          >
            <Radio className="w-5 h-5" />
            {broadcastLive && (
              <span className="absolute -top-1 -right-1 px-1 rounded-full bg-[var(--bt-accent)] text-[8px] font-bold tracking-wide text-white leading-4" aria-hidden="true" data-testid="visio-broadcast-badge">LIVE</span>
            )}
          </button>
        )}

        {/* 🎬 Studio — icône discrète, desktop seulement (sur mobile : item du menu ⋮ → tiroir). */}
        {canManageStage && onToggleStudio && (
          <button
            type="button"
            onClick={onToggleStudio}
            className={`hidden lg:inline-flex ${ROUND} ${studioOpen ? ACCENT : DARK}`}
            title={studioOpen ? 'Fermer le studio' : 'Studio'}
            aria-label={studioOpen ? 'Fermer le studio' : 'Ouvrir le studio'}
            aria-pressed={studioOpen}
            data-testid="studio-toggle"
          >
            <Clapperboard className="w-5 h-5" />
          </button>
        )}

        {/* ⋮ Actions secondaires. Les data-testid des anciens boutons sont conservés sur les items. */}
        <MenuActions
          buttonClassName={`${ROUND} ${DARK}`}
          items={[
            ...(canManageStage && onSelectCamera ? [{
              id: 'sources',
              label: sources ? 'Sources' : 'Caméra externe',
              icon: sources ? <SlidersHorizontal className="w-5 h-5" /> : <SwitchCamera className="w-5 h-5" />,
              onSelect: () => { onRefreshDevices?.(true); setCamMenuOpen((o) => !o); },
              active: camMenuOpen,
              testId: sources ? 'visio-sources' : 'visio-camera-menu',
            }] : []),
            ...(onTogglePrompteur ? [{
              id: 'prompteur',
              label: 'Prompteur',
              icon: <ScrollText className="w-5 h-5" />,
              onSelect: onTogglePrompteur,
              active: prompteurOuvert,
              testId: 'visio-prompteur-toggle',
            }] : []),
            ...(onStartTimer && canManageStage ? [{
              id: 'interval',
              label: 'Interval training',
              icon: <Timer className="w-5 h-5" />,
              onSelect: onStartTimer,
              testId: 'visio-start-timer',
            }] : []),
            ...(onToggleStudio && canManageStage ? [{
              id: 'studio',
              label: 'Studio',
              icon: <Clapperboard className="w-5 h-5" />,
              onSelect: onToggleStudio,
              active: studioOpen,
              testId: 'visio-studio',
            }] : []),
            ...(onToggleBroadcast && canManageStage ? [{
              id: 'broadcast',
              label: broadcastLive ? 'En direct — gérer' : 'Diffuser en direct',
              icon: <Radio className="w-5 h-5" />,
              onSelect: onToggleBroadcast,
              active: broadcastLive || broadcastOpen,
              testId: 'visio-broadcast-item',
            }] : []),
            ...(onToggleRecord && canManageStage ? [{
              id: 'record',
              label: recordSupporte ? libelleItemRecord(recordEtat, recordDureeSec) : (recordMotif || 'Enregistrement indisponible'),
              icon: recordEtat === 'enregistrement' ? <Square className="w-5 h-5" /> : <Disc className="w-5 h-5" />,
              onSelect: recordSupporte ? onToggleRecord : () => {},
              active: recordEtat === 'enregistrement' || recordOpen,
              testId: 'visio-record',
              fermeApres: true,
              node: !recordSupporte ? (
                <span className="flex-1 text-white/40 cursor-not-allowed" aria-disabled="true" data-testid="visio-record-indisponible">{recordMotif || 'Enregistrement indisponible'}</span>
              ) : recordEtat === 'enregistrement' ? (
                <span className="flex-1 flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--bt-accent)] animate-pulse" aria-hidden="true" />
                  <span>Enregistrement</span>
                  <span className="tabular-nums text-white/70">{formatDureeRec(recordDureeSec)}</span>
                  <span className="ml-auto text-xs text-white/50">Arrêter</span>
                </span>
              ) : undefined,
            }] : []),
            ...(embellirNode && canManageStage ? [{
              id: 'embellir',
              label: 'Embellir le visage',
              icon: <Sparkles className="w-5 h-5" />,
              onSelect: () => {},
              node: embellirNode,
              testId: 'visio-embellir',
            }] : []),
            {
              id: 'quitter',
              label: 'Quitter le live',
              icon: <LogOut className="w-5 h-5" />,
              onSelect: onLeaveLive,
              danger: true,
              testId: 'visio-leave',
            },
          ]}
        />
      </div>

      {/* 🎬 Studio — panneau (desktop) ou tiroir plein écran (mobile, `fixed` dans le nœud). Fermé = rien. */}
      {studioOpen && studioNode}

      {/* 📡 Tiroir « Diffuser en direct » (fixed dans le nœud : panneau desktop ou plein écran mobile). Fermé = rien. */}
      {broadcastOpen && broadcastNode}

      {/* ⏺ Panneau « Enregistrer le Programme » (fixed dans le nœud). Fermé = rien. */}
      {recordOpen && recordNode}

      {/* 🎛️ Avis caméra discret — jamais bloquant, fermable. */}
      {cameraNotice && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-t border-white/10 bg-black/30 text-xs text-white/70" role="status" data-testid="visio-camera-notice">
          <span className="flex-1">
            {cameraNotice === 'aucune-camera' && 'Aucune caméra disponible — le live continue en audio.'}
            {cameraNotice === 'retour-interne' && 'Caméra externe débranchée — retour à la caméra de l’appareil.'}
            {cameraNotice === 'camera-perdue' && 'Caméra débranchée — le live continue en audio.'}
          </span>
          {onDismissCameraNotice && (
            <button type="button" onClick={onDismissCameraNotice} aria-label="Fermer" className="p-0.5 rounded text-white/50 hover:text-white"><X className="w-3.5 h-3.5" /></button>
          )}
        </div>
      )}

      {/* 🎛️ Tiroir Sources (Phase 1) — en flux, fermé = rien de visible. */}
      {sources && canManageStage && onSelectCamera && (
        <SourcesDrawer
          ouvert={camMenuOpen}
          onFermer={() => setCamMenuOpen(false)}
          videoDevices={videoDevices}
          videoDeviceId={videoDeviceId}
          cameraOn={cameraOn}
          onSelectCamera={(id) => { onSelectCamera(id); }}
          onRefreshDevices={onRefreshDevices}
          {...sources}
        />
      )}

      {/* 🎥 Menu caméra (ancien, conservé quand `sources` n'est pas fourni). */}
      {!sources && camMenuOpen && canManageStage && onSelectCamera && (
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
