/**
 * 🎬 Phase 3 minimale — useProgramStream : la scène PROGRAMME devient un MediaStream A/V.
 *
 *   boîtes du programme (`layoutBoxes`)  ─┐
 *   médias existants (`resolveMedia`)    ─┼→ ProgramCompositor (canvas) → piste VIDÉO
 *   micro diffusé + musique + voix reçues ┘→ ProgramAudioBus (clones)  → piste AUDIO
 *                                              └────────── MediaStream programme ─────────┘
 *
 * Deux consommateurs, la même sortie : (1) Live Visio (`publishProgram` de useLiveKitStage :
 * la piste vidéo remplace la caméra publiée) ; (2) le multistream (Phase 5) publiera les
 * deux pistes dans la room pour l'Egress.
 *
 * `program === null` (aucune scène à l'antenne) → tout est arrêté, comportement d'avant.
 * Rien de ce hook ne crée un flux caméra/micro : il ne fait que LIRE l'existant.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SceneBox } from '@/lib/studioScenes';
import { ProgramCompositor, type ResolveMedia, type ResolutionProgramme, type StatsCompositeur, RESOLUTION_720P } from '@/lib/programCompositor';
import { ProgramAudioBus, entreesPourScene } from '@/lib/programAudio';

export interface SourcesAudioProgramme {
  /** Flux micro DIFFUSÉ du mixeur (gain + limiteur appliqués) — jamais le micro brut. */
  getMicStream: () => MediaStream | null;
  /** Musique du mixeur (`getMusicStream`), son réel post-gain (+ sons du timer). */
  getMusicStream: () => MediaStream | null;
  /** Voix participants reçues chez l'hôte (parole accordée), identité quand connue. */
  getTribeStreams: () => { peerId: string; userId: string | null; stream: MediaStream }[];
}

export interface UseProgramStreamOptions {
  boxes: SceneBox[];                // boîtes du PROGRAMME (vide = rien à l'antenne)
  resolveMedia: ResolveMedia;
  audio: SourcesAudioProgramme;
  /** Voix participants dans le programme : celles de la scène (défaut), toutes celles reçues, ou aucune. */
  participantsAudio?: 'scene' | 'tous' | 'aucun';
  resolution?: ResolutionProgramme;
}

export interface UseProgramStreamReturn {
  actif: boolean;
  stream: MediaStream | null;
  videoTrack: MediaStreamTrack | null;
  audioTrack: MediaStreamTrack | null;
  demarrer: () => MediaStream | null;
  arreter: () => void;
  /** Phase 4 : résolution à chaud, sans recréer la piste. */
  changerResolution: (res: ResolutionProgramme) => void;
  stats: { fps: number; msParFrame: number; resolution: ResolutionProgramme };
  /** Dernier abandon de la garde de performance (message court), sinon null. */
  avis: string | null;
}

export function useProgramStream(o: UseProgramStreamOptions): UseProgramStreamReturn {
  const compRef = useRef<ProgramCompositor | null>(null);
  const busRef = useRef<ProgramAudioBus | null>(null);
  const [actif, setActif] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [stats, setStats] = useState<{ fps: number; msParFrame: number; resolution: ResolutionProgramme }>({ fps: 0, msParFrame: 0, resolution: o.resolution ?? RESOLUTION_720P });
  const [avis, setAvis] = useState<string | null>(null);
  const audioRef = useRef(o.audio); audioRef.current = o.audio;
  const modeRef = useRef(o.participantsAudio ?? 'scene'); modeRef.current = o.participantsAudio ?? 'scene';

  const arreter = useCallback(() => {
    compRef.current?.arreter(); compRef.current = null;
    busRef.current?.arreter(); busRef.current = null;
    setStream(null); setActif(false);
  }, []);

  const demarrer = useCallback((): MediaStream | null => {
    if (compRef.current?.estActif && stream) return stream;
    const comp = new ProgramCompositor({
      resolution: o.resolution,
      onStats: (s: StatsCompositeur) => setStats({ fps: Math.round(s.fps), msParFrame: Math.round(s.msParFrame * 10) / 10, resolution: s.resolution }),
      onAbandon: (raison) => { setAvis(raison); arreter(); },
    });
    comp.mettreAJour(o.boxes, o.resolveMedia);
    const video = comp.demarrer();
    if (!video) { setAvis('compositeur indisponible (canvas/captureStream)'); return null; }
    const bus = new ProgramAudioBus();
    const audio = bus.demarrer();
    const pistes = [...video.getVideoTracks(), ...(audio?.getAudioTracks() ?? [])];
    const out = new MediaStream(pistes);
    compRef.current = comp; busRef.current = bus;
    setStream(out); setActif(true); setAvis(null);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [o.boxes, o.resolveMedia, o.resolution, arreter]);

  // Boîtes / médias qui changent pendant l'antenne → le compositeur suit sans couper la piste.
  useEffect(() => { compRef.current?.mettreAJour(o.boxes, o.resolveMedia); }, [o.boxes, o.resolveMedia]);

  // Entrées audio : mic + musique + participants selon la scène. Re-synchronisées à chaque changement
  // de boîtes et périodiquement (les voix participants arrivent/partent hors React).
  const participantsDansScene = useMemo(
    () => o.boxes.filter((b) => b.source.kind === 'participant' && b.source.id).map((b) => b.source.id as string),
    [o.boxes],
  );
  useEffect(() => {
    if (!actif) return;
    const sync = () => {
      const bus = busRef.current; if (!bus) return;
      const a = audioRef.current;
      const mic = a.getMicStream(); const musique = a.getMusicStream(); const tribu = a.getTribeStreams();
      const entrees = entreesPourScene({
        mic: !!mic, musique: !!musique,
        participantsDansScene,
        participantsAudibles: tribu.map((t) => t.userId ?? t.peerId),
        inclureParticipants: modeRef.current,
      });
      bus.synchroniser(entrees.map((e) => ({
        id: e.id, gain: e.gain,
        flux: e.id === 'mic' ? mic : e.id === 'musique' ? musique
          : tribu.find((t) => `participant:${t.userId ?? t.peerId}` === e.id)?.stream ?? null,
      })));
    };
    sync();
    const t = setInterval(sync, 2000);
    return () => clearInterval(t);
  }, [actif, participantsDansScene]);

  const changerResolution = useCallback((res: ResolutionProgramme) => { compRef.current?.changerResolution(res); }, []);

  useEffect(() => () => arreter(), [arreter]);

  return {
    actif, stream,
    videoTrack: stream?.getVideoTracks()[0] ?? null,
    audioTrack: stream?.getAudioTracks()[0] ?? null,
    demarrer, arreter, changerResolution, stats, avis,
  };
}

export default useProgramStream;
