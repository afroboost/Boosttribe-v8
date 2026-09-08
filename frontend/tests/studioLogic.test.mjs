/**
 * Bancs du Studio (caméra + prompteur) — logique pure, sans DOM ni framework.
 *
 * Exécution : `yarn test` (esbuild transpile le module TS, puis `node --test`).
 * Aucune dépendance ajoutée au projet : esbuild est déjà là, `node:test` est natif.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from './.build/studioLogic.mjs';

/* ─────────── PROMPTEUR : défilement ─────────── */

test('une vitesse lente finit par bouger le texte (report sous-pixel)', () => {
  // 24 px à 0.5× = 7,2 px/s. Sur une image de 16 ms : 0,115 px → arrondi à 0 sans report.
  let reste = 0, total = 0;
  for (let i = 0; i < 60; i++) {           // ~1 seconde d'images
    const r = L.pasDefilement(16, 24, 0.5, reste);
    reste = r.reste; total += r.pixels;
  }
  assert.ok(total >= 6 && total <= 8, `~7 px attendus en 1 s, obtenu ${total}`);
});

test('les pixels renvoyés sont toujours entiers et jamais négatifs', () => {
  for (const dt of [0, 1, 16, 33, 100, 5000, -50]) {
    const r = L.pasDefilement(dt, 48, 1, 0);
    assert.ok(Number.isInteger(r.pixels), `pixels non entier pour dt=${dt}`);
    assert.ok(r.pixels >= 0, `pixels négatif pour dt=${dt}`);
    assert.ok(r.reste >= 0 && r.reste < 1);
  }
});

test('un onglet revenu au premier plan ne fait pas sauter le texte (dt borné)', () => {
  const bond = L.pasDefilement(5000, 48, 1, 0);   // 5 s d'absence
  const borne = L.pasDefilement(L.DT_MAX_MS, 48, 1, 0);
  assert.equal(bond.pixels, borne.pixels);
});

test('la cadence de lecture ne dépend pas de la taille du texte', () => {
  // Doubler la taille double la distance parcourue : le nombre de LIGNES par seconde
  // reste constant, ce qui est la propriété qu'on veut.
  const petit = L.pasDefilement(1000, 24, 1, 0).pixels;
  const grand = L.pasDefilement(1000, 48, 1, 0).pixels;
  assert.equal(grand, petit * 2);
});

test('la vitesse est proportionnelle au multiplicateur', () => {
  // On accumule sur 1 s d'images RÉELLES : comparer deux pas isolés ne marcherait pas,
  // `Math.floor` cassant la proportionnalité stricte sur une seule image (2,88 → 2 vs 5,76 → 5).
  const parcours = (vitesse) => {
    let reste = 0, total = 0;
    for (let i = 0; i < 60; i++) { const r = L.pasDefilement(16, 48, vitesse, reste); reste = r.reste; total += r.pixels; }
    return total;
  };
  const x1 = parcours(1), x2 = parcours(2);
  assert.ok(Math.abs(x2 - x1 * 2) <= 1, `x2=${x2} devrait valoir ~2×x1=${x1 * 2}`);
});

test('fin de texte détectée au pixel près, et pas avant', () => {
  // Tolérance d'1 px ASSUMÉE : les hauteurs sont fractionnaires, un `>=` strict pourrait
  // ne jamais être atteint et le prompteur défilerait indéfiniment à l'arrêt.
  assert.equal(L.finAtteinte(0, 400, 2000), false);
  assert.equal(L.finAtteinte(1500, 400, 2000), false);
  assert.equal(L.finAtteinte(1598, 400, 2000), false);  // 1998 < 1999 → pas encore
  assert.equal(L.finAtteinte(1599, 400, 2000), true);   // 1999 >= 1999 → tolérance
  assert.equal(L.finAtteinte(1600, 400, 2000), true);
});

test('texte plus court que la fenêtre : la fin est immédiate (pas de défilement infini)', () => {
  assert.equal(L.finAtteinte(0, 400, 300), true);
});

