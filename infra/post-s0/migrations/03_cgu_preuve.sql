-- ============================================================================
-- POST-S0 — 03 : PREUVE DATÉE ET VERSIONNÉE DE L'ACCEPTATION DES CGU (profiles).
-- Sur LES DEUX bases (boosttribe.pro, afroboost.com/live). Idempotent. Transactionnel.
-- ⚠️ PRÉPARÉE, NON APPLIQUÉE. Testée au banc : infra/post-s0/banc_profils.sh
--    (états « 01 seul » ET « 01 + 02 », schémas bt ET live).
--
-- AVANT : seule la colonne booléenne `terms_accepted` existe ; aucune date, aucune version
--   (seul updated_at bouge, et il bouge pour n'importe quelle modification). L'inscription
--   n'enregistrait jamais le consentement ; acceptTerms pouvait annoncer un faux succès
--   (UPDATE sur une ligne profiles absente = 0 ligne, pas d'erreur).
-- APRÈS :
--   1. Colonnes `terms_accepted_at timestamptz` et `terms_version text` — posées CÔTÉ SERVEUR
--      uniquement. AUCUN remplissage rétroactif : les comptes existants restent sans preuve
--      (ils seront sollicités une fois).
--   2. Fonction `accepter_cgu(p_version)` SECURITY DEFINER : l'appelant = auth.uid() seulement ;
--      crée la ligne profiles si elle manque ; date = now() du SERVEUR (jamais antidatée) ;
--      version validée (AAAA-MM-JJ, jamais dans le futur, jamais en recul). Ré-accepter la même
--      version garde la date d'origine (idempotent).
--   3. Trigger `s0_proteger_profil_cgu` (après le trigger S0 02 s'il existe : ordre alphabétique) :
--      pour anon / authenticated (écriture directe du navigateur), terms_accepted_at et
--      terms_version ne s'écrivent JAMAIS à la main ; terms_accepted ne repasse jamais de true à
--      false ; un passage direct à true (ancien front) est daté par le serveur, version NULLE
--      (= « version non précisée », redemandée par le nouveau front).
--      Fonctionne SANS 02 (état « 01 seul », RLS d'origine) comme AVEC 02 (liste blanche) :
--      02 neutralise déjà les deux colonnes (hors liste blanche) ; ce trigger ne fait que dater.
-- Backend (service_role), propriétaire, fonctions SECURITY DEFINER : libres (comme S0).
-- Rollback : 03_cgu_preuve_rollback.sql (les preuves sont SAUVEGARDÉES avant retrait).
-- ============================================================================
begin;

-- 1) Colonnes (aucune valeur par défaut, aucun remplissage) -----------------------
alter table public.profiles add column if not exists terms_accepted_at timestamptz;
alter table public.profiles add column if not exists terms_version text;

-- Une date d'acceptation n'existe pas sans acceptation.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_cgu_preuve_coherente'
                  and conrelid = 'public.profiles'::regclass) then
    alter table public.profiles add constraint profiles_cgu_preuve_coherente
      check (terms_accepted_at is null or terms_accepted is true);
  end if;
end $$;

-- 2) Écriture directe du navigateur : jamais de preuve fabriquée ------------------
create or replace function public.s0_proteger_profil_cgu()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;                                   -- backend, propriétaire, SECURITY DEFINER
  end if;
  if tg_op = 'INSERT' then
    new.terms_accepted_at := null;
    new.terms_version := null;
    if new.terms_accepted is true then
      new.terms_accepted_at := now();             -- date SERVEUR, version non précisée
    end if;
  else
    new.terms_accepted_at := old.terms_accepted_at;
    new.terms_version := old.terms_version;
    if old.terms_accepted is true and new.terms_accepted is distinct from true then
      new.terms_accepted := true;                 -- jamais de retour à false
    end if;
    if new.terms_accepted is true and old.terms_accepted is distinct from true then
      new.terms_accepted_at := now();
      new.terms_version := null;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists s0_proteger_profil_cgu on public.profiles;
create trigger s0_proteger_profil_cgu
  before insert or update on public.profiles
  for each row execute function public.s0_proteger_profil_cgu();

-- 3) Acceptation officielle : fonction serveur ------------------------------------
create or replace function public.accepter_cgu(p_version text)
returns table (accepte boolean, accepte_le timestamptz, version text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid   uuid := auth.uid();
  v     text := btrim(coalesce(p_version, ''));
  d     date;
  mail  text;
  meta  jsonb := coalesce(auth.jwt() -> 'user_metadata', '{}'::jsonb);
  prec  record;
begin
  if uid is null then
    raise exception 'accepter_cgu : connexion requise' using errcode = '42501';
  end if;
  if v !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception 'accepter_cgu : version invalide' using errcode = '22023';
  end if;
  begin
    d := v::date;
  exception when others then
    raise exception 'accepter_cgu : version invalide' using errcode = '22023';
  end;
  if d > current_date + 1 then                    -- une version de CGU n'est jamais dans le futur
    raise exception 'accepter_cgu : version invalide' using errcode = '22023';
  end if;
  select u.email into mail from auth.users u where u.id = uid;
  if not found then
    raise exception 'accepter_cgu : compte introuvable' using errcode = '42501';
  end if;

  select p.terms_accepted, p.terms_accepted_at, p.terms_version into prec
    from public.profiles p where p.id = uid for update;
  if not found then
    -- subscription_status = 'none' (aucun abonnement) : jamais 'trial' (= « a déjà eu un abonnement »
    -- pour le backend, _has_prior_subscription → essai refusé), jamais 'free' (le front le compte
    -- comme un plan). Toutes les autres colonnes : valeur par DÉFAUT de la base.
    insert into public.profiles (id, email, full_name, avatar_url, subscription_status, terms_accepted, terms_accepted_at, terms_version)
    values (uid, mail,
            coalesce(nullif(meta ->> 'full_name', ''), nullif(meta ->> 'name', ''), split_part(coalesce(mail, ''), '@', 1)),
            coalesce(nullif(meta ->> 'avatar_url', ''), nullif(meta ->> 'picture', ''), ''),
            'none', true, now(), v)
    on conflict (id) do nothing;
    if found then                                 -- ligne créée avec la preuve : terminé
      return query
        select p.terms_accepted, p.terms_accepted_at, p.terms_version from public.profiles p where p.id = uid;
      return;
    end if;
    select p.terms_accepted, p.terms_accepted_at, p.terms_version into prec   -- course : ligne apparue
      from public.profiles p where p.id = uid for update;
  end if;

  if prec.terms_accepted is true and prec.terms_accepted_at is not null and prec.terms_version = v then
    null;                                         -- déjà acceptée, même version : date d'origine gardée
  elsif prec.terms_version is not null and prec.terms_version > v then
    null;                                         -- jamais de recul de version
  else
    update public.profiles p
       set terms_accepted = true, terms_accepted_at = now(), terms_version = v, updated_at = now()
     where p.id = uid;
  end if;

  return query
    select p.terms_accepted, p.terms_accepted_at, p.terms_version from public.profiles p where p.id = uid;
end;
$$;
-- Même propriétaire que la table (supabase_admin sur boosttribe.pro, postgres sur /live) : le
-- propriétaire de la table n'est pas soumis à la RLS, et les triggers S0 le laissent libre.
do $$
declare proprio text;
begin
  select pg_get_userbyid(relowner) into proprio from pg_class where oid = 'public.profiles'::regclass;
  execute format('alter function public.accepter_cgu(text) owner to %I', proprio);
  execute format('alter function public.s0_proteger_profil_cgu() owner to %I', proprio);
end $$;
revoke all on function public.accepter_cgu(text) from public, anon;
grant execute on function public.accepter_cgu(text) to authenticated, service_role;

commit;
