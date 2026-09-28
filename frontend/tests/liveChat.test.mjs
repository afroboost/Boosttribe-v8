/**
 * 💬 CHAT LIVE TRANSPARENT — les règles pures (lib/liveChat.ts).
 *
 * Il n'y a PAS de serveur de chat : les messages voyagent en broadcast Supabase
 * Realtime ('CHAT_GROUP'). La seule protection contre le flood est donc côté client
 * (ce limiteur) + les limites natives de Realtime. Il doit freiner un spam sans
 * jamais gêner quelqu'un qui écrit normalement.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  derniersMessages, limiteurChat, normaliserTexte, initiales, LONGUEUR_MAX,
} from './.build/liveChat.mjs';

const msg = (i) => ({ id: `m${i}`, userId: 'u', name: 'A', text: `t${i}`, ts: i });

test('derniersMessages garde les N derniers, dans l ordre', () => {
  const l = Array.from({ length: 10 }, (_, i) => msg(i));
  assert.deepEqual(derniersMessages(l, 3).map((m) => m.id), ['m7', 'm8', 'm9']);
  assert.equal(derniersMessages(l, 20).length, 10);
  assert.equal(derniersMessages(l, 0).length, 0);
  assert.equal(derniersMessages([], 5).length, 0);
  assert.equal(derniersMessages(undefined, 5).length, 0);
  assert.equal(derniersMessages(l, -2).length, 0);
});

test('derniersMessages ne modifie pas la liste reçue', () => {
  const l = [msg(1), msg(2), msg(3)];
  derniersMessages(l, 1);
  assert.equal(l.length, 3);
});

test('normaliserTexte : trim, espaces multiples, 300 max', () => {
  assert.equal(normaliserTexte('  salut   tout  le   monde  '), 'salut tout le monde');
  assert.equal(normaliserTexte('a\n\n\tb'), 'a b');
  assert.equal(normaliserTexte(''), '');
  assert.equal(normaliserTexte(null), '');
  assert.equal(LONGUEUR_MAX, 300);
  assert.equal(normaliserTexte('x'.repeat(500)).length, 300);
});

test('initiales', () => {
  assert.equal(initiales('marie curie'), 'MC');
  assert.equal(initiales('Bassi'), 'B');
  assert.equal(initiales('  jean  paul  sartre '), 'JP');
  assert.equal(initiales(''), '?');
  assert.equal(initiales(undefined), '?');
  assert.equal(initiales('éloïse'), 'É');
});

test('limiteur : un usage normal passe (1 message toutes les 3 s)', () => {
  const l = limiteurChat();
  for (let i = 0; i < 20; i++) assert.equal(l.essayer(i * 3000).ok, true, `message ${i}`);
});

test('limiteur : deux messages à moins de 1,2 s → le 2e attend', () => {
  const l = limiteurChat();
  assert.equal(l.essayer(1000).ok, true);
  const r = l.essayer(1500);
  assert.equal(r.ok, false);
  assert.equal(r.attendreMs, 700);
  assert.equal(l.essayer(2200).ok, true, 'passé 1,2 s, c est bon');
});

test('limiteur : 6 messages / 15 s glissantes', () => {
  const l = limiteurChat();
  for (let i = 0; i < 6; i++) assert.equal(l.essayer(i * 1300).ok, true);
  const r = l.essayer(6 * 1300);           // 7e à 7,8 s
  assert.equal(r.ok, false);
  assert.equal(r.attendreMs, 15000 - 7800, 'attend que le 1er sorte de la fenêtre');
  assert.equal(l.essayer(15000).ok, true, 'le 1er (t=0) est sorti de la fenêtre');
});

test('limiteur : un refus ne consomme pas de place', () => {
  const l = limiteurChat();
  l.essayer(0);
  for (let i = 1; i < 10; i++) l.essayer(i * 100); // tous refusés
  assert.equal(l.essayer(1200).ok, true);
});

test('limiteur : options personnalisables', () => {
  const l = limiteurChat({ intervalleMinMs: 0, maxParFenetre: 2, fenetreMs: 1000 });
  assert.equal(l.essayer(0).ok, true);
  assert.equal(l.essayer(1).ok, true);
  assert.equal(l.essayer(2).ok, false);
});
