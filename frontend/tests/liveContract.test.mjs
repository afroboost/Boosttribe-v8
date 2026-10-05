/**
 * 🛡️ CONTRAT LIVE — règles pures EXÉCUTÉES (05/10/2026). Voir docs/LIVE_CONTRACT.md.
 *
 * Complément du harnais navigateur (tests/contrat/contrat.mjs) : ici, les décisions métier qui
 * protègent les fonctions du Live sont appelées avec de vraies entrées. Les seuls contrôles de
 * source vérifient un BRANCHEMENT (la page appelle bien la règle testée), jamais un texte.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { actionPromoParticipant } from './.build/livePromo.mjs';
import { optionsCameraLive, cibleCamera, OPTIONS_ROOM_LIVE } from './.build/qualiteVideo.mjs';
import { coteMaxTraitement } from './.build/beauteLogic.mjs';
import { TRAITEMENTS_PAROLE, GAINS_VOIX_DEFAUT } from './.build/voixLive.mjs';
import { sequenceFinDuLive, sequenceDepartTemporaire, departDoitAnnoncer } from './.build/finDuLive.mjs';
import { droitsApresChoixEntree } from './.build/accesSession.mjs';
import { CLES_PII_INVITE } from './.build/inviteLive.mjs';
import { lire, codeSeul } from './lireSource.mjs';

const PAGE = codeSeul(lire('pages', 'SessionPage.tsx'));
const STAGE = codeSeul(lire('hooks', 'useLiveKitStage.ts'));

/* ═══ Faire la promo ═══ */
test('Faire la promo : participant connecté → fenêtre ; invité sans compte → connexion ; hôte/fermée → rien', () => {
  const ouverte = { enabled: true, offres: [{ id: 'a' }] };
  assert.equal(actionPromoParticipant({ estProprietaire: false, connecte: true, config: ouverte }), 'ouvrir');
  assert.equal(actionPromoParticipant({ estProprietaire: false, connecte: false, config: ouverte }), 'connexion');
  assert.equal(actionPromoParticipant({ estProprietaire: true, connecte: true, config: ouverte }), null);
  assert.equal(actionPromoParticipant({ estProprietaire: false, connecte: true, config: { enabled: false, offres: [{ id: 'a' }] } }), null);
  assert.equal(actionPromoParticipant({ estProprietaire: false, connecte: true, config: { enabled: true, offres: [] } }), null);
  assert.equal(actionPromoParticipant({ estProprietaire: false, connecte: true, config: null }), null);
});

test('branchement : la page décide « Faire ma promo » avec CETTE règle (plus de `user &&` qui la cachait)', () => {
  assert.match(PAGE, /actionPromoParticipant\(\{ estProprietaire: estProprietaireSession, connecte: !!user, config: livePromo\.config \}\)/);
  assert.match(PAGE, /onFaireMaPromo=\{promoParticipantAction === 'ouvrir'/);
  assert.match(PAGE, /<PromoConnexionInvite onFermer=/);                       // invité : fenêtre « Se connecter » (cliquée par le harnais)
  assert.match(PAGE, /state: \{ from: location\.pathname \+ location\.search \}/); // retour RELATIF au routeur (basename /live)
});

/* ═══ Persistance de la configuration (mode d'entrée / droits des invités) ═══ */
test('branchement : à l’ouverture, le SERVEUR applique les préférences (plus de condition « access_mode vide »)', () => {
  assert.match(PAGE, /appliquerPreferencesLive\(sessionId\)/);
  assert.doesNotMatch(PAGE, /if \(accesJamaisRegleRef\.current !== true\) return;/);
  assert.match(PAGE, /memoriserDroitsInvites\(accessDraft, sessionId\)/);
});

test('Gratuit par lien → accès visio proposé par défaut (règle existante intacte)', () => {
  assert.equal(droitsApresChoixEntree({ ancien: 'open', nouveau: 'private', droits: 'guest', choixManuel: false }), 'account');
  assert.equal(droitsApresChoixEntree({ ancien: 'open', nouveau: 'private', droits: 'guest', choixManuel: true }), 'guest');
});

/* ═══ Quitter = temporaire, Terminer = définitif ═══ */
test('Quitter (hôte) est TEMPORAIRE : les participants ne sont PAS renvoyés ; Terminer les prévient', () => {
  const e = { enregistrementEnCours: false, partageEcranActif: false, cameraActive: true, microActif: true, estHote: true };
  assert.ok(!sequenceDepartTemporaire(e).includes('prevenir-participants'));
  assert.ok(!sequenceDepartTemporaire(e).includes('retour-ecran'));
  assert.ok(sequenceFinDuLive(e).includes('prevenir-participants'));
  assert.equal(departDoitAnnoncer(true, false), false);            // aucun live démarré → rien à annoncer
});

/* ═══ Bon retour (invité) : aucune coordonnée en clair dans le navigateur ═══ */
test('Bon retour : les anciennes clés PII invité sont toujours effacées', () => {
  assert.deepEqual([...CLES_PII_INVITE].sort(), ['bt_invite_contact', 'bt_local_avatar', 'bt_nickname']);
});

/* ═══ Caméra 4K / mobile ═══ */
test('Caméra : 4K demandée si la caméra l’annonce ; téléphone jamais forcé en 4K', () => {
  assert.equal(cibleCamera(2160), 2160);
  assert.equal(cibleCamera(1440), 1440);                         // 1440p : caméra qui l'annonce (ex. MacBook « 1920 » → palier inférieur)
  assert.deepEqual(optionsCameraLive({ mobile: false, hauteurMax: 1440 }).capture.resolution, { width: 2560, height: 1440, frameRate: 30 });
  assert.deepEqual(optionsCameraLive({ mobile: false, hauteurMax: 1080 }).capture.resolution, { width: 1920, height: 1080, frameRate: 30 });
  const o = optionsCameraLive({ mobile: false, hauteurMax: 2160 });
  assert.deepEqual(o.capture.resolution, { width: 3840, height: 2160, frameRate: 30 });
  assert.equal(o.publication.simulcast, true);
  assert.equal(o.publication.videoEncoding, undefined);          // aucun plafond de débit imposé
  assert.deepEqual(optionsCameraLive({ mobile: true, hauteurMax: 2160 }), { capture: {}, publication: undefined });
  assert.equal(coteMaxTraitement({ mobile: false }), 3840);      // beauté/look jamais réduits à 720 sur ordinateur
  assert.equal(coteMaxTraitement({ mobile: true }), 720);
});

test('Room du Live : adaptiveStream + dynacast, options UNIQUES partagées par le hook et le harnais', () => {
  assert.deepEqual({ ...OPTIONS_ROOM_LIVE }, { adaptiveStream: true, dynacast: true });
  assert.match(STAGE, /new Room\(OPTIONS_ROOM_LIVE\)/);
  assert.match(STAGE, /ajusterDebitsCouches\(piste\)/);                      // changement de caméra : débits recalculés
});

/* ═══ Audio : strictement inchangé ═══ */
test('Audio : AEC + NS + AGC actifs, gains naturels (aucune ré-amplification)', () => {
  assert.deepEqual({ ...TRAITEMENTS_PAROLE }, { echoCancellation: true, noiseSuppression: true, autoGainControl: true });
  assert.ok(Object.entries(GAINS_VOIX_DEFAUT).every(([k, v]) => (k === 'micParticipantPct' ? v === 100 : v === 1)));
});
