/**
 * Bancs du bouton « Morceau précédent ».
 *
 * Même exigence que pour « suivant », et la même raison : l'état du bouton et l'action
 * du clic doivent sortir de la MÊME fonction. Ici s'ajoute la règle de position — au-delà
 * de quelques secondes, ⏮ redémarre le titre au lieu de reculer — parce qu'un clic qui
 * fait perdre trois minutes d'écoute est le pire défaut possible sur ce bouton.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  indexPrecedent, aUnePistePrecedente, actionPrecedent, SEUIL_REDEMARRAGE_S,
} from './.build/playlistNav.mjs';

test('recule d une piste au milieu de la playlist', () => {
  assert.equal(indexPrecedent(5, 3, 'none'), 2);
  assert.equal(indexPrecedent(5, 1, 'one'), 0);
});

test('premiere piste : rien avant, sauf en repetition « all »', () => {
  assert.equal(indexPrecedent(5, 0, 'none'), null);
  assert.equal(indexPrecedent(5, 0, 'one'), null);
  assert.equal(indexPrecedent(5, 0, 'all'), 4);
});

test('playlist d un seul titre ou vide : rien avant', () => {
  assert.equal(indexPrecedent(1, 0, 'all'), null);
  assert.equal(indexPrecedent(0, 0, 'all'), null);
});

test('index hors bornes : refuse au lieu de boucler par surprise', () => {
  assert.equal(indexPrecedent(3, -1, 'all'), null);
  assert.equal(indexPrecedent(3, 3, 'all'), null);
  assert.equal(indexPrecedent(3, 99, 'none'), null);
});

test('affichage et action ne peuvent pas diverger', () => {
  for (const n of [0, 1, 2, 3, 10]) {
    for (let i = -1; i <= n; i++) {
      for (const r of ['none', 'one', 'all']) {
        assert.equal(aUnePistePrecedente(n, i, r), indexPrecedent(n, i, r) !== null,
          `divergence pour n=${n} i=${i} r=${r}`);
      }
    }
  }
});

test('au-dela du seuil, on REDEMARRE le titre en cours', () => {
  assert.equal(actionPrecedent(SEUIL_REDEMARRAGE_S + 0.1, true), 'redemarrer');
  assert.equal(actionPrecedent(180, false), 'redemarrer');   // meme sans piste avant
});

test('au tout debut, on recule s il y a une piste avant', () => {
  assert.equal(actionPrecedent(0, true), 'precedent');
  assert.equal(actionPrecedent(SEUIL_REDEMARRAGE_S, true), 'precedent'); // pile au seuil
});

test('debut de la PREMIERE piste : le bouton ne doit rien promettre', () => {
  assert.equal(actionPrecedent(0, false), 'rien');
  assert.equal(actionPrecedent(SEUIL_REDEMARRAGE_S, false), 'rien');
});

test('position illisible : traitee comme zero, jamais comme un redemarrage', () => {
  for (const p of [NaN, -5, Infinity, -Infinity]) {
    assert.equal(actionPrecedent(p, false), 'rien', `position ${p}`);
    assert.equal(actionPrecedent(p, true), 'precedent', `position ${p}`);
  }
});

test('le seuil est une constante partagee, pas un nombre recopie', () => {
  assert.equal(typeof SEUIL_REDEMARRAGE_S, 'number');
  assert.ok(SEUIL_REDEMARRAGE_S > 0 && SEUIL_REDEMARRAGE_S < 10);
});
