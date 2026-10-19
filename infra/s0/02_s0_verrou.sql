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
  tablename  text not null default 'profiles',
  policyname text not null,
  cmd        text not null,
  permissive text not null,
  roles      text[] not null,
  qual       text,
  with_check text,
  saved_at   timestamptz not null default now(),
  primary key (tablename, policyname)
);
alter table public.s0_sauvegarde_policies enable row level security;   -- aucune policy : service-role seul
revoke all on public.s0_sauvegarde_policies from anon, authenticated;
insert into public.s0_sauvegarde_policies (tablename, policyname, cmd, permissive, roles, qual, with_check)
select tablename, policyname, cmd, permissive, roles::text[], qual, with_check
  from pg_policies
 where schemaname = 'public'
   and (tablename = 'profiles' or (tablename = 'access_requests' and policyname = 'access_requests_host_update'))
   and policyname not like 's0\_%'
on conflict (tablename, policyname) do nothing;

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

-- Création : SEULEMENT son propre profil. Toute autre règle INSERT (ex. « System can insert
-- profiles » WITH CHECK (true) de frontend/supabase-setup.sql) est retirée (sauvegardée ci-dessus).
do $$
declare p record;
begin
  for p in select policyname from pg_policies
            where schemaname = 'public' and tablename = 'profiles' and cmd = 'INSERT'
              and policyname not like 's0\_%'
  loop
    execute format('drop policy %I on public.profiles', p.policyname);
  end loop;
end $$;
drop policy if exists s0_profiles_insert_soi on public.profiles;
create policy s0_profiles_insert_soi on public.profiles for insert to authenticated
  with check (auth.uid() = id);

-- 1b) Valeur par DÉFAUT d'une colonne (catalogue Postgres). Une colonne neutralisée à la création
--     reprend SA valeur par défaut — jamais NULL : plusieurs colonnes sont NOT NULL en production
--     (playlists.mode 'open', playlists.is_private false, profiles.coach_payment_type 'subscription'…).
create or replace function public.s0_defaut(p_table regclass, p_col text)
returns jsonb language plpgsql stable set search_path = public as $$
declare expr text; v jsonb;
begin
  if p_table not in ('public.profiles'::regclass, 'public.playlists'::regclass) then
    raise exception 's0_defaut : table non prise en charge';
  end if;
  select pg_get_expr(d.adbin, d.adrelid) into expr
    from pg_attribute a join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
   where a.attrelid = p_table and a.attname = p_col and not a.attisdropped;
  if expr is null or expr ~* '(nextval|gen_random|uuid_generate)' then
    return 'null'::jsonb;
  end if;
  execute format('select to_jsonb(%s)', expr) into v;
  return coalesce(v, 'null'::jsonb);
