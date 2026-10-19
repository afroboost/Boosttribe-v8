-- ============================================================================
-- S0 — ÉTAPE 2/2 : VERROU DES PROFILS. À appliquer APRÈS l'étape 1 ET APRÈS le
-- déploiement du frontend S0 (qui lit les autres participants via profiles_public).
-- Sur LES DEUX bases. Idempotent. Transactionnel.
--
-- AVANT (constaté le 19/10/2026) :
--   - lecture : `profiles_select USING (true)` → TOUT profil lisible, même SANS connexion
--     (solde, accès offert, e-mail, rôle…) ;
--   - écriture : `profiles_update USING (auth.uid() = id)`, sans restriction de colonnes →
--     un utilisateur pouvait se donner des crédits, l'illimité, un rôle, changer son e-mail.
-- APRÈS :
--   - lecture : uniquement SA propre ligne (les autres → vue profiles_public) ;
--   - écriture par l'utilisateur : uniquement les colonnes de la LISTE BLANCHE
--     (full_name, avatar_url, has_accepted_terms, terms_accepted, updated_at). Toute autre
--     colonne garde sa valeur (création : valeur sûre). Le backend (service_role) et les
--     fonctions SQL serveur ne sont PAS concernés.
--
-- Les règles actuelles sont SAUVEGARDÉES (s0_sauvegarde_policies) avant d'être retirées :
-- le rollback (rollback_s0.sql) les recrée À L'IDENTIQUE.
-- ============================================================================
begin;

-- 0) Sauvegarde exacte des règles actuelles de profiles -------------------------
create table if not exists public.s0_sauvegarde_policies (
  policyname text primary key,
  cmd        text not null,
  permissive text not null,
  roles      text[] not null,
  qual       text,
  with_check text,
  saved_at   timestamptz not null default now()
);
alter table public.s0_sauvegarde_policies enable row level security;   -- aucune policy : service-role seul
revoke all on public.s0_sauvegarde_policies from anon, authenticated;
insert into public.s0_sauvegarde_policies (policyname, cmd, permissive, roles, qual, with_check)
select policyname, cmd, permissive, roles::text[], qual, with_check
  from pg_policies
 where schemaname = 'public' and tablename = 'profiles'
   and policyname not like 's0\_%'
on conflict (policyname) do nothing;

-- 1) Retrait des règles de LECTURE et de MODIFICATION existantes ---------------
do $$
declare p record;
begin
  for p in select policyname from pg_policies
            where schemaname = 'public' and tablename = 'profiles'
              and cmd in ('SELECT', 'UPDATE', 'ALL') and policyname not like 's0\_%'
  loop
    execute format('drop policy %I on public.profiles', p.policyname);
  end loop;
end $$;

alter table public.profiles enable row level security;

drop policy if exists s0_profiles_select_soi on public.profiles;
create policy s0_profiles_select_soi on public.profiles
  for select to authenticated using (auth.uid() = id);

drop policy if exists s0_profiles_update_soi on public.profiles;
create policy s0_profiles_update_soi on public.profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

-- Une création de SON profil doit rester possible (le frontend la fait à la 1re connexion).
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles'
                  and cmd = 'INSERT') then
    execute 'create policy s0_profiles_insert_soi on public.profiles for insert to authenticated
             with check (auth.uid() = id)';
  end if;
end $$;

-- 2) Liste blanche des colonnes modifiables par l'utilisateur -------------------
--    SECURITY INVOKER (défaut) : current_user = le rôle de la requête PostgREST.
--    anon / authenticated → verrou ; service_role, postgres, fonctions SECURITY DEFINER → libre.
create or replace function public.s0_proteger_profil()
returns trigger language plpgsql set search_path = public as $$
declare
  libres   text[] := array['full_name','avatar_url','has_accepted_terms','terms_accepted','updated_at','created_at','id'];
  admin    boolean := lower(coalesce(auth.jwt() ->> 'email', '')) = 'contact.artboost@gmail.com';
  n        jsonb := to_jsonb(new);
  o        jsonb;
  k        text;
  forcer   jsonb := '{}'::jsonb;
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    o := to_jsonb(old);
    for k in select jsonb_object_keys(n) loop
      if not (k = any(libres)) and (n -> k) is distinct from (o -> k) then
        -- Exception historique : le compte admin (adresse fixe, comme la RLS des playlists)
        -- garde son auto-correction role/subscription_status (AuthContext.tsx).
        if admin and ((k = 'role' and n ->> k = 'admin') or (k = 'subscription_status' and n ->> k = 'enterprise')) then
          continue;
        end if;
        forcer := forcer || jsonb_build_object(k, o -> k);
      end if;
    end loop;
  else  -- INSERT : les colonnes SENSIBLES prennent une valeur SÛRE (les autres gardent la valeur fournie)
    for k in select jsonb_object_keys(n) loop
      if k = any(libres) then continue; end if;
      if not (k ~ '^(credits|role|subscription_status|email|coach_payment_type)$'
              or k ~ '^(comp_access|stripe|payout|is_|plan|wallet|balance)') then
        continue;
      end if;
      if k = 'email' then
        forcer := forcer || jsonb_build_object(k, nullif(auth.jwt() ->> 'email', ''));
      elsif k = 'role' then
        forcer := forcer || jsonb_build_object(k, case when admin then 'admin' else 'user' end);
      elsif k = 'subscription_status' then
        forcer := forcer || jsonb_build_object(k, case when admin then 'enterprise'
                                                       when n ->> k in ('free','trial') then n ->> k
                                                       else 'free' end);
      elsif jsonb_typeof(n -> k) = 'number' then
        forcer := forcer || jsonb_build_object(k, 0);
      elsif jsonb_typeof(n -> k) = 'boolean' then
        forcer := forcer || jsonb_build_object(k, false);
      elsif jsonb_typeof(n -> k) <> 'null' then
        forcer := forcer || jsonb_build_object(k, null);
      end if;
    end loop;
  end if;

  if forcer <> '{}'::jsonb then
    raise warning '[S0] colonnes protégées ignorées sur profiles (%): %', tg_op,
      (select string_agg(x, ',') from jsonb_object_keys(forcer) x);
    new := jsonb_populate_record(new, forcer);
  end if;
  return new;
end;
$$;

drop trigger if exists s0_proteger_profil on public.profiles;
create trigger s0_proteger_profil
  before insert or update on public.profiles
  for each row execute function public.s0_proteger_profil();

commit;
