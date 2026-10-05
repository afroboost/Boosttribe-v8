/**
 * 👤 INVITÉ LIVE — Phase 1 (05/10/2026), audit prouvé :
 *  - le bouton disait « Rejoindre l'écoute » en dur, même en « Accès visio » ;
 *  - « Valider » de la photo ne réagissait pas quand l'image n'était pas décodée (HEIC) ;
 *  - la photo changée n'était jamais republiée dans la présence ;
 *  - aucun e-mail / WhatsApp, aucun contact côté Afroboost.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { libelleRejoindre, validerPhotoInvite, validerContactInvite, avatarPourPresence,
         TEXTE_INFO_CONTACT, PHOTO_TAILLE_MAX } from './.build/inviteLive.mjs';
import { lire, codeSeul } from './lireSource.mjs';

test('A/B. libellé selon le réglage RÉEL de l’hôte', () => {
  assert.equal(libelleRejoindre({ estHote: false, acces: 'account', resolu: true }), 'Rejoindre le Live');
  assert.equal(libelleRejoindre({ estHote: false, acces: 'guest', resolu: true }), 'Rejoindre l’écoute');
  assert.equal(libelleRejoindre({ estHote: false, acces: 'account', resolu: false }), 'Rejoindre');
  assert.equal(libelleRejoindre({ estHote: true, acces: 'guest', resolu: true }), 'Démarrer la session');
});

test('C. JPEG / PNG / WebP acceptés (y compris type vide avec bonne extension)', () => {
  for (const f of [{ type: 'image/jpeg', name: 'a.jpg', size: 2e6 }, { type: 'image/png', name: 'a.png', size: 1e6 },
                   { type: 'image/webp', name: 'a.webp', size: 1e6 }, { type: '', name: 'photo.JPG', size: 1e6 }]) {
    assert.deepEqual(validerPhotoInvite(f), { ok: true }, f.name);
  }
});

test('D. HEIC / HEIF → message clair (jamais un bouton muet)', () => {
  for (const f of [{ type: 'image/heic', name: 'IMG_1.HEIC', size: 2e6 }, { type: '', name: 'IMG_2.heif', size: 2e6 },
                   { type: 'image/heif', name: 'x', size: 1 }]) {
    const r = validerPhotoInvite(f);
    assert.equal(r.ok, false); assert.match(r.erreur, /HEIC/);
  }
});

test('E. fichier trop gros / format inconnu → message clair', () => {
  const r = validerPhotoInvite({ type: 'image/jpeg', name: 'a.jpg', size: PHOTO_TAILLE_MAX + 1 });
  assert.equal(r.ok, false); assert.match(r.erreur, /trop lourde/);
  const g = validerPhotoInvite({ type: 'image/gif', name: 'a.gif', size: 100 });
  assert.equal(g.ok, false); assert.match(g.erreur, /JPEG, PNG ou WebP/);
});

test('coordonnées : e-mail valide si renseigné, WhatsApp au format Afroboost, au moins un des deux', () => {
  assert.equal(validerContactInvite({ email: '', whatsapp: '' }).ok, false);
  assert.equal(validerContactInvite({ email: 'pas-un-mail', whatsapp: '' }).ok, false);
  assert.equal(validerContactInvite({ email: '', whatsapp: '12' }).ok, false);
  assert.deepEqual(validerContactInvite({ email: ' Lea@Exemple.CH ', whatsapp: '' }), { ok: true, email: 'lea@exemple.ch', whatsapp: '' });
  for (const t of ['079 123 45 67', '+41 79 123 45 67', '0041 79 123 45 67']) {
    assert.equal(validerContactInvite({ email: '', whatsapp: t }).ok, true, t);
  }
});

test('présence : jamais une image base64 dans le temps réel', () => {
  assert.equal(avatarPourPresence('data:image/jpeg;base64,AAAA'), undefined);
  assert.equal(avatarPourPresence(null), undefined);
  assert.equal(avatarPourPresence('https://x.supabase.co/storage/v1/object/public/session-media/invites/a.jpg'),
               'https://x.supabase.co/storage/v1/object/public/session-media/invites/a.jpg');
});

test('information affichée (pas de consentement marketing)', () => {
  assert.equal(TEXTE_INFO_CONTACT, 'En rejoignant le Live, tes coordonnées sont enregistrées par Afroboost pour gérer ta participation.');
});

const P = codeSeul(lire('pages', 'SessionPage.tsx'));
const M = P.slice(P.indexOf('export const NicknameModal'), P.indexOf('// Subscription Badge Component') > 0 ? P.indexOf('// Subscription Badge Component') : P.indexOf('export const NicknameModal') + 9000);

test('écran invité : libellé calculé (plus de texte en dur), champs e-mail + WhatsApp, information', () => {
  assert.doesNotMatch(M, /"Rejoindre l'écoute"/);
  assert.match(M, /libelleRejoindre\(\{ estHote: isHost, acces: acces \?\? 'account', resolu: !!accesResolu \}\)/);
  assert.match(M, /data-testid="invite-email"/);
  assert.match(M, /data-testid="invite-whatsapp"/);
  assert.match(M, /TEXTE_INFO_CONTACT/);
  assert.doesNotMatch(M, /type="checkbox"/, 'aucun consentement marketing (encore moins pré-coché)');
});

test('M. mobile : la fenêtre défile avec le clavier ouvert, aucun autoFocus pour l’invité', () => {
  assert.match(M, /className="fixed inset-0 z-50 overflow-y-auto"/);
  assert.match(M, /autoFocus=\{isHost\}/);
  assert.match(M, /<form onSubmit=\{handleSubmit\} className="space-y-4" noValidate>/, 'nos messages, pas la bulle native');
});

test('l’écran reçoit le réglage de l’hôte et la collecte n’existe que sur Afroboost', () => {
  assert.match(P, /acces=\{accessMode\}/);
  assert.match(P, /accesResolu=\{accessModeResolved\}/);
  assert.match(P, /collecteContact=\{BRAND_ID === 'afroboost' && !isHost\}/);
});

test('G. à l’entrée, le contact part au serveur (jamais bloquant)', () => {
  const h = P.slice(P.indexOf('const handleNicknameSubmit'), P.indexOf('const handleAddPhotoFromModal'));
  assert.match(h, /void enregistrerContactInvite\(\{ sessionId, pseudo: newNickname, email: contact\.email, whatsapp: contact\.whatsapp, photoUrl: avatarPourPresence\(myAvatar\) \}\)/);
});

test('K. photo changée → présence republiée (sans quitter la session)', () => {
  assert.match(P, /socket\.updatePresenceAvatar\(avatarPourPresence\(myAvatar\)\);/);
  assert.match(P, /socket\.joinSession\(sessionId, socket\.userId, isHost, nickname, avatarPourPresence\(myAvatar\)\);/);
  const S = codeSeul(lire('context', 'SocketContext.tsx'));
  assert.match(S, /const updatePresenceAvatar = useCallback/);
  assert.match(S, /supabaseChannelRef\.current\.track\(/);
});

const A = codeSeul(lire('components', 'profile', 'AvatarUploadCrop.tsx'));

test('photo : galerie ET appareil photo, validation, décodage vérifié, Valider jamais muet', () => {
  assert.match(A, /data-testid="avatar-file-input"/);
  assert.match(A, /capture="user"/);
  assert.match(A, /data-testid="avatar-camera-input"/);
  assert.match(A, /validerPhotoInvite\(/);
  assert.match(A, /img\.onerror = \(\) => \{ setError\(/);
  assert.doesNotMatch(A, /if \(!imageSrc \|\| !croppedAreaPixels\) return;/);
});

test('invité anonyme : la photo est déposée sur le serveur (URL courte), plus en base64', () => {
  assert.match(A, /envoyerPhotoInvite\(sessionId, blob\)/);
});
