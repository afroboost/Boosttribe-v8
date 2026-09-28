import React, { useLayoutEffect, useRef, useState } from 'react';
import { LayoutGrid, Rows3, Users, Maximize2, Minimize2, X, RefreshCw } from 'lucide-react';
import { SourcesDrawer, type SourcesDrawerProps } from '@/components/session/SourcesDrawer';
import { CameraTile } from '@/components/session/CameraTile';
import { LiveControls } from '@/components/session/LiveControls';
import { formatDureeRec, badgeVisible } from '@/lib/recordUi';
import { zoneCommentaires, colonnesGrille } from '@/lib/liveControls';
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
  /** @deprecated Ignorée : le micro est dans la barre unique pour TOUS (hôte compris).
   *  Conservée pour compatibilité d'appel. */
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
  /**
   * Démarre / arrête RÉELLEMENT l'enregistrement (bouton rond de la barre). C'est la
   * même mécanique que le panneau — `recorder.demarrer()` / `recorder.arreter()`, avec
   * la règle « rien à l'antenne → caméra du coach » déjà branchée dedans. `onToggleRecord`,
   * lui, ne fait qu'ouvrir le panneau : les deux portes restent distinctes et existantes.
   */
  /** 🔴 Terminer RÉELLEMENT le live (arrêt, annonce, statut public). Hôte seulement. */
  onTerminerLive?: () => void;
  onRecordDirect?: () => void;
  /** 🤖 Souffleur privé de l'hôte. @deprecated plus de bouton dans la barre : l'assistant
   *  vit DANS le panneau Prompteur (icône Prompteur). Props conservées pour compatibilité. */
  onToggleAssistant?: () => void;
  assistantOuvert?: boolean;
  assistantActif?: boolean;
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
  /**
   * 🔴 Hôte PROPRIÉTAIRE de la session : seul à voir « Terminer » (qui coupe le Live pour
   * tous). Un co-hôte gère la scène mais ne termine pas : son ⋮ garde « Quitter ».
   * Non fourni : repli sur `canManageStage` (ancien comportement).
   */
  estHote?: boolean;
  // 💬 CALQUES LIVE posés SUR la vidéo, rendus DANS la zone caméra (donc aussi en plein
  //    écran). Ordre de priorité de l'écran : 1) personnes en vidéo 2) commandes 3) chat
  //    4) réactions. Tailles : `zoneCommentaires` (lib/liveControls).
  /** Flux de commentaires, en bas à gauche au-dessus du champ. */
  chatOverlayNode?: React.ReactNode;
  /** Réactions / likes, colonne étroite à droite. */
  reactionsNode?: React.ReactNode;
  /** Champ « écrire un commentaire », juste au-dessus de la barre de commandes. */
  commentInputNode?: React.ReactNode;
  /** Commentaires masqués (flux + champ) — réglé depuis le menu ⋮. */
  commentairesMasques?: boolean;
  onToggleCommentaires?: () => void;
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
  micActive, onToggleMic, onToggleCamera, onLeaveLive,
  canManageStage = true, stageRequestPending = false, onRequestStage,
  spotlightId: spotlightIdProp, onSpotlightChange,
  onStartTimer, timerNode,
  videoDevices = [], videoDeviceId = null, onSelectCamera, onFlipCamera, onRefreshDevices,
  sources, cameraNotice = null, onDismissCameraNotice,
  onToggleScreenShare, screenSharing = false, screenSupported = false,
  embellirNode, studioNode, studioOpen = false, onToggleStudio, onToggleStageRequests, stageRequestCount,
  broadcastNode, broadcastOpen = false, broadcastLive = false, onToggleBroadcast, screenShareDisponible = true,
  onTerminerLive, onRecordDirect,
  recordNode, recordOpen = false, recordEtat = 'inactif', recordDureeSec = 0, recordSupporte = true, recordMotif, onToggleRecord,
  prompteurNode, prompteurTiroirNode, prompteurOuvert = false, onTogglePrompteur, audioNode,
  connexionScene, estHote,
  chatOverlayNode, reactionsNode, commentInputNode, commentairesMasques = false, onToggleCommentaires,
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
  // 📜 ramenerBarre — ouvrir le Prompteur réserve de la place sous les caméras (le visage
  //    reste libre) : sur un écran court, la barre Live passait SOUS le bas de l'écran (mesuré
  //    en prod, 414/430 px). Une fonction = un endroit : la barre doit rester atteignable.
  //    `nearest` ne bouge rien si elle est déjà visible.
  React.useEffect(() => {
    if (!prompteurOuvert || camFullscreen) return;
    const ramenerBarre = () => {
      const barre = camAreaRef.current?.querySelector('[data-testid="visio-controls"]');
      const reduit = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      barre?.scrollIntoView({ block: 'nearest', behavior: reduit ? 'auto' : 'smooth' });
    };
    const id = requestAnimationFrame(ramenerBarre);
    return () => cancelAnimationFrame(id);
  }, [prompteurOuvert, camFullscreen]);
  // 📏 Largeur RÉELLE de la zone caméra : décide ce qui tient dans la barre et la place du
  //    chat. Mise à jour seulement si elle change (pas de setState à l'identique → pas de boucle).
  const [largeurZone, setLargeurZone] = useState<number>(() => (typeof window !== 'undefined' ? window.innerWidth : 1280));
  useLayoutEffect(() => {
    const el = camAreaRef.current;
    if (!el) return;
    const mesurer = () => {
      const l = Math.round(el.getBoundingClientRect().width);
      if (l > 0) setLargeurZone((p) => (p === l ? p : l));
    };
    mesurer();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(mesurer) : null;
    ro?.observe(el);
    window.addEventListener('resize', mesurer);
    return () => { ro?.disconnect(); window.removeEventListener('resize', mesurer); };
  }, [camFullscreen]);
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

  // 💬 Place des calques (chat / champ / réactions) : fonction pure, testée.
  const avecCalques = !!(chatOverlayNode || reactionsNode || commentInputNode);
  const zone = zoneCommentaires({
    largeur: largeurZone,
    // QA 28/09 : une vignette « caméra coupée » se recouvre aussi — toute vignette compte.
    camerasActives: Math.max(activeCameraCount, participants.length),
    pleinEcran: camFullscreen,
    vignettes: camFullscreen && fsOthers.length > 0,
    avecCalques,
    prompteurOuvert: prompteurOuvert && !!prompteurTiroirNode,
  });
  const chatVisible = !!chatOverlayNode && !commentairesMasques;
  const inputVisible = !!commentInputNode && !commentairesMasques;

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
        /* Hors plein écran : sous les vignettes, la place de la barre (et du chat s'il y a
           plusieurs caméras) — les personnes filmées ne sont jamais recouvertes. */
        style={camFullscreen ? undefined : { minHeight: zone.hauteurMin, paddingBottom: `calc(0.75rem + ${zone.reserveBas} + ${zone.reservePrompteur})` }}
        data-testid="visio-camera-area"
      >
        {camFullscreen ? (
          /* 🔍 PLEIN ÉCRAN : une caméra en grand (object-contain → jamais rogner le visage), orientation auto,
             bande de vignettes en bas (taper = elle passe en grand), bouton Réduire + timer overlay (lecture seule). */
          <>
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
            {timerNode}
            {/* 📜 Le texte reste SUR la vidéo en plein écran : c'est justement là qu'on parle. */}
            {prompteurNode}
            {/* ✍️ …et on peut l'ÉCRIRE là aussi, sans sortir du plein écran. Jamais sur le
                centre de l'image (le visage) — QA 28/09 : à 55 % de haut il le couvrait.
                Téléphone / tablette : moitié BASSE ; grand écran : moitié DROITE. */}
            <div
              className={`pointer-events-none absolute z-[135] ${largeurZone < 1024 ? 'inset-x-0 top-1/2' : 'left-1/2 right-0 top-0'}`}
              style={{ bottom: 'env(safe-area-inset-bottom)' }}
              data-testid="visio-prompteur-place"
            >
              {prompteurTiroirNode}
            </div>
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
          /* Colonnes selon la largeur de la ZONE (colonne desktop ≈ 384 px), pas de l'écran. */
          <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${colonnesGrille(largeurZone, participants.length)}, minmax(0, 1fr))` }}>
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
        {/* Hors plein écran, le panneau occupe une place RÉSERVÉE sous les vignettes
            (`reservePrompteur`) : il ne recouvre plus les personnes filmées. */}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 z-[135]"
          style={{ height: `calc(0.75rem + ${zone.reserveBas} + ${zone.reservePrompteur})` }}
          data-testid="visio-prompteur-place"
        >
          {!camFullscreen && prompteurTiroirNode}
        </div>

        {/* 🎛️ COUCHE LIVE — UNE seule, dans les DEUX modes (le plein écran prend cette zone pour
            cible, donc tout ce qui est ici le suit). Transparente aux clics, sauf ses éléments.
            Du bas vers le haut : barre de commandes → musique (plein écran) → champ commentaire
            → vignettes des invités (plein écran) → flux de chat (gauche) + réactions (droite).
            z-[115] : au-dessus de l'overlay du prompteur (z-[112]), sous ses tiroirs (z-[140]). */}
        <div
          className="pointer-events-none absolute z-[115] inset-0 flex flex-col justify-end gap-2"
          style={camFullscreen ? {
            paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))',
            paddingLeft: 'env(safe-area-inset-left)',
            paddingRight: 'env(safe-area-inset-right)',
          } : { paddingBottom: '0.25rem' }}
          data-testid="visio-calques"
          data-mobile={zone.mobile ? 'true' : 'false'}
          data-reduit={zone.reduit ? 'true' : 'false'}
        >
          {/* Voile léger sous les commandes (plein écran : la vidéo va jusqu'en bas) — lisibilité
              sans bandeau opaque. Hors plein écran, la barre a déjà sa place sous les vignettes. */}
          {camFullscreen && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 max-h-full bg-gradient-to-t from-black/55 via-black/20 to-transparent" aria-hidden="true" />
          )}

          {/* 3) Chat (gauche) + 4) réactions (droite) — hauteur bornée, jamais sur les invités. */}
          {(chatVisible || reactionsNode) && (
            <div className="relative flex items-end justify-between gap-2 px-2 min-h-0" style={{ height: zone.chatHauteurMax }} data-testid="visio-calque-haut">
              {chatVisible ? (
                <div className="pointer-events-none min-w-0 h-full overflow-hidden" style={{ width: '100%', maxWidth: zone.chatLargeurMax }} data-testid="visio-calque-chat">
                  {chatOverlayNode}
                </div>
              ) : <span />}
              {reactionsNode && (
                <div className="pointer-events-none shrink-0 h-full flex flex-col justify-end" style={{ width: zone.reactionsLargeur }} data-testid="visio-calque-reactions">
                  {reactionsNode}
                </div>
              )}
            </div>
          )}

          {/* 1) Invités en vignettes (plein écran) : taper = passe en grand. */}
          {camFullscreen && fsOthers.length > 0 && (
            <div className="pointer-events-auto relative flex gap-2 overflow-x-auto px-2" data-testid="visio-fs-thumbs">
              {fsOthers.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="w-24 flex-shrink-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--bt-accent)]"
                  onClick={() => setSpotlightId(p.id)}
                  aria-label={`Afficher ${p.name} en grand`}
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

          {/* Champ commentaire : pleine largeur sur téléphone, ≤ 24 rem à gauche sur ordinateur. */}
          {inputVisible && (
            <div className="pointer-events-auto relative px-2 w-full" style={{ maxWidth: zone.inputLargeurMax }} data-testid="visio-calque-input">
              {commentInputNode}
            </div>
          )}

          {/* 🎵 Musique atteignable sans sortir du plein écran. */}
          {audioNode && camFullscreen && (
            <div className="pointer-events-none relative flex justify-center px-3" data-testid="visio-fs-audio">
              <div className="pointer-events-auto w-full max-w-sm">{audioNode}</div>
            </div>
          )}

          {/* 2) LA barre de commandes — même composant en vue normale et en plein écran. */}
          <LiveControls
            pleinEcran={camFullscreen}
            largeur={largeurZone}
            className="relative self-center"
            micActive={micActive}
            onToggleMic={onToggleMic}
            cameraOn={cameraOn}
            canManageStage={canManageStage}
            estHote={estHote}
            onToggleCamera={onToggleCamera}
            onRequestStage={onRequestStage}
            stageRequestPending={stageRequestPending}
            onToggleStageRequests={onToggleStageRequests}
            stageRequestCount={stageRequestCount}
            onFlipCamera={onFlipCamera}
            peutBasculerCamera={videoDevices.length > 1}
            onSources={onSelectCamera ? () => { onRefreshDevices?.(true); setCamMenuOpen((o) => !o); } : undefined}
            sourcesOuvertes={camMenuOpen}
            sourcesAvancees={!!sources}
            onToggleScreenShare={onToggleScreenShare}
            screenSharing={screenSharing}
            screenSupported={screenSupported}
            screenShareDisponible={screenShareDisponible}
            onRecordDirect={onRecordDirect}
            onToggleRecord={onToggleRecord}
            recordOpen={recordOpen}
            recordEtat={recordEtat}
            recordDureeSec={recordDureeSec}
            recordSupporte={recordSupporte}
            recordMotif={recordMotif}
            onTogglePrompteur={onTogglePrompteur}
            prompteurOuvert={prompteurOuvert}
            onToggleBroadcast={onToggleBroadcast}
            broadcastOpen={broadcastOpen}
            broadcastLive={broadcastLive}
            onTerminerLive={onTerminerLive}
            onStartTimer={onStartTimer}
            onToggleStudio={onToggleStudio}
            studioOpen={studioOpen}
            embellirNode={embellirNode}
            commentairesMasques={commentairesMasques}
            onToggleCommentaires={onToggleCommentaires}
            onLeaveLive={onLeaveLive}
            onReduce={camFullscreen ? exitCamFullscreen : undefined}
          />
        </div>
      </div>

      {/* 🎵 Commandes musique — dans le panneau, juste sous les caméras. */}
      {audioNode && !camFullscreen && (
        <div className="px-3 pb-1" data-testid="visio-audio">{audioNode}</div>
      )}

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
