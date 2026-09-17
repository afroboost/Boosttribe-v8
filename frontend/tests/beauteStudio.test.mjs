/**
 * ✨ Embellir le visage — bancs STRUCTURELS (lecture des sources).
 *
 * Ce qui ne s'isole pas dans `node --test` (LiveKit, WebGL, captureStream) se LIT dans le code :
 *  - le traitement passe par le processeur de piste LiveKit (piste PUBLIÉE traitée, pas seulement l'aperçu) ;
 *  - la bascule de caméra survit : le processeur implémente `restart` et garde la même piste de sortie ;
 *  - désactivation = `stopProcessor` (piste brute republiée), jamais une nouvelle publication ;
 *  - désactivé par défaut, réglage `bt_beaute` ; garde de performance branchée ; aucune dépendance ML ;
 *  - le contrôle ne se rend pas sans support et ne montre aucun jargon ;
 *  - barre / panneau du live NON touchés par ce lot (l'agent UI place le contrôle).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { lire, codeSeul } from './lireSource.mjs';

const HOOK = codeSeul(lire('hooks', 'useBeauteVisage.ts'));
const HOOK_LK = codeSeul(lire('hooks', 'useLiveKitStage.ts'));
const PROC = codeSeul(lire('lib', 'beaute', 'BeauteProcessor.ts'));
const RENDU = codeSeul(lire('lib', 'beaute', 'rendu.ts'));
const TOGGLE = lire('components', 'session', 'BeauteToggle.tsx');
const PKG = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));

test('la piste PUBLIÉE est traitée : processeur LiveKit posé/retiré sur la piste caméra', () => {
  assert.ok(HOOK.includes('setProcessor('), 'setProcessor sur la LocalVideoTrack');
  assert.ok(HOOK.includes('stopProcessor()'), 'désactivation = stopProcessor (piste brute republiée)');
  assert.ok(!HOOK.includes('publishTrack('), 'aucune republication manuelle : LiveKit gère le remplacement');
  assert.ok(HOOK_LK.includes('getCameraTrack'), 'le hook LiveKit expose la piste caméra');
  assert.ok(HOOK_LK.includes('TrackProcessorUpdate'), "l'aperçu local suit la piste traitée/brute");
});

test('le processeur implémente le contrat LiveKit et survit à la bascule de caméra', () => {
  for (const m of ['async init(', 'async restart(', 'async destroy(']) assert.ok(PROC.includes(m), m);
  assert.ok(PROC.includes('processedTrack'), 'processedTrack exposée');
  // restart ne recrée PAS la piste de sortie : le canvas et sa capture restent les mêmes.
  const restart = PROC.slice(PROC.indexOf('async restart('), PROC.indexOf('async destroy('));
  assert.ok(!restart.includes('captureStream'), 'restart : même canvas, même piste publiée');
  assert.ok(PROC.includes('captureStream'), 'sortie = canvas.captureStream()');
});

test('garde de performance et plafond de résolution branchés dans le processeur', () => {
  assert.ok(PROC.includes('GardePerformance'), 'garde importée de la logique pure');
  assert.ok(PROC.includes('onCoupure'), 'coupure remontée au hook');
  assert.ok(PROC.includes('resolutionTraitement'), 'résolution plafonnée (mobile)');
  assert.ok(HOOK.includes("setAvis('perf')"), 'le hook prévient et remet off');
});

test('désactivé par défaut, réglage persistant, aucune dépendance ML', () => {
  assert.ok(HOOK.includes('lireNiveauBeaute(localStorage)'), 'lecture du réglage (absent = off)');
  assert.ok(HOOK.includes('ecrireNiveauBeaute'), 'écriture du réglage');
  const deps = { ...(PKG.dependencies || {}), ...(PKG.devDependencies || {}) };
  for (const d of Object.keys(deps)) assert.ok(!/mediapipe|tensorflow|@tensorflow|onnx/i.test(d), `dépendance ML interdite : ${d}`);
  assert.ok(RENDU.includes('masquePeau'), 'lissage limité aux tons peau');
  assert.ok(!RENDU.includes('import') || !/from '(?!@\/lib\/beauteLogic)/.test(RENDU.replace(/import type[^\n]*\n/g, '')), 'rendu sans dépendance externe');
});

test('le contrôle : pas de rendu sans support, trois choix, aucun jargon', () => {
  assert.ok(TOGGLE.includes('if (!beaute.supporte) return null;'));
  assert.ok(TOGGLE.includes('data-testid={`beaute-${n}`}'), 'un bouton par niveau');
  assert.ok(TOGGLE.includes("['off', 'leger', 'moyen']"), 'les trois choix, dans cet ordre');
  for (const mot of ['WebGL', 'shader', 'captureStream', 'processor', 'bilat']) assert.ok(!TOGGLE.includes(mot), `jargon : ${mot}`);
  assert.ok(TOGGLE.includes('var(--bt-accent)'), 'accent du projet');
  assert.ok(!/[\u{1F300}-\u{1FAFF}]/u.test(TOGGLE), 'aucun emoji dans le rendu');
});

test('barre et panneau du live intacts (le placement du contrôle revient au lot UI)', () => {
  const BAR = lire('components', 'session', 'VisioControlBar.tsx');
  const PANEL = lire('components', 'session', 'LiveVisioPanel.tsx');
  assert.ok(!BAR.includes('BeauteToggle') && !PANEL.includes('BeauteToggle'));
});
