/**
 * 🎬 Phase 2 mini studio — LOGIQUE DE SCÈNES, PURE (aucun React, aucun DOM).
 *
 * Deux zones : PREVIEW (ce que le coach prépare) et PROGRAMME (ce que les participants
 * voient). En Phase 2 le programme n'est qu'un ÉTAT : les participants continuent de
 * recevoir le flux LiveKit existant tel quel (`program === null` = « rien de composé »).
 * Phase 3 peindra `layoutBoxes(program)` sur un canvas pour en faire le programStream.
 *
 * Les sources ne sont pas créées ici : elles viennent de l'existant (caméra coach =
 * `localStream` de useLiveKitStage — déjà la piste traitée quand « Embellir » est actif —,
 * caméras secondaires de useSecondaryCameras, participants = remoteCameras, écran =
 * localScreen). Ce module ne fait que les NOMMER et les PLACER.
 */

export type SourceKind = 'coach' | 'coach2' | 'participant' | 'screen';

/** coach2 : id = deviceId de la caméra secondaire ; participant : id = identité LiveKit. */
export interface StudioSourceRef { kind: SourceKind; id?: string; label: string }

export type SceneType = 'coach_full' | 'participant_full' | 'split_50' | 'pip' | 'screen_coach' | 'cam1' | 'cam2';
export type PipPosition = 'tl' | 'tr' | 'bl' | 'br';

export interface StudioScene {
  id: string;
  type: SceneType;
  label: string;
  primarySource: StudioSourceRef | null;
  secondarySource: StudioSourceRef | null;
  layout: { kind: 'full' | 'split' | 'pip'; pip?: PipPosition };
}

/** Boîte normalisée 0..1 (Phase 3 la peindra sur le canvas du programStream). */
export interface SceneBox { source: StudioSourceRef; x: number; y: number; w: number; h: number; z: number }

export interface SceneTemplate {
  type: SceneType;
  label: string;
  icon: 'user' | 'users' | 'columns-2' | 'picture-in-picture-2' | 'monitor' | 'camera' | 'video';
  needs: SourceKind[];
}

/** A → G : modèles prédéfinis, pas d'éditeur libre. */
export const SCENE_TEMPLATES: SceneTemplate[] = [
  { type: 'coach_full', label: 'Coach plein écran', icon: 'user', needs: ['coach'] },
  { type: 'participant_full', label: 'Participant plein écran', icon: 'users', needs: ['participant'] },
  { type: 'split_50', label: 'Coach + participant', icon: 'columns-2', needs: ['coach', 'participant'] },
  { type: 'pip', label: "Image dans l'image", icon: 'picture-in-picture-2', needs: ['coach', 'participant'] },
  { type: 'screen_coach', label: 'Écran + coach', icon: 'monitor', needs: ['screen', 'coach'] },
  { type: 'cam1', label: 'Caméra 1', icon: 'camera', needs: ['coach'] },
  { type: 'cam2', label: 'Caméra 2', icon: 'video', needs: ['coach2'] },
];

const aSource = (sources: StudioSourceRef[], kind: SourceKind, id?: string): StudioSourceRef | undefined =>
  sources.find((s) => s.kind === kind && (id === undefined || s.id === id));

/** Scènes possibles avec les sources RÉELLEMENT présentes (G si une coach2, B/C/D si un participant, E si un écran). */
export function scenesDisponibles(sources: StudioSourceRef[]): SceneTemplate[] {
  return SCENE_TEMPLATES.filter((t) => t.needs.every((k) => !!aSource(sources, k)));
}

/** Taille de l'incrustation (fraction de la largeur ; la hauteur suit le même ratio que le cadre). */
export const PIP_TAILLE = 0.28;
export const PIP_MARGE = 0.02;

/**
 * Construit une scène depuis un modèle et les sources du moment. `null` si une source
 * requise manque. Le participant choisi (`opts.participantId`) prime ; sinon le premier.
 */
export function construireScene(
  type: SceneType,
  sources: StudioSourceRef[],
  opts?: { participantId?: string; pip?: PipPosition; cam2Id?: string },
): StudioScene | null {
  const modele = SCENE_TEMPLATES.find((t) => t.type === type);
  if (!modele) return null;
  const coach = aSource(sources, 'coach');
  const participant = opts?.participantId ? aSource(sources, 'participant', opts.participantId) : aSource(sources, 'participant');
  const screen = aSource(sources, 'screen');
  const cam2 = opts?.cam2Id ? aSource(sources, 'coach2', opts.cam2Id) : aSource(sources, 'coach2');
  const pip = opts?.pip ?? 'br';
  const base = { type, label: modele.label };
  switch (type) {
    case 'coach_full':
    case 'cam1':
      return coach ? { ...base, id: type, primarySource: coach, secondarySource: null, layout: { kind: 'full' } } : null;
    case 'cam2':
      return cam2 ? { ...base, id: `cam2:${cam2.id ?? ''}`, primarySource: cam2, secondarySource: null, layout: { kind: 'full' } } : null;
    case 'participant_full':
      return participant ? { ...base, id: `participant_full:${participant.id ?? ''}`, primarySource: participant, secondarySource: null, layout: { kind: 'full' } } : null;
    case 'split_50':
      return coach && participant
        ? { ...base, id: `split_50:${participant.id ?? ''}`, primarySource: coach, secondarySource: participant, layout: { kind: 'split' } }
        : null;
    case 'pip':
      return coach && participant
        ? { ...base, id: `pip:${participant.id ?? ''}:${pip}`, primarySource: participant, secondarySource: coach, layout: { kind: 'pip', pip } }
        : null;
    case 'screen_coach':
      return screen && coach
        ? { ...base, id: `screen_coach:${pip}`, primarySource: screen, secondarySource: coach, layout: { kind: 'pip', pip } }
        : null;
    default:
      return null;
  }
}

