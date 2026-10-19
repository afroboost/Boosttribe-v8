-- Banc S0 — ÉTAT RÉEL de production, relevé en lecture seule le 19/10/2026 sur les DEUX bases.
-- Variante choisie par la variable psql :live (true = afroboost.com/live, false = boosttribe.pro).
-- Exécuté SOUS LE RÔLE PROPRIÉTAIRE réel (boosttribe.pro : supabase_admin ; /live : postgres),
-- comme en production — c'est ce propriétaire qui compte pour les fonctions SECURITY DEFINER.

create or replace function public.update_updated_at_column() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- ── profiles ──────────────────────────────────────────────────────────────────────────
\if :live
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text, full_name text, avatar_url text,
  role text default 'user', subscription_status text default 'free', terms_accepted boolean default false,
  created_at timestamptz default now(), updated_at timestamptz default now(),
  comp_access_plan text, comp_access_until timestamptz,
  coach_payment_type text not null default 'subscription' check (coach_payment_type in ('subscription','commission')),
  live_preferences jsonb
);
\else
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text, full_name text, avatar_url text,
  role text default 'user', subscription_status text default 'free', terms_accepted boolean default false,
  created_at timestamptz default now(), updated_at timestamptz default now(),
  stripe_customer_id text, stripe_subscription_id text,
  comp_access_until timestamptz, comp_access_plan text,
  coach_payment_type text not null default 'subscription' check (coach_payment_type in ('subscription','commission')),
  live_preferences jsonb
);
\endif
alter table public.profiles enable row level security;
create policy "profiles_select" on public.profiles for select using (true);
create policy "profiles_insert" on public.profiles for insert with check (auth.uid() = id);
create policy "profiles_update" on public.profiles for update using (auth.uid() = id);
create trigger update_profiles_updated_at before update on public.profiles
  for each row execute function public.update_updated_at_column();

-- ── playlists ─────────────────────────────────────────────────────────────────────────
create table public.playlists (
  id uuid not null default gen_random_uuid() primary key,
  session_id text not null unique,
  tracks jsonb default '[]'::jsonb, selected_track_id text,
  created_at timestamptz default now(), updated_at timestamptz default now(),
  description text, shared_media jsonb, host_id uuid,
  is_private boolean not null default false,
  mode text not null default 'open', price_chf numeric, capacity integer,
  record_enabled boolean not null default false,
  promo_enabled boolean default false, promo_media_url text, promo_media_type text, promo_description text,
  promo_cta text, promo_payment_link text, promo_price text, promo_format text,
  access_mode text default 'account', promo_allow_access_requests boolean default false,
  live_promo_enabled boolean default false, live_promo_offres jsonb default '[]'::jsonb,
  live_ended_at timestamptz
);
\if :live
alter table public.playlists add column cohosts jsonb not null default '[]'::jsonb;
\else
alter table public.playlists add column cohosts jsonb;
\endif
alter table public.playlists enable row level security;
create trigger update_playlists_updated_at before update on public.playlists
  for each row execute function public.update_updated_at_column();

create table public.coach_subscriptions (
  user_id uuid primary key, stripe_subscription_id text, status text, current_period_end timestamptz,
  updated_at timestamptz default now()
);
alter table public.coach_subscriptions enable row level security;

-- ── grand livre + fonctions de crédits : le VRAI fichier du dépôt ─────────────────────
\ir ../../credits/schema.sql
alter table public.credit_ledger drop constraint credit_ledger_reason_chk;
alter table public.credit_ledger add constraint credit_ledger_reason_chk check (reason = any (array['purchase','spend_join',
  'spend_host','spend_record','offered','signup_bonus','referral','launch_bonus','refund','gift']));
\ir ../../access/coach-unlimited-admin-grant.sql

-- Règles RLS de playlists, à l'identique de la production (elles diffèrent entre les 2 bases).
create policy playlists_insert on public.playlists for insert to authenticated
  with check ((host_id is null) or ((host_id)::text = (auth.uid())::text));
create policy playlists_select on public.playlists for select using (
  (mode is distinct from 'open') or (access_mode = 'guest') or (host_id = auth.uid())
  or (cohosts @> to_jsonb((auth.uid())::text))
  or (coalesce((auth.jwt() ->> 'email'), '') = 'contact.artboost@gmail.com')
  or has_open_session_access(session_id));
\if :live
create policy playlists_delete on public.playlists for delete to authenticated using ((host_id)::text = (auth.uid())::text);
create policy playlists_update on public.playlists for update to authenticated
  using ((host_id is null) or ((host_id)::text = (auth.uid())::text) or (coalesce(cohosts, '[]'::jsonb) @> to_jsonb((auth.uid())::text)))
  with check ((host_id is null) or ((host_id)::text = (auth.uid())::text) or (coalesce(cohosts, '[]'::jsonb) @> to_jsonb((auth.uid())::text)));
\else
create policy playlists_delete on public.playlists for delete using ((host_id)::text = (auth.uid())::text);
create policy playlists_update on public.playlists for update
  using (((host_id)::text = (auth.uid())::text) or (cohosts @> to_jsonb((auth.uid())::text)))
  with check (((host_id)::text = (auth.uid())::text) or (cohosts @> to_jsonb((auth.uid())::text)));
\endif

-- ── demandes d'accès (identiques sur les 2 bases) ─────────────────────────────────────
create table public.access_requests (
  id bigint generated by default as identity primary key, session_id text not null,
  requester_user_id uuid, requester_name text not null, status text not null default 'pending',
  created_at timestamptz not null default now(), decided_at timestamptz
);
alter table public.access_requests enable row level security;
create policy access_requests_host_select on public.access_requests for select to authenticated
  using ((exists (select 1 from public.playlists p where p.session_id = access_requests.session_id and p.host_id = auth.uid()))
         or (requester_user_id = auth.uid()));
create policy access_requests_host_update on public.access_requests for update to authenticated
  using (exists (select 1 from public.playlists p where p.session_id = access_requests.session_id and p.host_id = auth.uid()))
  with check (exists (select 1 from public.playlists p where p.session_id = access_requests.session_id and p.host_id = auth.uid()));

-- ── billets : /live n'a PAS les colonnes de paiement mobile ───────────────────────────
create table public.tickets (
  id bigint generated always as identity primary key, session_id text not null,
  buyer_user_id uuid, buyer_email text, coach_user_id uuid, stripe_session_id text, stripe_payment_intent text,
  amount_chf numeric(10,2) not null default 0, commission_chf numeric(10,2) not null default 0,
  commission_percent numeric(5,2), status text not null default 'paid', created_at timestamptz not null default now()
);
\if :live
\else
alter table public.tickets add column provider text, add column tx_ref text, add column paid_currency text, add column paid_amount numeric;
\endif
alter table public.tickets enable row level security;

-- ── portefeuille CHF (wallet_add : déjà fermé en production par 00, rejoué par le banc) ─
create table public.coach_wallet (user_id uuid primary key, balance_chf numeric not null default 0);
create function public.wallet_add(p_user uuid, p_delta numeric, p_reason text, p_ref text, p_is_revenue boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.coach_wallet(user_id, balance_chf) values (p_user, p_delta)
  on conflict (user_id) do update set balance_chf = coach_wallet.balance_chf + p_delta;
end $$;
