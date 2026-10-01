// 📡 Régression 01/10 : icône « Diffuser en direct » sans effet + menu ⋮ décalé/coupé sur mobile.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { placerMenu } from './.build/superposition.mjs';

const src = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');

for (const W of [320, 360, 375, 390, 412, 430]) {
  test(`${W} px : le menu ⋮ reste entièrement visible (coordonnées fenêtre)`, () => {
    const H = 760, largeurMenu = 240;
    for (const boutonHaut of [80, 380, 700]) {
      const { bottom, right } = placerMenu({ largeurFenetre: W, hauteurFenetre: H, boutonHaut, boutonDroite: W - 12, largeurMenu });
      assert.ok(right >= 8 && W - right - largeurMenu >= 8, `bord gauche/droit (${right})`);
      assert.ok(bottom >= 8 && bottom <= H, `bas (${bottom})`);
    }
  });
}

test('menu ⋮ : rendu en PORTAIL (plus de repère « transform » de la barre), toujours défilable', () => {
  const m = src('components/session/MenuActions.tsx');
  assert.match(m, /\{open && cibleSuperposition\(\) && createPortal\(/);
  assert.match(m, /placerMenu\(\{ largeurFenetre: window\.innerWidth/);
  assert.match(m, /overflow-y-auto overscroll-contain/);
});

test('tiroir « Diffuser en direct » : portail vers l’élément plein écran (sinon body), même composant', () => {
  const p = src('components/session/LiveVisioPanel.tsx');
  assert.match(p, /\{broadcastOpen && broadcastNode && cibleSuperposition\(\) && createPortal\(broadcastNode, cibleSuperposition\(\) as HTMLElement\)\}/);
  const s = src('pages/SessionPage.tsx');
  assert.match(s, /onToggleBroadcast=\{\(\) => setBroadcastOpen\(\(o\) => !o\)\}/);               // chaîne du clic intacte
  assert.match(s, /<BroadcastDrawer broadcast=\{broadcast\} open=\{broadcastOpen\} onClose=\{\(\) => setBroadcastOpen\(false\)\}/);
  const l = src('lib/superposition.ts');
  assert.match(l, /document\.fullscreenElement as HTMLElement \| null\) \|\| document\.body/);
});

test('ouvrir le tiroir ne démarre AUCUN direct social (protections existantes)', () => {
  const d = src('components/session/BroadcastDrawer.tsx');
  const ouverture = d.slice(d.indexOf('export const BroadcastDrawer'), d.indexOf('if (!open) return null;'));
  assert.doesNotMatch(ouverture, /\.start\(|demarrer\(/);
});
