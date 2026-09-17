/**
 * 🎬 Phase 2 mini studio — le hook qui relie la logique PURE (`lib/studioScenes.ts`) aux
 * sources EXISTANTES. Il ne crée aucun flux : pas de getUserMedia, pas d'enumerateDevices.
 *
 *  - coach        → `localStream` de useLiveKitStage (déjà la piste traitée par « Embellir »
 *                    quand l'option est active : aucun second pipeline) ;
 *  - coach2       → caméras secondaires de useSecondaryCameras (Phase 1, aperçus locaux) ;
 *  - participant  → `remoteCameras` de useLiveKitStage (identité + MediaStream distant) ;
 *  - screen       → `localScreen` de useLiveKitStage.
 *
 * Le PROGRAMME reste un état : les participants continuent de recevoir le flux LiveKit
 * existant. Phase 3 branchera `boxesProgram` sur un compositeur canvas → programStream.
 */
import { useCallback, useMemo, useReducer } from 'react';
import {
  construireScene, layoutBoxes, scenesDisponibles, studioReducer, STUDIO_INITIAL,
  type PipPosition, type SceneBox, type SceneTemplate, type SceneType, type StudioSourceRef, type StudioState,
} from '@/lib/studioScenes';

export interface StudioCameraSecondaire { deviceId: string; label: string; stream: MediaStream | null }
export interface StudioParticipant { identity: string; name?: string; stream?: MediaStream | null; videoTrack?: MediaStreamTrack | null }

export interface UseStudioOptions {
  coachLabel?: string;
  localStream: MediaStream | null;
  secondaryCameras: StudioCameraSecondaire[];
  participants: StudioParticipant[];
  screenShareActive: boolean;
  localScreen?: MediaStream | null;
}

export type ResolveMedia = (src: StudioSourceRef) => MediaStream | MediaStreamTrack | null;

export interface UseStudioReturn {
  state: StudioState;
  sources: StudioSourceRef[];
  scenes: SceneTemplate[];
  preview: (type: SceneType, opts?: { participantId?: string; pip?: PipPosition; cam2Id?: string }) => void;
  take: () => void;
  cut: (type: SceneType, opts?: { participantId?: string; pip?: PipPosition; cam2Id?: string }) => void;
  setParticipant: (id: string | null) => void;
  setPip: (pos: PipPosition) => void;
  clearPreview: () => void;
  boxesPreview: SceneBox[];
  boxesProgram: SceneBox[];
  resolveMedia: ResolveMedia;
}

/** Les sources nommées, assemblées depuis l'existant (pur : testable sans React). */
export function assemblerSources(o: {
  coachLabel?: string; localStream: MediaStream | null; secondaryCameras: StudioCameraSecondaire[];
  participants: StudioParticipant[]; screenShareActive: boolean;
}): StudioSourceRef[] {
  const out: StudioSourceRef[] = [];
  if (o.localStream) out.push({ kind: 'coach', label: o.coachLabel || 'Coach' });
  for (const c of o.secondaryCameras) if (c.stream) out.push({ kind: 'coach2', id: c.deviceId, label: c.label || 'Caméra 2' });
  for (const p of o.participants) out.push({ kind: 'participant', id: p.identity, label: p.name || p.identity });
  if (o.screenShareActive) out.push({ kind: 'screen', label: 'Écran partagé' });
  return out;
}

/** `resolveMedia` par défaut : quel média DOM pour quelle source. Aucun flux créé ici. */
export function construireResolveMedia(o: {
  localStream: MediaStream | null; secondaryCameras: StudioCameraSecondaire[];
  participants: StudioParticipant[]; localScreen?: MediaStream | null;
}): ResolveMedia {
  return (src) => {
    switch (src.kind) {
      case 'coach': return o.localStream;
      case 'coach2': return o.secondaryCameras.find((c) => c.deviceId === src.id)?.stream ?? null;
      case 'participant': {
        const p = o.participants.find((x) => x.identity === src.id);
        return p?.stream ?? p?.videoTrack ?? null;
      }
      case 'screen': return o.localScreen ?? null;
      default: return null;
    }
  };
}

export function useStudio(o: UseStudioOptions): UseStudioReturn {
  const [state, dispatch] = useReducer(studioReducer, STUDIO_INITIAL);

  const sources = useMemo(
    () => assemblerSources(o),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [o.coachLabel, o.localStream, o.secondaryCameras, o.participants, o.screenShareActive],
  );
  const scenes = useMemo(() => scenesDisponibles(sources), [sources]);

  const options = useCallback(
    (opts?: { participantId?: string; pip?: PipPosition; cam2Id?: string }) => ({
      participantId: opts?.participantId ?? state.selectedParticipant ?? undefined,
      pip: opts?.pip ?? state.pip,
      cam2Id: opts?.cam2Id,
    }),
    [state.selectedParticipant, state.pip],
  );

  const preview = useCallback((type: SceneType, opts?: { participantId?: string; pip?: PipPosition; cam2Id?: string }) => {
    const scene = construireScene(type, sources, options(opts));
    if (scene) dispatch({ type: 'preview', scene });
  }, [sources, options]);

  const cut = useCallback((type: SceneType, opts?: { participantId?: string; pip?: PipPosition; cam2Id?: string }) => {
    const scene = construireScene(type, sources, options(opts));
    if (scene) dispatch({ type: 'cut', scene });
  }, [sources, options]);

  const take = useCallback(() => dispatch({ type: 'take' }), []);
  const clearPreview = useCallback(() => dispatch({ type: 'clear_preview' }), []);
  const setPip = useCallback((pos: PipPosition) => dispatch({ type: 'pip', pos }), []);

  // Changer de participant : le réducteur remplace l'identité ; on reconstruit la preview
  // depuis les sources pour que le LIBELLÉ suive aussi (le réducteur pur ne les connaît pas).
  const setParticipant = useCallback((id: string | null) => {
    dispatch({ type: 'participant', id });
    if (id && state.preview && [state.preview.primarySource, state.preview.secondarySource].some((r) => r?.kind === 'participant')) {
      const scene = construireScene(state.preview.type, sources, { participantId: id, pip: state.pip });
      if (scene) dispatch({ type: 'preview', scene });
    }
  }, [sources, state.preview, state.pip]);

  const boxesPreview = useMemo(() => (state.preview ? layoutBoxes(state.preview) : []), [state.preview]);
  const boxesProgram = useMemo(() => (state.program ? layoutBoxes(state.program) : []), [state.program]);

  const resolveMedia = useMemo(
    () => construireResolveMedia({ localStream: o.localStream, secondaryCameras: o.secondaryCameras, participants: o.participants, localScreen: o.localScreen }),
    [o.localStream, o.secondaryCameras, o.participants, o.localScreen],
  );

  return { state, sources, scenes, preview, take, cut, setParticipant, setPip, clearPreview, boxesPreview, boxesProgram, resolveMedia };
}

export default useStudio;
