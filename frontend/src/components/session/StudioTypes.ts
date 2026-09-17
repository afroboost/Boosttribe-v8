/**
 * 🎬 Studio (Phase 2) — CONTRAT vu par l'UI.
 *
 * Miroir STRUCTUREL du contrat de `lib/studioScenes.ts` / `hooks/useStudio.ts` (logique de
 * scènes, livrée par un autre lot) : l'UI ne dépend que de ces formes, pas de leur
 * implémentation. Le typage est structurel : l'objet rendu par `useStudio` s'y branche
 * tel quel à l'intégration, sans adaptateur.
 *
 * Rien de métier ici : aucun état, aucune scène construite, aucun média — seulement les
 * formes dont le panneau a besoin pour afficher et déclencher.
 */
export type SourceKind = 'coach' | 'coach2' | 'participant' | 'screen';

export interface StudioSourceRef {
  kind: SourceKind;
  /** coach2 : deviceId de la caméra secondaire ; participant : identité LiveKit. */
  id?: string;
  label: string;
}

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

export type SceneIcon = 'user' | 'users' | 'columns-2' | 'picture-in-picture-2' | 'monitor' | 'camera' | 'video';

export interface SceneTemplate {
  type: SceneType;
  label: string;
  icon: SceneIcon;
  needs: SourceKind[];
}

export interface StudioState {
  preview: StudioScene | null;
  /** `null` = aucune scène à l'antenne : le PROGRAMME est le flux live existant, tel quel. */
  program: StudioScene | null;
  selectedParticipant: string | null;
  pip: PipPosition;
}

/** Options de construction d'une scène (miroir de `construireScene`). */
export interface SceneOptions {
  participantId?: string;
  pip?: PipPosition;
  cam2Id?: string;
}

/** Ce que le panneau consomme — le retour de `useStudio`. */
export interface StudioLike {
  state: StudioState;
  sources: StudioSourceRef[];
  scenes: SceneTemplate[];
  preview: (type: SceneType, opts?: SceneOptions) => void;
  take: () => void;
  cut: (type: SceneType, opts?: SceneOptions) => void;
  setParticipant: (id: string | null) => void;
  setPip: (pos: PipPosition) => void;
  clearPreview: () => void;
}

export type StudioZone = 'preview' | 'program';

/** Scènes dont la disposition porte une vignette PiP (positions de coin réglables). */
export const SCENES_AVEC_PIP: ReadonlySet<SceneType> = new Set<SceneType>(['pip', 'screen_coach']);

export const PIP_POSITIONS: ReadonlyArray<{ pos: PipPosition; label: string }> = [
  { pos: 'tl', label: 'Haut gauche' },
  { pos: 'tr', label: 'Haut droite' },
  { pos: 'bl', label: 'Bas gauche' },
  { pos: 'br', label: 'Bas droite' },
];
