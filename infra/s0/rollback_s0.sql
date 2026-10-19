-- ============================================================================
-- S0 — ROLLBACK. Remet EXACTEMENT l'état d'avant S0.
-- Ordre : ÉTAPE 2 d'abord (verrou), puis ÉTAPE 1 si nécessaire (ajouts).
-- Chaque section est transactionnelle et idempotente.
-- ⚠️ Revenir à l'ÉTAPE 2 rouvre la faille (profils lisibles sans connexion, colonnes
--    sensibles modifiables par l'utilisateur) : à réserver à une panne avérée.
-- ============================================================================

-- ─────────────── ROLLBACK ÉTAPE 2 : verrou des profils ───────────────
begin;
drop trigger if exists s0_proteger_profil on public.profiles;
drop function if exists public.s0_proteger_profil();
drop policy if exists s0_profiles_select_soi on public.profiles;
drop policy if exists s0_profiles_update_soi on public.profiles;
drop policy if exists s0_profiles_insert_soi on public.profiles;
-- Recrée chaque règle sauvegardée, à l'identique (nom, commande, rôles, conditions).
do $$
declare p record; sql text;
begin
  if to_regclass('public.s0_sauvegarde_policies') is null then
    raise exception 'Sauvegarde S0 absente : rollback impossible automatiquement';
  end if;
  for p in select * from public.s0_sauvegarde_policies loop
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles'
                and policyname = p.policyname) then
      continue;                                   -- règle INSERT jamais retirée : déjà là
    end if;
    sql := format('create policy %I on public.profiles as %s for %s to %s',
                  p.policyname, p.permissive, p.cmd,
                  (select string_agg(case when r = 'public' then 'public' else quote_ident(r) end, ', ')
                     from unnest(p.roles) r));
    if p.qual is not null then sql := sql || ' using (' || p.qual || ')'; end if;
    if p.with_check is not null then sql := sql || ' with check (' || p.with_check || ')'; end if;
    execute sql;
  end loop;
end $$;
commit;

-- ─────────────── ROLLBACK ÉTAPE 1 : ajouts (optionnel) ───────────────
-- Ne le jouer que si l'étape 1 elle-même pose problème. Le backend S0 sait se passer de
-- credits_disponibles (repli sur profiles.credits) : le retirer ne casse pas le backend.
begin;
drop view if exists public.profiles_public;

-- Fonctions de crédits d'origine (infra/credits/schema.sql, section 2 et 8).
create or replace function public.recalc_user_credits(p_user uuid)
returns void language sql security definer set search_path = public as $$
  update public.profiles
     set credits = coalesce((select sum(delta) from public.credit_ledger where user_id = p_user), 0)
   where id = p_user;
$$;

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
    return coalesce(v_bal, 0);
  end if;
  insert into public.credit_ledger(user_id, delta, reason, ref, note, expires_at)
  values (p_user, abs(p_amount), p_reason, p_ref, p_note, p_expires);
  select credits into v_bal from public.profiles where id = p_user;
  return coalesce(v_bal, 0);
end;
$$;

create or replace function public.spend_credits(
  p_user uuid, p_amount int, p_reason text, p_ref text default null, p_note text default null
) returns integer
language plpgsql security definer set search_path = public as $$
declare v_bal integer;
begin
  select credits into v_bal from public.profiles where id = p_user for update;
  if v_bal is null then v_bal := 0; end if;
  if p_ref is not null and exists (
    select 1 from public.credit_ledger where reason = p_reason and ref = p_ref
  ) then
    return v_bal;
  end if;
  if v_bal < p_amount then
    raise exception 'insufficient_credits' using errcode = 'P0001';
  end if;
  insert into public.credit_ledger(user_id, delta, reason, ref, note)
  values (p_user, -abs(p_amount), p_reason, p_ref, p_note);
  return v_bal - p_amount;
end;
$$;

drop function if exists public.credits_disponibles(uuid);
commit;
