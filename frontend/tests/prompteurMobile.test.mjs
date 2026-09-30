// Fix mobile 30/09 — Prompteur CENTRÉ dans la vidéo, jamais sous la barre verticale droite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cadrePrompteur, RESERVE_DROITE, TAILLE_BOUTON, SEUIL_PROMPTEUR_SYMETRIQUE } from './.build/liveControls.mjs';

const REM = 16;
const px = (v) => (String(v).endsWith('rem') ? parseFloat(v) * REM : parseFloat(v));
const src = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');

for (const largeur of [320, 360, 375, 390, 412, 430]) {
  test(`${largeur} px : prompteur centré dans la vidéo, hors de la barre`, () => {
    const c = cadrePrompteur({ largeur, droite: RESERVE_DROITE });
    const g = px(c.gauche); const d = px(c.droite);
    // centre de la colonne de texte = centre de la vidéo
    assert.equal(g + (largeur - g - d) / 2, largeur / 2);
    // la barre occupe 0,75 rem de marge + un bouton de 44 px : entièrement dans la réserve
    assert.ok(0.75 * REM + TAILLE_BOUTON <= d, 'la barre dépasse la réserve');
    // place utile pour le texte (et sa barre de contrôle, qui passe à la ligne)
    assert.ok(largeur - g - d >= 190, `trop étroit : ${largeur - g - d}px`);
  });
}

test('ordinateur (≥ seuil) : rendu inchangé — bord gauche, réserve à droite', () => {
  assert.equal(SEUIL_PROMPTEUR_SYMETRIQUE, 1024);
  assert.deepEqual(cadrePrompteur({ largeur: 1280, droite: RESERVE_DROITE }), { gauche: '0px', droite: RESERVE_DROITE });
});

test('plein écran : la réserve suit la safe-area (encoche) des DEUX côtés sur téléphone', () => {
  const d = `calc(${RESERVE_DROITE} + env(safe-area-inset-right))`;
  assert.deepEqual(cadrePrompteur({ largeur: 390, droite: d }), { gauche: d, droite: d });
});

test('le Live applique ce cadre dans les deux vues (normale et plein écran)', () => {
  const s = src('components/session/LiveVisioPanel.tsx');
  assert.equal((s.match(/left: prompteurCadre\.gauche, right: prompteurCadre\.droite/g) || []).length, 2);
  assert.doesNotMatch(s, /absolute inset-y-0 left-0" style=\{\{ right: droiteCalques \}\}/);
});

test('la barre verticale ne bouge pas : à droite, même position, même composant', () => {
  const s = src('components/session/LiveVisioPanel.tsx');
  assert.match(s, /className="absolute top-1\/2 -translate-y-1\/2"\n\s+style=\{\{ right: camFullscreen \? 'calc\(0\.75rem \+ env\(safe-area-inset-right\)\)' : '0\.75rem' \}\}/);
  assert.match(src('lib/liveControls.ts'), /return \{ orientation: 'verticale', cote: 'droite', reserveDroite: RESERVE_DROITE \};/);
});

test('grosse police : le texte passe toujours à la ligne, jamais de défilement horizontal', () => {
  const s = src('components/studio/Prompteur.tsx');
  assert.match(s, /whitespace-pre-wrap break-words \[overflow-wrap:anywhere\]/);
  assert.match(s, /overflow-y-auto overflow-x-hidden/);
});

test('barre de contrôle du prompteur : toutes les commandes, retour à la ligne, jamais plus large que le texte', () => {
  const s = src('components/session/PrompteurOverlay.tsx');
  assert.match(s, /flex max-w-full flex-wrap items-center justify-center/);
  for (const id of ['play', 'reset', 'vitesse-moins', 'vitesse-plus', 'taille-moins', 'taille-plus', 'editer', 'fermer'])
    assert.match(s, new RegExp(`prompteur-overlay-${id}`));
  // la réserve de 4,25 rem ne s'applique plus qu'à partir de lg (desktop inchangé)
  assert.match(s, /lg:pr-\[max\(4\.25rem,env\(safe-area-inset-right\)\)\]/);
  assert.doesNotMatch(s, /style=\{\{ paddingRight: 'max\(4\.25rem/);
});
