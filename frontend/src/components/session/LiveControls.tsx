import React from 'react';
import { Mic, MicOff, Video, VideoOff, Hand, Minimize2, MonitorUp, MonitorX, ScrollText, Power, SwitchCamera, SlidersHorizontal } from 'lucide-react';
import { Timer, Clapperboard, Sparkles, Disc, Square, LogOut, MessageSquareOff, MessageSquare, Users, Radio } from 'lucide-react';
import { MenuActions, type MenuAction } from '@/components/session/MenuActions';
import { libelleItemRecord, formatDureeRec } from '@/lib/recordUi';
import { repartirCommandes, SEUIL_MOBILE, TAILLE_BOUTON, LARGEUR_PILULE, ESPACE_BOUTONS, ESPACE_COLONNE, type CommandeId } from '@/lib/liveControls';
import type { RecEtat } from '@/components/session/RecordTypes';

/**
 * 🎛️ LA barre de commandes du Live — une seule, partagée par la vue normale ET le plein
 * écran caméra (et, en colonne, par le plein écran de la vidéo partagée via VisioControlBar).
 *
 * Principe Live mobile : la vidéo domine, les commandes flottent sur un voile léger (en
 * colonne à droite pour le Live Visio depuis la barre v2).
 * Barre = l'essentiel (micro, caméra, partage d'écran, enregistrer, prompteur, diffusion,
 * terminer) ; TOUT le secondaire vit dans le menu ⋮. Ce qui ne tient pas (largeur en rangée,
 * hauteur en colonne) descend dans ⋮ (règle pure `repartirCommandes`) : jamais de défilement.
 *
 * Présentation seulement : chaque bouton appelle EXACTEMENT le gestionnaire reçu, aucun
 * état métier n'est créé ici.
 */
export interface LiveControlsProps {
  /** Plein écran caméra (ou vidéo partagée) : data-testid historiques « visio-fs-* ». */
  pleinEcran: boolean;
  /** Rangée (défaut) ou colonne à droite (Live Visio depuis la barre v2, vidéo partagée). */
  orientation?: 'horizontale' | 'verticale';
  /** Largeur utile mesurée (px) ; sans mesure : aucune contrainte. */
  largeur?: number;
  /** Colonne : hauteur utile mesurée (px) — ce qui ne tient pas passe dans ⋮. Sans mesure : aucune contrainte. */
  hauteur?: number;
  className?: string;
  style?: React.CSSProperties;

  micActive?: boolean;
  onToggleMic?: () => void;
  cameraOn?: boolean;
  canManageStage?: boolean;
  /** Hôte propriétaire : seul à pouvoir TERMINER le Live pour tous (le co-hôte quitte). */
  estHote?: boolean;
  onToggleCamera?: () => void;
  onRequestStage?: () => void;
  stageRequestPending?: boolean;
  onToggleStageRequests?: () => void;
  stageRequestCount?: number;

  onFlipCamera?: () => void;
  /** Plusieurs caméras détectées : la bascule avant/arrière a un sens. */
  peutBasculerCamera?: boolean;
  /** Sources / caméra externe (item ⋮). */
  onSources?: () => void;
  sourcesOuvertes?: boolean;
  sourcesAvancees?: boolean;

  onToggleScreenShare?: () => void;
  screenSharing?: boolean;
  screenSupported?: boolean;
  screenShareDisponible?: boolean;

  onRecordDirect?: () => void;
  onToggleRecord?: () => void;
  recordOpen?: boolean;
  recordEtat?: RecEtat;
  recordDureeSec?: number;
  recordSupporte?: boolean;
  recordMotif?: string;

  onTogglePrompteur?: () => void;
  prompteurOuvert?: boolean;

  onToggleBroadcast?: () => void;
  broadcastOpen?: boolean;
  broadcastLive?: boolean;

  onTerminerLive?: () => void;
  onStartTimer?: () => void;
  onToggleStudio?: () => void;
  studioOpen?: boolean;
  embellirNode?: React.ReactNode;

