/**
 * 🔴 TERMINER LE LIVE — l'ordre des opérations, et la fin qui survit à un onglet fermé.
 *
 * Le bug de terrain (23/09/2026) : « Quitter le live » fermait l'écran et rien d'autre.
 * Caméra allumée, room ouverte, enregistrement non finalisé, participants non prévenus,
 * et la page d'accueil qui annonçait « EN DIRECT » pendant trois heures.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { sequenceFinDuLive, departDoitAnnoncer, EVENEMENT_LIVE_TERMINE, EVENEMENTS_DEPART } from './.build/finDuLive.mjs';
import { lire, codeSeul } from './lireSource.mjs';

const TOUT = { enregistrementEnCours: true, partageEcranActif: true, cameraActive: true, microActif: true, estHote: true };

test('tout est coupé, et dans le bon ordre', () => {
  assert.deepEqual(sequenceFinDuLive(TOUT), [
    'finaliser-enregistrement', 'prevenir-participants', 'couper-camera',
    'couper-ecran', 'couper-micro', 'quitter-room', 'annoncer-fin', 'retour-ecran',
  ]);
});

test('finaliser AVANT de couper les pistes — un fichier fermé sur des pistes mortes pèse 0 octet', () => {
  const s = sequenceFinDuLive(TOUT);
  assert.ok(s.indexOf('finaliser-enregistrement') < s.indexOf('couper-camera'));
  assert.ok(s.indexOf('finaliser-enregistrement') < s.indexOf('quitter-room'));
});

test('prévenir AVANT de quitter la room — après, le canal est fermé et personne n’apprend rien', () => {
  const s = sequenceFinDuLive(TOUT);
  assert.ok(s.indexOf('prevenir-participants') < s.indexOf('quitter-room'));
});

test('annoncer la fin en DERNIER — sinon on déclare terminé un live qui diffuse encore', () => {
  const s = sequenceFinDuLive(TOUT);
  assert.ok(s.indexOf('annoncer-fin') > s.indexOf('quitter-room'));
  assert.equal(s[s.length - 1], 'retour-ecran');
});

test('une étape inutile n’est pas jouée', () => {
  const s = sequenceFinDuLive({ ...TOUT, enregistrementEnCours: false, partageEcranActif: false, cameraActive: false, microActif: false });
  assert.deepEqual(s, ['prevenir-participants', 'quitter-room', 'annoncer-fin', 'retour-ecran']);
});

test('un spectateur ne termine rien pour les autres : il part, c’est tout', () => {
  const s = sequenceFinDuLive({ ...TOUT, estHote: false });
  assert.ok(!s.includes('prevenir-participants'));
  assert.ok(!s.includes('annoncer-fin'));
  assert.ok(s.includes('quitter-room'));
});

test('le départ silencieux n’annonce que si un live tournait vraiment', () => {
  assert.equal(departDoitAnnoncer(true, true), true);
  assert.equal(departDoitAnnoncer(true, false), false, 'aucun live démarré');
  assert.equal(departDoitAnnoncer(false, true), false, 'un spectateur n’annonce pas');
});

test('structurel : la fin est branchée, et sur les événements qui survivent à un onglet fermé', () => {
  const page = codeSeul(lire('pages', 'SessionPage.tsx'));
  assert.ok(page.includes('const terminerLive = useCallback'), 'la routine existe');
  assert.ok(page.includes('sequenceFinDuLive({'), 'elle suit la séquence testée');
  assert.ok(page.includes('await recorder.arreter()'), 'elle finalise l’enregistrement existant');
  assert.ok(page.includes('videoMesh.stopCamera()') && page.includes('videoMesh.stopScreen()'));
  assert.ok(page.includes('setLiveMode(false)'), 'elle quitte la room');
  assert.ok(page.includes('notifyEmbedSessionEnded('), 'elle annonce la fin à Afroboost');
  // LE point du bug : un nettoyage React ne s'exécute PAS quand on ferme l'onglet.
  assert.ok(page.includes('EVENEMENTS_DEPART.forEach((e) => window.addEventListener(e, annoncer))'),
    'la fin est aussi annoncée sur pagehide / beforeunload');
  assert.deepEqual([...EVENEMENTS_DEPART], ['pagehide', 'beforeunload']);
});

test('structurel : les participants sont prévenus, et l’hôte a un vrai bouton', () => {
  const page = codeSeul(lire('pages', 'SessionPage.tsx'));
  assert.ok(page.includes(`event: EVENEMENT_LIVE_TERMINE`), 'le message part');
  assert.ok(page.includes(`.on('broadcast', { event: EVENEMENT_LIVE_TERMINE }`), 'et il est écouté');
  assert.ok(page.includes('data-testid="live-termine"'), 'un écran de fin, pas une image figée');
  const panel = codeSeul(lire('components', 'session', 'LiveVisioPanel.tsx'));
  assert.ok(panel.includes('data-testid="visio-terminer-live"'), 'bouton visible dans la barre');
  assert.ok(/\{canManageStage && onTerminerLive && \(/.test(panel), 'hôte uniquement');
  assert.ok(panel.includes('window.confirm('), 'une action irréversible demande confirmation');
  assert.equal(EVENEMENT_LIVE_TERMINE, 'LIVE_ENDED');
});