end;
$$;
-- Nécessaire aux triggers (SECURITY INVOKER, exécutés sous le rôle de l'utilisateur connecté) ;
-- inutile à un anonyme (aucune écriture anonyme sur ces tables).
revoke all on function public.s0_defaut(regclass, text) from public, anon;
grant execute on function public.s0_defaut(regclass, text) to authenticated, service_role;

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
  else  -- INSERT : LISTE BLANCHE, comme l'UPDATE — toute autre colonne prend sa valeur par DÉFAUT
    for k in select jsonb_object_keys(n) loop
      if k = any(libres) then continue; end if;
      if k = 'email' then
        forcer := forcer || jsonb_build_object(k, nullif(auth.jwt() ->> 'email', ''));
      elsif k = 'role' then
        forcer := forcer || jsonb_build_object(k, case when admin then 'admin' else 'user' end);
      elsif k = 'subscription_status' then
        forcer := forcer || jsonb_build_object(k, case when admin then 'enterprise'
                                                       when n ->> k in ('free','trial') then n ->> k
                                                       else 'free' end);
      elsif (n -> k) is distinct from public.s0_defaut('public.profiles', k) then
        forcer := forcer || jsonb_build_object(k, public.s0_defaut('public.profiles', k));
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

-- 3) playlists : l'AUTORITÉ d'une session ne s'écrit pas depuis le navigateur ----------
--    Avant : `playlists_update` autorise tout compte tant que host_id est NULL → un tiers pouvait
--    s'inscrire hôte d'une session pas encore revendiquée, puis (règle access_requests ci-dessous)
--    approuver sa propre demande d'accès à un Live payant. Le navigateur ne peut plus CHANGER
--    host_id (seul le backend le pose sur une session existante, après débit) ; à la CRÉATION d'une
--    session neuve, host_id = soi-même reste permis (session_id est UNIQUE : impossible pour une
--    session existante). created_at n'est jamais antidaté. Mode, prix, capacité, co-hôtes, fin du
--    Live, option d'enregistrement : backend uniquement (comme aujourd'hui). L'hôte garde : pistes,
--    description, média partagé, is_private, access_mode, promo. Session SANS hôte : contenu seul.
create or replace function public.s0_proteger_playlist()
returns trigger language plpgsql set search_path = public as $$
declare
  -- Écrites par le backend SEULEMENT (même par l'hôte) :
  serveur  text[] := array['host_id','cohosts','mode','price_chf','capacity','live_ended_at','record_enabled','created_at'];
  -- Session SANS hôte (pas encore revendiquée) : la RLS laisse TOUT compte la modifier ; on n'y
  -- accepte alors que du CONTENU, jamais un réglage d'accès, de promo ou de paiement.
  contenu  text[] := array['session_id','tracks','selected_track_id','description','updated_at','id'];
  n jsonb := to_jsonb(new);
  o jsonb;
  forcer jsonb := '{}'::jsonb;
  k text;
  sans_hote boolean;
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    o := to_jsonb(old);
    sans_hote := (o ->> 'host_id') is null;
    for k in select jsonb_object_keys(n) loop
      if (k = any(serveur) or (sans_hote and not (k = any(contenu)))) and (n -> k) is distinct from (o -> k) then
        forcer := forcer || jsonb_build_object(k, o -> k);
      end if;
    end loop;
  else
    -- INSERT : host_id = soi-même ou NULL (RLS) ; created_at = maintenant (jamais antidaté).
    -- ⚠️ Un UPSERT du navigateur (onConflict session_id, SANS host_id) passe d'abord ici : si la
    --    session existe déjà avec un hôte, ce n'est PAS une session sans hôte (la mise à jour qui
    --    suit est contrôlée par la RLS et par la branche UPDATE).
    sans_hote := (n ->> 'host_id') is null
                 and not exists (select 1 from public.playlists p
                                  where p.session_id = new.session_id and p.host_id is not null);
    forcer := jsonb_build_object('created_at', to_jsonb(now()));
    for k in select jsonb_object_keys(n) loop
      if k in ('host_id', 'created_at', 'id', 'session_id') then continue; end if;
      if (k = any(serveur) or (sans_hote and not (k = any(contenu))))
         and (n -> k) is distinct from public.s0_defaut('public.playlists', k) then
        forcer := forcer || jsonb_build_object(k, public.s0_defaut('public.playlists', k));
      end if;
    end loop;
  end if;
  if forcer <> '{}'::jsonb then
    new := jsonb_populate_record(new, forcer);
  end if;
  return new;
end;
$$;
drop trigger if exists s0_proteger_playlist on public.playlists;
create trigger s0_proteger_playlist
  before insert or update on public.playlists
  for each row execute function public.s0_proteger_playlist();

-- 4) access_requests : l'approbation passe par le BACKEND (/session/access-request/{id}/decision,
--    qui vérifie l'hôte de référence). Le navigateur ne l'écrit jamais directement.
do $$
begin
  if to_regclass('public.access_requests') is not null then
    execute 'drop policy if exists access_requests_host_update on public.access_requests';
  end if;
end $$;

commit;
