-- ============================================================================
-- BoostTribe — PROMO PARTICIPANT PENDANT LE LIVE (V1)
-- Appliqué automatiquement au démarrage du backend (pg-meta), idempotent.
-- Source : backend/live_promo.py (SQL_SCHEMA). AJOUT PUR : aucune ligne existante modifiée.
-- Sauvegarde préalable : public.playlists_backup_live_promo_20260930 (copie de playlists).
--
-- ROLLBACK (manuel, uniquement si nécessaire) :
--   drop table if exists public.live_promos;
--   alter table public.playlists drop column if exists live_promo_enabled,
--                                drop column if exists live_promo_offres;
--   -- (la copie playlists_backup_live_promo_20260930 peut ensuite être supprimée)
-- ============================================================================
create table if not exists public.playlists_backup_live_promo_20260930 as table public.playlists;
alter table public.playlists
  add column if not exists live_promo_enabled boolean default false,
  add column if not exists live_promo_offres  jsonb   default '[]'::jsonb;
create table if not exists public.live_promos (
  id                      uuid primary key default gen_random_uuid(),
  session_id              text not null,
  host_id                 uuid not null,
  participant_id          uuid not null,
  participant_name        text,
  offre_id                text,
  duration_seconds        integer not null check (duration_seconds between 5 and 3600),
  price_chf               numeric(10,2) not null check (price_chf > 0),
  currency                text not null default 'CHF',
  media_url               text,
  title                   text not null,
  body                    text,
  external_url            text,
  status                  text not null default 'requested' check (status in
    ('requested','rejected','accepted','payment_pending','payment_failed','ready','broadcasting','completed','stopped_early')),
  requested_at            timestamptz not null default now(),
  decided_at              timestamptz,
  checkout_attempt        integer not null default 0,
  stripe_session_id       text unique,
  stripe_payment_intent   text,
  paid_at                 timestamptz,
  commission_percent      numeric(5,2),
  commission_chf          numeric(10,2),
  net_chf                 numeric(10,2),
  wallet_ref              text,
  started_at              timestamptz,
  ends_at                 timestamptz,
  stopped_at              timestamptz,
  stopped_by              uuid,
  actual_duration_seconds integer,
  stop_reason             text,
  updated_at              timestamptz not null default now()
);
create index if not exists live_promos_session_idx on public.live_promos(session_id, status);
create index if not exists live_promos_participant_idx on public.live_promos(participant_id);
create unique index if not exists live_promos_une_diffusion on public.live_promos(session_id) where status = 'broadcasting';
alter table public.live_promos enable row level security;
alter table public.live_promos add column if not exists test_sans_paiement boolean not null default false;
