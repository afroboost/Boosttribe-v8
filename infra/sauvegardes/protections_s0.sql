-- Protections S0 CRITIQUES, vérifiées une à une EN VALEUR ABSOLUE (lecture seule).
-- Complète empreintes.sql : la comparaison d'empreintes dit « restauré = sauvegardé » ; ce fichier dit
-- « ce qui est restauré est PROTÉGÉ ». Il attrape donc aussi une sauvegarde prise sur une production
-- qui avait DÉJÀ perdu une protection (empreintes identiques des deux côtés, mais faille présente).
--
-- Variable psql obligatoire : -v niveau=complet|etape1|aucun
--   complet : 00 + 01 + 02 appliqués (état des 2 bases depuis le 19/10/2026) — valeur par défaut des scripts ;
--   etape1  : 00 + 01 seulement ; aucun : rien n'est exigé (lignes NON_EXIGEE).
-- Sortie : une ligne par protection, triée : « PROTECTION <id> OK|MANQUANTE|SANS_OBJET|NON_EXIGEE — <libellé> ».
-- Toute ligne MANQUANTE fait échouer le test de restauration (et signale une alerte à la sauvegarde).
\pset footer off
\pset tuples_only on

with niveau as (select :'niveau'::text as n),
fn(id, sig) as (values
  ('wallet_add',          'public.wallet_add(uuid,numeric,text,text,boolean)'),
  ('recalc_user_credits', 'public.recalc_user_credits(uuid)'),
  ('add_credits',         'public.add_credits(uuid,integer,text,text,text,timestamp with time zone)'),
  ('spend_credits',       'public.spend_credits(uuid,integer,text,text,text)'),
  ('credits_disponibles', 'public.credits_disponibles(uuid)')),
f as (select fn.id, fn.sig, p.oid, p.prosecdef, p.proconfig, p.proowner
        from fn left join pg_proc p on p.oid = to_regprocedure(fn.sig)),
pol as (select * from pg_policies where schemaname = 'public'),
trg as (select c.relname, t.tgname, t.tgenabled, t.tgfoid
          from pg_trigger t join pg_class c on c.oid = t.tgrelid
         where c.relnamespace = 'public'::regnamespace and not t.tgisinternal),
