/**
 * 🎛️ Phase 1 Sources — la RÈGLE caméra de l'hôte, prouvée sans navigateur.
 *
 * Ce que ces bancs verrouillent (cas A → G de la mission du 16/09/2026) :
 *   A. ordinateur sans caméra externe → webcam intégrée ;
 *   B. ordinateur + caméra externe choisie → l'externe ;
 *   C. caméra externe retirée → le live ne tombe pas : retour à l'intégrée (ou audio si plus rien) ;
 *   D. téléphone sans externe → caméra du téléphone ;
 *   E. Avant ↔ Arrière ;
 *   F. la 2ᵉ caméra (secondaire) qui échoue ne touche pas la principale (état 'indisponible') ;
 *   G. `devicechange` → décision recalculée sur la nouvelle liste.
 * La logique est PURE (`src/lib/sourcesLogic.ts`) : on la transpile avec esbuild (yarn test) et
 * on l'exécute telle quelle. Les hooks qui l'appellent sont vérifiés par le banc structurel
 * `sourcesStudio.test.mjs`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  familleCamera, libelleCamera, choisirCameraPrincipale, decisionDebranchement, cibleBascule,
  multiCamPossible, estMobile, libelleMicro, camerasAffichables, microsAffichables,
} from './.build/sourcesLogic.mjs';

const FACETIME = { deviceId: 'int', label: 'FaceTime HD Camera (Built-in)' };
const SONY = { deviceId: 'sony', label: 'Sony ZV-E10 (054c:0a3d)' };
const HDMI = { deviceId: 'hdmi', label: 'USB Video (534d:2109)' };
const AVANT = { deviceId: 'front', label: 'camera2 1, facing front' };
const ARRIERE = { deviceId: 'back', label: 'camera2 0, facing back' };

test('familles : intégrée / externe / avant / arrière lues sur le libellé', () => {
  assert.equal(familleCamera(FACETIME.label), 'interne');
  assert.equal(familleCamera(SONY.label), 'externe');
  assert.equal(familleCamera(HDMI.label), 'externe');
  assert.equal(familleCamera(AVANT.label), 'avant');
  assert.equal(familleCamera(ARRIERE.label), 'arriere');
  assert.equal(familleCamera('Front Camera'), 'avant');
  assert.equal(familleCamera('Back Camera'), 'arriere');
});

test('libellés utilisateur : jamais « user / environment / facing » à l écran', () => {
  assert.equal(libelleCamera(AVANT, 0), 'Caméra avant');
  assert.equal(libelleCamera(ARRIERE, 1), 'Caméra arrière');
  assert.equal(libelleCamera(SONY, 0), 'Sony ZV-E10');              // identifiant USB retiré
  assert.equal(libelleCamera({ deviceId: 'x', label: '' }, 2), 'Caméra externe 3');
  for (const c of [AVANT, ARRIERE, SONY, HDMI, FACETIME]) {
    assert.doesNotMatch(libelleCamera(c, 0), /\buser\b|environment|facing/i);
  }
});

test('A. ordinateur sans externe → webcam intégrée', () => {
  assert.equal(choisirCameraPrincipale([FACETIME], null), 'int');
});

test('B. ordinateur + externe explicitement choisie → l externe', () => {
  assert.equal(choisirCameraPrincipale([FACETIME, SONY], 'sony'), 'sony');
  // sans choix explicite, l'externe n'est JAMAIS imposée : l'intégrée reste le repli naturel
  assert.equal(choisirCameraPrincipale([SONY, FACETIME], null), 'int');
});

test('C. externe retirée → retour à l intégrée ; plus rien → audio (null), jamais une exception', () => {
  const d1 = decisionDebranchement([FACETIME], 'sony');
  assert.deepEqual(d1, { debranchee: true, retour: 'int' });
  const d2 = decisionDebranchement([], 'sony');
  assert.deepEqual(d2, { debranchee: true, retour: null });
  // caméra encore là → rien à faire
  assert.deepEqual(decisionDebranchement([FACETIME, SONY], 'sony'), { debranchee: false, retour: null });
  assert.deepEqual(decisionDebranchement([FACETIME], null), { debranchee: false, retour: null });
});

test('D. téléphone sans externe → caméra du téléphone (la première proposée, sans forcer avant/arrière)', () => {
  assert.equal(choisirCameraPrincipale([ARRIERE, AVANT], null), 'back');
  assert.equal(choisirCameraPrincipale([AVANT, ARRIERE], null), 'front');
  // aucune caméra du tout → null (live audio, message discret)
  assert.equal(choisirCameraPrincipale([], null), null);
});

test('E. bascule Avant ↔ Arrière (préfère l autre orientation, sinon la suivante)', () => {
  assert.equal(cibleBascule([AVANT, ARRIERE, SONY], 'front'), 'back');
  assert.equal(cibleBascule([AVANT, ARRIERE, SONY], 'back'), 'front');
  assert.equal(cibleBascule([FACETIME, SONY], 'int'), 'sony'); // ordinateur : simple rotation
  assert.equal(cibleBascule([FACETIME], 'int'), null);         // une seule caméra : rien
});

test('F. multi-caméra : ordinateur Chromium seulement ; mobile et Safari = mono-caméra', () => {
  const CHROME_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
  const SAFARI_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
  const CHROME_ANDROID = 'Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36';
  const SAFARI_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
  const EDGE_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0';
  assert.equal(multiCamPossible(CHROME_MAC), true);
  assert.equal(multiCamPossible(EDGE_WIN), true);
  assert.equal(multiCamPossible(SAFARI_MAC), false);
  assert.equal(multiCamPossible(CHROME_ANDROID), false);
  assert.equal(multiCamPossible(SAFARI_IOS), false);
  assert.equal(multiCamPossible(SAFARI_MAC, 5), false); // iPadOS se présente comme un Mac tactile
  assert.equal(estMobile(CHROME_ANDROID), true);
  assert.equal(estMobile(CHROME_MAC), false);
});

test('G. devicechange : la décision se recalcule sur la NOUVELLE liste', () => {
  // avant : intégrée + Sony, Sony publiée ; après : Sony a disparu
  const avant = [FACETIME, SONY];
  const apres = [FACETIME];
  assert.deepEqual(decisionDebranchement(avant, 'sony'), { debranchee: false, retour: null });
  assert.deepEqual(decisionDebranchement(apres, 'sony'), { debranchee: true, retour: 'int' });
  // une caméra ajoutée à chaud ne change pas la principale
  assert.deepEqual(decisionDebranchement([FACETIME, SONY, HDMI], 'sony'), { debranchee: false, retour: null });
});

test('micros : libellé lisible, jamais un deviceId brut', () => {
  assert.equal(libelleMicro('Rode Wireless GO II (19f7:0035)', 1), 'Rode Wireless GO II');
  assert.equal(libelleMicro('', 0), 'Micro de l’appareil');
  assert.equal(libelleMicro('', 2), 'Micro 3');
});


/* ═══════════════ DÉDOUBLONNAGE (constat iPhone du 17/09/2026 : « Caméra avant » ×2, « arrière » ×2) ═══════════════ */

