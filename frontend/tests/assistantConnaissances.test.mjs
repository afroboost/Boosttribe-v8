// 🤖 01/10 — l'assistant BoostTribe répond selon les règles RÉELLES (Espace Coach, promos, prix canonique).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getBotResponse } from './.build/assistantConnaissances.mjs';
import { lire, codeSeul } from './lireSource.mjs';

const cfg = { trial_days: 7, cost_join: 1, cost_host: 1, signup_free_credits: 1, credit_validity_months: 12, packs: [], offers: {} };
const R = (q, prix = 99.99) => getBotResponse(q, cfg, prix);

test('« C’est quoi le Prompteur ? » → outil de l’Espace Coach', () => {
  const r = R("C'est quoi le Prompteur ?");
  assert.match(r, /PROMPTEUR est un outil de l'ESPACE COACH/); assert.match(r, /défiler/);
});

test('« Qui peut enregistrer un Live ? » → hôte d’un Live Espace Coach', () => {
  assert.match(R('Qui peut enregistrer un Live ?'), /seul l'hôte d'un Live hébergé par un Espace Coach/);
});

test('« Comment faire ma promo ? » → participant, ⋮ Faire ma promo, l’hôte accepte puis diffuse', () => {
  const r = R('Comment faire ma promo ?');
  assert.match(r, /« Faire ma promo »/); assert.match(r, /Tu n'as PAS besoin d'être coach/); assert.match(r, /Diffuser maintenant/);
});

test('promo gratuite / payante / quand payer', () => {
  assert.match(R('Peut-on faire une promo gratuite ?'), /aucun paiement, aucune étape Stripe/);
  assert.match(R('Peut-on faire une promo payante ?'), /tu ne paies JAMAIS à l'envoi/);
  assert.match(R('Quand est-ce que je paie ma promo ?'), /seulement ensuite le bouton « Payer »/);
});

test('« Un participant non-coach peut-il proposer sa promo ? » → OUI, ne dit jamais « il faut devenir coach »', () => {
  const r = R('Un participant non-coach peut-il proposer sa promo ?');
  assert.match(r, /^Oui/); assert.doesNotMatch(r, /il faut devenir coach/i);
});

test('« Je suis Coach, puis-je faire ma promo dans le Live d’un autre Coach ? » → OUI, aucun droit de gestion', () => {
  const r = R("Je suis Coach, puis-je faire ma promo dans le Live d'un autre Coach ?");
  assert.match(r, /^Oui : même si tu as ton propre Espace Coach/); assert.match(r, /aucun droit de gestion/); assert.match(r, /l'argent va à l'hôte du Live/);
});

test('« Combien coûte l’Espace Coach ? » → prix et essai de la CONFIGURATION (jamais en dur)', () => {
  assert.match(R("Combien coûte l'Espace Coach ?"), /99\.99 CHF\/mois/);
  assert.match(R("Combien coûte l'Espace Coach ?", 120), /120\.00 CHF\/mois/);
  assert.match(R("Combien coûte l'Espace Coach ?"), /Essai de 7 jours/);
  assert.match(getBotResponse('abonnement coach', { ...cfg, trial_days: 0 }, 99.99), /^(?!.*Essai de)/s);
  assert.doesNotMatch(codeSeul(lire('lib/assistantConnaissances.ts')), /99[,.]99/);
  assert.match(codeSeul(lire('components/AssistantChat.tsx')), /import \{ getBotResponse \} from '@\/lib\/assistantConnaissances'/);   // une seule base
});
