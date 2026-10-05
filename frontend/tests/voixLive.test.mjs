/**
 * 🎙️ ÉCHO EN LIVE — audit du 02/10/2026 : AEC/NS/AGC coupés sur tous les micros de parole et
 * voix amplifiées ×1,5 à l'émission puis ×1,6 × 1,25 à l'écoute → écho puis larsen.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { TRAITEMENTS_PAROLE, GAINS_VOIX_DEFAUT, verifierTraitementsVoix } from './.build/voixLive.mjs';
import { lire, codeSeul } from './lireSource.mjs';

test('micros de parole : AEC + NS + AGC demandés', () => {
  assert.deepEqual(TRAITEMENTS_PAROLE, { echoCancellation: true, noiseSuppression: true, autoGainControl: true });
});

test('aucun gain automatique de voix > 1', () => {
  for (const [k, v] of Object.entries(GAINS_VOIX_DEFAUT)) assert.ok(k === 'micParticipantPct' ? v <= 100 : v <= 1, k);
});

test('getSettings fait foi : demandé ≠ appliqué', () => {
  const piste = (reel) => ({ getConstraints: () => ({ ...TRAITEMENTS_PAROLE }), getSettings: () => reel });
  assert.equal(verifierTraitementsVoix(piste({ echoCancellation: true, noiseSuppression: true, autoGainControl: true }), 't').actifs, true);
  const refus = verifierTraitementsVoix(piste({ echoCancellation: false, noiseSuppression: true, autoGainControl: true }), 't');
  assert.equal(refus.actifs, false);
  assert.equal(refus.demande.ec, true);
  assert.equal(verifierTraitementsVoix(null, 't'), null);
});

const SANS_TRAITEMENT = /echoCancellation:\s*false|noiseSuppression:\s*false|autoGainControl:\s*false/;

test('micro HÔTE (MicrophoneControl) : traitements de parole, plus aucun « false »', () => {
  const c = codeSeul(lire('components', 'audio', 'MicrophoneControl.tsx'));
  const bloc = c.slice(c.indexOf('useMicrophone({'), c.indexOf('useMicrophone({') + 300);
  assert.match(bloc, /\.\.\.TRAITEMENTS_PAROLE/);
  assert.doesNotMatch(bloc, SANS_TRAITEMENT);
});

test('micro PARTICIPANT (SessionPage) : traitements de parole, plus de makeup 150 %', () => {
  const c = codeSeul(lire('pages', 'SessionPage.tsx'));
  const bloc = c.slice(c.indexOf('const participantMic = useMicrophone({'), c.indexOf('const participantMic = useMicrophone({') + 300);
  assert.match(bloc, /\.\.\.TRAITEMENTS_PAROLE/);
  assert.doesNotMatch(bloc, SANS_TRAITEMENT);
  assert.doesNotMatch(bloc, /initialVolume:\s*150/);
});

test('micro SECONDAIRE : traitements de parole', () => {
  const c = codeSeul(lire('hooks', 'useSecondaryMic.ts'));
  assert.match(c, /audio: \{ deviceId: \{ exact: id \}, \.\.\.TRAITEMENTS_PAROLE \}/);
  assert.doesNotMatch(c, SANS_TRAITEMENT);
});

test('chaque capture micro vérifie getSettings()', () => {
  const c = codeSeul(lire('hooks', 'useMicrophone.ts'));
  assert.match(c, /verifierTraitementsVoix\(/);
  assert.match(codeSeul(lire('hooks', 'useSecondaryMic.ts')), /verifierTraitementsVoix\(/);
});

test('lecture : gains par défaut et sortie commune à 1 (plus de 1,6 / 1,4 / 1,25)', () => {
  const c = codeSeul(lire('hooks', 'usePeerAudio.ts'));
  assert.match(c, /const TRIBE_DEFAULT_GAIN = GAINS_VOIX_DEFAUT\.tribu;/);
  assert.match(c, /const RELAY_DEFAULT_GAIN = GAINS_VOIX_DEFAUT\.relais;/);
  assert.match(c, /const HOST_VOICE_DEFAULT_GAIN = GAINS_VOIX_DEFAUT\.voixHote;/);
  assert.match(c, /master\.gain\.value = GAINS_VOIX_DEFAUT\.sortie;/);
  assert.doesNotMatch(c, /gain\.value = 1\.25/);
});

test('émission hôte : micVolume par défaut à 1 (plus de 1,5)', () => {
  const c = codeSeul(lire('hooks', 'useAudioMixer.ts'));
  assert.match(c, /micVolume: GAINS_VOIX_DEFAUT\.micHote,/);
});

test('« M’entendre » reste coupé par défaut (gain 0)', () => {
  assert.match(codeSeul(lire('hooks', 'useAudioMixer.ts')), /monitor\.gain\.value = 0;/);
});

test('une seule sortie par voix : secours <audio> actif ⇒ chemin Web Audio à 0, retour au normal quand le contexte reprend', () => {
  const c = codeSeul(lire('hooks', 'usePeerAudio.ts'));
  const ensure = c.slice(c.indexOf('const ensureVoiceAudible'), c.indexOf('const getTribeAudioStreams'));
  assert.match(ensure, /el\.dataset\.secours = '1';\s*gain\.gain\.value = 0;/);
  const garde = c.slice(c.indexOf('const garder = '), c.indexOf('const unlockAudio'));
  assert.match(garde, /if \(!el\.muted && gain\.gain\.value !== 0\) gain\.gain\.value = 0;/);
  assert.match(garde, /delete el\.dataset\.secours;/);
});
