/**
 * 🎬 Phase 3 — programStream : audio = bus programme alimenté par le MIXEUR existant (clones),
 * aucun second getUserMedia, aucun second pipeline beauté ; Live Visio reçoit le programme à la
 * place de la caméra, sans stopper la caméra.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { entreesPourScene } from './.build/programAudio.mjs';
import { lire, codeSeul } from './lireSource.mjs';

test('entrées audio : mic + musique + voix des participants DE LA SCÈNE (défaut)', () => {
  const e = entreesPourScene({ mic: true, musique: true, participantsDansScene: ['sara'], participantsAudibles: ['sara', 'leo'], inclureParticipants: 'scene' });
  assert.deepEqual(e.map((x) => x.id), ['mic', 'musique', 'participant:sara']);
});

test('entrées audio : mode « tous » et « aucun »', () => {
  assert.deepEqual(entreesPourScene({ mic: true, musique: false, participantsDansScene: [], participantsAudibles: ['sara', 'leo'], inclureParticipants: 'tous' }).map((x) => x.id), ['mic', 'participant:sara', 'participant:leo']);
  assert.deepEqual(entreesPourScene({ mic: false, musique: true, participantsDansScene: ['sara'], participantsAudibles: ['sara'], inclureParticipants: 'aucun' }).map((x) => x.id), ['musique']);
});

test('structurel : le bus audio clone les pistes et ne crée aucun micro', () => {
  const src = codeSeul(lire('lib', 'programAudio.ts'));
  assert.ok(src.includes('.clone()'), 'les pistes sont clonées (l’original n’est jamais capté)');
  assert.ok(!src.includes('getUserMedia'), 'aucun micro créé');
  assert.ok(src.includes('createMediaStreamDestination'), 'sortie = MediaStreamAudioDestinationNode');
});

test('structurel : le hook lit le mic DIFFUSÉ du mixeur, la musique du mixeur et les voix reçues ; pas de 2e beauté', () => {
  const hook = codeSeul(lire('hooks', 'useProgramStream.ts'));
  assert.ok(!hook.includes('useBeauteVisage') && !hook.includes('BeauteProcessor'), 'aucun second pipeline beauté');
  assert.ok(!hook.includes('getUserMedia') && !hook.includes('enumerateDevices'));
  const page = codeSeul(lire('pages', 'SessionPage.tsx'));
  assert.ok(page.includes('getMicStream: () => micDiffuseRef.current'), 'mic = flux diffusé (gain + limiteur du mixeur)');
  assert.ok(page.includes('getMusicStream: () => getMusicStream()'), 'musique = getMusicStream du mixeur');
  assert.ok(page.includes('getTribeStreams: () => getTribeAudioStreams()'), 'voix participants = usePeerAudio');
});

test('structurel : Live Visio reçoit le programme à la place de la caméra, caméra dépubliée mais VIVANTE', () => {
  const lk = codeSeul(lire('hooks', 'useLiveKitStage.ts'));
  assert.ok(lk.includes('unpublishTrack(cam, false)'), 'la caméra est dépubliée SANS être stoppée (beauté + compositeur continuent)');
  assert.ok(lk.includes("source: Track.Source.Camera, name: 'program'"), 'le programme est publié comme source Camera');
  assert.ok(lk.includes('restartTrack({ deviceId: { exact: deviceId } })'), 'bascule de caméra pendant le programme = restart local');
  const page = codeSeul(lire('pages', 'SessionPage.tsx'));
  assert.ok(page.includes('programmeVersParticipants'), 'drapeau « programme vers les participants »');
  assert.ok(page.includes('useState(true)') && page.includes('setProgrammeVersParticipants'), 'ON par défaut dès qu’une scène est à l’antenne');
});

test('structurel : le prompteur ne peut pas entrer dans le programme', () => {
  for (const f of [['lib', 'programCompositor.ts'], ['lib', 'programAudio.ts'], ['hooks', 'useProgramStream.ts'], ['hooks', 'useBroadcast.ts']]) {
    const src = codeSeul(lire(...f)).toLowerCase();
    assert.ok(!src.includes('prompteur'), `${f.join('/')} ignore le prompteur`);
  }
});
