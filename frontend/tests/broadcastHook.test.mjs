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
  for (const m of ['destinations', 'live', 'elapsedSec', 'directAutorise', 'select', 'start', 'stopAll', 'stop', 'retry', 'connect', 'configure', 'forget', 'refresh', 'avis']) assert.ok(src.includes(m), `contrat : ${m}`);
  assert.ok(src.includes("'/live/broadcast/start'") && src.includes("'/live/broadcast/stop'") && src.includes('/live/broadcast/status'));
  assert.ok(src.includes("'/social/destinations/status'"), 'l’état des comptes vient de la route « status » (diagnostic par plateforme)');
  for (const interdit of ['stream_key', 'streamKey', 'rtmp', 'localStorage', 'sessionStorage', 'access_token:', 'refresh_token']) {
    assert.ok(!src.toLowerCase().includes(interdit.toLowerCase()), `aucun « ${interdit} » dans le hook`);
  }
  assert.ok(src.includes('platform })') || src.includes('map((platform) => ({ platform }))'), 'le front n’envoie que des NOMS de plateformes');
  assert.ok(!src.includes('connectUrl'), 'plus de lien OAuth sans jeton');
  assert.ok(src.includes('fenetreOAuth(window).location.assign(r.url)'), 'Connecter = redirection (fenêtre principale) vers le VRAI parcours OAuth renvoyé par le serveur');
  assert.ok(src.includes('setDirectAutorise(directAutoriseDepuisServeur(r.json))'), 'directAutorise vient du serveur, jamais du front');
});

test('comptes serveur : la route « status » (état + diagnostic) et l’ancienne route « accounts » sont normalisées', async () => {
  const { comptesDepuisServeur, directAutoriseDepuisServeur } = await import('./.build/broadcastLogic.mjs');
  const riche = comptesDepuisServeur({ direct_reel_autorise: false, destinations: [
    { platform: 'facebook', status: 'config_required', kind: 'oauth', missing: ['FACEBOOK_APP_ID', 'SOCIAL_OAUTH_REDIRECT_BASE'] },
    { platform: 'instagram', status: 'configured', kind: 'manual', key_saved: true, key_hint: 'ab12', missing: [] },
    { platform: 'youtube', status: 'reauth', kind: 'oauth', account_label: 'Af…t' },
    { platform: 'tiktok', status: 'not_configured', kind: 'manual' },
    { platform: 'pinterest', status: 'connected' }, { platform: 'facebook', status: 'nimporte' },
  ] });
  assert.deepEqual(riche.facebook, { status: 'config_required', kind: 'oauth', missing: ['FACEBOOK_APP_ID', 'SOCIAL_OAUTH_REDIRECT_BASE'], key_hint: null, key_saved: false, account_label: null });
  assert.equal(riche.instagram.status, 'configured'); assert.equal(riche.instagram.key_hint, 'ab12');
  assert.equal(riche.youtube.account_label, 'Af…t');
  assert.ok(!('pinterest' in riche));
  assert.equal(directAutoriseDepuisServeur({ direct_reel_autorise: false }), false);
  assert.equal(directAutoriseDepuisServeur({ direct_reel_autorise: true }), true);
  assert.equal(directAutoriseDepuisServeur(null), false);
  const simple = comptesDepuisServeur({ accounts: { facebook: 'connected', instagram: 'bidon' } });
  assert.deepEqual(simple, { facebook: 'connected' });
  // le réducteur accepte les deux formes et n’autorise la coche que pour connected / configured
  let e = broadcastReducer(BROADCAST_INITIAL, { type: 'comptes', comptes: riche });
  assert.equal(par(e).facebook.status, 'config_required'); assert.deepEqual(par(e).facebook.missing, ['FACEBOOK_APP_ID', 'SOCIAL_OAUTH_REDIRECT_BASE']);
  assert.equal(par(e).instagram.keyHint, 'ab12');
  e = broadcastReducer(e, { type: 'select', platform: 'instagram', on: true });
  assert.equal(par(e).instagram.selected, true, 'configuré → cochable');
  e = broadcastReducer(e, { type: 'select', platform: 'tiktok', on: true });
  assert.equal(par(e).tiktok.selected, false, 'non configuré → pas cochable');
  e = broadcastReducer(e, { type: 'select', platform: 'youtube', on: true });
  assert.equal(par(e).youtube.selected, false, 'reconnexion nécessaire → pas cochable');
  assert.deepEqual(destinationsADemarrer(e), ['instagram']);
  // après suppression de la config (état serveur non configuré), la coche tombe
  e = broadcastReducer(e, { type: 'comptes', comptes: { instagram: 'not_configured' } });
  assert.equal(par(e).instagram.selected, false);
});

test('Connecter : la page OAuth (Google/Facebook) est TOUJOURS ouverte dans la fenêtre PRINCIPALE, jamais dans l’iframe', async () => {
  // Google renvoie « 403. Vous n’avez pas accès à cette page » dès que sa page OAuth est chargée dans
  // une iframe (afroboost.com/live embarqué dans l’overlay Afroboost). Il faut naviguer window.top.
  const { fenetreOAuth } = await import('./.build/broadcastLogic.mjs');
  const seule = { top: null, self: null }; seule.top = seule; seule.self = seule;
  assert.equal(fenetreOAuth(seule), seule, 'hors iframe : l’onglet courant');
  const parent = { location: { assign() {} } };
  const cadre = { top: parent, self: null }; cadre.self = cadre;
  assert.equal(fenetreOAuth(cadre), parent, 'dans une iframe : la fenêtre principale');
  const opaque = { get top() { throw new Error('SecurityError'); }, self: null }; opaque.self = opaque;
  assert.equal(fenetreOAuth(opaque), opaque, 'window.top inaccessible → repli sur l’onglet courant');
  const src = codeSeul(lire('hooks', 'useBroadcast.ts'));
  assert.ok(src.includes('fenetreOAuth(window).location.assign(r.url)'), 'le hook passe par fenetreOAuth');
  assert.ok(!src.includes('window.location.assign(r.url)'), 'plus de navigation de l’iframe elle-même');
});
