-- Banc S0 — l'ÉTAT ACTUEL de production, reproduit : table profiles (colonnes lues/écrites par
-- le code) + les règles de frontend/SUPABASE_COMPLETE_SETUP.sql:164-171 (celles que la lecture
-- anonyme constatée le 19/10 confirme). Le schéma crédits est chargé ensuite depuis
-- infra/credits/schema.sql (le VRAI fichier du dépôt).
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  avatar_url text,
  role text default 'user',
  subscription_status text default 'free',
  has_accepted_terms boolean default false,
  terms_accepted boolean default false,
  comp_access_plan text,
  comp_access_until timestamptz,
  coach_payment_type text,
  stripe_customer_id text,
  stripe_subscription_id text,
  live_preferences jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.profiles enable row level security;
create policy "profiles_select" on public.profiles for select using (true);
create policy "profiles_insert" on public.profiles for insert with check (auth.uid() = id);
create policy "profiles_update" on public.profiles for update using (auth.uid() = id);
