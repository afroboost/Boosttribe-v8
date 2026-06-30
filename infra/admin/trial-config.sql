-- ============================================================================
-- BoostTribe — Réglage admin : Essai gratuit → paiement automatique
-- Colonnes additionnelles sur pricing_settings. Idempotent.
-- ============================================================================
alter table public.pricing_settings
  add column if not exists trial_days          integer default 3,
  add column if not exists auto_charge_enabled boolean default false;
