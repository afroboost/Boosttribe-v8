-- ============================================================================
-- S0 — ÉTAPE 1/2 : AJOUTS PURS. Aucune règle d'accès existante n'est modifiée.
-- À appliquer sur LES DEUX bases (api.boosttribe.pro ET supabase-live.afroboost.com),
-- en supabase_admin (éditeur SQL), AVANT le déploiement du backend/frontend S0.
-- Idempotent. Transactionnel : une erreur annule tout.
--
--   1. credits_disponibles(user) : LE solde autoritaire, calculé depuis credit_ledger,
--      crédits EXPIRÉS exclus. Le backend ne lit plus `profiles.credits` pour décider.
--   2. spend_credits / add_credits / recalc_user_credits : même signature, mais le
--      contrôle de solde passe par credits_disponibles (et non plus par profiles.credits,
--      qu'un utilisateur pouvait réécrire). profiles.credits reste une COPIE d'affichage.
--   3. Vue profiles_public (id, full_name, avatar_url) : ce dont le Live a besoin pour
--      afficher les AUTRES participants. Lisible par tous ; aucune donnée privée.
--
-- Rollback : infra/s0/rollback_s0.sql (section ÉTAPE 1).
-- ============================================================================
begin;

-- 0) Garde-fous ---------------------------------------------------------------
--    a) une ligne `playlists` par session : le backend et le frontend en dépendent (upsert
--       onConflict session_id). Sans contrainte d'unicité, on S'ARRÊTE (rien n'est appliqué).
do $$
begin
  if not exists (
    select 1 from pg_index i join pg_class t on t.oid = i.indrelid
     where t.relname = 'playlists' and t.relnamespace = 'public'::regnamespace and i.indisunique
       and i.indnatts = 1
       and (select attname from pg_attribute where attrelid = t.oid and attnum = i.indkey[0]) = 'session_id'
  ) then
    raise exception 'S0 : playlists.session_id n''est pas UNIQUE sur cette base — migration arrêtée, à traiter d''abord';
  end if;
end $$;
--    b) fonctions de portefeuille / copie de solde : jamais appelables par un utilisateur
--       (identique à 00_urgent_wallet_add.sql, rejoué ici par sécurité).
do $$
begin
  if to_regprocedure('public.wallet_add(uuid,numeric,text,text,boolean)') is not null then
    revoke all on function public.wallet_add(uuid,numeric,text,text,boolean) from public, anon, authenticated;
    grant execute on function public.wallet_add(uuid,numeric,text,text,boolean) to service_role;
  end if;
end $$;

-- 1) Solde autoritaire ---------------------------------------------------------
--    Rejeu CHRONOLOGIQUE du grand livre : chaque dépense consomme les crédits encore
--    valides À SA DATE, ceux qui expirent le plus tôt d'abord. Le solde = ce qui reste
--    dans les lots non expirés MAINTENANT. Sans aucune date d'expiration, c'est
--    exactement la somme du grand livre (comportement d'avant).
create or replace function public.credits_disponibles(p_user uuid)
returns integer language plpgsql stable security definer set search_path = public as $$
declare
  ev       record;
  lot_exp  timestamptz[] := '{}';
  lot_rest integer[]     := '{}';
  besoin   integer;
  i        integer;
  choix    integer;
  total    integer := 0;
begin
  for ev in select delta, expires_at, created_at from public.credit_ledger
             where user_id = p_user order by created_at, id loop
    if ev.delta > 0 then
      lot_exp  := lot_exp  || coalesce(ev.expires_at, 'infinity'::timestamptz);
      lot_rest := lot_rest || ev.delta;
    elsif ev.delta < 0 then
      besoin := -ev.delta;
      while besoin > 0 loop
        choix := null;
        for i in 1 .. coalesce(array_length(lot_exp, 1), 0) loop
          if lot_rest[i] > 0 and lot_exp[i] > ev.created_at
             and (choix is null or lot_exp[i] < lot_exp[choix]) then
            choix := i;
          end if;
        end loop;
        exit when choix is null;                 -- rien à consommer (historique incohérent) : on s'arrête
        if lot_rest[choix] >= besoin then
          lot_rest[choix] := lot_rest[choix] - besoin; besoin := 0;
        else
          besoin := besoin - lot_rest[choix]; lot_rest[choix] := 0;
        end if;
      end loop;
    end if;
  end loop;
  for i in 1 .. coalesce(array_length(lot_exp, 1), 0) loop
    if lot_exp[i] > now() then total := total + lot_rest[i]; end if;
  end loop;
  return total;
end;
$$;
revoke all on function public.credits_disponibles(uuid) from public, anon, authenticated;
grant execute on function public.credits_disponibles(uuid) to service_role;

-- 2) Copie d'affichage profiles.credits = solde disponible ----------------------
create or replace function public.recalc_user_credits(p_user uuid)
returns void language sql security definer set search_path = public as $$
  update public.profiles set credits = public.credits_disponibles(p_user) where id = p_user;
$$;
revoke all on function public.recalc_user_credits(uuid) from public, anon, authenticated;
grant execute on function public.recalc_user_credits(uuid) to service_role;

create or replace function public.add_credits(
  p_user uuid, p_amount int, p_reason text, p_ref text default null,
  p_note text default null, p_expires timestamptz default null
) returns integer
language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('credits:' || p_user::text, 0));
  if p_ref is not null and exists (
    select 1 from public.credit_ledger where reason = p_reason and ref = p_ref
  ) then
    return public.credits_disponibles(p_user);   -- déjà crédité → no-op
  end if;
  insert into public.credit_ledger(user_id, delta, reason, ref, note, expires_at)
  values (p_user, abs(p_amount), p_reason, p_ref, p_note, p_expires);
  return public.credits_disponibles(p_user);
end;
$$;

create or replace function public.spend_credits(
  p_user uuid, p_amount int, p_reason text, p_ref text default null, p_note text default null
) returns integer
language plpgsql security definer set search_path = public as $$
declare v_bal integer;
begin
  -- Verrou par utilisateur (anti double-débit concurrent), même sans ligne profiles.
  perform pg_advisory_xact_lock(hashtextextended('credits:' || p_user::text, 0));
  v_bal := public.credits_disponibles(p_user);
  if p_ref is not null and exists (
    select 1 from public.credit_ledger where reason = p_reason and ref = p_ref
  ) then
    return v_bal;                                  -- déjà débité pour cette action → no-op
  end if;
  if v_bal < p_amount then
    raise exception 'insufficient_credits' using errcode = 'P0001';
  end if;
  insert into public.credit_ledger(user_id, delta, reason, ref, note)
  values (p_user, -abs(p_amount), p_reason, p_ref, p_note);
  return v_bal - p_amount;
end;
$$;
revoke all on function public.add_credits(uuid,int,text,text,text,timestamptz) from public, anon, authenticated;
revoke all on function public.spend_credits(uuid,int,text,text,text) from public, anon, authenticated;
grant execute on function public.add_credits(uuid,int,text,text,text,timestamptz) to service_role;
grant execute on function public.spend_credits(uuid,int,text,text,text) to service_role;

-- 3) Ce que le Live affiche des AUTRES participants -----------------------------
--    Vue au droit du propriétaire (contourne la RLS de profiles) mais limitée à 3 colonnes.
create or replace view public.profiles_public as
  select id, full_name, avatar_url from public.profiles;
revoke all on public.profiles_public from public, anon, authenticated;
grant select on public.profiles_public to anon, authenticated, service_role;

commit;
