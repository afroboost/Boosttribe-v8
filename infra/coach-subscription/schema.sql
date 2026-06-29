-- ============================================================================
-- BoostTribe — ABONNEMENT COACH « Illimité » + TYPE DE PAIEMENT par coach
-- À exécuter en supabase_admin (SQL editor). Idempotent.
--   GARDE la billetterie IBAN (virements manuels) + les crédits public (achat unique).
--   PAS de Stripe Connect. L'abo coach est un abonnement Stripe RÉCURRENT réservé aux coachs.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Type de paiement par coach (choisi par l'admin) — défaut 'subscription'
--    subscription = Abo « Coach Illimité » (crédits illimités + 0% commission)
--    commission   = Billetterie IBAN avec commission + demande de virement (existant)
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists coach_payment_type text not null default 'subscription'
  check (coach_payment_type in ('subscription', 'commission'));

-- ---------------------------------------------------------------------------
-- 2) Abonnements coach (Stripe récurrent) — source de vérité du flag "illimité"
-- ---------------------------------------------------------------------------
create table if not exists public.coach_subscriptions (
  user_id                uuid primary key references auth.users(id) on delete cascade,
  stripe_subscription_id text,
  status                 text,                 -- active | trialing | past_due | canceled | unpaid | ...
  current_period_end     timestamptz,
  updated_at             timestamptz not null default now()
);
create index if not exists coach_subscriptions_stripe_idx
  on public.coach_subscriptions(stripe_subscription_id);

-- ---------------------------------------------------------------------------
-- 3) Prix de l'abo « Coach Illimité » dans la config admin (CHF/mois, éditable)
--    (commission_settings est créée par infra/billetterie/schema.sql)
-- ---------------------------------------------------------------------------
alter table public.commission_settings
  add column if not exists coach_sub_price_chf numeric(10,2) not null default 99.99;

-- ---------------------------------------------------------------------------
-- 4) RLS — le coach lit son propre abonnement ; écriture backend (service-role).
-- ---------------------------------------------------------------------------
alter table public.coach_subscriptions enable row level security;

drop policy if exists coach_subscriptions_read_own on public.coach_subscriptions;
create policy coach_subscriptions_read_own on public.coach_subscriptions
  for select using (auth.uid() = user_id);

-- (profiles a déjà ses policies ; coach_payment_type est lisible par le propriétaire
--  via les policies existantes de profiles, et écrit par le backend service-role/admin.)