controles(id, requis, applicable, ok, libelle) as (
  -- ── Fonctions de crédit / portefeuille : jamais appelables par un visiteur ou un compte ─────────
  select 'fn.' || id || '.fermee', 'etape1', true,
         oid is not null and not has_function_privilege('anon', oid, 'EXECUTE')
                         and not has_function_privilege('authenticated', oid, 'EXECUTE'),
         sig || ' : aucun EXECUTE pour PUBLIC / anon / authenticated' from f
  union all
  select 'fn.' || id || '.service_role', 'etape1', true,
         oid is not null and has_function_privilege('service_role', oid, 'EXECUTE'),
         sig || ' : EXECUTE pour service_role (le backend)' from f
  union all
  select 'fn.' || id || '.definer', 'etape1', true, coalesce(prosecdef, false),
         sig || ' : SECURITY DEFINER' from f
  union all
  select 'fn.' || id || '.search_path', 'etape1', true,
         coalesce(exists (select 1 from unnest(proconfig) c where c like 'search_path=%'), false),
         sig || ' : search_path figé' from f
  union all
  select 'fn.credits_disponibles.proprio', 'etape1', true,
         (select a.proowner = b.proowner from f a, f b where a.id = 'credits_disponibles' and b.id = 'spend_credits'),
         'credits_disponibles a le même propriétaire que spend_credits'
  -- ── Grand livre ──────────────────────────────────────────────────────────────────────────────
  union all
  select 'table.credit_ledger.rls', 'etape1', true,
         coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.credit_ledger')), false),
         'credit_ledger : RLS activée'
  union all
  select 'table.credit_ledger.ecriture', 'etape1', true,
         to_regclass('public.credit_ledger') is not null and not exists (
           select 1 from pol where tablename = 'credit_ledger' and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
              and roles && array['public', 'anon', 'authenticated']::name[]),
         'credit_ledger : aucune règle d''écriture pour public / anon / authenticated'
  union all
  select 'table.credit_ledger.declencheur', 'etape1', true,
         exists (select 1 from trg where relname = 'credit_ledger' and tgname = 'trg_credit_ledger_change'
                    and tgenabled in ('O', 'A')),
         'credit_ledger : déclencheur trg_credit_ledger_change actif'
  -- ── Profils ──────────────────────────────────────────────────────────────────────────────────
  union all
  select 'table.profiles.rls', 'etape1', true,
         coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.profiles')), false),
         'profiles : RLS activée'
  union all
  select 'table.playlists.rls', 'etape1', true,
         coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.playlists')), false),
         'playlists : RLS activée'
  union all
  select 'vue.profiles_public.colonnes', 'etape1', true,
         coalesce((select string_agg(attname, ',' order by attnum) = 'id,full_name,avatar_url'
                     from pg_attribute where attrelid = to_regclass('public.profiles_public')
                      and attnum > 0 and not attisdropped)
                  and (select relkind from pg_class where oid = to_regclass('public.profiles_public')) = 'v', false),
         'profiles_public : vue limitée à id, full_name, avatar_url'
  union all
  select 'vue.profiles_public.lecture_seule', 'etape1', true,
         to_regclass('public.profiles_public') is not null and not (
              has_table_privilege('anon', 'public.profiles_public', 'INSERT, UPDATE, DELETE, TRUNCATE')
           or has_table_privilege('authenticated', 'public.profiles_public', 'INSERT, UPDATE, DELETE, TRUNCATE')),
         'profiles_public : aucune écriture pour anon / authenticated'
  -- ── Étape 2 (verrou) ─────────────────────────────────────────────────────────────────────────
  union all
  select 'regle.profiles.lecture_soi', 'complet', true,
         exists (select 1 from pol where tablename = 'profiles' and policyname = 's0_profiles_select_soi'
                    and cmd = 'SELECT' and permissive = 'PERMISSIVE' and roles = array['authenticated']::name[]
                    and qual = '(auth.uid() = id)'),
         'profiles : lecture de SA ligne seulement (s0_profiles_select_soi)'
  union all
  select 'regle.profiles.ecriture_soi', 'complet', true,
         exists (select 1 from pol where tablename = 'profiles' and policyname = 's0_profiles_update_soi'
                    and cmd = 'UPDATE' and roles = array['authenticated']::name[]
                    and qual = '(auth.uid() = id)' and with_check = '(auth.uid() = id)'),
         'profiles : modification de SA ligne seulement (s0_profiles_update_soi)'
  union all
  select 'regle.profiles.creation_soi', 'complet', true,
         exists (select 1 from pol where tablename = 'profiles' and policyname = 's0_profiles_insert_soi'
                    and cmd = 'INSERT' and roles = array['authenticated']::name[]
                    and with_check = '(auth.uid() = id)'),
         'profiles : création de SON profil seulement (s0_profiles_insert_soi)'
  union all
  select 'regle.profiles.aucune_autre', 'complet', true,
         to_regclass('public.profiles') is not null and not exists (
           select 1 from pol where tablename = 'profiles' and permissive = 'PERMISSIVE'
              and cmd in ('SELECT', 'UPDATE', 'INSERT', 'ALL') and policyname not like 's0\_%'),
         'profiles : aucune autre règle permissive de lecture / écriture'
  union all
  select 'verrou.profiles', 'complet', true,
         exists (select 1 from trg join pg_proc p on p.oid = trg.tgfoid
                  where relname = 'profiles' and tgname = 's0_proteger_profil' and tgenabled in ('O', 'A')
                    and p.proname = 's0_proteger_profil' and not p.prosecdef),
         'profiles : verrou s0_proteger_profil actif (fonction SECURITY INVOKER)'
  union all
  select 'verrou.playlists', 'complet', true,
         exists (select 1 from trg join pg_proc p on p.oid = trg.tgfoid
                  where relname = 'playlists' and tgname = 's0_proteger_playlist' and tgenabled in ('O', 'A')
                    and p.proname = 's0_proteger_playlist' and not p.prosecdef),
         'playlists : verrou s0_proteger_playlist actif (fonction SECURITY INVOKER)'
  union all
  select 'fn.s0_defaut.droits', 'complet', true,
         coalesce((select not has_function_privilege('anon', p.oid, 'EXECUTE') and not p.prosecdef
                     from pg_proc p where p.oid = to_regprocedure('public.s0_defaut(regclass,text)')), false),
         's0_defaut : SECURITY INVOKER, aucun EXECUTE pour anon'
  union all
  select 'table.s0_sauvegarde_policies.fermee', 'complet', true,
         coalesce((select c.relrowsecurity
                          and not has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE')
                          and not has_table_privilege('authenticated', c.oid, 'SELECT, INSERT, UPDATE, DELETE')
                     from pg_class c where c.oid = to_regclass('public.s0_sauvegarde_policies')), false),
         's0_sauvegarde_policies : RLS activée, fermée à anon / authenticated'
  union all
  select 'regle.access_requests.approbation_backend', 'complet', to_regclass('public.access_requests') is not null,
         not exists (select 1 from pol where tablename = 'access_requests' and policyname = 'access_requests_host_update'),
         'access_requests : approbation par le backend seulement (access_requests_host_update absente)'
)
select 'PROTECTION ' || c.id || ' '
       || case when niveau.n = 'aucun' or (c.requis = 'complet' and niveau.n <> 'complet') then 'NON_EXIGEE'
               when not c.applicable then 'SANS_OBJET'
               when coalesce(c.ok, false) then 'OK'
               else 'MANQUANTE' end
       || ' — ' || c.libelle
  from controles c, niveau
 order by c.id collate "C";
