/**
 * 🎥 PHASE CAMÉRA 2 — qualité native de la caméra jusqu'à 4K (mesuré le 05/10/2026).
 *
 * Banc réel (Insta360 Link 2 Pro, Mac Apple M5, LiveKit 1.13.7 local) : la caméra donne
 * 3840×2160 à 30 i/s ; VP8 (codec actuel) l'encode en ~12 ms/image (budget 33 ms) sans
 * limitation (`qualityLimitationReason: none`) et le spectateur reçoit 3840×2160. H.264
 * (OpenH264 logiciel) : ~15,7 ms/image → AUCUNE raison de changer de codec.
 * Avant : capture plafonnée à 1080p et débit imposé à 3 Mbit/s ; embellissement → 720×406.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { optionsCameraLive, cibleCamera, couchesPour, debitPourHauteur, encodagesAjustes, decisionQualiteCpu, hauteurMaxCamera } from './.build/qualiteVideo.mjs';
import { resolutionTraitement, coteMaxTraitement, echelleRayon, MASQUE_ALPHA_TEMPOREL, masquePeauRef, lisserMasqueTemporel, GardePerformance } from './.build/beauteLogic.mjs';
import { lire, codeSeul } from './lireSource.mjs';

test('cible = meilleure résolution que la caméra annonce, sans dépasser 4K (A/B/C/D)', () => {
  assert.equal(cibleCamera(2160), 2160);
  assert.equal(cibleCamera(4320), 2160);          // 8K annoncé → on s'arrête à 4K
  assert.equal(cibleCamera(1440), 1440);
  assert.equal(cibleCamera(1200), 1080);
  assert.equal(cibleCamera(1080), 1080);
  assert.equal(cibleCamera(720), 720);
  assert.equal(cibleCamera(480), 720);            // demande 720 « idéale » : la caméra donne ce qu'elle peut
  assert.equal(cibleCamera(null), 1080);          // capacités inconnues (Safari) : comportement actuel
});

test('capacités lues sans ouvrir la caméra (InputDeviceInfo.getCapabilities)', () => {
  assert.equal(hauteurMaxCamera({ getCapabilities: () => ({ height: { max: 2160, min: 1 } }) }), 2160);
  assert.equal(hauteurMaxCamera({ getCapabilities: () => ({}) }), null);
  assert.equal(hauteurMaxCamera({}), null);
  assert.equal(hauteurMaxCamera(null), null);
  assert.equal(hauteurMaxCamera({ getCapabilities: () => { throw new Error('x'); } }), null);
});

test('ordinateur : capture demandée à la cible, AUCUN débit imposé (LiveKit l’adapte à la résolution RÉELLE)', () => {
  const o = optionsCameraLive({ mobile: false, hauteurMax: 2160 });
  assert.deepEqual(o.capture.resolution, { width: 3840, height: 2160, frameRate: 30 });
  assert.equal(o.publication.simulcast, true);
  assert.equal(o.publication.videoEncoding, undefined, 'plus de plafond à 3 Mbit/s');
  assert.deepEqual(o.publication.videoSimulcastLayers.map((l) => l.height), [360, 1080]);
  assert.deepEqual(optionsCameraLive({ mobile: false, hauteurMax: 1080 }).publication.videoSimulcastLayers.map((l) => l.height), [360, 720]);
  assert.deepEqual(optionsCameraLive({ mobile: false, hauteurMax: 720 }).publication.videoSimulcastLayers.map((l) => l.height), [180, 360]);
  assert.deepEqual(optionsCameraLive({ mobile: false }).capture.resolution, { width: 1920, height: 1080, frameRate: 30 });
});

test('K. téléphone : jamais de 4K forcé (stabilité d’abord) — réglage LiveKit inchangé', () => {
  const o = optionsCameraLive({ mobile: true, hauteurMax: 2160 });
  assert.equal(o.capture.resolution, undefined);
  assert.equal(o.publication, undefined);
});

test('couches : une échelle utile pour chaque cible, jamais de couche en double', () => {
  for (const h of [720, 1080, 1440, 2160]) {
    const c = couchesPour(h).map((l) => l.height);
    assert.ok(c.every((x) => x < h), `${h} : ${c}`);
  }
});

test('débit par couche selon sa hauteur réelle (préréglages LiveKit)', () => {
  assert.equal(debitPourHauteur(2160), 8_000_000);
  assert.equal(debitPourHauteur(1440), 5_000_000);
  assert.equal(debitPourHauteur(1080), 3_000_000);
  assert.equal(debitPourHauteur(720), 1_700_000);
  assert.equal(debitPourHauteur(360), 450_000);
});

test('H. changement de caméra : débits recalculés pour la NOUVELLE résolution (rid et échelles conservés)', () => {
  const avant = [{ rid: 'q', scaleResolutionDownBy: 3, maxBitrate: 450_000 }, { rid: 'h', scaleResolutionDownBy: 1.5, maxBitrate: 1_700_000 },
                 { rid: 'f', scaleResolutionDownBy: 1, maxBitrate: 3_000_000 }];
  const apres = encodagesAjustes(avant, 3840, 2160);
  assert.deepEqual(apres.map((e) => [e.rid, e.scaleResolutionDownBy, e.maxBitrate]),
    [['q', 3, 1_700_000], ['h', 1.5, 5_000_000], ['f', 1, 8_000_000]]);
});

test('surcharge processeur : on descend PROPREMENT d’un palier (4K → 1440 → 1080), jamais en dessous, et on dit pourquoi', () => {
  const cpu = Array(3).fill({ limite: 'cpu' });
  assert.deepEqual(decisionQualiteCpu(cpu, 2160), { cible: 1440, raison: 'processeur saturé (encodage vidéo)' });
  assert.deepEqual(decisionQualiteCpu(cpu, 1440), { cible: 1080, raison: 'processeur saturé (encodage vidéo)' });
  assert.equal(decisionQualiteCpu(cpu, 1080), null);
  assert.equal(decisionQualiteCpu([{ limite: 'cpu' }, { limite: 'none' }, { limite: 'cpu' }], 2160), null);
  assert.equal(decisionQualiteCpu(Array(3).fill({ limite: 'bandwidth' }), 2160), null, 'le réseau est géré par LiveKit (couches)');
});

test('F. embellissement : traitement à la résolution de la caméra sur ordinateur (fin du 720×406)', () => {
  assert.equal(coteMaxTraitement({ mobile: false }), 3840);
  assert.equal(coteMaxTraitement({ mobile: true }), 720);
  assert.deepEqual(resolutionTraitement(3840, 2160, coteMaxTraitement({ mobile: false })), { largeur: 3840, hauteur: 2160 });
  assert.deepEqual(resolutionTraitement(1920, 1080, coteMaxTraitement({ mobile: false })), { largeur: 1920, hauteur: 1080 });
  assert.equal(echelleRayon(720, 406), 1);
  assert.equal(echelleRayon(3840, 2160), 3840 / 720);       // même lissage visuel qu'au réglage d'origine
});

test('G. scintillement : masque peau robuste au bruit et lissé dans le temps', () => {
  // Couleur de peau en BORD de plage : un bruit capteur de ±3/255 ne doit plus faire basculer le masque.
  const base = [0.80, 0.60, 0.50];
  let ecartMax = 0;
  const m0 = masquePeauRef(...base);
  for (const d of [-3 / 255, 3 / 255]) for (let k = 0; k < 3; k++) {
    const c = [...base]; c[k] += d; ecartMax = Math.max(ecartMax, Math.abs(masquePeauRef(...c) - m0));
  }
  assert.ok(ecartMax <= 0.12, `variation du masque ${ecartMax.toFixed(3)}`);
  // Alternance brutale 0/1 d'une image à l'autre → amplitude amortie.
  assert.ok(MASQUE_ALPHA_TEMPOREL > 0 && MASQUE_ALPHA_TEMPOREL <= 0.4);
  let m = 0.5, min = 1, max = 0;
  for (let i = 0; i < 40; i++) { m = lisserMasqueTemporel(m, i % 2, MASQUE_ALPHA_TEMPOREL); if (i > 10) { min = Math.min(min, m); max = Math.max(max, m); } }
  assert.ok(max - min <= 0.45, `oscillation ${(max - min).toFixed(2)}`);
});

test('garde : une caméra lente (basse lumière) ne coupe plus l’embellissement — seul un traitement en RETARD compte', () => {
  const g = new GardePerformance();
  let t = 0, coupe = false;
  for (let i = 0; i < 120; i++) { t += 1000 / 15; coupe = g.enregistrer(t, 15) || coupe; }   // source à 15 i/s, tout traité
  assert.equal(coupe, false);
  const g2 = new GardePerformance();
  t = 0; coupe = false;
  for (let i = 0; i < 120; i++) { t += 1000 / 10; coupe = g2.enregistrer(t, 30) || coupe; }  // source 30, traité 10
  assert.equal(coupe, true);
});

const R = codeSeul(lire('lib', 'beaute', 'rendu.ts'));
const B = codeSeul(lire('lib', 'beaute', 'BeauteProcessor.ts'));

test('rendu : masque en passe séparée, moyenne temporelle (ping-pong), éclaircissement non additif', () => {
  assert.match(R, /createFramebuffer/);
  assert.match(R, /u_masquePrecedent/);
  assert.match(R, /u_alpha/);
  assert.doesNotMatch(R, /\+ u_eclair \* m;/);
  assert.match(R, /u_echelle/);
});

test('processeur : une image déjà traitée n’est pas retraitée ; plafond selon l’appareil ; paliers avant coupure', () => {
  assert.match(B, /presentedFrames/);
  assert.match(B, /coteMaxTraitement\(\{ mobile: /);
  assert.match(B, /palierSuivant\(/);
});

const S = codeSeul(lire('hooks', 'useLiveKitStage.ts'));

test('publication : capacités de LA caméra choisie ; changement de caméra = redémarrage à SA meilleure qualité', () => {
  assert.match(S, /hauteurMaxCamera\(/);
  assert.match(S, /optionsCameraLive\(\{ mobile[^}]*hauteurMax/);
  const sw = S.slice(S.indexOf('const setCameraDevice = useCallback'), S.indexOf('basculeAutoRef.current = async'));
  assert.match(sw, /restartTrack\(\{ deviceId: \{ exact: deviceId \}, \.\.\.capture \}\)/);
  assert.match(sw, /ajusterDebitsCouches\(piste\)/);          // 05/10 : débits recalculés (encodagesAjustes) — mesuré par le contrat navigateur
  assert.match(sw, /if \(!piste\) \{ await room\.switchActiveDevice\('videoinput', deviceId\); return; \}/, 'switchActiveDevice seulement en secours (aucune piste)');
});

test('E/L. embellissement OFF : aucun canvas ; audio intact (aucune option micro touchée)', () => {
  assert.doesNotMatch(S, /setMicrophoneEnabled|createLocalAudioTrack/);
});
