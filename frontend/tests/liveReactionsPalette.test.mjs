/**
 * ❤ PALETTE DE RÉACTIONS — 6 types (ajout EN FIN, protocole additif) + clic simple = palette.
 *
 * - Les 3 types historiques gardent leur place : la priorité du plafond (like → bravo → feu)
 *   est inchangée, les nouveaux (pouce, main, rire) passent après.
 * - Aucun double comptage : 20 clics répartis sur les 6 types = exactement 20 partout,
 *   y compris avec l'annonce du total par l'hôte (totauxAnnoncables).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from './.build/liveReactions.mjs';
const {
  TYPES_REACTION, ETAT_INITIAL, MAX_PAR_LOT,
  creerTamponReactions, appliquerLot, ajouterLocal, synchroTotal, totauxAnnoncables, plafonnerComptes, totalDe,
} = L;
// Accès paresseux : un export absent fait rougir SON test, pas tout le fichier.
const actionClicReaction = (...a) => L.actionClicReaction(...a);
import { lire, codeSeul } from './lireSource.mjs';

const SIX = ['like', 'bravo', 'feu', 'pouce', 'main', 'rire'];

test('protocole additif : 6 types, les 3 historiques en tête, dans le même ordre', () => {
  assert.deepEqual([...TYPES_REACTION], SIX);
});

test('état initial : les 6 types à 0', () => {
  assert.deepEqual(ETAT_INITIAL.totaux, { like: 0, bravo: 0, feu: 0, pouce: 0, main: 0, rire: 0 });
});

test('plafond : priorité inchangée, les nouveaux types passent après', () => {
  const c = plafonnerComptes({ rire: 50, like: 40, pouce: 5 });
  assert.equal(totalDe(c), MAX_PAR_LOT);
  assert.equal(c.like, 40, 'like servi en premier');
  assert.equal(c.pouce, 5);
  assert.equal(c.rire, 15, 'rire prend le reste');
  assert.deepEqual(Object.keys(c), SIX);
});

test('20 clics répartis sur 6 types = somme exacte chez l’émetteur (hôte) ET le récepteur', () => {
  const envois = [];
  const t = creerTamponReactions({ from: 'A', envoyer: (l) => envois.push(l), seqInitial: 100 });
  let a = ETAT_INITIAL;
  let b = ETAT_INITIAL;
  const attendu = { like: 0, bravo: 0, feu: 0, pouce: 0, main: 0, rire: 0 };
  for (let i = 0; i < 20; i++) {
    const type = SIX[i % 6];
    assert.ok(t.ajouter(type, i * 50));
    a = ajouterLocal(a, type);
    attendu[type] += 1;
    // Annonce de l'hôte PENDANT la rafale (clics en tampon) : le récepteur s'aligne dessus.
    if (i === 11) b = synchroTotal(b, totauxAnnoncables(a.totaux, t.comptesEnAttente()));
  }
  assert.ok(t.vider(1500));
  assert.equal(envois.length, 1);
  b = appliquerLot(b, envois[0], 1500);
  // Annonce après vidage : plus rien en tampon, total complet.
  b = synchroTotal(b, totauxAnnoncables(a.totaux, t.comptesEnAttente()));
  assert.deepEqual(a.totaux, attendu);
  assert.deepEqual(b.totaux, attendu, 'aucun double comptage');
  assert.equal(totalDe(a.totaux), 20);
  assert.equal(totalDe(b.totaux), 20);
});

test('un récepteur qui reçoit un lot avec seulement « rire » l’additionne', () => {
  const e = appliquerLot(ETAT_INITIAL, { from: 'z', seq: 1, counts: { rire: 3 } }, 0);
  assert.equal(e.totaux.rire, 3);
  assert.equal(totalDe(e.totaux), 3);
  const e2 = appliquerLot(e, { from: 'z', seq: 2, counts: { rire: 2, main: 1 } }, 1000);
  assert.equal(e2.totaux.rire, 5);
  assert.equal(e2.totaux.main, 1);
});

test('actionClicReaction : fermé → ouvre sans envoyer ; ouvert sans choix → ferme ; choix → envoie + ferme', () => {
  assert.deepEqual(actionClicReaction(false), { ouvrir: true });
  assert.deepEqual(actionClicReaction(true), { ouvrir: false });
  assert.deepEqual(actionClicReaction(true, 'rire'), { envoyer: 'rire', ouvrir: false });
  assert.deepEqual(actionClicReaction(false, 'pouce'), { envoyer: 'pouce', ouvrir: false });
  assert.deepEqual(actionClicReaction(true, 'caca'), { ouvrir: false }, 'type inconnu : rien ne part');
});

test('structure : lib et hook ne listent plus les types en dur', () => {
  const lib = codeSeul(lire('lib', 'liveReactions.ts'));
  const hook = codeSeul(lire('hooks', 'useLiveReactions.ts'));
  assert.doesNotMatch(lib, /etat\.totaux\.like\s*\+/, 'appliquerLot : boucle sur TYPES_REACTION');
  assert.doesNotMatch(lib, /\{\s*like:\s*0,\s*bravo:\s*0,\s*feu:\s*0\s*\}/, 'littéral à 3 types');
  assert.doesNotMatch(hook, /\['like',\s*'bravo',\s*'feu'\]/);
  assert.match(hook, /TYPES_REACTION/);
});

test('structure : clic simple = palette (plus d’appui long), 6 icônes lucide, accessibilité', () => {
  const comp = codeSeul(lire('components', 'session', 'LiveReactionOverlay.tsx'));
  assert.doesNotMatch(comp, /APPUI_LONG|setTimeout|onPointerDown/, 'minuterie d’appui long retirée');
  assert.match(comp, /actionClicReaction\(/);
  for (const icone of ['Heart', 'Sparkles', 'Flame', 'ThumbsUp', 'Hand', 'Laugh']) {
    assert.match(comp, new RegExp(`\\b${icone}\\b`), `icône ${icone}`);
  }
  assert.match(comp, /aria-expanded=\{/);
  assert.match(comp, /'Escape'/);
  assert.match(comp, /pointerdown/, 'clic hors palette');
  assert.match(comp, /grid-cols-3/, '3 × 2 : tient dans 360 px');
  assert.match(comp, /min-h-\[44px\] min-w-\[44px\]/);
  // Aucun emoji dans l'UI (pictogrammes « Extended_Pictographic »).
  assert.doesNotMatch(comp, /\p{Extended_Pictographic}/u);
  for (const t of SIX) assert.match(comp, new RegExp(`\\b${t}:`), `libellé / icône pour ${t}`);
});

// Terrain 28/09 (prod, desktop) : la palette est en `absolute` dans le bouton de 44 px ;
// sans largeur propre, sa grille 3×2 était comprimée à 44 px et ses icônes débordaient
// sur la barre verticale. Elle doit prendre sa largeur de contenu et s'ouvrir vers la GAUCHE.
test('palette : largeur de contenu (w-max), ancrée à droite, ouverte vers la gauche', () => {
  const src = lire('components', 'session', 'LiveReactionOverlay.tsx');
  assert.match(src, /absolute bottom-full right-0[^"]*\bw-max\b[^"]*grid grid-cols-3/);
});
