// 🌐 01/10 — boosttribe.pro reflète les outils RÉELS de l'Espace Coach (sans promettre ce qui n'existe pas).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lire, codeSeul } from './lireSource.mjs';

test('Fonctionnalités : Prompteur, Enregistrement Live et Promotions marqués « Espace Coach »', () => {
  const f = codeSeul(lire('pages/FeaturesPage.tsx'));
  for (const t of ['title: "Prompteur Live",\n    badge: BADGE_COACH', 'title: "Enregistrement Live + Transcription IA",\n    badge: BADGE_COACH', 'title: "Promotions des participants",\n    badge: BADGE_COACH'])
    assert.ok(f.includes(t), t);
  assert.ok(f.includes('"Offre gratuite ou payante"') && f.includes('"Diffusion manuelle"'), 'promo : gratuite ou payante, diffusion manuelle');
  assert.ok(f.includes('"Vignettes déplaçables"'), 'Live Visio à jour');
  assert.ok(f.includes('getBilletterieConfig().then'), 'prix Coach : source canonique (comme /pricing)');
  assert.doesNotMatch(f, /99,99 CHF\/mois|99,99\/mois/, 'aucun prix Coach en dur dans les textes');
});

test('Tarifs : « Inclus dans l’Espace Coach » sous l’offre Coach, prix inchangé (source canonique)', () => {
  const p = codeSeul(lire('pages/PricingPage.tsx'));
  assert.ok(p.includes('data-testid="pricing-inclus-coach"'));
  for (const x of ['Prompteur Live', 'Enregistrement Live + transcription IA', 'Promotions des participants (gratuites ou payantes)']) assert.ok(p.includes(x), x);
  assert.ok(p.includes('if (bill.data?.coach_sub_price_chf) setCoachSubPrice(bill.data.coach_sub_price_chf);'));
});

test('Accueil : chapitre Espace Coach ; le participant n’a pas besoin d’être coach pour sa promo', () => {
  const s = codeSeul(lire('components/sections/StorySections.tsx'));
  assert.ok(s.includes('eyebrow: "Espace Coach"'));
  assert.ok(s.includes("vos participants, eux, n'ont pas besoin d'être coachs pour proposer leur promo"));
});
