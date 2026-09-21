/**
 * 📡 Diffusion / Broadcast — CORRECTIONS TERRAIN (21/09) : plus jamais un « Non connecté » générique
 * derrière un bouton mort. Banc des helpers PURS (compilés par esbuild) + banc structurel.
 *
 * Ce que le banc prouve :
 *  1. mapping état → libellé / action pour les QUATRE plateformes :
 *       Facebook / YouTube : Connecter · Reconnecter · Configuration requise (+ noms des variables) ;
 *       Instagram / TikTok : Configurer · Configuré (Modifier) · Configuration requise ;
 *     et jamais un bouton pour `config_required` / `unavailable` (aucun bouton mort) ;
 *  2. la clé de diffusion n'est JAMAIS écrite dans localStorage / sessionStorage : espion sur `setItem`
 *     pendant un enregistrement complet via `socialConfigClient` ;
 *  3. « Démarrer le direct » est bloqué : sans sélection (désactivé) et, côté serveur, `directAutorise`
 *     n'est vrai que si le serveur le dit — le front ne connaît aucune URL de réseau social ;
 *  4. validateurs : `rtmps://` seul, `rtmp://` refusé, clé vide / trop longue refusée ;
 *  5. retour OAuth `#social=<p>:<résultat>` → message clair.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { actionPour, libelleStatut, diagnosticConfig, validerUrlServeur, validerCle, messageRetourOAuth, aideConnexion, selectionnable, nbSelectionnes } from './.build/broadcastUi.mjs';
import { enregistrerDestination, supprimerDestination, urlOAuth, messageErreur } from './.build/socialConfigClient.mjs';
import { lire, codeSeul } from './lireSource.mjs';

const CLE = 'sk-ULTRA-SECRETE-0123456789abcdef';

// ── 1. état → libellé / action, par plateforme ────────────────────────────────
test('Facebook / YouTube (OAuth) : Connecter, Reconnecter, Configuration requise avec diagnostic', () => {
  for (const platform of ['facebook', 'youtube']) {
    const oauth = (status, extra = {}) => ({ status, selected: false, kind: 'oauth', ...extra });
    assert.deepEqual(actionPour(oauth('not_connected')), { kind: 'oauth', libelle: 'Connecter' });
    assert.equal(libelleStatut(oauth('not_connected'), false), 'Non connecté');
    assert.deepEqual(actionPour(oauth('reauth')), { kind: 'oauth', libelle: 'Reconnecter' });
    assert.equal(libelleStatut(oauth('reauth'), false), 'Reconnexion nécessaire');
    assert.deepEqual(actionPour(oauth('connected')), { kind: 'none' });
    assert.equal(libelleStatut(oauth('connected'), false), 'Connecté');
    const manque = platform === 'facebook'
      ? ['SOCIAL_SECRETS_KEY', 'FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET', 'AFROBOOST_FB_PAGE_ID', 'SOCIAL_OAUTH_REDIRECT_BASE']
      : ['SOCIAL_SECRETS_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'AFROBOOST_YT_CHANNEL_ID', 'SOCIAL_OAUTH_REDIRECT_BASE'];
    const a = actionPour(oauth('config_required', { missing: manque }));
    assert.equal(a.kind, 'diagnostic'); assert.equal(a.libelle, 'Configuration requise'); assert.deepEqual(a.missing, manque);
    assert.equal(libelleStatut(oauth('config_required'), false), 'Configuration requise');
    assert.equal(diagnosticConfig(manque), `Variables serveur à poser (Coolify) : ${manque.join(', ')}`);
    assert.ok(aideConnexion(platform, 'oauth').includes(platform === 'youtube' ? 'chaîne YouTube Afroboost' : 'Page Afroboost'));
  }
  assert.equal(diagnosticConfig([]), 'Configuration serveur incomplète.');
});

test('Instagram / TikTok (RTMPS + clé) : Configurer, Configuré (Modifier), Configuration requise — jamais « Connecter »', () => {
  for (const platform of ['instagram', 'tiktok']) {
    const manual = (status, extra = {}) => ({ status, selected: false, kind: 'manual', ...extra });
    assert.deepEqual(actionPour(manual('not_configured')), { kind: 'configure', libelle: 'Configurer' });
    assert.equal(libelleStatut(manual('not_configured'), false), 'Non configuré');
    assert.deepEqual(actionPour(manual('configured', { keyHint: 'cdef' })), { kind: 'configured', libelle: 'Modifier' });
    assert.equal(libelleStatut(manual('configured', { keyHint: 'cdef' }), false), 'Configuré — clé enregistrée (…cdef)');
    assert.equal(libelleStatut(manual('configured'), false), 'Configuré', 'CONFIGURÉ, pas « Connecté »');
    const a = actionPour(manual('config_required', { missing: ['SOCIAL_SECRETS_KEY'] }));
    assert.equal(a.kind, 'diagnostic'); assert.deepEqual(a.missing, ['SOCIAL_SECRETS_KEY']);
    // même un ancien statut « not_connected » sur une plateforme manuelle ne produit jamais « Connecter »
    assert.deepEqual(actionPour(manual('not_connected')), { kind: 'configure', libelle: 'Configurer' });
    // TikTok : LIVE Studio ne fournit AUCUNE clé (prouvé 21/09) — la clé vient de l’application TikTok (PC/Mac → Logiciel de streaming)
    assert.ok(aideConnexion(platform, 'manual').includes(platform === 'tiktok' ? 'application TikTok' : 'Instagram Live Producer'));
    assert.ok(!aideConnexion('tiktok', 'manual').includes('LIVE Studio'), 'plus jamais « copiez depuis LIVE Studio »');
    assert.ok(aideConnexion(platform, 'manual').includes('nouvelle clé à chaque direct'));
  }
});

test('aucun bouton mort : config_required / unavailable / en diffusion → aucune action cliquable', () => {
  for (const status of ['unavailable', 'starting', 'live', 'error', 'off']) {
    assert.deepEqual(actionPour({ status, selected: true, kind: 'oauth' }), { kind: 'none' }, status);
    assert.deepEqual(actionPour({ status, selected: true, kind: 'manual' }), { kind: 'none' }, status);
  }
  assert.equal(actionPour({ status: 'config_required', selected: false, kind: 'oauth', missing: ['X'] }).kind, 'diagnostic');
  // et la coche n'existe que pour connected / configured
  assert.equal(selectionnable('connected'), true); assert.equal(selectionnable('configured'), true);
  for (const s of ['not_connected', 'reauth', 'unavailable', 'config_required', 'not_configured']) assert.equal(selectionnable(s), false, s);
});

// ── 2. la clé n'est jamais écrite dans un stockage navigateur ─────────────────
test('la clé de diffusion ne touche JAMAIS localStorage / sessionStorage (espion setItem) et n’est jamais journalisée', async () => {
  const ecritures = [];
  const faux = { setItem: (k, v) => ecritures.push([k, String(v)]), getItem: () => null, removeItem: () => {}, clear: () => {}, key: () => null, length: 0 };
  globalThis.localStorage = faux; globalThis.sessionStorage = faux;
  const journal = [];
  const orig = { log: console.log, info: console.info, debug: console.debug, warn: console.warn, error: console.error };
  for (const k of Object.keys(orig)) console[k] = (...a) => journal.push(a.map(String).join(' '));
  const requetes = [];
  const appel = async (path, body, method) => {
    requetes.push({ path, body, method });
    if (path.endsWith('/manual')) return { ok: true, status: 200, json: { platform: 'instagram', status: 'configured', key_saved: true, key_hint: CLE.slice(-4) } };
    if (method === 'DELETE') return { ok: true, status: 200, json: { platform: 'instagram', status: 'not_configured' } };
    return { ok: false, status: 404, json: null };
  };
  try {
    const r = await enregistrerDestination(appel, 'instagram', { url: 'rtmps://live-upload.instagram.com:443/rtmp/', cle: CLE });
    assert.equal(r.ok, true);
    assert.equal(r.etat.status, 'configured'); assert.equal(r.etat.key_hint, CLE.slice(-4));
    assert.ok(!JSON.stringify(r).includes(CLE), 'le résultat ne porte pas la clé');
    // la clé est partie UNE fois, dans le corps du POST, et nulle part ailleurs
    assert.equal(requetes.length, 1);
    assert.equal(requetes[0].body.stream_key, CLE); assert.equal(requetes[0].body.rtmp_url, 'rtmps://live-upload.instagram.com:443/rtmp/');
    assert.ok(!requetes[0].path.includes(CLE), 'jamais dans une URL');
    const s = await supprimerDestination(appel, 'instagram');
    assert.equal(s.ok, true);
  } finally {
    for (const k of Object.keys(orig)) console[k] = orig[k];
    delete globalThis.localStorage; delete globalThis.sessionStorage;
  }
  assert.deepEqual(ecritures, [], 'aucune écriture localStorage / sessionStorage');
  assert.ok(!journal.some((l) => l.includes(CLE)), 'aucun journal ne contient la clé');
  // et le code source du client, du hook et du formulaire n'y touche pas
  for (const [d, f] of [['lib', 'socialConfigClient.ts'], ['hooks', 'useBroadcast.ts'], ['components/session', 'BroadcastConfigForm.tsx']]) {
    const src = codeSeul(lire(...d.split('/'), f));
    assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie/.test(src), `${f} : aucun stockage navigateur`);
    assert.ok(!/console\.(log|info|debug)/.test(src), `${f} : aucun journal`);
  }
});

test('erreurs serveur lisibles : 409 « Configuration requise » remonte les NOMS des variables, 400 rtmp:// remonte le motif', async () => {
  const appel409 = async () => ({ ok: false, status: 409, json: { detail: { code: 'config_required', missing: ['SOCIAL_SECRETS_KEY'], message: 'Configuration requise : poser SOCIAL_SECRETS_KEY côté serveur' } } });
  const r = await enregistrerDestination(appel409, 'tiktok', { url: 'rtmps://a.b/c/', cle: CLE });
  assert.equal(r.ok, false); assert.deepEqual(r.missing, ['SOCIAL_SECRETS_KEY']); assert.ok(r.message.includes('SOCIAL_SECRETS_KEY'));
  const appel400 = async () => ({ ok: false, status: 400, json: { detail: 'URL en clair refusée : l’adresse doit commencer par rtmps://' } });
  const r2 = await enregistrerDestination(appel400, 'tiktok', { url: 'rtmp://a.b/c/', cle: CLE });
  assert.equal(r2.ok, false); assert.ok(r2.message.includes('rtmps://'));
  assert.deepEqual(messageErreur({ detail: { missing: ['A', 'B'] } }, 'x'), { message: 'Configuration requise : A, B', missing: ['A', 'B'] });
  assert.deepEqual(messageErreur(null, 'défaut'), { message: 'défaut', missing: [] });
  const o = await urlOAuth(appel409, 'facebook', 'https://afroboost.com/live/s');
  assert.equal(o.ok, false); assert.equal(o.url, null); assert.deepEqual(o.missing, ['SOCIAL_SECRETS_KEY']);
  const ok = await urlOAuth(async (p) => ({ ok: true, status: 200, json: { url: 'https://www.facebook.com/v25.0/dialog/oauth?client_id=1&state=s' }, p }), 'facebook', 'https://afroboost.com/live/s');
  assert.equal(ok.ok, true); assert.ok(ok.url.startsWith('https://www.facebook.com/'));
});

// ── 3. « Démarrer le direct » bloqué ─────────────────────────────────────────
test('« Démarrer le direct » : inerte sans sélection ; simulation tant que le serveur ne débloque pas ; aucune URL de réseau dans le front', () => {
  assert.equal(nbSelectionnes([{ status: 'configured', selected: false }, { status: 'not_connected', selected: true }, { status: 'config_required', selected: true }]), 0);
  assert.equal(nbSelectionnes([{ status: 'configured', selected: true }, { status: 'connected', selected: true }]), 2);
  const DRAWER = codeSeul(lire('components', 'session', 'BroadcastDrawer.tsx'));
  assert.ok(DRAWER.includes('disabled={nbSelection === 0}'), 'désactivé sans sélection');
  assert.ok(DRAWER.includes("'Démarrer (simulation)'"), 'libellé simulation');
  const HOOK = codeSeul(lire('hooks', 'useBroadcast.ts'));
  assert.ok(HOOK.includes("appel('/live/broadcast/start'"), 'le seul démarrage passe par le serveur (verrouillé côté serveur)');
  for (const f of ['hooks/useBroadcast.ts', 'lib/socialConfigClient.ts', 'lib/broadcastLogic.ts', 'lib/broadcastUi.ts', 'components/session/BroadcastDrawer.tsx', 'components/session/BroadcastConfigForm.tsx']) {
    const src = codeSeul(lire(...f.split('/')));
    assert.ok(!/facebook\.com|googleapis|youtube\.com|instagram\.com|tiktok\.com|livekit/i.test(src), `${f} : aucune URL de réseau / d’Egress côté front`);
  }
  assert.ok(!HOOK.includes('directAutorise: true') && !HOOK.includes('useState(true)'), 'directAutorise ne peut pas être vrai sans le serveur');
});

// ── 4. validateurs ───────────────────────────────────────────────────────────
test('validation : rtmps:// seul (rtmp:// refusé), clé non vide, bornée', () => {
  assert.equal(validerUrlServeur('rtmps://live-upload.instagram.com:443/rtmp/'), null);
  assert.equal(validerUrlServeur('rtmps://push-rtmps.tiktok.example/live/'), null);
  assert.ok(validerUrlServeur('rtmp://live-upload.instagram.com/rtmp/').includes('rtmps://'), 'rtmp:// en clair refusé');
  assert.ok(validerUrlServeur('RTMP://x.y/z/').includes('rtmps://'));
  assert.ok(validerUrlServeur('https://x.y/z/'));
  assert.ok(validerUrlServeur(''));
  assert.ok(validerUrlServeur('rtmps://a b/c/'));
  assert.equal(validerCle(CLE), null);
  assert.ok(validerCle('')); assert.ok(validerCle('   ')); assert.ok(validerCle('x'.repeat(513))); assert.ok(validerCle('a\nb'));
});

// ── 5. retour OAuth ──────────────────────────────────────────────────────────
test('retour OAuth : #social=<plateforme>:<résultat> → message clair, sinon null', () => {
  const L = { facebook: 'Facebook', youtube: 'YouTube' };
  assert.deepEqual(messageRetourOAuth('#social=facebook:connected', L), { platform: 'facebook', ok: true, texte: 'Facebook connecté au compte Afroboost.' });
  assert.equal(messageRetourOAuth('#social=facebook:refused', L).texte, 'Facebook : ce compte n’est pas celui d’Afroboost — connexion refusée.');
  assert.equal(messageRetourOAuth('#social=youtube:cancelled', L).texte, 'YouTube : connexion annulée.');
  assert.equal(messageRetourOAuth('#social=youtube:config_required', L).texte, 'YouTube : configuration serveur requise.');
  assert.equal(messageRetourOAuth('#social=youtube:error', L).ok, false);
  assert.equal(messageRetourOAuth('', L), null);
  assert.equal(messageRetourOAuth('#autre=chose', L), null);
});
