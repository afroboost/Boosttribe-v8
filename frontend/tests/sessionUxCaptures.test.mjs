/**
 * Branchements de la page pour la mission UX « captures » (28/09) :
 * la palette propose les 6 réactions, et « Enregistrer dès le démarrage » démarre
 * UNE fois, quand la caméra de l'hôte est réellement diffusée.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { lire, codeSeul } from './lireSource.mjs';

const PAGE = codeSeul(lire('pages', 'SessionPage.tsx'));

test('le bouton de réaction reçoit les 6 types de la palette', () => {
  assert.match(PAGE, /<LiveReactionButton[^>]*types=\{\['like', 'bravo', 'feu', 'pouce', 'main', 'rire'\]\}/);
});

test('enregistrement auto : doitDemarrerAuto, front montant unique, caméra diffusée', () => {
  assert.match(PAGE, /doitDemarrerAuto\(\{ auto: recAuto, evenement: 'live_demarre', estHote: isHost/);
  assert.match(PAGE, /if \(recAutoFaitRef\.current \|\| !cameraDiffusee\) return;/);
  assert.match(PAGE, /recAutoFaitRef\.current = true;[\s\S]{0,80}recorder\.demarrer\(\)/);
  // dépendances primitives : jamais l'objet recorder (règle anti-boucle)
  assert.match(PAGE, /\}, \[cameraDiffusee, recAuto, recEtat, recSupporte, isHost\]\);/);
});