const IPHONE_FR = [
  { deviceId: 'a', label: 'Caméra avant' },
  { deviceId: 'b', label: 'Caméra arrière' },
  { deviceId: 'c', label: 'Caméra arrière (double grand angle)' },
  { deviceId: 'd', label: 'Caméra avant (TrueDepth)' },
];
const IPHONE_EN = [
  { deviceId: '1', label: 'Front Camera' },
  { deviceId: '2', label: 'Back Camera' },
  { deviceId: '3', label: 'Back Dual Wide Camera' },
  { deviceId: '4', label: 'Back Ultra Wide Camera' },
  { deviceId: '5', label: 'Back Triple Camera' },
];
const SAMSUNG = [
  { deviceId: '0', label: 'camera2 0, facing back' },
  { deviceId: '1', label: 'camera2 1, facing front' },
  { deviceId: '2', label: 'camera2 2, facing back' },
];
const PIXEL = [{ deviceId: 'p0', label: 'Back Camera' }, { deviceId: 'p1', label: 'Front Camera' }];
const MAC = [
  { deviceId: 'ft', label: 'FaceTime HD Camera (Built-in)', groupId: 'g1' },
  { deviceId: 's1', label: 'Sony ZV-E10 (054c:0a3d)', groupId: 'g2' },
  { deviceId: 's2', label: 'Sony ZV-E10 (054c:0a3d)', groupId: 'g2' },      // 2ᵉ profil du même boîtier
  { deviceId: 'obs', label: 'OBS Virtual Camera' },
  { deviceId: 'h', label: 'USB Capture HDMI (534d:2109)' },
];
const WIN = [{ deviceId: 'i', label: 'Integrated Camera' }, { deviceId: 'w', label: 'Logitech BRIO' }];

test('iPhone FR : 4 objectifs → 2 entrées « Caméra avant » / « Caméra arrière », deviceId stable = premier de la face', () => {
  const l = camerasAffichables(IPHONE_FR, { mobile: true });
  assert.deepEqual(l.map((e) => e.libelle), ['Caméra avant', 'Caméra arrière']);
  assert.deepEqual(l.map((e) => e.deviceId), ['a', 'b']);
  assert.deepEqual(l.map((e) => e.membres), [['a', 'd'], ['b', 'c']]);
});

