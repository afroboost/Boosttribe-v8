// 🏠 01/10 — page noire de boosttribe.pro : TONES[undefined].bg (4 teintes pour 5 chapitres).
// Preuve RÉELLE (build production servi localement, Chrome) : rouge avant, vert après — consignée
// dans le commit. Ici : la règle qui empêche la récidive, quel que soit le nombre de chapitres.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lire, codeSeul } from './lireSource.mjs';

test('chaque chapitre reçoit une teinte EXISTANTE, quel que soit leur nombre', () => {
  const s = codeSeul(lire('components/sections/StorySections.tsx'));
  assert.match(s, /const toneDuChapitre = \(i: number\): Tone => \(i % 2 === 0 \? "light" : "dark"\);/);
  assert.match(s, /tone=\{toneDuChapitre\(i\)\}/);
  assert.doesNotMatch(s, /const tones: Tone\[\] = \[/);                       // plus de tableau de longueur fixe
  assert.doesNotMatch(s, /tone=\{tones\[i\]\}/);
  // repli sûr : une teinte inconnue est signalée, jamais une exception de rendu
  assert.match(s, /return c \?\? TONES\.dark;/);
  assert.equal((s.match(/const c = teinte\(tone\);/g) || []).length, 2);
  const toneDuChapitre = (i) => (i % 2 === 0 ? 'light' : 'dark');
  for (let n = 1; n <= 12; n++) for (let i = 0; i < n; i++) assert.ok(['light', 'dark'].includes(toneDuChapitre(i)));
});
