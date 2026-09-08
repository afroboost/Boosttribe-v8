/**
 * Bancs du bouton « Morceau suivant ».
 *
 * Ces bancs existent parce que le bouton a été livré INVISIBLE en production : la
 * condition d'affichage (« au moins deux pistes ») et l'intention (« passer au titre
 * suivant ») ne disaient pas la même chose. On teste donc la fonction UNIQUE dont
 * dépendent désormais l'affichage ET l'action.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { indexSuivant, aUnePisteSuivante } from './.build/playlistNav.mjs';

test('piste 1 → piste 2, piste 2 → piste 3', () => {
  assert.equal(indexSuivant(3, 0, 'none'), 1);
  assert.equal(indexSuivant(3, 1, 'none'), 2);
});

test('dernière piste sans répétition : aucune suivante (bouton désactivé)', () => {
  assert.equal(indexSuivant(3, 2, 'none'), null);
  assert.equal(aUnePisteSuivante(3, 2, 'none'), false);
});

test('répétition « all » : la dernière reboucle sur la première', () => {
  assert.equal(indexSuivant(3, 2, 'all'), 0);
  assert.equal(aUnePisteSuivante(3, 2, 'all'), true);
});

test('répétition « one » : un clic MANUEL avance quand même', () => {
  assert.equal(indexSuivant(3, 0, 'one'), 1);
  // ...mais ne reboucle pas depuis la dernière : seule « all » boucle.
  assert.equal(indexSuivant(3, 2, 'one'), null);
});

test('playlist d’UNE seule piste : aucune suivante — c’est le cas qui a masqué le bouton', () => {
  assert.equal(indexSuivant(1, 0, 'none'), null);
  assert.equal(indexSuivant(1, 0, 'all'), null);
  assert.equal(aUnePisteSuivante(1, 0, 'all'), false);
});

test('playlist vide : aucune suivante, aucune exception', () => {
  assert.equal(indexSuivant(0, 0, 'none'), null);
  assert.equal(indexSuivant(0, -1, 'all'), null);
});

test('piste courante introuvable (index -1) : aucune suivante', () => {
  assert.equal(indexSuivant(3, -1, 'none'), null);
  assert.equal(indexSuivant(3, -1, 'all'), null);
});

test('index hors bornes : refusé au lieu de boucler par surprise', () => {
  assert.equal(indexSuivant(3, 3, 'all'), null);
  assert.equal(indexSuivant(3, 99, 'none'), null);
});

test('deux pistes : aller-retour cohérent en répétition « all »', () => {
  assert.equal(indexSuivant(2, 0, 'all'), 1);
  assert.equal(indexSuivant(2, 1, 'all'), 0);
});

test('affichage et action ne peuvent plus diverger', () => {
  for (const n of [0, 1, 2, 3, 10]) {
    for (let i = -1; i <= n; i++) {
      for (const r of ['none', 'one', 'all']) {
        assert.equal(aUnePisteSuivante(n, i, r), indexSuivant(n, i, r) !== null,
          `divergence pour n=${n} i=${i} r=${r}`);
      }
    }
  }
});
