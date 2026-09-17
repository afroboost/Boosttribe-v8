/**
 * 📡 « Diffuser en direct » — logique pure : aucune présélection, start/stop/stop(platform)/retry,
 * échec isolé, statuts serveur ; + contrat useBroadcast (structurel) et zéro secret côté front.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { broadcastReducer, BROADCAST_INITIAL, destinationsADemarrer, dureeSec, formatDuree, selectionnable } from './.build/broadcastLogic.mjs';
import { lire, codeSeul } from './lireSource.mjs';

const comptes = { instagram: 'not_connected', facebook: 'connected', youtube: 'connected', tiktok: 'connected' };
const par = (e) => Object.fromEntries(e.destinations.map((d) => [d.platform, d]));

test('rien n’est présélectionné ; seul un compte connecté est cochable', () => {
  let e = broadcastReducer(BROADCAST_INITIAL, { type: 'comptes', comptes });
  assert.ok(e.destinations.every((d) => d.selected === false));
  assert.equal(par(e).instagram.status, 'not_connected');
  assert.equal(selectionnable(par(e).instagram), false);
  e = broadcastReducer(e, { type: 'select', platform: 'instagram', on: true });
  assert.equal(par(e).instagram.selected, false, 'non connecté → impossible à cocher');
  e = broadcastReducer(e, { type: 'select', platform: 'facebook', on: true });
  assert.equal(par(e).facebook.selected, true);
});

test('start : seules les destinations cochées partent (Facebook + YouTube), les autres restent « non diffusées »', () => {
  let e = broadcastReducer(BROADCAST_INITIAL, { type: 'comptes', comptes });
  e = broadcastReducer(e, { type: 'select', platform: 'facebook', on: true });
  e = broadcastReducer(e, { type: 'select', platform: 'youtube', on: true });
  assert.deepEqual(destinationsADemarrer(e), ['facebook', 'youtube']);
  e = broadcastReducer(e, { type: 'start', maintenant: 1000 });
  assert.equal(e.live, true);
  assert.equal(par(e).facebook.status, 'starting');
  assert.equal(par(e).tiktok.status, 'connected', 'non sélectionné → pas diffusé');
  assert.equal(dureeSec(e, 754_000 + 1000), 754);
  assert.equal(formatDuree(754), '00:12:34');
});

test('échec isolé : TikTok en erreur, Facebook et YouTube live ; retry TikTok seul', () => {
  let e = broadcastReducer(BROADCAST_INITIAL, { type: 'comptes', comptes });
  for (const p of ['facebook', 'youtube', 'tiktok']) e = broadcastReducer(e, { type: 'select', platform: p, on: true });
  e = broadcastReducer(e, { type: 'start', maintenant: 0 });
  e = broadcastReducer(e, { type: 'statut', maintenant: 3000, statut: { live: true, elapsedSec: 3, destinations: [
    { platform: 'facebook', status: 'live' }, { platform: 'youtube', status: 'live' }, { platform: 'tiktok', status: 'error', error: 'TikTok n’a pas pu démarrer' },
  ] } });
  assert.equal(par(e).facebook.status, 'live');
  assert.equal(par(e).youtube.status, 'live');
  assert.equal(par(e).tiktok.status, 'error');
  assert.equal(par(e).tiktok.error, 'TikTok n’a pas pu démarrer');
  assert.equal(e.live, true);
  e = broadcastReducer(e, { type: 'retry', platform: 'tiktok' });
  assert.equal(par(e).tiktok.status, 'starting');
  assert.equal(par(e).facebook.status, 'live', 'le retry ne touche pas les autres');
});

test('arrêt individuel : YouTube s’arrête, Facebook continue ; arrêt total : plus rien en direct', () => {
  let e = broadcastReducer(BROADCAST_INITIAL, { type: 'comptes', comptes });
  for (const p of ['facebook', 'youtube']) e = broadcastReducer(e, { type: 'select', platform: p, on: true });
  e = broadcastReducer(e, { type: 'start', maintenant: 0 });
  e = broadcastReducer(e, { type: 'statut', maintenant: 1, statut: { live: true, elapsedSec: 0, destinations: [{ platform: 'facebook', status: 'live' }, { platform: 'youtube', status: 'live' }] } });
  e = broadcastReducer(e, { type: 'stop', platform: 'youtube' });
  assert.equal(par(e).youtube.status, 'connected');
  assert.equal(par(e).facebook.status, 'live');
  assert.equal(e.live, true);
  e = broadcastReducer(e, { type: 'stop_all' });
  assert.equal(e.live, false);
  assert.ok(e.destinations.every((d) => d.status === d.compte));
});

test('un compte qui se déconnecte pendant la sélection est décoché', () => {
  let e = broadcastReducer(BROADCAST_INITIAL, { type: 'comptes', comptes });
  e = broadcastReducer(e, { type: 'select', platform: 'facebook', on: true });
  e = broadcastReducer(e, { type: 'comptes', comptes: { ...comptes, facebook: 'reauth' } });
  assert.equal(par(e).facebook.selected, false);
  assert.equal(par(e).facebook.status, 'reauth');
});

test('contrat useBroadcast : signature et zéro secret côté front', () => {
  const src = codeSeul(lire('hooks', 'useBroadcast.ts'));
  for (const m of ['destinations', 'live', 'elapsedSec', 'select', 'start', 'stopAll', 'stop', 'retry', 'connectUrl']) assert.ok(src.includes(m), `contrat : ${m}`);
  assert.ok(src.includes("'/live/broadcast/start'") && src.includes("'/live/broadcast/stop'") && src.includes('/live/broadcast/status'));
  for (const interdit of ['stream_key', 'streamKey', 'rtmp', 'localStorage', 'access_token:', 'refresh_token']) {
    assert.ok(!src.toLowerCase().includes(interdit.toLowerCase()), `aucun « ${interdit} » dans le hook`);
  }
  assert.ok(src.includes('platform })') || src.includes('map((platform) => ({ platform }))'), 'le front n’envoie que des NOMS de plateformes');
});
