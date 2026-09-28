/**
 * Prod 28/09 (414/430 px, écran court) : ouvrir le Prompteur agrandit la zone caméra
 * (réserve de 16rem pour ne pas couvrir le visage) et poussait la barre Live SOUS le bas
 * de l'écran. Règle : Prompteur ouvert ⇒ la barre Live unique reste à l'écran.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { lire, codeSeul } from './lireSource.mjs';

const PANEL = codeSeul(lire('components', 'session', 'LiveVisioPanel.tsx'));

test('ouvrir le Prompteur ramène la barre Live à l écran (hors plein écran)', () => {
  const i = PANEL.lastIndexOf('if (!prompteurOuvert || camFullscreen) return;');
  assert.ok(i > 0, 'un effet dédié existe');
  const bloc = PANEL.slice(i, i + 700);
  assert.ok(bloc.includes('const ramenerBarre = () =>'), 'déclenché à l ouverture, jamais en plein écran');
  assert.ok(bloc.includes("scrollIntoView({ block: 'nearest'"), 'défilement minimal, sans sauter en haut');
  assert.ok(bloc.includes('prefers-reduced-motion'), 'pas d animation si mouvement réduit');
});
