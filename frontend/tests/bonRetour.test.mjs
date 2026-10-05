/**
 * 👋 « Bon retour [pseudo] » — Phase 1, même appareil (V574 Afroboost).
 * Identité côté serveur (afroboost.com/api, cookie HttpOnly), plus aucune coordonnée en clair
 * dans le navigateur ; seul l'invité ANONYME de la marque Afroboost est concerné.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { CLES_PII_INVITE, effacerPiiInvite, CHEMIN_LIVE_GUEST } from './.build/inviteLive.mjs';
import { lire, codeSeul } from './lireSource.mjs';

test('anciennes clés invité en clair : liste complète, effacées sans toucher au reste', () => {
  assert.deepEqual([...CLES_PII_INVITE].sort(), ['bt_invite_contact', 'bt_local_avatar', 'bt_nickname']);
  const m = new Map([['bt_invite_contact', '{}'], ['bt_nickname', 'Bass'], ['bt_local_avatar', 'x'], ['bt_theme_config', 't']]);
  effacerPiiInvite({ removeItem: (k) => m.delete(k) });
  assert.deepEqual([...m.keys()], ['bt_theme_config']);
  assert.doesNotThrow(() => effacerPiiInvite(null));
});

const L = codeSeul(lire('lib', 'inviteLive.ts'));

test('appels MÊME ORIGINE vers afroboost.com/api, cookies inclus', () => {
  assert.equal(CHEMIN_LIVE_GUEST, '/api/live-guest');
  for (const f of ['liveGuestMoi', 'liveGuestRejoindre', 'liveGuestContinuer', 'liveGuestModifier', 'liveGuestOublier']) {
    assert.match(L, new RegExp(`export async function ${f}\\(`), f);
  }
  assert.match(L, /credentials: 'same-origin'/);
  assert.doesNotMatch(L, /setItem\(/, 'plus aucune écriture de coordonnées dans le navigateur');
});

const P = codeSeul(lire('pages', 'SessionPage.tsx'));

test('A/C. au chargement, l’invité Afroboost anonyme est reconnu par le SERVEUR (plus en silence)', () => {
  assert.match(P, /const parcoursInvite = BRAND_ID === 'afroboost' && !isHost && !user\?\.id;/);
  const e = P.slice(P.indexOf('if (parcoursInvite && (urlSessionId || sessionId))'), P.indexOf('if (parcoursInvite && (urlSessionId || sessionId))') + 700);
  assert.match(e, /liveGuestMoi\(\)\.then\(\(vue\) => \{/);
  assert.match(e, /if \(vue\) setBonRetour\(vue\);\s*else setShowNicknameModal\(true\);/);
});

test('écran « Bon retour » : pseudo, photo, coordonnées masquées, 4 actions', () => {
  const B = P.slice(P.indexOf('export const BonRetourModal'), P.indexOf('export const BonRetourModal') + 6000);
  assert.match(B, /Bon retour \{vue\.pseudo\}/);
  for (const id of ['bon-retour', 'bon-retour-continuer', 'bon-retour-modifier', 'bon-retour-pas-moi', 'bon-retour-oublier']) {
    assert.match(B, new RegExp(`data-testid="${id}"`), id);
  }
  assert.match(B, /vue\.email_masque/);
  assert.match(B, /vue\.whatsapp_masque/);
  assert.match(B, /\{occupe \? 'Connexion…' : libelle\}/);
  assert.match(P, /libelle=\{accessModeResolved && accessMode === 'guest' \? 'Continuer vers l’écoute' : 'Continuer vers le Live'\}/);
  assert.match(B, /Modifier mes informations/);
  assert.match(B, /Ce n’est pas moi/);
  assert.match(B, /Oublier ce profil sur cet appareil/);
});

test('B. 1re participation : serveur même origine, plus de coordonnées ni de pseudo écrits en local', () => {
  const h = P.slice(P.indexOf('const handleNicknameSubmit'), P.indexOf('const handleAddPhotoFromModal'));
  assert.match(h, /if \(parcoursInvite\) \{/);
  assert.match(h, /void \(modeModification\s*\? liveGuestModifier\(/);
  assert.match(h, /: liveGuestRejoindre\(\{ session_code: sessionId/);
  assert.doesNotMatch(h, /memoriserContact\(/);
  assert.match(h, /if \(!parcoursInvite\) setStoredNickname\(newNickname\);/);
});

test('I/J. « Ce n’est pas moi » et « Oublier » : révocation serveur + clés locales effacées', () => {
  const o = P.slice(P.indexOf('const oublierCetAppareil'), P.indexOf('const oublierCetAppareil') + 600);
  assert.match(o, /void liveGuestOublier\(\);/);
  assert.match(o, /effacerPiiInvite\(/);
  assert.match(o, /setShowNicknameModal\(true\);/);
});

test('photo locale : jamais relue ni écrite pour l’invité Afroboost (le serveur fait foi)', () => {
  assert.match(P, /useState<string \| null>\(\(\) => \(BRAND_ID === 'afroboost' \? null : getStoredLocalAvatar\(\)\)\)/);
  assert.match(P, /if \(!parcoursInvite\) setStoredLocalAvatar\(url\);/);
});