  commentairesMasques?: boolean;
  onToggleCommentaires?: () => void;

  onLeaveLive?: () => void;
  onReduce?: () => void;
}

// Boutons ronds : 44 px (cible tactile), focus clavier visible, voile translucide.
const ROUND = 'w-11 h-11 shrink-0 rounded-full flex items-center justify-center shadow-lg transition-colors backdrop-blur-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--bt-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-black';
const DARK = 'bg-black/45 text-white/90 hover:bg-black/65';
const GREEN = 'bg-green-500/40 text-green-100 hover:bg-green-500/50';
const ACCENT = 'bg-[rgb(var(--bt-accent-rgb)/0.4)] text-[var(--bt-accent)] hover:bg-[rgb(var(--bt-accent-rgb)/0.5)]';
const PILL = 'min-h-[44px] shrink-0 flex items-center gap-1.5 px-3.5 rounded-full text-xs font-medium backdrop-blur-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--bt-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-black';

export const LiveControls: React.FC<LiveControlsProps> = ({
  pleinEcran, orientation = 'horizontale', largeur = Infinity, hauteur = Infinity, className = '', style,
  micActive = false, onToggleMic, cameraOn = false, canManageStage = false, estHote, onToggleCamera,
  onRequestStage, stageRequestPending = false, onToggleStageRequests, stageRequestCount = 0,
  onFlipCamera, peutBasculerCamera = false, onSources, sourcesOuvertes = false, sourcesAvancees = false,
  onToggleScreenShare, screenSharing = false, screenSupported = false, screenShareDisponible = true,
  onRecordDirect, onToggleRecord, recordOpen = false, recordEtat = 'inactif', recordDureeSec = 0, recordSupporte = true, recordMotif,
  onTogglePrompteur, prompteurOuvert = false,
  onToggleBroadcast, broadcastOpen = false, broadcastLive = false,
  onTerminerLive, onStartTimer, onToggleStudio, studioOpen = false, embellirNode,
  commentairesMasques = false, onToggleCommentaires,
  onLeaveLive, onReduce,
}) => {
  const vertical = orientation === 'verticale';
  // Écran large (≥ 640 px) : décide du partage d'écran « indisponible » visible (desktop).
  const ecranLarge = largeur >= SEUIL_MOBILE;
  // Pilule « Terminer » avec texte : seulement en rangée large (une colonne reste ronde).
  const large = !vertical && ecranLarge;

  // 🔴 Terminer = hôte propriétaire. Sans `estHote` fourni : ancien comportement (canManageStage).
  const peutTerminer = !!onTerminerLive && (estHote ?? canManageStage);
  const terminer = () => { if (onTerminerLive && window.confirm('Terminer le Live pour tout le monde ?')) onTerminerLive(); };
  const enregistrer = recordSupporte ? (onRecordDirect || onToggleRecord) : undefined;

  // ── Commandes disponibles pour CET utilisateur (avant la contrainte de largeur) ──
  const candidats: CommandeId[] = [];
  if (onToggleMic) candidats.push('micro');
  if (onToggleCamera && (canManageStage || cameraOn)) candidats.push('camera');
  if (!canManageStage && !cameraOn && (onRequestStage || stageRequestPending)) candidats.push('scene');
  if (canManageStage && screenSupported && onToggleScreenShare && (screenShareDisponible || ecranLarge)) candidats.push('partage');
  if (canManageStage && (onRecordDirect || onToggleRecord)) candidats.push('record');
  if (onTogglePrompteur) candidats.push('prompteur');
  if (canManageStage && onToggleBroadcast) candidats.push('diffusion');
  if (canManageStage && onToggleStageRequests && stageRequestCount > 0) candidats.push('demandes');
  if (peutTerminer) candidats.push('terminer');
  if (onReduce) candidats.push('reduire');

  const pilules = !vertical;
  // Colonne : contrainte par sa HAUTEUR (gap-3) ; rangée : par sa largeur (gap-2).
  const { barre, menu } = repartirCommandes(candidats, vertical ? hauteur : largeur, {
    camera: !canManageStage && pilules ? 150 : TAILLE_BOUTON,
    scene: pilules ? LARGEUR_PILULE : TAILLE_BOUTON,
    terminer: large ? 104 : TAILLE_BOUTON,
  }, vertical ? ESPACE_COLONNE : ESPACE_BOUTONS);
  const enBarre = (c: CommandeId) => barre.includes(c);

  // ── Commandes principales qui débordent : mêmes gestionnaires, rangées dans ⋮ ──
  const debordement: Record<CommandeId, () => MenuAction | null> = {
    micro: () => ({ id: 'd-micro', label: micActive ? 'Couper le micro' : 'Activer le micro', icon: micActive ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />, onSelect: onToggleMic!, active: micActive, testId: pleinEcran ? 'visio-fs-mic' : 'visio-mic-toggle' }),
    camera: () => ({ id: 'd-camera', label: canManageStage ? (cameraOn ? 'Couper la caméra' : 'Allumer la caméra') : 'Quitter la scène', icon: cameraOn ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />, onSelect: onToggleCamera!, active: canManageStage ? cameraOn : undefined, testId: pleinEcran ? 'visio-fs-camera' : 'visio-camera-toggle' }),
    scene: () => (stageRequestPending ? null : { id: 'd-scene', label: 'Demander à monter en vidéo', icon: <Hand className="w-5 h-5" />, onSelect: onRequestStage!, testId: pleinEcran ? 'visio-fs-stage' : 'visio-request-stage' }),
    partage: () => (screenShareDisponible ? { id: 'd-partage', label: screenSharing ? 'Arrêter le partage d\'écran' : 'Partager mon écran', icon: screenSharing ? <MonitorX className="w-5 h-5" /> : <MonitorUp className="w-5 h-5" />, onSelect: onToggleScreenShare!, active: screenSharing, testId: 'visio-screen-share' } : null),
    record: () => (enregistrer ? { id: 'd-record', label: recordEtat === 'enregistrement' ? `Arrêter l'enregistrement (${formatDureeRec(recordDureeSec)})` : 'Démarrer l’enregistrement', icon: recordEtat === 'enregistrement' ? <Square className="w-5 h-5" /> : <Disc className="w-5 h-5" />, onSelect: enregistrer, active: recordEtat === 'enregistrement', testId: 'visio-record-direct' } : null),
    prompteur: () => ({ id: 'd-prompteur', label: 'Prompteur', icon: <ScrollText className="w-5 h-5" />, onSelect: onTogglePrompteur!, active: prompteurOuvert, testId: pleinEcran ? 'visio-fs-prompteur' : 'visio-prompteur-toggle' }),
    diffusion: () => ({ id: 'broadcast', label: broadcastLive ? 'En direct — gérer' : 'Diffuser en direct', icon: <Radio className="w-5 h-5" />, onSelect: onToggleBroadcast!, active: broadcastLive || broadcastOpen, testId: 'visio-broadcast-item' }),
    demandes: () => ({ id: 'd-demandes', label: `Demandes de scène (${stageRequestCount})`, icon: <Hand className="w-5 h-5" />, onSelect: onToggleStageRequests!, testId: pleinEcran ? 'visio-fs-stage-requests' : 'visio-stage-requests' }),
    terminer: () => ({ id: 'd-terminer', label: 'Terminer le Live', icon: <Power className="w-5 h-5" />, onSelect: terminer, danger: true, testId: 'visio-terminer-live' }),
    reduire: () => ({ id: 'd-reduire', label: 'Quitter le plein écran', icon: <Minimize2 className="w-5 h-5" />, onSelect: onReduce!, testId: 'visio-camera-fs-reduce' }),
  };
  const itemsDebordement = menu.map((c) => debordement[c]()).filter((x): x is MenuAction => !!x);

  // ── Menu ⋮ : tout le secondaire. Ordre : Sources → Bascule → Interval → Studio → Scène →
  //    Enregistrer (panneau) → Embellir → Commentaires → Quitter (rouge, dernier). ──
  const items: MenuAction[] = [
    ...itemsDebordement.filter((i) => !i.danger),
    ...(canManageStage && onSources ? [{
      id: 'sources',
      label: sourcesAvancees ? 'Sources' : 'Caméra externe',
      icon: sourcesAvancees ? <SlidersHorizontal className="w-5 h-5" /> : <SwitchCamera className="w-5 h-5" />,
      onSelect: onSources,
      active: sourcesOuvertes,
      testId: sourcesAvancees ? 'visio-sources' : 'visio-camera-menu',
    }] : []),
    ...(canManageStage && onFlipCamera && peutBasculerCamera ? [{
      id: 'flip',
      label: 'Changer de caméra (avant/arrière)',
      icon: <SwitchCamera className="w-5 h-5" />,
      onSelect: onFlipCamera,
      testId: 'visio-camera-flip',
    }] : []),
    ...(onStartTimer && canManageStage ? [{
      id: 'interval',
      label: 'Interval training',
      icon: <Timer className="w-5 h-5" />,
      onSelect: onStartTimer,
      testId: pleinEcran ? 'visio-fs-timer' : 'visio-start-timer',
    }] : []),
    ...(onToggleStudio && canManageStage ? [{
      id: 'studio',
      label: 'Studio',
      icon: <Clapperboard className="w-5 h-5" />,
      onSelect: onToggleStudio,
      active: studioOpen,
      testId: 'visio-studio',
    }] : []),
    ...(onToggleStageRequests && canManageStage && !candidats.includes('demandes') ? [{
      id: 'gestion-scene',
      label: 'Gestion de la scène',
      icon: <Users className="w-5 h-5" />,
      onSelect: onToggleStageRequests,
      testId: 'visio-gestion-scene',
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
    ...(onToggleCommentaires ? [{
      id: 'commentaires',
      label: commentairesMasques ? 'Afficher les commentaires' : 'Masquer les commentaires',
      icon: commentairesMasques ? <MessageSquare className="w-5 h-5" /> : <MessageSquareOff className="w-5 h-5" />,
      onSelect: onToggleCommentaires,
      testId: 'visio-toggle-commentaires',
    }] : []),
    ...itemsDebordement.filter((i) => i.danger),
    ...(onLeaveLive ? [{
      id: 'quitter',
      label: 'Quitter le live',
      icon: <LogOut className="w-5 h-5" />,
      onSelect: onLeaveLive,
      danger: true,
      testId: 'visio-leave',
    }] : []),
  ];

  return (
    <div
      role="toolbar"
      aria-label="Commandes du Live"
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      className={`pointer-events-auto flex items-center ${vertical ? 'flex-col gap-3 py-2' : 'flex-row justify-center gap-2 px-2 py-1.5 max-w-full'} ${className}`}
      style={style}
      data-testid={pleinEcran ? 'visio-fs-controls' : 'visio-controls'}
    >
      {/* 🎤 Micro — pour tous (hôte compris) : un seul micro, dans la barre. */}
      {enBarre('micro') && (
        <button
          type="button"
          onClick={onToggleMic}
          className={`${ROUND} ${micActive ? GREEN : DARK}`}
          title={micActive ? 'Couper le micro' : 'Activer le micro'}
          aria-label={micActive ? 'Couper le micro' : 'Activer le micro'}
          aria-pressed={micActive}
          data-testid={pleinEcran ? 'visio-fs-mic' : 'visio-mic-toggle'}
        >
          {micActive ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
        </button>
      )}

      {/* 🎥 Caméra — hôte/co-hôte : on/off ; spectateur à l'écran : quitter la scène. */}
      {enBarre('camera') && (canManageStage ? (
        <button
          type="button"
          onClick={onToggleCamera}
          className={`${ROUND} ${cameraOn ? ACCENT : DARK}`}
          title={cameraOn ? 'Couper la caméra' : 'Allumer la caméra'}
          aria-label={cameraOn ? 'Couper la caméra' : 'Allumer la caméra'}
          aria-pressed={cameraOn}
          data-testid={pleinEcran ? 'visio-fs-camera' : 'visio-camera-toggle'}
        >
          {cameraOn ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
        </button>
      ) : (
        <button
          type="button"
          onClick={onToggleCamera}
          className={pilules ? `${PILL} bg-[rgb(var(--bt-accent-rgb)/0.3)] text-[var(--bt-accent)] hover:bg-[rgb(var(--bt-accent-rgb)/0.4)]` : `${ROUND} ${ACCENT}`}
          title="Descendre de la scène"
          aria-label="Quitter la scène"
          data-testid={pleinEcran ? 'visio-fs-camera' : 'visio-leave-stage'}
        >
          <VideoOff className="w-4 h-4" /><span className={pilules ? '' : 'sr-only'}>Quitter la scène</span>
        </button>
      ))}

      {/* 🙋 Spectateur : demander à monter en vidéo (ou demande en attente). */}
      {enBarre('scene') && (stageRequestPending ? (
        <button
          type="button"
          disabled
          className={pilules ? `${PILL} bg-[rgb(var(--bt-accent-rgb)/0.15)] text-[rgb(var(--bt-accent-rgb)/0.7)] cursor-default` : `${ROUND} ${DARK} opacity-60`}
          aria-label="Demande envoyée"
          data-testid={pleinEcran ? 'visio-fs-stage' : 'visio-request-pending'}
        >
          <Hand className="w-4 h-4" /><span className={pilules ? '' : 'sr-only'}>Demande envoyée…</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={onRequestStage}
          className={pilules ? `${PILL} bg-black/45 text-white/85 hover:bg-[rgb(var(--bt-accent-rgb)/0.25)] hover:text-[var(--bt-accent)]` : `${ROUND} ${DARK}`}
          aria-label="Demander à monter en vidéo"
          data-testid={pleinEcran ? 'visio-fs-stage' : 'visio-request-stage'}
        >
          <Hand className="w-4 h-4" /><span className={pilules ? '' : 'sr-only'}>Demander à monter en vidéo</span>
        </button>
      ))}

      {/* 🖥️ Partager l'écran — réutilise l'existant (getDisplayMedia + LiveKit ScreenShare). */}
      {enBarre('partage') && (
        <button
          type="button"
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

      {/* ⏺ ENREGISTRER — déclenche l'action existante (démarrer/arrêter), même état que l'item ⋮.
          Icône « record » : un disque plein ; en cours : un carré plein + la durée. L'état ne
          repose pas sur la seule couleur : forme, durée, point clignotant, aria-pressed. */}
      {enBarre('record') && (
        <button
          type="button"
          onClick={recordSupporte ? (onRecordDirect || onToggleRecord) : undefined}
          disabled={!recordSupporte}
          className={`relative ${ROUND} ${recordEtat === 'enregistrement' ? ACCENT : DARK}${recordSupporte ? '' : ' opacity-40 cursor-not-allowed'}`}
          title={!recordSupporte ? (recordMotif || 'Enregistrement indisponible')
            : recordEtat === 'enregistrement' ? `Arrêter l'enregistrement (${formatDureeRec(recordDureeSec)})`
            : recordEtat === 'finalisation' ? 'Finalisation en cours…'
            : 'Enregistrer'}
          aria-label={!recordSupporte ? (recordMotif || 'Enregistrement indisponible')
            : recordEtat === 'enregistrement' ? `Enregistrement en cours depuis ${formatDureeRec(recordDureeSec)} — arrêter`
            : recordEtat === 'finalisation' ? 'Finalisation de l’enregistrement en cours'
            : 'Démarrer l’enregistrement'}
          aria-pressed={recordEtat === 'enregistrement'}
          aria-disabled={!recordSupporte}
          data-testid="visio-record-direct"
          data-record-etat={recordEtat}
        >
          {recordEtat === 'enregistrement' ? (
            <span className="w-3.5 h-3.5 rounded-[3px] bg-current" aria-hidden="true" />
          ) : (
            <span className="w-5 h-5 rounded-full border-2 border-white/85 flex items-center justify-center" aria-hidden="true">
              <span className="w-2.5 h-2.5 rounded-full bg-[var(--bt-accent)]" />
            </span>
          )}
          {recordEtat === 'enregistrement' && (
            <span className="absolute -top-1 -right-1 flex items-center gap-0.5 px-1 rounded-full bg-[var(--bt-accent)] text-[8px] font-bold tracking-wide text-white leading-4 tabular-nums" data-testid="visio-record-direct-duree">
              <span className="w-1 h-1 rounded-full bg-white animate-pulse" aria-hidden="true" />
              {formatDureeRec(recordDureeSec)}
            </span>
          )}
        </button>
      )}

      {/* 📜 Prompteur — UNE seule icône (l'assistant IA vit désormais dans le panneau Prompteur).
          Aucune condition caméra : il se lit caméra coupée aussi. */}
      {enBarre('prompteur') && (
        <button
          type="button"
          onClick={onTogglePrompteur}
          className={`${ROUND} ${prompteurOuvert ? ACCENT : DARK}`}
          title={prompteurOuvert ? 'Masquer le prompteur' : 'Afficher le prompteur'}
          aria-label={prompteurOuvert ? 'Masquer le prompteur' : 'Afficher le prompteur'}
          aria-pressed={!!prompteurOuvert}
          data-testid={pleinEcran ? 'visio-fs-prompteur' : 'visio-prompteur-toggle'}
        >
          <ScrollText className="w-5 h-5" />
        </button>
      )}

      {/* 📡 Diffuser en direct — fuchsia + « LIVE » quand un direct tourne. */}
      {enBarre('diffusion') && (
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

      {/* 🙋 Demandes de scène en attente (hôte/co-hôte) — n'apparaît que s'il y en a. */}
      {enBarre('demandes') && (
        <button
          type="button"
          onClick={onToggleStageRequests}
          className={`${ROUND} ${ACCENT} relative`}
          title="Demandes de prise de caméra"
          aria-label={`Demandes de scène : ${stageRequestCount} en attente`}
          data-testid={pleinEcran ? 'visio-fs-stage-requests' : 'visio-stage-requests'}
        >
          <Hand className="w-5 h-5" />
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[var(--bt-accent-2)] text-white text-[10px] font-bold flex items-center justify-center" aria-hidden="true">
            {stageRequestCount > 9 ? '9+' : stageRequestCount}
          </span>
        </button>
      )}

      {/* 🔴 TERMINER LE LIVE — hôte seulement, confirmation avant de couper l'antenne. */}
      {enBarre('terminer') && (
        <button
          type="button"
          onClick={terminer}
          className={`${large ? PILL + ' font-semibold' : ROUND} bg-red-500/25 text-red-200 hover:bg-red-500/35 border border-red-500/45`}
          title="Terminer le Live : arrête la diffusion et prévient tout le monde"
          aria-label="Terminer le Live"
          data-testid="visio-terminer-live"
        >
          <Power className={large ? 'w-4 h-4' : 'w-5 h-5'} />{large && <span>Terminer</span>}
        </button>
      )}

      {/* 🔽 Réduire (sortir du plein écran caméra) */}
      {enBarre('reduire') && (
        <button
          type="button"
          onClick={onReduce}
          className={`${ROUND} ${DARK}`}
          title="Réduire"
          aria-label="Quitter le plein écran"
          data-testid="visio-camera-fs-reduce"
        >
          <Minimize2 className="w-5 h-5" />
        </button>
      )}

      {/* ⋮ Tout le secondaire (et ce qui déborde). Les data-testid historiques sont sur les items. */}
      {items.length > 0 && <MenuActions buttonClassName={`${ROUND} ${DARK}`} items={items} />}
    </div>
  );
};

export default LiveControls;
