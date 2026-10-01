// 📣 01/10 — « Promo en attente » bien visible pour l'hôte (compteur exact, animation seulement au changement).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lire, codeSeul } from './lireSource.mjs';

test('pastille « Promo en attente » : grande, contrastée, compteur exact, animation seulement au changement', () => {
  const s = codeSeul(lire('pages/SessionPage.tsx'));
  assert.match(s, /<button key=\{promoAtraiter\} type="button" onClick=\{\(\) => setPromoHoteOuvert\(true\)\}/);   // rejoue à chaque nouveau nombre
  assert.match(s, /min-h-\[48px\][^"]*text-base font-bold[^"]*animate-\[bounce_0\.6s_ease-out_2\]/);               // jamais en boucle
  assert.match(s, /Promo en attente \(\{promoAtraiter\}\)/);
  assert.match(s, /style=\{\{ background: 'var\(--bt-accent\)' \}\}/);                                          // couleur du thème, pas en dur
});
