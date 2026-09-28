/**
 * ❤ RÉACTIONS LIVE — agrégation réseau, plafonds, rejeux, et « même référence si rien ne change ».
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  creerTamponReactions, appliquerLot, ajouterLocal, synchroTotal, doitAnnoncerTotal,
  bullesAAfficher, formaterCompteur, parametresBulle, plafonnerComptes, totalDe,
  ETAT_INITIAL, EVT_REACTIONS, EVT_TOTAL, MAX_PAR_LOT,
} from './.build/liveReactions.mjs';
import { lire, codeSeul } from './lireSource.mjs';

const tampon = (opts = {}) => {
  const envois = [];
  const t = creerTamponReactions({ from: 'u1', envoyer: (l) => envois.push(l), ...opts });
  return { t, envois };
};

test('noms d’événements exportés', () => {
  assert.equal(EVT_REACTIONS, 'LIVE_REACTIONS');
  assert.equal(EVT_TOTAL, 'LIVE_REACTIONS_TOTAL');
});

test('20 clics en 1 s → UN seul envoi réseau { like: 20 }', () => {
  const { t, envois } = tampon();
  for (let i = 0; i < 20; i++) t.ajouter('like', i * 50);
  assert.equal(t.vider(1000), null, 'trop tôt : rien ne part');
  assert.equal(envois.length, 0);
  const lot = t.vider(1500);
  assert.equal(envois.length, 1);
  assert.deepEqual(lot.counts, { like: 20 });
  assert.equal(lot.from, 'u1');
  assert.equal(t.vider(1600), null, 'rien en attente : aucun envoi vide');
  assert.equal(envois.length, 1);
});

test('au plus 1 envoi par intervalle, seq croissant', () => {
  const { t, envois } = tampon({ seqInitial: 100 });
  t.ajouter('like', 0); t.vider(1500);
  t.ajouter('feu', 1600);
  assert.equal(t.vider(2000), null, '500 ms après le précédent envoi : on attend');
  assert.equal(t.prochainVidage(), 3100);
  t.vider(3100);
  assert.equal(envois.length, 2);
  assert.deepEqual(envois.map((l) => l.seq), [100, 101]);
  assert.deepEqual(envois[1].counts, { feu: 1 });
});

test('au-delà de maxParEnvoi → tronqué', () => {
  const { t, envois } = tampon({ maxParEnvoi: 30 });
  let acceptes = 0;
  for (let i = 0; i < 50; i++) if (t.ajouter(i % 2 ? 'bravo' : 'like', i)) acceptes++;
  assert.equal(acceptes, 30);
  t.vider(5000);
  assert.equal(totalDe(envois[0].counts), 30);
});

test('vider(forcé) envoie immédiatement (sortie de la page)', () => {
  const { t, envois } = tampon();
  t.ajouter('like', 0);
  assert.ok(t.vider(10, true));
  assert.equal(envois.length, 1);
});

test('type inconnu refusé', () => {
  const { t } = tampon();
  assert.equal(t.ajouter('caca', 0), false);
  assert.equal(t.enAttente(), 0);
});

test('2 émetteurs simultanés → totaux additionnés', () => {
  let e = ETAT_INITIAL;
  e = appliquerLot(e, { from: 'a', seq: 1, counts: { like: 5 } }, 1000);
  e = appliquerLot(e, { from: 'b', seq: 1, counts: { like: 3, feu: 2 } }, 1000);
  assert.deepEqual(e.totaux, { like: 8, bravo: 0, feu: 2 });
});

test('rejeu du même seq (ou plus ancien) ignoré — même référence', () => {
  const e1 = appliquerLot(ETAT_INITIAL, { from: 'a', seq: 7, counts: { like: 5 } }, 0);
  assert.equal(appliquerLot(e1, { from: 'a', seq: 7, counts: { like: 5 } }, 5000), e1);
  assert.equal(appliquerLot(e1, { from: 'a', seq: 6, counts: { like: 5 } }, 5000), e1);
  const e2 = appliquerLot(e1, { from: 'a', seq: 8, counts: { like: 1 } }, 5000);
  assert.equal(e2.totaux.like, 6);
});

test('lot abusif plafonné à 60 par lot et par émetteur', () => {
  const e = appliquerLot(ETAT_INITIAL, { from: 'x', seq: 1, counts: { like: 10_000, feu: 500 } }, 0);
  assert.equal(totalDe(e.totaux), MAX_PAR_LOT);
  assert.equal(MAX_PAR_LOT, 60);
  assert.deepEqual(plafonnerComptes({ like: -3, bravo: 2.7, feu: 'x' }), { like: 0, bravo: 2, feu: 0 });
});

test('rafale d’un même émetteur (< 700 ms) ignorée à la réception', () => {
  const e1 = appliquerLot(ETAT_INITIAL, { from: 'x', seq: 1, counts: { like: 60 } }, 0);
  assert.equal(appliquerLot(e1, { from: 'x', seq: 2, counts: { like: 60 } }, 100), e1);
  assert.equal(appliquerLot(e1, { from: 'x', seq: 2, counts: { like: 60 } }, 1500).totaux.like, 120);
});

test('payload invalide ou lot vide → même référence', () => {
  for (const p of [null, 'x', {}, { from: '', seq: 1, counts: { like: 1 } }, { from: 'a', seq: NaN, counts: { like: 1 } }, { from: 'a', seq: 1, counts: {} }]) {
    assert.equal(appliquerLot(ETAT_INITIAL, p, 0), ETAT_INITIAL);
  }
});

test('ajouterLocal compte ses propres clics', () => {
  assert.equal(ajouterLocal(ETAT_INITIAL, 'bravo').totaux.bravo, 1);
  assert.equal(ajouterLocal(ETAT_INITIAL, 'nope'), ETAT_INITIAL);
});

test('synchroTotal garde le max ; rien de plus grand → même référence', () => {
  const e = appliquerLot(ETAT_INITIAL, { from: 'a', seq: 1, counts: { like: 10, feu: 4 } }, 0);
  const s = synchroTotal(e, { like: 42, bravo: 1, feu: 2 });
  assert.deepEqual(s.totaux, { like: 42, bravo: 1, feu: 4 });
  assert.equal(synchroTotal(s, { like: 5, bravo: 0, feu: 0 }), s);
  assert.equal(synchroTotal(s, null), s);
  assert.equal(synchroTotal(s, { like: 1e12 }), s, 'total absurde ignoré');
});

test('annonce du total par l’hôte : ≤ 1 / 10 s et seulement si changé', () => {
  const t = { like: 3, bravo: 0, feu: 0 };
  assert.equal(doitAnnoncerTotal(null, t, -Infinity, 0), true);
  assert.equal(doitAnnoncerTotal(null, t, 0, 9_999), false);
  assert.equal(doitAnnoncerTotal({ ...t }, t, 0, 20_000), false, 'inchangé');
  assert.equal(doitAnnoncerTotal({ ...t }, { ...t, like: 4 }, 0, 20_000), true);
  assert.equal(doitAnnoncerTotal(null, { like: 0, bravo: 0, feu: 0 }, -Infinity, 0), false, 'rien à annoncer');
});

test('bulles : min(n, 8), 1 seule en reduced-motion, 0 pour rien', () => {
  assert.equal(bullesAAfficher(3, false), 3);
  assert.equal(bullesAAfficher(20, false), 8);
  assert.equal(bullesAAfficher(20, true), 1);
  assert.equal(bullesAAfficher(0, true), 0);
  assert.equal(bullesAAfficher(-5, false), 0);
});

test('paramètres de bulle déterministes et bornés', () => {
  for (let i = 0; i < 200; i++) {
    const p = parametresBulle(i);
    assert.deepEqual(p, parametresBulle(i));
    assert.ok(p.deriveePx >= -20 && p.deriveePx <= 20);
    assert.ok(p.dureeMs >= 1800 && p.dureeMs <= 2200);
  }
});

test('formaterCompteur', () => {
  assert.equal(formaterCompteur(0), '0');
  assert.equal(formaterCompteur(999), '999');
  assert.equal(formaterCompteur(1000), '1 k');
  assert.equal(formaterCompteur(1234), '1,2 k');
  assert.equal(formaterCompteur(999_999), '999,9 k');
  assert.equal(formaterCompteur(2_500_000), '2,5 M');
  assert.equal(formaterCompteur(NaN), '0');
});

test('structure : aucun hex codé en dur, SVG lucide, pas d’écriture en base', () => {
  const comp = codeSeul(lire('components', 'session', 'LiveReactionOverlay.tsx'));
  const hook = codeSeul(lire('hooks', 'useLiveReactions.ts'));
  const lib = codeSeul(lire('lib', 'liveReactions.ts'));
  assert.doesNotMatch(comp, /#[0-9a-fA-F]{3,8}\b/);
  assert.match(comp, /var\(--bt-accent\)/);
  assert.match(comp, /from 'lucide-react'/);
  assert.match(comp, /prefers-reduced-motion: reduce/);
  assert.match(comp, /onAnimationEnd/);
  assert.match(comp, /pointer-events-none absolute/);
  for (const src of [comp, hook, lib]) {
    assert.doesNotMatch(src, /\.from\(['"`]|\.insert\(|\.upsert\(|fetch\(/, 'éphémère : aucune base');
  }
  assert.doesNotMatch(lib, /setTimeout|setInterval|Date\.now/, 'horloge injectée dans la lib');
  assert.match(hook, /MAX_BULLES_SIMULTANEES/);
});

test('QA : le bouton se nomme « J’aime » (lecteur d’écran), pas « J’aimer »', () => {
  const comp = codeSeul(lire('components', 'session', 'LiveReactionOverlay.tsx'));
  assert.ok(!comp.includes("J'aimer"), 'libellé fautif');
  assert.ok(comp.includes("`J'aime (${total})`"));
});

test('QA : mouvement réduit — la bulle unique RESTE visible (fondu 600 ms)', () => {
  // index.css force `animation-duration: 0.01ms !important` sur `*` en mouvement réduit :
  // mesuré en Chrome, la bulle naissait et mourait dans la même image (0 visible).
  const comp = lire('components', 'session', 'LiveReactionOverlay.tsx');
  const bloc = comp.slice(comp.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(bloc, /\.bt-reac-bulle \{[^}]*animation-duration: 600ms !important/);
});
