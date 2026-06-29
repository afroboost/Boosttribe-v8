-- ============================================================================
-- BoostTribe — Système de CRÉDITS (remplace les abonnements). À exécuter en
-- supabase_admin (SQL editor Supabase). Idempotent autant que possible.
--   1 crédit = 1 accès à un live (rejoindre OU héberger).
--   Solde = somme des deltas du grand livre (credit_ledger), maintenu sur profiles.credits.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0) Colonne de solde sur profiles (maintenue par trigger depuis le ledger)
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists credits integer not null default 0;

-- ---------------------------------------------------------------------------
-- 1) GRAND LIVRE des crédits (source de vérité, traçable)
--    reason ∈ purchase | spend_join | spend_host | offered | signup_bonus
--             | referral | launch_bonus | refund | gift
-- ---------------------------------------------------------------------------
create table if not exists public.credit_ledger (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  delta       integer not null,                  -- +crédit / -débit
  reason      text not null,
  ref         text,                              -- ex: stripe event id, session_id, code…
  note        text,
  expires_at  timestamptz,                       -- validité (crédits achetés/offerts)
  created_at  timestamptz not null default now(),
  constraint credit_ledger_reason_chk check (reason in
    ('purchase','spend_join','spend_host','offered','signup_bonus',
     'referral','launch_bonus','refund','gift'))
);
create index if not exists credit_ledger_user_idx on public.credit_ledger(user_id, created_at desc);
-- Idempotence des crédits (évite double crédit/débit sur un même event/action).
-- ref unique PAR raison quand ref fourni (ex: un event Stripe ne crédite qu'une fois).
create unique index if not exists credit_ledger_ref_ux
  on public.credit_ledger(reason, ref) where ref is not null;

-- ---------------------------------------------------------------------------
-- 2) Trigger : maintenir profiles.credits = somme des deltas
-- ---------------------------------------------------------------------------
create or replace function public.recalc_user_credits(p_user uuid)
returns void language sql security definer set search_path = public as $$
  update public.profiles
     set credits = coalesce((select sum(delta) from public.credit_ledger where user_id = p_user), 0)
   where id = p_user;
$$;

create or replace function public.credit_ledger_after_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    perform public.recalc_user_credits(old.user_id);
    return old;
  else
    perform public.recalc_user_credits(new.user_id);
    return new;
  end if;
end;
$$;

drop trigger if exists trg_credit_ledger_change on public.credit_ledger;
create trigger trg_credit_ledger_change
  after insert or update or delete on public.credit_ledger
  for each row execute function public.credit_ledger_after_change();

-- ---------------------------------------------------------------------------
-- 3) CONFIG éditable par l'admin
-- ---------------------------------------------------------------------------
create table if not exists public.credit_packs (
  id             bigint generated always as identity primary key,
  name           text not null,
  credits        integer not null check (credits > 0),
  price_chf      numeric(10,2) not null check (price_chf >= 0),
  currency       text not null default 'CHF',
  is_highlighted boolean not null default false,   -- badge « populaire »
  audience       text not null default 'participant' check (audience in ('participant','creator')),
  sort           integer not null default 0,
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists public.pricing_settings (
  id                    text primary key default 'default',
  services_shown        jsonb   not null default '["live","visio","stage","chat"]'::jsonb,
  offers                jsonb   not null default '{
    "first_free": {"enabled": true,  "title": "1er cours offert",        "text": "Ton premier live est offert à l''inscription."},
    "discovery":  {"enabled": true,  "title": "Pack Découverte",          "text": "1er achat à prix doux."},
    "validity":   {"enabled": true,  "title": "Crédits valables 12 mois", "text": "Aucune pression, utilise tes crédits quand tu veux."},
    "referral":   {"enabled": false, "title": "Parrainage",               "text": "Offre 1 crédit, reçois 1 crédit."},
    "gift":       {"enabled": false, "title": "Carte cadeau",             "text": "Offre des crédits à quelqu''un par email."},
    "launch":     {"enabled": false, "title": "Offre de lancement",       "text": "Bonus de crédits sur tous les packs.", "percent": 20, "ends_at": null}
  }'::jsonb,
  cost_join             integer not null default 1 check (cost_join >= 0),
  cost_host             integer not null default 1 check (cost_host >= 0),
  credit_validity_months integer not null default 12 check (credit_validity_months > 0),
  signup_free_credits   integer not null default 1 check (signup_free_credits >= 0),
  updated_at            timestamptz not null default now()
);
insert into public.pricing_settings (id) values ('default') on conflict (id) do nothing;

-- Packs par défaut (modifiables/supprimables par l'admin ensuite)
insert into public.credit_packs (name, credits, price_chf, is_highlighted, audience, sort, active)
select * from (values
  ('Découverte',  1,  9.00::numeric, false, 'participant', 1, true),
  ('Populaire',   5, 40.00::numeric, true,  'participant', 2, true),
  ('Tribu',      10, 70.00::numeric, false, 'participant', 3, true),
  ('Coach',      10, 70.00::numeric, false, 'creator',     1, true)
) as v(name,credits,price_chf,is_highlighted,audience,sort,active)
where not exists (select 1 from public.credit_packs);

-- ---------------------------------------------------------------------------
-- 4) Parrainage / carte-cadeau : codes (table prévue, usage backend)
-- ---------------------------------------------------------------------------
create table if not exists public.credit_codes (
  code        text primary key,                  -- code à partager
  kind        text not null check (kind in ('referral','gift')),
  credits     integer not null check (credits > 0),
  created_by  uuid references auth.users(id) on delete set null,
  for_email   text,                              -- carte cadeau destinée à un email (optionnel)
  redeemed_by uuid references auth.users(id) on delete set null,
  redeemed_at timestamptz,
  expires_at  timestamptz,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 5) RLS
