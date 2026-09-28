/**
 * 📷 CAMÉRA TOUJOURS VISIBLE DANS LA SCÈNE DU LIVE (28/09) — diagnostic prod mesuré :
 * vraie caméra MacBook, piste 1280×720 lue (readyState 4), MAIS la vignette de la scène
 * était placée en POURCENTAGES (left 70 %, top 70 %, largeur 28 %, 16:9). Sur une scène
 * plus large que 16:9 (plein écran 1272×633) elle débordait de 10 px en bas et passait
 * 31 px SOUS la barre verticale ; en panneau latéral (~303 px) elle faisait 83×46 px.
 * « Caméra active mais je ne me vois pas ».
 *
 * Ce banc verrouille :
 *   1. `placementVignette` (pixels, bornée DANS la scène, hors barre et hors champ) ;
 *   2. `decoupeCoteACote` (paysage 50/50, portrait empilé) ;
 *   3. `apercuEcranLocal` (anti-miroir : l'hôte ne voit pas son propre onglet en abyme) ;
 *   4. la barre média permanente ⏮ ▶ ⏭ supprimée : Play/Pause dans la colonne, ⏮ ⏭ dans ⋮ ;
 *   5. le champ commentaire centré en bas (zoneCommentaires).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { placementVignette, decoupeCoteACote, apercuEcranLocal } from './.build/sceneLive.mjs';
import { zoneCommentaires, ORDRE_COMMANDES, PRIORITE_COMMANDES, repartirCommandes, ESPACE_COLONNE } from './.build/liveControls.mjs';
import { lire, codeSeul } from './lireSource.mjs';

const dansScene = (p, L, H) => p.x >= 0 && p.y >= 0 && p.x + p.largeur <= L + 1e-9 && p.y + p.hauteur <= H + 1e-9;

/* ───────────────────────── 1. placementVignette ───────────────────────── */

test('plein écran 1272×633 + barre 60 px : vignette ENTIÈREMENT dans la scène, hors barre, hors champ', () => {
  const reserveBasPx = 64;
  const p = placementVignette({ largeurScene: 1272, hauteurScene: 633, reserveDroitePx: 60, reserveBasPx });
  assert.ok(dansScene(p, 1272, 633), JSON.stringify(p));
  assert.ok(p.x + p.largeur <= 1272 - 60, `droite ${p.x + p.largeur} > ${1272 - 60} : sous la barre`);
  assert.ok(p.y + p.hauteur <= 633 - reserveBasPx, `bas ${p.y + p.hauteur} > ${633 - reserveBasPx} : sous le champ`);
  assert.ok(Math.abs(p.hauteur - p.largeur * 9 / 16) < 1e-6, '16:9');
  // Coin BAS-DROIT par défaut : collée à la réserve, pas perdue au milieu.
  assert.ok(p.x + p.largeur >= 1272 - 60 - 24 && p.y + p.hauteur >= 633 - reserveBasPx - 24, 'coin bas-droit');
});

test('plus la scène est large, JAMAIS de débordement (21:9, ultra-large)', () => {
  for (const [L, H] of [[1272, 633], [1920, 700], [2560, 720], [1280, 400], [800, 300]]) {
    const p = placementVignette({ largeurScene: L, hauteurScene: H, reserveDroitePx: 60, reserveBasPx: 64 });
    assert.ok(dansScene(p, L, H), `${L}×${H} : ${JSON.stringify(p)}`);
    assert.ok(p.x + p.largeur <= L - 60 && p.y + p.hauteur <= H - 64, `${L}×${H} : réserves respectées`);
  }
});

test('panneau latéral 303×171 : la vignette reste LISIBLE (≥ 120 px de large)', () => {
  const p = placementVignette({ largeurScene: 303, hauteurScene: 171, reserveDroitePx: 0, reserveBasPx: 0 });
  assert.ok(p.largeur >= 120, `largeur ${p.largeur}`);
  assert.ok(dansScene(p, 303, 171), JSON.stringify(p));
});

test('scène portrait 360×640 : dans la scène', () => {
  const p = placementVignette({ largeurScene: 360, hauteurScene: 640, reserveDroitePx: 60, reserveBasPx: 64 });
  assert.ok(dansScene(p, 360, 640), JSON.stringify(p));
  assert.ok(p.largeur >= 120, `largeur ${p.largeur}`);
});

