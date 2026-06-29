-- ============================================================================
-- BoostTribe — BILLETTERIE COACH (sessions payantes CHF) + PORTEFEUILLE coach
-- À exécuter en supabase_admin (SQL editor). Idempotent autant que possible.
--   PAS de Stripe Connect : les billets sont payés sur le compte plateforme
--   existant. La part coach (prix - commission) alimente son SOLDE ; le coach
--   renseigne son IBAN et DEMANDE des virements, l'admin les traite à la main.
--   Coexiste avec les CRÉDITS (cours ouverts).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Sessions : mode d'accès + prix/place + capacité (colonnes sur playlists)
--    mode : open (crédits) | paid (billet CHF) | private (lien/QR gratuit)
-- ---------------------------------------------------------------------------
alter table public.playlists add column if not exists mode      text not null default 'open'
  check (mode in ('open','paid','private'));
alter table public.playlists add column if not exists price_chf numeric(10,2);
alter table public.playlists add column if not exists capacity  integer;   -- null = illimité

-- ---------------------------------------------------------------------------
-- 2) Billets (places payées) — source de vérité des accès payants
-- ---------------------------------------------------------------------------
create table if not exists public.tickets (
  id                    bigint generated always as identity primary key,
  session_id            text not null,
  buyer_user_id         uuid references auth.users(id) on delete set null,
  buyer_email           text,
  coach_user_id         uuid references auth.users(id) on delete set null,
  stripe_session_id     text,                       -- Checkout Session id (idempotence)
  stripe_payment_intent text,
  amount_chf            numeric(10,2) not null default 0,
  commission_chf        numeric(10,2) not null default 0,
  commission_percent    numeric(5,2),
  status                text not null default 'paid' check (status in ('paid','refunded')),
  created_at            timestamptz not null default now()
);
create index if not exists tickets_session_idx on public.tickets(session_id);
create index if not exists tickets_buyer_idx   on public.tickets(buyer_user_id);
create index if not exists tickets_coach_idx   on public.tickets(coach_user_id);
create index if not exists tickets_pi_idx      on public.tickets(stripe_payment_intent);
-- Idempotence : un même Checkout ne crée qu'UN billet. Index NON partiel pour que
-- l'upsert PostgREST (on_conflict=stripe_session_id) puisse l'inférer ; Postgres
-- autorise plusieurs NULL dans un index unique → aucun blocage si jamais null.
create unique index if not exists tickets_stripe_session_ux
  on public.tickets(stripe_session_id);

-- ---------------------------------------------------------------------------
-- 3) PORTEFEUILLE coach : solde + revenus + coordonnées bancaires + grand-livre
-- ---------------------------------------------------------------------------
create table if not exists public.coach_wallet (
  user_id           uuid primary key references auth.users(id) on delete cascade,
  balance_chf       numeric(12,2) not null default 0,
  total_revenue_chf numeric(12,2) not null default 0,
  first_sale_at     timestamptz,                    -- fenêtre offre de lancement
  updated_at        timestamptz not null default now()
);

create table if not exists public.coach_bank (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  iban       text,
  holder     text,
  updated_at timestamptz not null default now()
);

create table if not exists public.wallet_ledger (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  delta_chf  numeric(12,2) not null,
  reason     text not null check (reason in ('sale','commission','withdrawal','refund')),
  ref        text,                                  -- idempotence (sale:<cs_id>, payout:<id>, refund:<pi>:<tid>)
  created_at timestamptz not null default now()
);
create index if not exists wallet_ledger_user_idx on public.wallet_ledger(user_id);
create unique index if not exists wallet_ledger_ref_ux
  on public.wallet_ledger(ref) where ref is not null;

