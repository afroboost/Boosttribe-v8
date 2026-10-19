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
--
-- Variable psql facultative : -v post_s0=aucun|03|03_04 (scripts : POST_S0_NIVEAU, défaut « aucun »)
--   Migrations post-S0 (infra/post-s0/migrations) : 03 = preuve CGU (2 bases), 04 = session sans hôte
--   (afroboost.com/live seulement ; sans effet sur boosttribe.pro).
--   aucun : contrôles 03 / 04 CONDITIONNELS — faits seulement si un objet de la migration existe dans
--           la base (sinon SANS_OBJET) : une 03 partiellement perdue est vue, une 03 jamais appliquée non ;
--   03    : 03 EXIGÉE en valeur absolue (une restauration qui l'a PERDUE entièrement → MANQUANTE) ;
--   03_04 : 03 et 04 exigées (sur boosttribe.pro, 04 = « playlists_update sans hôte vide », déjà vrai).
--   Valeur inconnue → ligne MANQUANTE (niveau.post_s0.valide).
\pset footer off
\pset tuples_only on
-- Post-S0 : chemin de recherche FIXE. pg_policies réécrit les expressions selon le search_path de la
-- session : en supabase_admin (search_path « $user, public, auth, extensions ») « auth.uid() » devient
-- « uid() », et les règles S0 pourtant présentes étaient déclarées MANQUANTES (constaté en prod le 19/10).
set search_path = public, extensions;
\if :{?post_s0}
\else
\set post_s0 aucun
\endif

with niveau as (select :'niveau'::text as n, :'post_s0'::text as ps),
fn(id, sig) as (values
  ('wallet_add',          'public.wallet_add(uuid,numeric,text,text,boolean)'),
  ('recalc_user_credits', 'public.recalc_user_credits(uuid)'),
  ('add_credits',         'public.add_credits(uuid,integer,text,text,text,timestamp with time zone)'),
  ('spend_credits',       'public.spend_credits(uuid,integer,text,text,text)'),
  ('credits_disponibles', 'public.credits_disponibles(uuid)')),
f as (select fn.id, fn.sig, p.oid, p.prosecdef, p.proconfig, p.proowner
        from fn left join pg_proc p on p.oid = to_regprocedure(fn.sig)),
pol as (select * from pg_policies where schemaname = 'public'),
trg as (select c.relname, t.tgname, t.tgenabled, t.tgfoid, t.tgtype, t.tgattr::text tgattr, c.relowner
          from pg_trigger t join pg_class c on c.oid = t.tgrelid
         where c.relnamespace = 'public'::regnamespace and not t.tgisinternal),
-- ── Post-S0 03 / 04 : présence (pour les contrôles conditionnels) et niveau exigé ──────────────
cgu as (select p.oid, p.prosecdef, p.proconfig, p.proowner
          from pg_proc p where p.oid = to_regprocedure('public.accepter_cgu(text)')),
ps as (select
         niveau.ps in ('03', '03_04') as exige03,
         niveau.ps = '03_04' as exige04,
         (to_regprocedure('public.accepter_cgu(text)') is not null
          or to_regprocedure('public.s0_proteger_profil_cgu()') is not null
          or exists (select 1 from pg_attribute where attrelid = to_regclass('public.profiles')
                        and attname in ('terms_accepted_at', 'terms_version') and not attisdropped)
          or exists (select 1 from pg_constraint where conrelid = to_regclass('public.profiles')
                        and conname = 'profiles_cgu_preuve_coherente')) as present03,
         to_regclass('public.ps0_04_sauvegarde_policy') is not null as present04,
         (select relowner from pg_class where oid = to_regclass('public.profiles')) as proprio_profiles
       from niveau),
pl_upd as (select regexp_replace(coalesce(qual, ''), '\s+', '', 'g') q, regexp_replace(coalesce(with_check, ''), '\s+', '', 'g') w,
                  roles::text roles, cmd, permissive
             from pg_policies where schemaname = 'public' and tablename = 'playlists' and policyname = 'playlists_update'),
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
  -- ── Post-S0 03 : preuve CGU (exigée si post_s0 ∈ {03, 03_04}, sinon seulement si un objet 03 existe) ──
  union all
  select 'niveau.post_s0.valide', 'etape1', true,
         (select ps in ('aucun', '03', '03_04') from niveau),
         'niveau post-S0 demandé connu (aucun | 03 | 03_04)'
  union all
  select 'cgu.accepter_cgu.fermee', 'etape1', ps.exige03 or ps.present03,
         exists (select 1 from cgu where not has_function_privilege('public', cgu.oid, 'EXECUTE')
                                     and not has_function_privilege('anon', cgu.oid, 'EXECUTE')),
         'accepter_cgu(text) : aucun EXECUTE pour PUBLIC / anon' from ps
  union all
  select 'cgu.accepter_cgu.authenticated', 'etape1', ps.exige03 or ps.present03,
         exists (select 1 from cgu where has_function_privilege('authenticated', cgu.oid, 'EXECUTE')),
         'accepter_cgu(text) : EXECUTE pour authenticated (le navigateur connecté)' from ps
  union all
  select 'cgu.accepter_cgu.definer', 'etape1', ps.exige03 or ps.present03,
         exists (select 1 from cgu where cgu.prosecdef),
         'accepter_cgu(text) : SECURITY DEFINER' from ps
  union all
  select 'cgu.accepter_cgu.search_path', 'etape1', ps.exige03 or ps.present03,
         exists (select 1 from cgu where exists (select 1 from unnest(cgu.proconfig) c where c like 'search_path=%')),
         'accepter_cgu(text) : search_path figé' from ps
  union all
  select 'cgu.accepter_cgu.proprio', 'etape1', ps.exige03 or ps.present03,
         exists (select 1 from cgu where cgu.proowner = ps.proprio_profiles),
         'accepter_cgu(text) : même propriétaire que la table profiles' from ps
  union all
  select 'cgu.colonnes', 'etape1', ps.exige03 or ps.present03,
         (select count(*) = 2 from pg_attribute where attrelid = to_regclass('public.profiles') and not attisdropped
             and ((attname = 'terms_accepted_at' and atttypid = 'timestamptz'::regtype)
               or (attname = 'terms_version' and atttypid = 'text'::regtype))),
         'profiles : colonnes terms_accepted_at (timestamptz) et terms_version (text)' from ps
  union all
  select 'cgu.verrou', 'etape1', ps.exige03 or ps.present03,
         exists (select 1 from trg join pg_proc p on p.oid = trg.tgfoid
                  where relname = 'profiles' and tgname = 's0_proteger_profil_cgu' and tgenabled in ('O', 'A')
                    and p.proname = 's0_proteger_profil_cgu' and not p.prosecdef
                    -- BEFORE (2) ROW (1) INSERT (4) UPDATE (16), sans liste de colonnes : toute écriture passe
                    and trg.tgtype & 23 = 23 and trg.tgattr = ''),
         'profiles : déclencheur s0_proteger_profil_cgu actif, BEFORE INSERT OR UPDATE par ligne (fonction SECURITY INVOKER)' from ps
  union all
  -- Colonnes non modifiables directement : la protection est le corps du déclencheur (les droits de
  -- colonne ne l'expriment pas) ; on vérifie qu'il rétablit les deux colonnes pour anon / authenticated.
  select 'cgu.colonnes.non_modifiables', 'etape1', ps.exige03 or ps.present03,
         coalesce((select regexp_replace(p.prosrc, '\s+', '', 'g') like '%current_usernotin(''anon'',''authenticated'')%'
                      and regexp_replace(p.prosrc, '\s+', '', 'g') like '%new.terms_accepted_at:=old.terms_accepted_at;%'
                      and regexp_replace(p.prosrc, '\s+', '', 'g') like '%new.terms_version:=old.terms_version;%'
                      and regexp_replace(p.prosrc, '\s+', '', 'g') like '%new.terms_accepted_at:=null;new.terms_version:=null;%'
                     from pg_proc p where p.oid = to_regprocedure('public.s0_proteger_profil_cgu()')), false),
         'profiles : terms_accepted_at / terms_version jamais écrits par anon / authenticated (corps du déclencheur)' from ps
  union all
  select 'cgu.contrainte', 'etape1', ps.exige03 or ps.present03,
         exists (select 1 from pg_constraint where conrelid = to_regclass('public.profiles')
                    and conname = 'profiles_cgu_preuve_coherente' and contype = 'c' and convalidated
                    and regexp_replace(pg_get_constraintdef(oid), '\s+', '', 'g')
                        = 'CHECK(((terms_accepted_atISNULL)OR(terms_acceptedISTRUE)))'),
         'profiles : contrainte profiles_cgu_preuve_coherente (pas de date sans acceptation), validée' from ps
  union all
  select 'cgu.sauvegarde_rollback.fermee', 'etape1', to_regclass('public.s0c_cgu_preuve_sauvegarde') is not null,
         coalesce((select c.relrowsecurity
                          and not has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE')
                          and not has_table_privilege('authenticated', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE')
                     from pg_class c where c.oid = to_regclass('public.s0c_cgu_preuve_sauvegarde')), false),
         's0c_cgu_preuve_sauvegarde (laissée par le rollback 03) : RLS activée, fermée à anon / authenticated'
  -- ── Post-S0 04 : session sans hôte (exigée si post_s0 = 03_04, sinon seulement si 04 a été appliquée) ──
  union all
  select 'regle.playlists.sans_hote_vide', 'etape1', ps.exige04 or ps.present04,
         to_regclass('public.playlists') is not null
         and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'playlists'
                            and cmd in ('UPDATE', 'ALL')
                            and (coalesce(qual, '') ilike '%host_id IS NULL%' or coalesce(with_check, '') ilike '%host_id IS NULL%'))
         and (select count(*) = 1 from pg_policies where schemaname = 'public' and tablename = 'playlists' and cmd in ('UPDATE', 'ALL'))
         and exists (select 1 from pl_upd where cmd = 'UPDATE' and permissive = 'PERMISSIVE' and (
               -- forme posée par 04 (afroboost.com/live)
               (q = '(((host_id)::text=(auth.uid())::text)OR(COALESCE(cohosts,''[]''::jsonb)@>to_jsonb((auth.uid())::text)))'
                and w = q and roles = '{authenticated}')
               -- forme d'origine de boosttribe.pro (jamais eu « hôte vide », 04 sans effet)
            or (q = '(((host_id)::text=(auth.uid())::text)OR(cohosts@>to_jsonb((auth.uid())::text)))'
                and w = q and roles = '{public}'))),
         'playlists : playlists_update = hôte ou co-hôte seulement (aucun « host_id IS NULL »), seule règle UPDATE' from ps
  union all
  select 'table.ps0_04_sauvegarde_policy.fermee', 'etape1', ps.present04,
         coalesce((select c.relrowsecurity
                          and not has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE')
                          and not has_table_privilege('authenticated', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE')
                     from pg_class c where c.oid = to_regclass('public.ps0_04_sauvegarde_policy')), false),
         'ps0_04_sauvegarde_policy (règle d''origine sauvegardée par 04) : RLS activée, fermée à anon / authenticated' from ps
)
select 'PROTECTION ' || c.id || ' '
       || case when niveau.n = 'aucun' or (c.requis = 'complet' and niveau.n <> 'complet') then 'NON_EXIGEE'
               when not c.applicable then 'SANS_OBJET'
               when coalesce(c.ok, false) then 'OK'
               else 'MANQUANTE' end
       || ' — ' || c.libelle
  from controles c, niveau
 order by c.id collate "C";
