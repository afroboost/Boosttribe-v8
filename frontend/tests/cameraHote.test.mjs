/**
 * 🎥 « L'hôte est en caméra » — le signal qui manquait, les droits qu'il ne contourne pas,
 *    et le refus de publier qui ne se déguise plus en spectateur.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EVENEMENT_CAMERA_HOTE, BATTEMENT_CAMERA_MS, PEREMPTION_CAMERA_MS,
  appliquerSignalCamera, purgerCamerasPerimees, peutRecevoirLaVideo, raisonVisioFermee,
} from './.build/cameraHoteSignal.mjs';
import { lire, codeSeul } from './lireSource.mjs';

const DROITS_OK = {
  lectureSeule: false, paywallCredits: false, billetManquant: false,
  attenteInscription: false, refuse: false, enAttenteAdmission: false, pseudoConnu: true,
};

test('le signal entre dans le registre, son écho personnel est ignoré', () => {
  const r = new Map();
  assert.equal(appliquerSignalCamera(r, { active: true, userId: 'moi' }, 'moi', 1000), false, 'mon propre écho');
  assert.equal(r.size, 0);
  assert.equal(appliquerSignalCamera(r, { active: true, userId: 'hote' }, 'moi', 1000), true);
  assert.equal(r.size, 1);
  assert.equal(appliquerSignalCamera(r, { active: true, userId: 'hote' }, 'moi', 5000), false,
    'un battement rafraîchit sans provoquer de rendu');
  assert.equal(r.get('hote'), 5000, 'mais la date de vie est bien mise à jour');
});

test('CAMERA OFF : le « off » explicite retire le diffuseur', () => {
  const r = new Map([['hote', 1000]]);
  assert.equal(appliquerSignalCamera(r, { active: false, userId: 'hote' }, 'moi', 2000), true);
  assert.equal(r.size, 0);
  assert.equal(appliquerSignalCamera(r, { active: false, userId: 'hote' }, 'moi', 3000), false, 'idempotent');
});

test('un onglet fermé brutalement n’envoie jamais son « off » → la péremption le retire', () => {
  const r = new Map([['hote', 1000], ['cohote', 1000]]);
  assert.equal(purgerCamerasPerimees(r, 1000 + PEREMPTION_CAMERA_MS - 1), false, 'encore vivants');
  assert.equal(r.size, 2);
  assert.equal(purgerCamerasPerimees(r, 1000 + PEREMPTION_CAMERA_MS + 1), true);
  assert.equal(r.size, 0);
  assert.ok(PEREMPTION_CAMERA_MS > 3 * BATTEMENT_CAMERA_MS, 'au moins trois battements de marge');
});

test('plusieurs diffuseurs : la vidéo reste active tant qu’il en reste un', () => {
  const r = new Map();
  appliquerSignalCamera(r, { active: true, userId: 'hote' }, 'moi', 1000);
  appliquerSignalCamera(r, { active: true, userId: 'cohote' }, 'moi', 1000);
  appliquerSignalCamera(r, { active: false, userId: 'hote' }, 'moi', 2000);
  assert.equal(r.size, 1, 'le co-hôte diffuse encore');
});

test('LE SIGNAL N’OUVRE AUCUNE PORTE : chaque règle d’accès ferme la vidéo, avec sa raison', () => {
  assert.equal(peutRecevoirLaVideo(DROITS_OK), true);
  const cas = [
    ['pseudoConnu', false, 'Indique ton nom'],
    ['refuse', true, 'refusé ton entrée'],
    ['enAttenteAdmission', true, "doit t'admettre"],
    ['lectureSeule', true, 'écoute/lecture seule'],
    ['billetManquant', true, 'billet'],
    ['attenteInscription', true, 'inscription'],
    ['paywallCredits', true, "crédit d'accès"],
  ];
  for (const [cle, valeur, extrait] of cas) {
    const d = { ...DROITS_OK, [cle]: valeur };
    assert.equal(peutRecevoirLaVideo(d), false, `${cle} doit fermer la vidéo`);
    assert.ok(raisonVisioFermee(d).includes(extrait), `${cle} → « ${raisonVisioFermee(d)} »`);
  }
  assert.equal(raisonVisioFermee(DROITS_OK), '', 'aucune raison quand rien ne bloque');
});

test('GUEST (lecture seule) et OPEN (crédits) restent fermés — aucune économie nouvelle', () => {
  assert.equal(peutRecevoirLaVideo({ ...DROITS_OK, lectureSeule: true }), false);
  assert.equal(peutRecevoirLaVideo({ ...DROITS_OK, paywallCredits: true }), false);
});

test('PRIVATE : invité admis d’une session gratuite → vidéo autorisée', () => {
  assert.equal(peutRecevoirLaVideo({ ...DROITS_OK, enAttenteAdmission: false }), true);
});

test('structurel : HOST CAMERA SIGNAL — émis sur la publication RÉELLE, avec battement', () => {
  const page = codeSeul(lire('pages', 'SessionPage.tsx'));
  assert.ok(page.includes('const cameraDiffusee = canShare && videoMesh.cameraOn;'),
    'annoncé sur la publication réelle, jamais sur le clic');
  assert.ok(page.includes('event: EVENEMENT_CAMERA_HOTE'), 'même canal Realtime que le partage écran');
  assert.ok(page.includes('setInterval(() => broadcastHostCameraState(true), BATTEMENT_CAMERA_MS)'),
    'battement pour les arrivées tardives');
  assert.ok(page.includes('broadcastHostCameraState(false)'), 'le départ propre le dit');
});

test('structurel : PARTICIPANT AUTO JOIN — la room s’active, et seulement pour qui a le droit', () => {
  const page = codeSeul(lire('pages', 'SessionPage.tsx'));
  assert.ok(page.includes('active: (liveMode || screenSharing || remoteScreenActive || cameraHoteAVoir) && !!sessionId'),
    'la caméra distante active la room');
  assert.ok(page.includes('peutRecevoirLaVideo(droitsVisio)'), 'les droits sont relus avant toute connexion');
  assert.ok(page.includes('setCameraHoteAVoir((prev) => (prev === aVoir ? prev : aVoir))'),
    'pas de setState inutile (règle anti-boucle du dépôt)');
  assert.ok(page.includes('visioOuverteAutoRef'), 'refermer seulement ce qu’on a ouvert soi-même');
});

test('structurel : SCREEN SHARE INTACT — l’annonce écran existe toujours, à côté', () => {
  const page = codeSeul(lire('pages', 'SessionPage.tsx'));
  assert.equal((page.match(/SCREEN_SHARE_STATE/g) || []).length, 2, 'émission + réception inchangées');
  assert.ok(page.includes('setRemoteScreenActive(!!p.active)'), 'le participant active toujours sa réception écran');
  assert.ok(page.includes('videoMesh.startScreen(stream)') && page.includes('videoMesh.stopScreen()'));
  assert.notEqual(EVENEMENT_CAMERA_HOTE, 'SCREEN_SHARE_STATE', 'un voisin, pas un remplaçant');
});

test('structurel : STAGE REFUSÉ — plus de repli silencieux en spectateur', () => {
  const lk = codeSeul(lire('hooks', 'useLiveKitStage.ts'));
  assert.ok(lk.includes("setConnexion('refus-publication')"), 'le refus a son état propre');
  assert.ok(/else if \(!creds\) \{\s*\n\s*if \(!cancelled\) setConnexion\('refus-publication'\);\s*\n\s*return;/.test(lk),
    'un stage refusé ne redemande PAS un jeton viewer');
  assert.ok(lk.includes('if (canPublish) return false;'),
    'startCamera ne répond plus « oui » à un hôte qui ne publie pas');
  assert.ok(lk.includes("connexionRef.current === 'refus-publication'"), 'startCamera refuse aussi dans cet état');
  // La scène pleine reste une dégradation ANNONCÉE : viewer y est légitime.
  assert.ok(lk.includes("onStageFullRef.current?.(); creds = await fetchToken('viewer')"));
  const panel = codeSeul(lire('components', 'session', 'LiveVisioPanel.tsx'));
  assert.ok(panel.includes('visio-refus-publication'), 'et cela s’affiche');
});

test('structurel : la course claimHost → jeton stage est fermée', () => {
  const page = codeSeul(lire('pages', 'SessionPage.tsx'));
  assert.ok(page.includes('const publicationPrete = isAdminUser || isCoHost || (!!user?.id && sessionHostId != null && sessionHostId === user.id)'),
    'on n’essaie de publier qu’avec une autorité déjà écrite');
  assert.ok(page.includes('publicationPrete,'), 'transmise au hook vidéo');
  const lk = codeSeul(lire('hooks', 'useLiveKitStage.ts'));
  assert.ok(lk.includes('if (canPublish && !publicationPrete)'), 'le hook attend au lieu de courir');
  assert.ok(lk.includes('}, [active, sessionId, userId, canPublish, publicationPrete]);'),
    'et se rejoue dès que l’autorité arrive');
});

test('structurel : les libellés d’accès disent ce que le code fait', () => {
  const sel = codeSeul(lire('components', 'session', 'AccessModeSelector.tsx'));
  assert.ok(sel.includes("label: 'Accès lecture seule'") && sel.includes("label: 'Accès complet'"));
  assert.ok(!sel.includes('Accès avec inscription'), 'aucune inscription n’est créée ici');
  const page = lire('pages', 'SessionPage.tsx');
  assert.ok(page.includes("Ces crédits vont à la plateforme, pas à toi."),
    'le mode crédits ne se présente plus comme une vente du coach');
});