-- Demandes de virement (traitées manuellement par l'admin)
create table if not exists public.payout_requests (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  amount_chf numeric(12,2) not null,
  iban       text,
  status     text not null default 'requested' check (status in ('requested','paid','rejected')),
  created_at timestamptz not null default now(),
  paid_at    timestamptz
);
create index if not exists payout_requests_user_idx   on public.payout_requests(user_id);
create index if not exists payout_requests_status_idx on public.payout_requests(status);

-- ---------------------------------------------------------------------------
-- 4) RPC : mouvement de portefeuille atomique + idempotent
--    delta>0 = crédit (vente), delta<0 = débit (virement). is_revenue → cumule
--    aussi dans total_revenue_chf (vente: +net ; remboursement: -net).
-- ---------------------------------------------------------------------------
create or replace function public.wallet_add(
  p_user uuid, p_delta numeric, p_reason text,
  p_ref text default null, p_is_revenue boolean default false
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_rows integer := 0;
begin
  if p_ref is not null then
    insert into public.wallet_ledger(user_id, delta_chf, reason, ref)
      values (p_user, p_delta, p_reason, p_ref)
      on conflict (ref) where ref is not null do nothing;
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      return;  -- déjà traité (idempotence)
    end if;
  else
    insert into public.wallet_ledger(user_id, delta_chf, reason, ref)
      values (p_user, p_delta, p_reason, null);
  end if;

  insert into public.coach_wallet (user_id, balance_chf, total_revenue_chf, first_sale_at)
    values (
      p_user, p_delta,
      case when p_is_revenue then greatest(p_delta, 0) else 0 end,
      case when p_is_revenue and p_delta > 0 then now() else null end
    )
  on conflict (user_id) do update set
    balance_chf       = public.coach_wallet.balance_chf + p_delta,
    total_revenue_chf = public.coach_wallet.total_revenue_chf
                        + (case when p_is_revenue then p_delta else 0 end),
    first_sale_at     = coalesce(public.coach_wallet.first_sale_at,
                                 case when p_is_revenue and p_delta > 0 then now() else null end),
    updated_at        = now();
end;
$$;

-- ---------------------------------------------------------------------------
-- 5) Réglages Billetterie & Commission — ENTIÈREMENT éditables par l'admin
-- ---------------------------------------------------------------------------
create table if not exists public.commission_settings (
  id                 text primary key default 'default',
  commission_percent numeric(5,2) not null default 15,          -- commission plateforme
  fees_included      boolean not null default true,             -- true = "tout compris"
  launch_offer       jsonb not null default '{"active": true, "percent": 0, "scope": "first_month", "days": 30}'::jsonb,
  price_min_chf      numeric(10,2) not null default 5,
  price_max_chf      numeric(10,2) not null default 500,
  currency           text not null default 'CHF',
  updated_at         timestamptz not null default now()
);
insert into public.commission_settings (id) values ('default') on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 6) RLS
-- ---------------------------------------------------------------------------
alter table public.tickets             enable row level security;
alter table public.coach_wallet        enable row level security;
alter table public.coach_bank          enable row level security;
alter table public.wallet_ledger       enable row level security;
alter table public.payout_requests     enable row level security;
alter table public.commission_settings enable row level security;

-- Billets : l'ACHETEUR lit ses billets ; le COACH (vendeur) lit ses ventes. Écriture backend.
drop policy if exists tickets_read on public.tickets;
create policy tickets_read on public.tickets
  for select using (auth.uid() = buyer_user_id or auth.uid() = coach_user_id);

-- Portefeuille / IBAN / grand-livre / demandes : le coach lit les SIENS. Écriture backend.
drop policy if exists coach_wallet_read_own on public.coach_wallet;
create policy coach_wallet_read_own on public.coach_wallet
  for select using (auth.uid() = user_id);

drop policy if exists coach_bank_read_own on public.coach_bank;
create policy coach_bank_read_own on public.coach_bank
  for select using (auth.uid() = user_id);

drop policy if exists wallet_ledger_read_own on public.wallet_ledger;
create policy wallet_ledger_read_own on public.wallet_ledger
  for select using (auth.uid() = user_id);

drop policy if exists payout_requests_read_own on public.payout_requests;
create policy payout_requests_read_own on public.payout_requests
  for select using (auth.uid() = user_id);

-- Réglages commission : lecture PUBLIQUE (UI tarifaire) ; écriture backend (admin via require_admin).
drop policy if exists commission_settings_read on public.commission_settings;
create policy commission_settings_read on public.commission_settings for select using (true);

-- (Aucune policy insert/update/delete pour anon/authenticated → seul service_role écrit ;
--  les demandes de virement sont traitées par l'admin via le backend service-role.)