/** Boîtes normalisées 0..1 : full = 1 boîte ; split = 2 moitiés ; pip = principale + incrustation au coin, marge 0.02, z=1. */
export function layoutBoxes(scene: StudioScene): SceneBox[] {
  const p = scene.primarySource;
  const s = scene.secondarySource;
  if (!p) return [];
  if (scene.layout.kind === 'full') return [{ source: p, x: 0, y: 0, w: 1, h: 1, z: 0 }];
  if (scene.layout.kind === 'split') {
    const boxes: SceneBox[] = [{ source: p, x: 0, y: 0, w: 0.5, h: 1, z: 0 }];
    if (s) boxes.push({ source: s, x: 0.5, y: 0, w: 0.5, h: 1, z: 0 });
    return boxes;
  }
  // pip : ratio de l'incrustation = ratio du cadre → w et h identiques en fraction.
  const boxes: SceneBox[] = [{ source: p, x: 0, y: 0, w: 1, h: 1, z: 0 }];
  if (s) {
    const pos: PipPosition = scene.layout.pip ?? 'br';
    const x = pos === 'tl' || pos === 'bl' ? PIP_MARGE : 1 - PIP_TAILLE - PIP_MARGE;
    const y = pos === 'tl' || pos === 'tr' ? PIP_MARGE : 1 - PIP_TAILLE - PIP_MARGE;
    boxes.push({ source: s, x, y, w: PIP_TAILLE, h: PIP_TAILLE, z: 1 });
  }
  return boxes;
}

export interface StudioState {
  preview: StudioScene | null;
  /** `null` = aucune scène composée : les participants reçoivent le flux LiveKit existant. */
  program: StudioScene | null;
  selectedParticipant: string | null;
  pip: PipPosition;
}

export type StudioAction =
  | { type: 'preview'; scene: StudioScene }
  | { type: 'take' }
  | { type: 'cut'; scene: StudioScene }
  | { type: 'participant'; id: string | null }
  | { type: 'pip'; pos: PipPosition }
  | { type: 'clear_preview' };

export const STUDIO_INITIAL: StudioState = { preview: null, program: null, selectedParticipant: null, pip: 'br' };

const dependDuParticipant = (s: StudioScene | null): boolean =>
  !!s && [s.primarySource, s.secondarySource].some((r) => r?.kind === 'participant');
const dependDuPip = (s: StudioScene | null): boolean => !!s && s.layout.kind === 'pip';

/** Réducteur pur. TAKE : programme ← preview (la preview reste). CUT : programme ← scène immédiatement. */
export function studioReducer(state: StudioState, action: StudioAction): StudioState {
  switch (action.type) {
    case 'preview':
      return { ...state, preview: action.scene };
    case 'take':
      return state.preview ? { ...state, program: state.preview } : state;
    case 'cut':
      return { ...state, program: action.scene };
    case 'clear_preview':
      return { ...state, preview: null };
    case 'participant': {
      // La preview qui dépend du participant est recalculée avec le nouveau choix.
      const preview = state.preview && dependDuParticipant(state.preview) && action.id
        ? remplacerParticipant(state.preview, action.id)
        : state.preview;
      return { ...state, selectedParticipant: action.id, preview };
    }
    case 'pip': {
      const preview = state.preview && dependDuPip(state.preview)
        ? { ...state.preview, id: state.preview.id.replace(/:(tl|tr|bl|br)$/, `:${action.pos}`), layout: { ...state.preview.layout, pip: action.pos } }
        : state.preview;
      return { ...state, pip: action.pos, preview };
    }
    default:
      return state;
  }
}

function remplacerParticipant(scene: StudioScene, id: string): StudioScene {
  const swap = (r: StudioSourceRef | null): StudioSourceRef | null =>
    r && r.kind === 'participant' ? { ...r, id, label: r.label } : r;
  const primary = swap(scene.primarySource);
  const secondary = swap(scene.secondarySource);
  const ancien = [scene.primarySource, scene.secondarySource].find((r) => r?.kind === 'participant')?.id ?? '';
  return { ...scene, id: ancien ? scene.id.replace(ancien, id) : scene.id, primarySource: primary, secondarySource: secondary };
}
