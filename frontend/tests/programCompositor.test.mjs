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

// ── ARRIÈRE-PLAN (21/09) : onglet masqué → cadence Worker 1 i/s, garde suspendue, sursis au retour ──
// PREUVE RÉELLE (non automatisable : Playwright maintient tout onglet « visible » par émulation CDP, même
// fenêtre minimisée) — protocole rejoué dans le Chrome de l'utilisateur, harnais tests/.harnais/qa-rec.html :
//   1. `yarn dev --port 5181`, ouvrir le harnais, Démarrer l'enregistrement (visible, 30 i/s) ;
//   2. rendre un AUTRE onglet de la même fenêtre actif (AppleScript Chrome `set active tab index`) → hidden ;
//   3. relever toutes les 5-10 s (DevTools/extension) : visibilityState, recorder.state, pistes, stats ;
//   4. revenir, attendre 1 s, Arrêter, analyser le fichier (`ffprobe -show_entries frame=pts_time`).
// Mesuré AVANT : 0 image pendant 92 s masqué (boucle suspendue sur un rAF gelé), garde « abandonner » en prod.
// Mesuré APRÈS : 1 image/s masqué, horodatages distincts, audio continu, 30 i/s dès le retour, QuickTime OK
// y compris pour un enregistrement DÉMARRÉ onglet masqué (à 15 dessins/s, QuickTime le refusait : doublons).
import { gardePeutJuger, pasDessinMs, FPS_ARRIERE_PLAN, SURSIS_RETOUR_MS, FPS_PROGRAMME } from './.build/programCompositor.mjs';

test('arrière-plan : la garde ne juge jamais onglet masqué, et attend le sursis au retour', () => {
  assert.equal(gardePeutJuger(true, 0, 10_000), false, 'masqué → jamais');
  assert.equal(gardePeutJuger(false, 5_000, 4_999), false, 'retour : sursis pas écoulé');
  assert.equal(gardePeutJuger(false, 5_000, 5_000), true, 'retour : sursis écoulé');
  assert.equal(gardePeutJuger(false, 0, 1), true, 'visible sans retour → juge');
  assert.equal(SURSIS_RETOUR_MS, 1000);
});

test('arrière-plan : pas de dessin = 1 i/s masqué (seule cadence que Chrome horodate), fps demandés visible', () => {
  assert.equal(FPS_ARRIERE_PLAN, 1);
  assert.equal(Math.round(pasDessinMs(true, FPS_PROGRAMME)), 1000);
  assert.equal(Math.round(pasDessinMs(false, FPS_PROGRAMME)), 33);
  assert.equal(pasDessinMs(false, 60), 1000 / 60);
});

test('arrière-plan (structure) : visibilitychange écouté, cadence Worker, rAF jamais armé masqué, garde court-circuitée', () => {
  const src = codeSeul(lire('lib', 'programCompositor.ts'));
  assert.match(src, /addEventListener\('visibilitychange', this\.onVisibilite\)/, 'le compositeur écoute la visibilité');
  assert.match(src, /removeEventListener\('visibilitychange', this\.onVisibilite\)/, '… et cesse à l’arrêt');
  assert.match(src, /new Worker\(URL\.createObjectURL\(new Blob\(/, 'cadence arrière-plan = Worker (non bridé)');
  assert.match(src, /if \(!this\.actif \|\| this\.arrierePlan\) return;\s*this\.tick\(\);/, 'la boucle rAF ne tourne pas en arrière-plan');
  assert.match(src, /if \(!gardePeutJuger\(this\.arrierePlan, this\.gardeReprendA, maintenant\)\)/, 'la garde passe par gardePeutJuger');
  assert.match(src, /this\.gardeReprendA = performance\.now\(\) \+ SURSIS_RETOUR_MS/, 'sursis armé au retour visible');
  assert.match(src, /this\.basculerCadence\(\); \/\/ démarre la boucle selon la visibilité ACTUELLE/, 'un démarrage onglet masqué part directement en cadence Worker');
  assert.doesNotMatch(src, /this\.minuteur = setTimeout\(this\.boucle, pas\)/, 'l’ancien repli setTimeout depuis la boucle (jamais atteint, rAF gelé) a disparu');
  assert.match(src, /arrierePlan: this\.arrierePlan/, 'les stats disent la réalité (arrierePlan)');
});
