/**
 * 🖥️ Partage d'écran — capacité honnête, arrêt qui libère la capture, repartage, mobile.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { capacitePartageEcran, arreterPistesPartage, etatApresArret } from './.build/screenShareLogic.mjs';
import { lire, codeSeul } from './lireSource.mjs';

test('capacité : getDisplayMedia présent → supporté ; absent (iOS Safari / Android) → « Indisponible sur cet appareil »', () => {
  assert.deepEqual(capacitePartageEcran({ mediaDevices: { getDisplayMedia: () => {} } }), { supporte: true, motif: null });
  assert.deepEqual(capacitePartageEcran({ mediaDevices: {} }), { supporte: false, motif: 'Indisponible sur cet appareil' });
  assert.equal(capacitePartageEcran(null).supporte, false);
});

test('arrêt : toutes les pistes vivantes sont stoppées une fois, jamais deux ; état = repartage possible', () => {
  const stops = [];
  const piste = (id, ready = 'live') => ({ readyState: ready, stop: () => stops.push(id) });
  const n = arreterPistesPartage([piste('v'), piste('a'), piste('fini', 'ended')]);
  assert.equal(n, 2);
  assert.deepEqual(stops, ['v', 'a']);
  assert.deepEqual(etatApresArret(), { screenOn: false, repartagePossible: true });
});

test('structurel : un seul système — getDisplayMedia + publishScreen existants, arrêt natif ET local libèrent la capture', () => {
  const page = codeSeul(lire('pages', 'SessionPage.tsx'));
  assert.equal((page.match(/getDisplayMedia\(/g) || []).length, 1, 'un seul getDisplayMedia');
  assert.ok(page.includes('videoMesh.startScreen(stream)') && page.includes('videoMesh.stopScreen()'));
  assert.ok(page.includes("addEventListener('ended', onEnded"), 'arrêt natif détecté');
  assert.ok((page.match(/arreterPistesPartage\(/g) || []).length >= 2, 'arrêt local ET natif stoppent les pistes');
  assert.ok(page.includes('capacitePartageEcran('), 'capacité réelle, pas un test d’appareil');
  const lk = codeSeul(lire('hooks', 'useLiveKitStage.ts'));
  assert.ok(lk.includes('Track.Source.ScreenShare'), 'la source écran reste ScreenShare (scène ÉCRAN + COACH la lit)');
});
