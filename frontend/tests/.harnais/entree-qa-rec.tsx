/**
 * HARNAIS QA — vrais hooks (useStudio → useProgramStream → useProgramRecorder) + sources A/V
 * synthétiques. Copie de la Phase 4 (boosttribe-rec-int), enrichie pour le lot MP4/QuickTime :
 *  - `?antenne=0` : AUCUNE scène à l'antenne + l'effet exact de SessionPage qui appelle
 *    `programme.arreter()` dès que `boxesProgram` est vide (reproduction terrain) ;
 *  - `?fsa=1`      : garde `showSaveFilePicker` (Playwright l'injecte avec un handle OPFS) ;
 *  - `?source=720` : sources vidéo synthétiques en 1280×720 (comme la caméra 720p du Mac ; défaut 640×360) ;
 *  - `?resolution=720|1080|session` : résolution de DÉPART du compositeur. `session` = câblage EXACT de
 *                    SessionPage (aucune option `resolution` → 720p par défaut) : c'est le cas terrain du
 *                    20/09 « panneau 1920×1080, ffprobe 1280×720 » ; défaut = 1080 sur desktop, 720 sinon ;
 *  - `?programme=1` : démarre le Programme dès qu'une scène est à l'antenne (effet de SessionPage) → le
 *                    compositeur est DÉJÀ actif quand on enregistre (changerResolution à chaud avant start) ;
 *  - `window.__h`  : studio / programme / recorder / cut / demonter (unmount du hook).
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { RecordPanel } from '@/components/session/RecordPanel';
import { useStudio } from '@/hooks/useStudio';
import { useProgramStream } from '@/hooks/useProgramStream';
import { useProgramRecorder } from '@/hooks/useProgramRecorder';
import { RESOLUTION_720P, RESOLUTION_1080P } from '@/lib/programCompositor';
import { antennePourEnregistrer } from '@/lib/recordLogic';
import type { SceneType } from '@/lib/studioScenes';

const params = new URLSearchParams(location.search);

const SOURCE = params.get('source') === '720' ? { w: 1280, h: 720 } : { w: 640, h: 360 };

function sourceCanvas(couleur: string, nom: string, flash = false): MediaStream {
  const c = document.createElement('canvas'); c.width = SOURCE.w; c.height = SOURCE.h;
  const ctx = c.getContext('2d')!;
  const t0 = performance.now();
  const peindre = () => {
    const t = (performance.now() - t0) / 1000;
    const enFlash = flash && (t % 5) < 0.25;
    ctx.fillStyle = enFlash ? '#ffffff' : couleur; ctx.fillRect(0, 0, SOURCE.w, SOURCE.h);
    ctx.fillStyle = enFlash ? '#000' : '#fff'; ctx.font = 'bold 48px sans-serif'; ctx.fillText(nom + ' ' + t.toFixed(1) + 's', 40, SOURCE.h / 2 + 20);
    requestAnimationFrame(peindre);
  };
  peindre();
  return c.captureStream(30);
}

function sourcesAudio() {
  const ac = new AudioContext();
  (window as any).__ac = ac;
  const mic = ac.createMediaStreamDestination(); const mus = ac.createMediaStreamDestination();
  const osc = ac.createOscillator(); osc.frequency.value = 1000; const g = ac.createGain(); g.gain.value = 0;
  osc.connect(g).connect(mic); osc.start();
  const t0 = ac.currentTime;
  for (let i = 0; i < 40; i++) { g.gain.setValueAtTime(0.8, t0 + i * 5); g.gain.setValueAtTime(0, t0 + i * 5 + 0.25); }
  const osc2 = ac.createOscillator(); osc2.frequency.value = 220; const g2 = ac.createGain(); g2.gain.value = 0.25;
  osc2.connect(g2).connect(mus); osc2.start();
  return { getMicStream: () => mic.stream, getMusicStream: () => mus.stream, getTribeStreams: () => [] as any[] };
}

if (params.get('fsa') !== '1') { try { delete (window as any).showSaveFilePicker; } catch { (window as any).showSaveFilePicker = undefined; } }

function App() {
  const [srcs] = React.useState(() => ({
    coach: sourceCanvas('#00b050', 'COACH', true),
    coach2: sourceCanvas('#d91cd2', 'CAM 2'),
    participant: sourceCanvas('#1e60ff', 'SARA'),
    ecran: sourceCanvas('#e01010', 'ECRAN'),
    audio: sourcesAudio(),
  }));
  const [open, setOpen] = React.useState(true);
  const desktop = window.innerWidth >= 1024;
  const studio = useStudio({
    coachLabel: 'Coach', localStream: srcs.coach,
    secondaryCameras: [{ deviceId: 'cam2', label: 'Sony ZV-E10', stream: srcs.coach2 }],
    participants: [{ identity: 'p1', name: 'Sara', stream: srcs.participant }],
    screenShareActive: true, localScreen: srcs.ecran,
  });
  const resolutionDepart = params.get('resolution');
  const resolution = resolutionDepart === 'session' ? undefined : resolutionDepart === '720' ? RESOLUTION_720P : resolutionDepart === '1080' ? RESOLUTION_1080P : desktop ? RESOLUTION_1080P : RESOLUTION_720P;
  const programme = useProgramStream({ boxes: studio.boxesProgram, resolveMedia: studio.resolveMedia, audio: srcs.audio, resolution });
  // ── Effet EXACT de SessionPage (hôte) : rien à l'antenne → programme.arreter() ──
  const programmeALAntenne = studio.boxesProgram.length > 0;
  React.useEffect(() => {
    if (params.get('effetSession') === '0') return;
    if (!programmeALAntenne) programme.arreter();
    else if (params.get('programme') === '1' && !programme.actif) programme.demarrer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [programmeALAntenne, programme.actif]);
  const recorder = useProgramRecorder({
    programStream: programme.stream,
    // Câblage IDENTIQUE à SessionPage (fix 0 octet) — `?fixAntenne=0` rejoue l'ancien câblage.
    demarrerProgramme: async () => {
      if (params.get('fixAntenne') !== '0') {
        const verdict = antennePourEnregistrer(programmeALAntenne, studio.sources);
        if (verdict.action === 'refuser') throw new Error(verdict.message);
        if (verdict.action === 'mettre_coach') studio.cut('coach_full');
      }
      return programme.demarrer();
    },
    resolutionProgramme: (q) => programme.changerResolution(q === '1080p' ? RESOLUTION_1080P : RESOLUTION_720P),
    fpsProgramme: programme.stats.fps,
    arrierePlanProgramme: programme.stats.arrierePlan,
  });
  React.useEffect(() => {
    if (params.get('antenne') !== '0') studio.cut('coach_full', { participantId: 'p1', cam2Id: 'cam2' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  (window as any).__h = { studio, programme, recorder, cut: (t: SceneType) => studio.cut(t, { participantId: 'p1', cam2Id: 'cam2' }) };
  return (
    <div style={{ minHeight: '100vh', background: '#000' }} data-harnais>
      <RecordPanel recorder={recorder} open={open} onClose={() => setOpen(false)} mobile={!desktop} />
    </div>
  );
}
const root = createRoot(document.getElementById('root')!);
(window as any).__demonter = () => root.unmount();
root.render(<App />);