test('iPhone EN : « Back Dual/Ultra Wide/Triple » sont bien ARRIÈRE (plus « externe ») → 2 entrées', () => {
  assert.equal(familleCamera('Back Dual Wide Camera'), 'arriere');
  assert.equal(familleCamera('Back Ultra Wide Camera'), 'arriere');
  assert.equal(familleCamera('Back Triple Camera'), 'arriere');
  const l = camerasAffichables(IPHONE_EN, { mobile: true });
  assert.deepEqual(l.map((e) => [e.libelle, e.deviceId]), [['Caméra avant', '1'], ['Caméra arrière', '2']]);
});

test('Android Samsung / Pixel : une entrée par face, deviceId = premier énuméré de la face', () => {
  const s = camerasAffichables(SAMSUNG, { mobile: true });
  assert.deepEqual(s.map((e) => [e.libelle, e.deviceId]), [['Caméra avant', '1'], ['Caméra arrière', '0']]);
  const p = camerasAffichables(PIXEL, { mobile: true });
  assert.deepEqual(p.map((e) => [e.libelle, e.deviceId]), [['Caméra avant', 'p1'], ['Caméra arrière', 'p0']]);
});

test('Mac : intégrée d abord, puis chaque externe UNE fois (Sony à 2 profils = 1 ligne), virtuelle et HDMI gardées', () => {
  const l = camerasAffichables(MAC, { mobile: false });
  assert.deepEqual(l.map((e) => e.libelle), ['Caméra intégrée', 'Sony ZV-E10', 'OBS Virtual Camera', 'USB Capture HDMI']);
  assert.deepEqual(l[1].membres, ['s1', 's2']);
  assert.equal(camerasAffichables(WIN, { mobile: false }).map((e) => e.libelle).join(' | '), 'Caméra intégrée | Logitech BRIO');
});

test('libellés affichés : jamais de jargon, jamais de doublon', () => {
  for (const [devs, mobile] of [[IPHONE_FR, true], [IPHONE_EN, true], [SAMSUNG, true], [MAC, false], [WIN, false]]) {
    const libs = camerasAffichables(devs, { mobile }).map((e) => e.libelle);
    assert.equal(new Set(libs).size, libs.length, 'aucun libellé en double');
    for (const x of libs) assert.doesNotMatch(x, /\buser\b|environment|facing|[0-9a-f]{4}:[0-9a-f]{4}/i);
  }
});

test('bascule Avant ↔ Arrière reste cohérente avec la liste dédupliquée (même deviceId cible)', () => {
  const affiches = camerasAffichables(IPHONE_EN, { mobile: true });
  const arriere = affiches.find((e) => e.libelle === 'Caméra arrière');
  assert.equal(cibleBascule(IPHONE_EN, '1'), arriere.deviceId);        // depuis l'avant → l'arrière affichée
  assert.equal(cibleBascule(IPHONE_EN, '4'), '1');                    // depuis un objectif arrière secondaire → l'avant
  assert.equal(choisirCameraPrincipale(IPHONE_EN, null), '1');         // repli inchangé : premier proposé
});

test('micros : « Default / Communications » Windows et doublons de groupe → une ligne ; externe reconnu', () => {
  const win = microsAffichables([
    { deviceId: 'd', label: 'Default - Microphone (Realtek)' },
    { deviceId: 'c', label: 'Communications - Microphone (Realtek)' },
    { deviceId: 'r', label: 'Microphone (Realtek)' },
    { deviceId: 'rode', label: 'Rode Wireless GO II (19f7:0030)' },
  ]);
  assert.deepEqual(win.map((m) => [m.libelle, m.deviceId]), [['Micro de l’appareil', 'd'], ['Rode Wireless GO II', 'rode']]);
  const mac = microsAffichables([
    { deviceId: 'default', label: 'Default - MacBook Pro Microphone', groupId: 'g' },
    { deviceId: 'm', label: 'MacBook Pro Microphone', groupId: 'g' },
    { deviceId: 'z', label: 'Shure MV7' },
  ]);
  assert.deepEqual(mac.map((m) => m.libelle), ['Micro de l’appareil', 'Shure MV7']);
  const phone = microsAffichables([{ deviceId: 'x', label: 'iPhone Microphone' }, { deviceId: 'y', label: 'Rode Wireless GO' }]);
  assert.deepEqual(phone.map((m) => m.libelle), ['Micro de l’appareil', 'Rode Wireless GO']);
  assert.deepEqual(microsAffichables([{ deviceId: 'seul', label: '' }]).map((m) => m.libelle), ['Micro de l’appareil']);
});
