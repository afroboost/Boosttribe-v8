/**
 * 🎬 LA SCÈNE DU LIVE — film et écran partagé DANS la grande scène.
 *
 * Ce que ces bancs verrouillent :
 *   - l'arbitre pur `contenuScenePrincipale` : un film actif passe en grand, la tuile
 *     « Caméra coupée » ne le masque plus jamais ; un écran partagé devient une source ;
 *   - la priorité si film ET écran sont actifs (le FILM reste en grand, l'écran en vignette) ;
 *   - les dispositions proposées selon qu'une caméra existe ou non ;
 *   - `bornerVignette` : une vignette glissée ne sort jamais du cadre ;
 *   - studioScenes : `screen_full` existe et sert de repli à `screen_coach` sans caméra ;
 *   - la structure : plus de bloc « Votre partage d'écran » séparé, UN SEUL lecteur de film.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  contenuScenePrincipale, dispositionsPartage, bornerVignette, VIGNETTE_DEFAUT,
} from './.build/sceneLive.mjs';
import { construireScene, sceneDeRepli, layoutBoxes, PIP_TAILLE, PIP_MARGE } from './.build/studioScenes.mjs';
import { lire, codeSeul } from './lireSource.mjs';

const COACH = { kind: 'coach', label: 'Bassi' };
const SCREEN = { kind: 'screen', label: 'Écran partagé' };

/* ───────────────────────── A. le film ───────────────────────── */

test('caméra coupée + film actif → le FILM est en grand', () => {
  const a = contenuScenePrincipale({ cameraActive: false, filmActif: true, partageActif: false });
  assert.equal(a.principal, 'film');
  assert.ok(!a.vignettes.includes('film'));
});

test('caméra active + film → film en grand, caméra en vignette', () => {
  const a = contenuScenePrincipale({ cameraActive: true, filmActif: true, partageActif: false });
  assert.equal(a.principal, 'film');
  assert.ok(a.vignettes.includes('camera'));
});

test('rien de partagé → la caméra (comportement historique)', () => {
  const a = contenuScenePrincipale({ cameraActive: true, filmActif: false, partageActif: false });
  assert.equal(a.principal, 'camera');
  assert.deepEqual(a.vignettes, []);
  assert.equal(contenuScenePrincipale({ cameraActive: false, filmActif: false, partageActif: false }).principal, 'camera');
});

/* ───────────────────────── B. l'écran partagé ───────────────────────── */

test('partage + caméra coupée → l ÉCRAN en grand, quelle que soit la disposition demandée', () => {
  for (const disposition of ['screen_full', 'screen_coach', 'coach_screen', 'screen_split', undefined]) {
    const a = contenuScenePrincipale({ cameraActive: false, filmActif: false, partageActif: true, disposition });
    assert.equal(a.principal, 'ecran', String(disposition));
    assert.equal(a.disposition, 'screen_full');
    assert.equal(a.incrustation, null);
  }
});

test('les quatre dispositions avec caméra', () => {
  const d = (disposition) => contenuScenePrincipale({ cameraActive: true, filmActif: false, partageActif: true, disposition });
  assert.deepEqual([d('screen_full').principal, d('screen_full').incrustation], ['ecran', null]);
  assert.deepEqual([d('screen_coach').principal, d('screen_coach').incrustation], ['ecran', 'camera']);
  assert.deepEqual([d('coach_screen').principal, d('coach_screen').incrustation], ['camera', 'ecran']);
  assert.deepEqual([d('screen_split').principal, d('screen_split').cote], ['ecran', 'camera']);
  assert.equal(d(undefined).disposition, 'screen_coach', 'par défaut : écran en grand, caméra en vignette');
});

test('film ET écran : le film reste en grand, l écran passe en vignette (priorité figée)', () => {
  const a = contenuScenePrincipale({ cameraActive: true, filmActif: true, partageActif: true, disposition: 'screen_full' });
  assert.equal(a.principal, 'film');
  assert.equal(a.incrustation, 'ecran');
  assert.ok(a.vignettes.includes('ecran') && a.vignettes.includes('camera'));
});

test('dispositionsPartage : sans caméra, écran seul uniquement', () => {
  const sans = dispositionsPartage({ camera: false });
  assert.ok(sans.includes('screen_full'));
  assert.ok(!sans.includes('screen_coach'));
  assert.deepEqual(dispositionsPartage({ camera: true }), ['screen_full', 'screen_coach', 'coach_screen', 'screen_split']);
});