/* ─────────── PROMPTEUR : bornes des réglages ─────────── */

test('vitesse et taille restent dans leurs bornes', () => {
  assert.equal(L.bornerVitesse(-3), L.VITESSE_MIN);
  assert.equal(L.bornerVitesse(99), L.VITESSE_MAX);
  assert.equal(L.bornerVitesse(1.24), 1.25);
  assert.equal(L.bornerTaille(2), L.TAILLE_MIN);
  assert.equal(L.bornerTaille(500), L.TAILLE_MAX);
});

/* ─────────── PROMPTEUR : raccourcis clavier ─────────── */

test('Espace ne pilote pas le prompteur pendant une saisie', () => {
  assert.equal(L.estChampDeSaisie('TEXTAREA', false), true);
  assert.equal(L.estChampDeSaisie('INPUT', false), true);
  assert.equal(L.estChampDeSaisie('SELECT', false), true);
  assert.equal(L.estChampDeSaisie('DIV', true), true);   // contenteditable
  assert.equal(L.estChampDeSaisie('DIV', false), false); // hors saisie : le raccourci agit
  assert.equal(L.estChampDeSaisie(undefined, false), false);
});

/* ─────────── CAMÉRA : contraintes ─────────── */

test('une caméra choisie est demandée en exact, jamais en simple préférence', () => {
  const c = L.contrainteVideo('abc123', 'user');
  assert.deepEqual(c, { deviceId: { exact: 'abc123' } });
  assert.equal('facingMode' in c, false);
});

test('sans caméra choisie, on s’en remet à facingMode (seul fiable sur iOS)', () => {
  assert.deepEqual(L.contrainteVideo(null, 'environment'), { facingMode: { ideal: 'environment' } });
  assert.deepEqual(L.contrainteVideo(null, 'user'), { facingMode: { ideal: 'user' } });
});

/* ─────────── CAMÉRA : repli, permissions, libellés ─────────── */

test('périphérique retiré → repli sur une caméra disponible, jamais d’écran bloqué', () => {
  const devices = [{ deviceId: 'integree' }, { deviceId: 'logitech' }];
  assert.equal(L.cameraRetenue(devices, 'insta360-debranchee'), 'integree');
});

test('la caméra mémorisée est conservée si elle est encore là', () => {
  const devices = [{ deviceId: 'integree' }, { deviceId: 'insta360' }];
  assert.equal(L.cameraRetenue(devices, 'insta360'), 'insta360');
});

test('aucune caméra branchée → null (et surtout pas une exception)', () => {
  assert.equal(L.cameraRetenue([], 'insta360'), null);
  assert.equal(L.cameraRetenue([], null), null);
});

test('une seule caméra : elle est choisie même sans mémorisation', () => {
  assert.equal(L.cameraRetenue([{ deviceId: 'facetime' }], null), 'facetime');
});

test('permission refusée : message actionnable, aucun jargon', () => {
  const m = L.messageErreurCamera('NotAllowedError');
  assert.match(m, /refus/i);
  for (const nom of ['NotAllowedError', 'NotFoundError', 'NotReadableError', 'AbortError', '']) {
    const msg = L.messageErreurCamera(nom);
    assert.ok(msg.length > 0);
    assert.doesNotMatch(msg, /deviceId|MediaStream|UVC|WebRTC|getUserMedia/i, `jargon dans « ${msg} »`);
  }
});

test('caméra occupée par OBS : le message le dit explicitement', () => {
  assert.match(L.messageErreurCamera('NotReadableError'), /OBS|autre application/i);
});

test('libellés : identifiant USB retiré, repli numéroté', () => {
  assert.equal(L.nomCamera('Insta360 Link (2e1a:4c01)', 0), 'Insta360 Link');
  assert.equal(L.nomCamera('OBS Virtual Camera', 1), 'OBS Virtual Camera');
  assert.equal(L.nomCamera('', 2), 'Caméra 3');   // avant permission : libellé vide
});