test('taille : 28 % de la scène, bornée [min(140, 45 %) ; 40 %]', () => {
  assert.ok(Math.abs(placementVignette({ largeurScene: 1000, hauteurScene: 800 }).largeur - 280) < 1e-6, '28 %');
  assert.equal(placementVignette({ largeurScene: 400, hauteurScene: 800 }).largeur, 140, 'plancher 140 px');
  assert.ok(Math.abs(placementVignette({ largeurScene: 200, hauteurScene: 800 }).largeur - 90) < 1e-6, 'petite scène : 45 %');
  assert.ok(Math.abs(placementVignette({ largeurScene: 1000, hauteurScene: 800, taille: 0.9 }).largeur - 400) < 1e-6, 'plafond 40 %');
});

test('position glissée : conservée en proportion, re-bornée au redimensionnement', () => {
  const pos = { x: 0.1, y: 0.1 };
  const a = placementVignette({ largeurScene: 1000, hauteurScene: 600, position: pos });
  assert.ok(Math.abs(a.x - 100) < 1e-6 && Math.abs(a.y - 60) < 1e-6, 'dans le cadre : inchangée');
  // Tirée hors cadre / scène rétrécie : re-bornée, jamais dehors.
  for (const [L, H] of [[1000, 600], [400, 300], [303, 171]]) {
    const b = placementVignette({ largeurScene: L, hauteurScene: H, reserveDroitePx: 60, reserveBasPx: 40, position: { x: 0.95, y: 0.95 } });
    assert.ok(dansScene(b, L, H) && b.x + b.largeur <= L - 60 + 1e-9, `${L}×${H} : ${JSON.stringify(b)}`);
  }
  const nan = placementVignette({ largeurScene: 1000, hauteurScene: 600, position: { x: Number.NaN, y: 0.2 } });
  assert.ok(dansScene(nan, 1000, 600), 'NaN → position par défaut');
});

test('scène non mesurée (0 px) : aucune valeur absurde', () => {
  const p = placementVignette({ largeurScene: 0, hauteurScene: 0 });
  for (const v of Object.values(p)) assert.ok(Number.isFinite(v) && v >= 0);
});

/* ───────────────────────── 2. côte à côte ───────────────────────── */

test('côte à côte : 50/50 en paysage, EMPILÉ sur une scène portrait', () => {
  assert.equal(decoupeCoteACote({ largeur: 1272, hauteur: 633 }), 'horizontal');
  assert.equal(decoupeCoteACote({ largeur: 640, hauteur: 640 }), 'horizontal');
  assert.equal(decoupeCoteACote({ largeur: 360, hauteur: 640 }), 'vertical');
  assert.equal(decoupeCoteACote({ largeur: 0, hauteur: 0 }), 'horizontal', 'non mesuré : paysage');
});

/* ───────────────────────── 3. anti-miroir ───────────────────────── */

test('anti-miroir : placeholder seulement pour MON écran ET une surface à risque', () => {
  assert.equal(apercuEcranLocal({ ecranLocal: true, displaySurface: 'browser' }), 'placeholder');
  assert.equal(apercuEcranLocal({ ecranLocal: true, displaySurface: 'monitor' }), 'placeholder');
  assert.equal(apercuEcranLocal({ ecranLocal: true, displaySurface: 'window' }), 'flux', 'une autre fenêtre : pas de miroir');
  assert.equal(apercuEcranLocal({ ecranLocal: true, displaySurface: undefined }), 'flux', 'surface inconnue : aucune hypothèse');
  assert.equal(apercuEcranLocal({ ecranLocal: false, displaySurface: 'monitor' }), 'flux', 'participants : le vrai écran');
});

/* ───────────────────────── 4. barre média → colonne ───────────────────────── */

test('lecture : commande de la colonne, priorité définie, Terminer toujours en tête', () => {
  assert.ok(ORDRE_COMMANDES.includes('lecture') && PRIORITE_COMMANDES.includes('lecture'));
  assert.equal(PRIORITE_COMMANDES[0], 'terminer');
  // Colonne courte : Terminer tient, la lecture peut partir dans ⋮ mais rien ne se perd.
  const cands = ['micro', 'camera', 'partage', 'record', 'prompteur', 'lecture', 'diffusion', 'terminer'];
  const r = repartirCommandes(cands, 300, {}, ESPACE_COLONNE);
  assert.ok(r.barre.includes('terminer'));
  assert.deepEqual([...r.barre, ...r.menu].sort(), [...cands].sort());
});

const PANEL = codeSeul(lire('components', 'session', 'LiveVisioPanel.tsx'));
const LC = codeSeul(lire('components', 'session', 'LiveControls.tsx'));
const PAGE = codeSeul(lire('pages', 'SessionPage.tsx'));

