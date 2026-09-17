/**
 * 🎬 Phase 2 mini studio — la logique de scènes, prouvée sans navigateur.
 *
 * Ce que ces bancs verrouillent :
 *   - les 7 modèles A → G et leur disponibilité selon les sources RÉELLES ;
 *   - la construction de chaque scène (sources requises, participant choisi, coin du PiP) ;
 *   - les boîtes normalisées 0..1 que Phase 3 peindra (full, split, pip aux 4 coins) ;
 *   - le réducteur Preview / Programme : TAKE ne vide pas la preview, CUT est immédiat,
 *     programme null = flux LiveKit existant, participant / PiP recalculent la preview.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SCENE_TEMPLATES, scenesDisponibles, construireScene, layoutBoxes, studioReducer, STUDIO_INITIAL,
  PIP_TAILLE, PIP_MARGE,
} from './.build/studioScenes.mjs';

const COACH = { kind: 'coach', label: 'Bassi' };
const CAM2 = { kind: 'coach2', id: 'sony', label: 'Sony ZV-E10' };
const SARA = { kind: 'participant', id: 'sara', label: 'Sara' };
const LEO = { kind: 'participant', id: 'leo', label: 'Léo' };
const SCREEN = { kind: 'screen', label: 'Écran partagé' };
const TOUT = [COACH, CAM2, SARA, LEO, SCREEN];

test('A → G : sept modèles, dans l’ordre, avec une icône et des besoins', () => {
  assert.deepEqual(SCENE_TEMPLATES.map((t) => t.type), ['coach_full', 'participant_full', 'split_50', 'pip', 'screen_coach', 'cam1', 'cam2']);
  for (const t of SCENE_TEMPLATES) { assert.ok(t.label); assert.ok(t.icon); assert.ok(t.needs.length >= 1); }
});

test('disponibilité : coach seul → A et F seulement', () => {
  assert.deepEqual(scenesDisponibles([COACH]).map((t) => t.type), ['coach_full', 'cam1']);
});
test('disponibilité : + participant → B, C, D apparaissent ; + écran → E ; + caméra 2 → G', () => {
  assert.deepEqual(scenesDisponibles([COACH, SARA]).map((t) => t.type), ['coach_full', 'participant_full', 'split_50', 'pip', 'cam1']);
  assert.ok(scenesDisponibles([COACH, SCREEN]).some((t) => t.type === 'screen_coach'));
  assert.ok(scenesDisponibles([COACH, CAM2]).some((t) => t.type === 'cam2'));
  assert.equal(scenesDisponibles([]).length, 0);
});

test('construction : chaque modèle donne la bonne paire de sources', () => {
  assert.equal(construireScene('coach_full', TOUT).primarySource.kind, 'coach');
  assert.equal(construireScene('cam1', TOUT).primarySource.kind, 'coach');
  assert.equal(construireScene('cam2', TOUT).primarySource.id, 'sony');
  assert.equal(construireScene('participant_full', TOUT).primarySource.id, 'sara');       // premier participant par défaut
  assert.equal(construireScene('participant_full', TOUT, { participantId: 'leo' }).primarySource.id, 'leo');
  const split = construireScene('split_50', TOUT);
  assert.equal(split.primarySource.kind, 'coach'); assert.equal(split.secondarySource.kind, 'participant'); assert.equal(split.layout.kind, 'split');
  const pip = construireScene('pip', TOUT, { pip: 'tl' });
  assert.equal(pip.primarySource.kind, 'participant'); assert.equal(pip.secondarySource.kind, 'coach'); assert.equal(pip.layout.pip, 'tl');
  const sc = construireScene('screen_coach', TOUT);
  assert.equal(sc.primarySource.kind, 'screen'); assert.equal(sc.secondarySource.kind, 'coach'); assert.equal(sc.layout.pip, 'br');
});
test('construction : source requise absente → null, jamais une scène bancale', () => {
  assert.equal(construireScene('participant_full', [COACH]), null);
  assert.equal(construireScene('screen_coach', [COACH, SARA]), null);
  assert.equal(construireScene('cam2', [COACH]), null);
  assert.equal(construireScene('coach_full', []), null);
});

test('boîtes : full = une boîte 0,0,1,1 ; split = deux moitiés ; z = 0', () => {
  assert.deepEqual(layoutBoxes(construireScene('coach_full', TOUT)).map(({ x, y, w, h, z }) => [x, y, w, h, z]), [[0, 0, 1, 1, 0]]);
  const b = layoutBoxes(construireScene('split_50', TOUT));
  assert.deepEqual(b.map(({ x, y, w, h }) => [x, y, w, h]), [[0, 0, 0.5, 1], [0.5, 0, 0.5, 1]]);
  assert.equal(b[0].source.kind, 'coach'); assert.equal(b[1].source.kind, 'participant');
});
test('boîtes : pip aux 4 coins, marge 0.02, taille 0.28, incrustation au-dessus (z=1), dans le cadre', () => {
  for (const pos of ['tl', 'tr', 'bl', 'br']) {
    const [prin, inc] = layoutBoxes(construireScene('pip', TOUT, { pip: pos }));
    assert.deepEqual([prin.x, prin.y, prin.w, prin.h, prin.z], [0, 0, 1, 1, 0]);
    assert.equal(inc.z, 1); assert.equal(inc.w, PIP_TAILLE); assert.equal(inc.h, PIP_TAILLE);
    const loin = 1 - PIP_TAILLE - PIP_MARGE;
    assert.equal(inc.x, pos.endsWith('l') ? PIP_MARGE : loin);
    assert.equal(inc.y, pos.startsWith('t') ? PIP_MARGE : loin);
    assert.ok(inc.x + inc.w <= 1 && inc.y + inc.h <= 1);
  }
  const [ecran, coach] = layoutBoxes(construireScene('screen_coach', TOUT));
  assert.equal(ecran.source.kind, 'screen'); assert.equal(coach.source.kind, 'coach'); assert.equal(coach.z, 1);
});

test('réducteur : état initial = aucun programme (flux LiveKit existant), PiP en bas à droite', () => {
  assert.equal(STUDIO_INITIAL.program, null); assert.equal(STUDIO_INITIAL.preview, null); assert.equal(STUDIO_INITIAL.pip, 'br');
});
test('réducteur : preview → take copie vers le programme SANS vider la preview', () => {
  const s1 = studioReducer(STUDIO_INITIAL, { type: 'preview', scene: construireScene('split_50', TOUT) });
  assert.equal(s1.program, null);                      // rien n’est encore à l’antenne
  const s2 = studioReducer(s1, { type: 'take' });
  assert.equal(s2.program.type, 'split_50'); assert.equal(s2.preview.type, 'split_50');
});
test('réducteur : take sans preview ne change rien ; cut passe immédiatement, même sans preview', () => {
  assert.equal(studioReducer(STUDIO_INITIAL, { type: 'take' }), STUDIO_INITIAL);
  const s = studioReducer(STUDIO_INITIAL, { type: 'cut', scene: construireScene('coach_full', TOUT) });
  assert.equal(s.program.type, 'coach_full'); assert.equal(s.preview, null);
});
test('réducteur : changer de participant recalcule une preview qui en dépend, pas les autres', () => {
  const s1 = studioReducer(STUDIO_INITIAL, { type: 'preview', scene: construireScene('pip', TOUT) });
  const s2 = studioReducer(s1, { type: 'participant', id: 'leo' });
  assert.equal(s2.selectedParticipant, 'leo'); assert.equal(s2.preview.primarySource.id, 'leo'); assert.ok(s2.preview.id.includes('leo'));
  const c1 = studioReducer(STUDIO_INITIAL, { type: 'preview', scene: construireScene('coach_full', TOUT) });
  assert.equal(studioReducer(c1, { type: 'participant', id: 'leo' }).preview, c1.preview);
});
test('réducteur : changer le coin du PiP met à jour la preview pip, programme intact ; clear_preview vide la preview seule', () => {
  const s1 = studioReducer(studioReducer(STUDIO_INITIAL, { type: 'cut', scene: construireScene('coach_full', TOUT) }), { type: 'preview', scene: construireScene('pip', TOUT) });
  const s2 = studioReducer(s1, { type: 'pip', pos: 'tr' });
  assert.equal(s2.pip, 'tr'); assert.equal(s2.preview.layout.pip, 'tr'); assert.ok(s2.preview.id.endsWith(':tr')); assert.equal(s2.program.type, 'coach_full');
  const s3 = studioReducer(s2, { type: 'clear_preview' });
  assert.equal(s3.preview, null); assert.equal(s3.program.type, 'coach_full');
});

// ── QA Phase 4 : scène de repli quand une source requise disparaît ───────────
test('repli : écran arrêté pendant ÉCRAN+COACH → coach_full ; participant parti → coach_full ; cam2 débranchée → cam1 ; scène valide → null', async () => {
  const { construireScene, sceneDeRepli } = await import('./.build/studioScenes.mjs');
  const coach = { kind: 'coach', label: 'Coach' };
  const part = { kind: 'participant', id: 'p1', label: 'Sara' };
  const ecran = { kind: 'screen', label: 'Écran' };
  const cam2 = { kind: 'coach2', id: 'c2', label: 'Sony' };
  const tout = [coach, cam2, part, ecran];
  const sc = construireScene('screen_coach', tout, {}); assert.ok(sc);
  assert.equal(sceneDeRepli(sc, tout), null, 'scène encore valide → rien');
  const r1 = sceneDeRepli(sc, [coach, cam2, part]); assert.equal(r1 && r1.type, 'coach_full', 'écran parti → coach plein écran');
  const sp = construireScene('split_50', tout, { participantId: 'p1' });
  const r2 = sceneDeRepli(sp, [coach, ecran]); assert.equal(r2 && r2.type, 'coach_full', 'participant parti → coach');
  const pp = construireScene('participant_full', tout, { participantId: 'p1' });
  const r3 = sceneDeRepli(pp, [coach]); assert.equal(r3 && r3.type, 'coach_full');
  const c2 = construireScene('cam2', tout, { cam2Id: 'c2' });
  const r4 = sceneDeRepli(c2, [coach, part]); assert.equal(r4 && r4.type, 'cam1', 'cam2 débranchée → caméra 1');
  const r5 = sceneDeRepli(construireScene('coach_full', tout, {}), []); assert.equal(r5, null, 'plus aucune source → aucun repli possible (le programme s’arrête proprement ailleurs)');
  // le participant sélectionné change d'identité : l'ancienne scène n'est plus valide → repli
  const r6 = sceneDeRepli(sp, [coach, { kind: 'participant', id: 'p2', label: 'Léa' }]); assert.equal(r6 && r6.type, 'coach_full');
});