test('bornerVignette : la vignette reste dans le cadre (marge comprise)', () => {
  const b = bornerVignette({ x: 1.2, y: -0.3 });
  assert.equal(b.x, 1 - PIP_TAILLE - PIP_MARGE);
  assert.equal(b.y, PIP_MARGE);
  assert.deepEqual(bornerVignette({ x: 0.4, y: 0.3 }), { x: 0.4, y: 0.3 }, 'dans le cadre : inchangée');
  assert.equal(bornerVignette({ x: Number.NaN, y: 0.5 }).x, VIGNETTE_DEFAUT.x, 'NaN → position par défaut');
  // Une réserve à droite (barre verticale) recule la borne.
  assert.equal(bornerVignette({ x: 1, y: 0.5 }, { reserveDroite: 0.1 }).x, 1 - PIP_TAILLE - PIP_MARGE - 0.1);
});

/* ───────────────────────── studioScenes ───────────────────────── */

test('studio : screen_full existe (écran seul) et remplace screen_coach quand la caméra disparaît', () => {
  const s = construireScene('screen_full', [SCREEN]);
  assert.ok(s);
  assert.deepEqual(layoutBoxes(s).map((b) => [b.source.kind, b.w, b.h]), [['screen', 1, 1]]);
  const sc = construireScene('screen_coach', [SCREEN, COACH]);
  assert.equal(sceneDeRepli(sc, [SCREEN])?.type, 'screen_full');
  assert.equal(sceneDeRepli(sc, [COACH])?.type, 'coach_full', 'écran arrêté → caméra seule');
});

/* ───────────────────────── structure ───────────────────────── */

const PAGE = codeSeul(lire('pages', 'SessionPage.tsx'));
const PANEL = codeSeul(lire('components', 'session', 'LiveVisioPanel.tsx'));

test('SessionPage : plus de bloc « Votre partage d écran » séparé', () => {
  assert.ok(!PAGE.includes('<ScreenShareView'), 'l écran vit dans la scène du Live');
});

test('SessionPage : UN SEUL lecteur de film, rendu dans la scène', () => {
  assert.equal((PAGE.match(/<SharedMediaPlayer\b/g) || []).length, 1, 'une seule occurrence');
  assert.ok(/const sharedMediaNode = [\s\S]{0,120}<SharedMediaPlayer/.test(PAGE), 'un nœud unique');
  assert.ok(PAGE.includes('rendreFilm={() => sharedMediaNode}'), 'passé à la scène du Live');
  // Hors Live (écoute seule), le MÊME nœud reste à sa place — jamais les deux à la fois.
  assert.ok(PAGE.includes('{!filmDansLaScene && sharedMediaNode && ('), 'hors scène seulement si le Live est fermé');
});

test('LiveVisioPanel : film et écran rendus DANS la zone caméra, arbitrés par sceneLive', () => {
  assert.ok(PANEL.includes("from '@/lib/sceneLive'"));
  assert.ok(PANEL.includes('contenuScenePrincipale('));
  const zone = PANEL.slice(PANEL.indexOf('ref={camAreaRef}'), PANEL.indexOf('data-testid="visio-audio"'));
  assert.ok(zone.includes('{modeContenu && sceneContenu}'), 'la scène de contenu est DANS la cible du plein écran');
  const scene = PANEL.slice(PANEL.indexOf('const deplacerVignette = '), PANEL.indexOf('data-testid="live-visio-panel"'));
  assert.ok(scene.includes('data-testid="scene-film"') && scene.includes('{rendreFilm?.()}'), 'le film est dans la scène');
  assert.ok(scene.includes('data-testid="scene-ecran"'), 'l écran aussi');
  assert.ok(scene.includes('data-testid="scene-dispositions"'), 'contrôle de disposition dans la scène');
  assert.ok(scene.includes('bornerVignette('), 'vignette glissée bornée par la fonction pure');
  assert.ok(!/#[0-9a-fA-F]{6}\b/.test(scene), 'aucune couleur codée en dur');
  assert.ok(scene.includes('w-10 h-10'), 'cibles de 40 px');
  // Le lecteur ne change pas de parent entre vue normale et plein écran (pas de remontage).
  assert.ok(PANEL.indexOf('{modeContenu && sceneContenu}') < PANEL.indexOf('{camFullscreen ? ('),
    'la scène de contenu est une place stable, avant la bascule plein écran');
});

test('participants : pas de double écran quand la scène studio le montre déjà', () => {
  assert.ok(PAGE.includes('dansProgramme'), 'SCREEN_SHARE_STATE dit si l écran est déjà dans le Programme');
  assert.ok(PAGE.includes('ecranDansProgrammeDistant'), 'le participant ne l affiche alors pas une seconde fois');
});