-- ---------------------------------------------------------------------------
alter table public.credit_ledger    enable row level security;
alter table public.credit_packs     enable row level security;
alter table public.pricing_settings enable row level security;
alter table public.credit_codes     enable row level security;

-- Ledger : l'utilisateur LIT ses propres lignes ; écriture réservée au service-role (backend).
drop policy if exists credit_ledger_read_own on public.credit_ledger;
create policy credit_ledger_read_own on public.credit_ledger
  for select using (auth.uid() = user_id);
-- (aucune policy insert/update/delete pour anon/authenticated → seul service_role écrit)

-- Packs / settings : lecture PUBLIQUE (page tarifaire), écriture backend (service-role).
drop policy if exists credit_packs_read on public.credit_packs;
create policy credit_packs_read on public.credit_packs for select using (true);

drop policy if exists pricing_settings_read on public.pricing_settings;
create policy pricing_settings_read on public.pricing_settings for select using (true);

-- Codes : lecture par le créateur ou le destinataire ; écriture backend.
drop policy if exists credit_codes_read on public.credit_codes;
create policy credit_codes_read on public.credit_codes
  for select using (auth.uid() = created_by or auth.uid() = redeemed_by);

-- ---------------------------------------------------------------------------
-- 6) MIGRATION des accès Pro/comp existants → bonus de crédits (sûr, traçable)
--    Chaque utilisateur avec comp_access actif (ou abonnement payant) reçoit un
--    bonus de crédits via le ledger (reason=launch_bonus, ref=migration unique).
--    Choix : créditer un bonus plutôt que conserver l'abonnement (plus simple/sûr).
-- ---------------------------------------------------------------------------
insert into public.credit_ledger (user_id, delta, reason, ref, note, expires_at)
select p.id, 5, 'launch_bonus', 'migration_'||p.id::text,
       'Conversion accès Pro/offert → 5 crédits de bienvenue',
       now() + interval '12 months'
from public.profiles p
where (p.comp_access_until is not null and p.comp_access_until > now())
   or (p.subscription_status in ('pro','enterprise','monthly','yearly'))
-- l'index d'idempotence est PARTIEL (where ref is not null) → on répète le prédicat
on conflict (reason, ref) where ref is not null do nothing;

-- ---------------------------------------------------------------------------
-- 7) (optionnel) Trigger : créditer signup_free_credits à la création du profil.
--    On le gère plutôt côté BACKEND (idempotent) pour respecter pricing_settings ;
--    laissé en commentaire si tu préfères tout en DB.
-- ---------------------------------------------------------------------------
-- create or replace function public.grant_signup_bonus() returns trigger ...

-- ---------------------------------------------------------------------------
-- 8) RPC atomiques + idempotents (appelés par le BACKEND en service-role)
-- ---------------------------------------------------------------------------
-- Créditer (achat / offert / bonus). Idempotent sur (reason, ref) si ref fourni.
create or replace function public.add_credits(
  p_user uuid, p_amount int, p_reason text, p_ref text default null,
  p_note text default null, p_expires timestamptz default null
) returns integer
language plpgsql security definer set search_path = public as $$
declare v_bal integer;
begin
  if p_ref is not null and exists (
    select 1 from public.credit_ledger where reason = p_reason and ref = p_ref
  ) then
    select credits into v_bal from public.profiles where id = p_user;
    return coalesce(v_bal, 0);  -- déjà crédité → no-op
  end if;
  insert into public.credit_ledger(user_id, delta, reason, ref, note, expires_at)
  values (p_user, abs(p_amount), p_reason, p_ref, p_note, p_expires);
  select credits into v_bal from public.profiles where id = p_user;
  return coalesce(v_bal, 0);
end;
$$;

-- Débiter (rejoindre / héberger). Atomique : verrou + contrôle de solde.
-- Idempotent sur (reason, ref) : une même action (session) n'est débitée qu'une fois.
-- Lève 'insufficient_credits' si solde < montant.
create or replace function public.spend_credits(
  p_user uuid, p_amount int, p_reason text, p_ref text default null, p_note text default null
) returns integer
language plpgsql security definer set search_path = public as $$
declare v_bal integer;
begin
  -- Verrou pessimiste sur la ligne profil (anti double-débit concurrent)
  select credits into v_bal from public.profiles where id = p_user for update;
  if v_bal is null then v_bal := 0; end if;

  if p_ref is not null and exists (
    select 1 from public.credit_ledger where reason = p_reason and ref = p_ref
  ) then
    return v_bal;  -- déjà débité pour cette action → no-op
  end if;

  if v_bal < p_amount then
    raise exception 'insufficient_credits' using errcode = 'P0001';
  end if;

  insert into public.credit_ledger(user_id, delta, reason, ref, note)
  values (p_user, -abs(p_amount), p_reason, p_ref, p_note);
  return v_bal - p_amount;
end;
$$;

-- Droits d'exécution : service_role uniquement (le backend). Pas d'accès anon/auth.
revoke all on function public.add_credits(uuid,int,text,text,text,timestamptz) from public, anon, authenticated;
revoke all on function public.spend_credits(uuid,int,text,text,text) from public, anon, authenticated;