test('plus de grosse barre média permanente dans le panneau', () => {
  assert.ok(!PANEL.includes('audioNode'), 'aucun audioNode rendu');
  assert.ok(!PANEL.includes('data-testid="visio-audio"') && !PANEL.includes('data-testid="visio-fs-audio"'));
  assert.ok(!PAGE.includes('audioNode='), 'la page ne passe plus la barre');
  assert.ok(PAGE.includes('lecture={lectureLive}') && PANEL.includes('lecture={lecture}'), 'la lecture va à la colonne');
});

test('lecture : MÊMES gestionnaires que le lecteur unique, aucun second lecteur', () => {
  const bloc = PAGE.slice(PAGE.indexOf('const lectureLive'), PAGE.indexOf('const liveVisioNode'));
  assert.ok(bloc.includes('onPlayPause: handleMiniPlayPause'));
  assert.ok(bloc.includes('handlePlayerPrevious(audioState?.currentTime ?? 0)'));
  assert.ok(bloc.includes('handlePlayerNext'));
  assert.ok(bloc.includes("miniAudioPrecedent === 'rien'") && bloc.includes('miniAudioSuivante'), 'mêmes règles de précédent / suivant');
  assert.ok(!bloc.includes('<audio') && !bloc.includes('new Audio('));
  assert.equal((PAGE.match(/<AudioPlayer/g) || []).length, 1);
});

test('LiveControls : bouton Lire / Pause (lucide), ⏮ ⏭ dans ⋮', () => {
  assert.ok(LC.includes('data-testid="visio-lecture"'));
  assert.ok(LC.includes("'Mettre en pause'") && LC.includes("'Lire la musique'"));
  assert.ok(/<Pause\b/.test(LC) && /<Play\b/.test(LC));
  assert.ok(LC.includes("if (lecture) candidats.push('lecture')"), 'visible seulement si une musique est chargée');
  assert.ok(LC.includes("testId: 'visio-musique-precedent'") && LC.includes("testId: 'visio-musique-suivant'"));
});

/* ───────────────────────── 5. chat centré ───────────────────────── */

test('champ commentaire : centré en bas, 36 rem max sur ordinateur, pleine largeur sur téléphone', () => {
  const d = zoneCommentaires({ largeur: 1280, camerasActives: 1, pleinEcran: true });
  assert.equal(d.inputAlignement, 'centre');
  assert.equal(d.inputLargeurMax, '36rem');
  assert.equal(zoneCommentaires({ largeur: 390, camerasActives: 1, pleinEcran: true }).inputLargeurMax, '100%');
  const bloc = PANEL.slice(PANEL.indexOf('{inputVisible && ('), PANEL.indexOf('{commentInputNode}'));
  assert.ok(bloc.includes('self-center') && bloc.includes('maxWidth: zone.inputLargeurMax'), 'centré, largeur bornée');
});

/* ───────────────────────── structure de la scène ───────────────────────── */

test('la vignette est placée en PIXELS par placementVignette, re-mesurée au redimensionnement', () => {
  const scene = PANEL.slice(PANEL.indexOf('const deplacerVignette = '), PANEL.indexOf('data-testid="live-visio-panel"'));
  assert.ok(PANEL.includes('placementVignette('));
  assert.ok(!scene.includes('aspectRatio: \'16 / 9\'') && !/left: `\$\{vignette\.x \* 100\}%`/.test(scene), 'plus de pourcentages');
  assert.ok(scene.includes('left: placeVignette.x') && scene.includes('height: placeVignette.hauteur'));
  assert.ok(PANEL.includes('const scene = sceneBoxRef.current;') && PANEL.includes('ro?.observe(scene)'), 'la scène est observée (ResizeObserver)');
});

test('côte à côte et anti-miroir branchés dans la scène', () => {
  assert.ok(PANEL.includes('decoupeCoteACote('));
  assert.ok(PANEL.includes('apercuEcranLocal(') && PANEL.includes('data-testid="scene-ecran-placeholder"'));
  assert.ok(PANEL.includes('Votre écran est partagé'));
  // La caméra n'est JAMAIS masquée par l'anti-miroir : la règle ne vit que dans la branche écran.
  const branche = PANEL.slice(PANEL.indexOf('const contenuDe = '), PANEL.indexOf('const choixDisposition'));
  assert.ok(branche.indexOf('apercuEcranLocal(') < branche.indexOf("c === 'camera'"), 'anti-miroir limité à l écran');
});
