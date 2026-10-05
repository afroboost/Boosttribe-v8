/**
 * 🎥 QUALITÉ VIDÉO DU LIVE — mesurée sur un banc LiveKit 1.13.7 local (05/10/2026), pas devinée.
 *
 * Avant : le spectateur recevait 320×180 à ~20 i/s (~160 kbit/s), affiché en 1500×900.
 * Deux causes cumulées :
 *  1. réception : `adaptiveStream: true` SANS `track.attach()` — LiveKit ne connaît la taille
 *     d'aucun élément vidéo, il ne fait monter que la couche basse (q) et Dynacast coupe les
 *     autres chez l'hôte (`qualityLimitationReason: none` : ni réseau ni CPU en cause) ;
 *  2. capture : aucune résolution demandée → défaut LiveKit 1280×720, plafond 1,7 Mbit/s.
 * Après (même banc) : 1920×1080 / 30 i/s / ~3–4 Mbit/s reçu en grand, 640×360 sur une vignette.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { optionsCameraLive, brancherVideo, associerPisteVideo } from './.build/qualiteVideo.mjs';
import { lire, codeSeul } from './lireSource.mjs';

test('ordinateur : la capture suit la caméra (Phase caméra 2 — cf. cameraNative.test.mjs) ; capacités inconnues → 1080p', () => {
  const o = optionsCameraLive({ mobile: false });
  assert.deepEqual(o.capture.resolution, { width: 1920, height: 1080, frameRate: 30 });
  assert.equal(o.publication.videoEncoding, undefined, 'débit déduit de la résolution réelle par LiveKit');
  assert.deepEqual(o.publication.videoSimulcastLayers.map((l) => [l.width, l.height]), [[640, 360], [1280, 720]]);
  assert.equal(o.publication.simulcast, true);
});

test('téléphone : on ne force PAS le 1080p (réglage LiveKit inchangé)', () => {
  const o = optionsCameraLive({ mobile: true });
  assert.equal(o.capture.resolution, undefined);
  assert.equal(o.publication, undefined);
});

test('flux LiveKit → attach() / detach() ; flux local → srcObject (aucun changement)', () => {
  const appels = [];
  const piste = { attach: (el) => { appels.push(['attach', el.id]); return el; }, detach: (el) => { appels.push(['detach', el.id]); return el; } };
  const distant = { id: 'distant' }, local = { id: 'local' };
  associerPisteVideo(distant, piste);
  const el1 = { id: 'v1', srcObject: null };
  const fin1 = brancherVideo(el1, distant);
  assert.deepEqual(appels, [['attach', 'v1']]);
  fin1();
  assert.deepEqual(appels, [['attach', 'v1'], ['detach', 'v1']]);
  const el2 = { id: 'v2', srcObject: null };
  const fin2 = brancherVideo(el2, local);
  assert.equal(el2.srcObject, local);
  fin2();
  assert.equal(appels.length, 2);
});

const S = codeSeul(lire('hooks', 'useLiveKitStage.ts'));

test('réception : chaque piste vidéo distante (caméra ET écran) est associée à son flux', () => {
  const bloc = S.slice(S.indexOf('const handleSubscribed'), S.indexOf('const handleUnsubscribed'));
  assert.match(bloc, /associerPisteVideo\(s, track/);
  assert.match(bloc, /const flux = new MediaStream\(\[mst\]\);\s*associerPisteVideo\(flux, track/);
});

test('émission : la caméra est publiée avec optionsCameraLive (y compris republication)', () => {
  assert.match(S, /optionsCameraLive\(\{ mobile: /);
  assert.match(S, /setCameraEnabled\(true, \{ \.\.\.cam\.capture, \.\.\.\(deviceId \? \{ deviceId: \{ exact: deviceId \} \} : \{\}\) \}, cam\.publication\)/);
  assert.match(S, /publishTrack\(cam, \{ \.\.\.\(optionsCameraLive\(\{ mobile: /);
});

for (const [f, nom] of [['components/session/CameraTile.tsx', 'CameraTile'], ['components/session/SceneRenderer.tsx', 'SceneRenderer'],
                         ['components/session/ScreenShareView.tsx', 'ScreenShareView']]) {
  test(`${nom} : le flux est branché par brancherVideo (et détaché au démontage)`, () => {
    const c = codeSeul(lire(...f.split('/')));
    assert.match(c, /brancherVideo\(/);
    assert.doesNotMatch(c, /\.srcObject = stream;/);
  });
}
