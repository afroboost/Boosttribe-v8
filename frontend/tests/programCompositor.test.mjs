/**
 * 🎬 Phase 3 — compositeur du programme : partie PURE + banc structurel.
 *  - boîtes → rectangles de dessin « cover » (±1 px), ordre z ;
 *  - garde de performance (dégrader puis abandonner) ;
 *  - structurel : aucun prompteur/chat/timer/overlay ne peut être peint ; program null = inactif.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { calculerRectangles, verdictPerformance, RESOLUTION_720P, RESOLUTION_540P, RESOLUTION_1080P, choisirResolution } from './.build/programCompositor.mjs';
import { construireScene, layoutBoxes } from './.build/studioScenes.mjs';
import { lire, codeSeul } from './lireSource.mjs';

const COACH = { kind: 'coach', label: 'Coach' };
const SARA = { kind: 'participant', id: 'sara', label: 'Sara' };
const SCREEN = { kind: 'screen', label: 'Écran partagé' };
const dims16x9 = () => ({ largeur: 1920, hauteur: 1080 });
const dims9x16 = () => ({ largeur: 1080, hauteur: 1920 });

test('coach plein écran 16:9 → une boîte pleine, sans découpe', () => {
  const scene = construireScene('coach_full', [COACH]);
  const r = calculerRectangles(layoutBoxes(scene), RESOLUTION_720P, dims16x9);
  assert.equal(r.length, 1);
  assert.deepEqual([r[0].dx, r[0].dy, r[0].dw, r[0].dh], [0, 0, 1280, 720]);
  assert.deepEqual([r[0].sx, r[0].sy, r[0].sw, r[0].sh], [0, 0, 1920, 1080]);
});

test('source verticale (téléphone) dans une boîte 16:9 → découpe « cover » centrée', () => {
  const scene = construireScene('coach_full', [COACH]);
  const r = calculerRectangles(layoutBoxes(scene), RESOLUTION_720P, dims9x16)[0];
  // ratio boîte 16/9 : on garde toute la largeur source (1080) et sh = 1080 / (16/9) ≈ 608
  assert.equal(r.sw, 1080);
  assert.ok(Math.abs(r.sh - 608) <= 1);
  assert.ok(Math.abs(r.sy - (1920 - 608) / 2) <= 1);
});

test('50/50 : deux moitiés exactes ; pip : incrustation 0.28 au coin, z croissant', () => {
  const split = construireScene('split_50', [COACH, SARA]);
  const rs = calculerRectangles(layoutBoxes(split), RESOLUTION_720P, dims16x9);
  assert.deepEqual(rs.map((x) => [x.dx, x.dw]), [[0, 640], [640, 640]]);
  const pip = construireScene('pip', [COACH, SARA], { pip: 'tl' });
  const rp = calculerRectangles(layoutBoxes(pip), RESOLUTION_1080P, dims16x9);
  assert.equal(rp.length, 2);
  assert.ok(rp[0].z < rp[1].z);
  assert.ok(Math.abs(rp[1].dw - 0.28 * 1920) <= 1 && Math.abs(rp[1].dx - 0.02 * 1920) <= 1 && Math.abs(rp[1].dy - 0.02 * 1080) <= 1);
});

test('écran + coach : écran principal, coach incrusté en bas à droite', () => {
  const s = construireScene('screen_coach', [COACH, SCREEN]);
  const r = calculerRectangles(layoutBoxes(s), RESOLUTION_720P, dims16x9);
  assert.equal(r[0].source.kind, 'screen');
  assert.equal(r[1].source.kind, 'coach');
  assert.ok(r[1].dx + r[1].dw <= 1280 && r[1].dy + r[1].dh <= 720);
});

test('une source sans dimensions (vidéo pas prête) est simplement ignorée, pas une exception', () => {
  const s = construireScene('split_50', [COACH, SARA]);
  const r = calculerRectangles(layoutBoxes(s), RESOLUTION_720P, (src) => (src.kind === 'coach' ? dims16x9() : null));
  assert.equal(r.length, 1);
});

test('garde perf : 3 s sous 15 i/s → dégrader (540p) ; sous 12 i/s à 540p → abandonner ; sinon ok', () => {
  assert.equal(verdictPerformance(10, 1000, RESOLUTION_720P), 'ok');
  assert.equal(verdictPerformance(10, 3000, RESOLUTION_720P), 'degrader');
  assert.equal(verdictPerformance(13, 3000, RESOLUTION_540P), 'ok');
  assert.equal(verdictPerformance(9, 3000, RESOLUTION_540P), 'abandonner');
  assert.equal(choisirResolution('1080p'), RESOLUTION_1080P);
  assert.equal(choisirResolution('720p'), RESOLUTION_720P);
});

test('structurel : le compositeur ne connaît ni prompteur, ni chat, ni timer, ni overlay', () => {
  const src = codeSeul(lire('lib', 'programCompositor.ts')).toLowerCase();
  for (const interdit of ['prompteur', 'chatpanel', 'timer', 'overlay', 'interval', 'document.body', 'queryselector']) {
    assert.ok(!src.includes(interdit), `« ${interdit} » ne doit pas apparaître dans le compositeur`);
  }
  assert.ok(src.includes('capturestream('), 'la piste programme vient de canvas.captureStream');
  assert.ok(!src.includes('getusermedia'), 'aucun flux caméra créé ici');
});

test('structurel : programme null → aucun compositing (le hook arrête tout)', () => {
  const hook = codeSeul(lire('hooks', 'useProgramStream.ts'));
  assert.ok(hook.includes('arreter'), 'le hook expose arreter()');
  const page = codeSeul(lire('pages', 'SessionPage.tsx'));
  assert.ok(page.includes('programmeALAntenne') && page.includes('programme.arreter()'), 'sans scène à l’antenne, SessionPage arrête le programme');
});
