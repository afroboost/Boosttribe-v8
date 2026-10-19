-- Empreintes de contrôle d'une base BoostTribe / Afroboost Live (LECTURE SEULE).
-- Calculées au moment de la sauvegarde (sur la production) puis après restauration (conteneur jetable) :
-- les deux sorties doivent être IDENTIQUES, ligne à ligne. Aucune donnée personnelle n'apparaît
-- (comptes, sommes, md5) ; aucun mot de passe (pg_roles, jamais pg_authid).
--
-- Post-S0 (sauvegardes v2) : en plus des données, chaque protection d'accès est relevée OBJET PAR OBJET,
-- pour que la perte de N'IMPORTE LAQUELLE soit vue par le test de restauration :
--   rel      tables / vues / séquences des schémas public (et storage.buckets / storage.objects) :
--            type, PROPRIÉTAIRE (nom), RLS activée, RLS FORCÉE, droits (relacl normalisés : acldefault
--            si NULL, éléments triés), définition des vues (md5) et options (security_invoker…) ;
--   col      droits par colonne (attacl) ;
--   fn       fonctions de public : propriétaire, SECURITY DEFINER, volatilité, réglages (search_path…),
--            droits (proacl normalisés), md5 du corps et du type de retour ;
--   regle    politiques RLS complètes (permissive/restrictive, commande, rôles triés, USING, WITH CHECK)
--            des schémas public et storage ;
--   verrou   déclencheurs (public, auth, storage) : table, nom, ÉTAT (tgenabled O/D/R/A), md5 de la définition ;
--   schema   propriétaire + droits des schémas public / auth / storage ;
--   role     rôles d'accès Supabase (attributs, sans mot de passe) + appartenances ;
--   defaut   droits par défaut (pg_default_acl) des schémas surveillés.
-- Tri déterministe partout (collation "C"). Les protections S0 CRITIQUES sont en plus vérifiées une à
-- une, en valeur absolue, par protections_s0.sql.
\pset footer off
\pset tuples_only on

-- ── Données ─────────────────────────────────────────────────────────────────────────────────────
select 'profils n=' || count(*) || ' credits=' || coalesce(sum(credits), 0)
       || ' md5=' || md5(coalesce(string_agg(to_jsonb(p)::text, '|' order by p.id), ''))
  from public.profiles p;
select 'grand_livre n=' || count(*) || ' somme=' || coalesce(sum(delta), 0)
       || ' md5=' || md5(coalesce(string_agg(to_jsonb(l)::text, '|' order by l.id), ''))
  from public.credit_ledger l;
select 'sessions n=' || count(*) || ' md5=' || md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.session_id), ''))
  from public.playlists x;
select 'comptes n=' || count(*) || ' md5=' || md5(coalesce(string_agg(u.id::text, '|' order by u.id), ''))
  from auth.users u;

-- Fichiers (Supabase Storage) : les LIGNES de storage.objects. Les fichiers eux-mêmes sont dans
-- <base>-stockage.tar, vérifiés à part par le test de restauration (manifeste + cohérence).
select to_regclass('storage.objects') is not null as a_stockage \gset
\if :a_stockage
select 'stockage_seaux n=' || count(*) || ' md5=' || md5(coalesce(string_agg(
         b.id || ':' || coalesce(b.public::text, ''), '|' order by b.id collate "C"), ''))
  from storage.buckets b;
select 'stockage_objets n=' || count(*) || ' md5=' || md5(coalesce(string_agg(
         o.bucket_id || '/' || o.name || ':' || coalesce(o.metadata ->> 'size', ''), '|'
         order by o.bucket_id collate "C", o.name collate "C"), ''))
  from storage.objects o;
\else
select 'stockage absent';
\endif

-- ── Relations ───────────────────────────────────────────────────────────────────────────────────
select 'rel ' || n.nspname || '.' || c.relname
       || ' type=' || c.relkind::text
       || ' proprio=' || pg_get_userbyid(c.relowner)
       || ' rls=' || c.relrowsecurity
       || ' force=' || c.relforcerowsecurity
       || ' droits=' || coalesce((select string_agg(a::text, ',' order by a::text collate "C")
                                    from unnest(coalesce(c.relacl,
                                         acldefault(case when c.relkind = 'S' then 's'::"char" else 'r'::"char" end, c.relowner))) a), '-')
       || case when c.relkind in ('v', 'm') then ' def=' || md5(pg_get_viewdef(c.oid, true))
                 || ' options=' || coalesce(array_to_string(c.reloptions, ';'), '-') else '' end
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
   and (n.nspname = 'public' or (n.nspname = 'storage' and c.relname in ('buckets', 'objects')))
 order by n.nspname collate "C", c.relname collate "C";

select 'col ' || n.nspname || '.' || c.relname || '.' || a.attname
       || ' droits=' || (select string_agg(x::text, ',' order by x::text collate "C") from unnest(a.attacl) x)
  from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
 where a.attacl is not null and not a.attisdropped and a.attnum > 0
   and (n.nspname = 'public' or (n.nspname = 'storage' and c.relname in ('buckets', 'objects')))
 order by n.nspname collate "C", c.relname collate "C", a.attname collate "C";

-- ── Fonctions de public ─────────────────────────────────────────────────────────────────────────
select 'fn ' || p.oid::regprocedure::text
       || ' proprio=' || pg_get_userbyid(p.proowner)
       || ' definer=' || p.prosecdef
       || ' volatil=' || p.provolatile::text
       || ' config=' || coalesce((select string_agg(x, ';' order by x collate "C") from unnest(p.proconfig) x), '-')
       || ' droits=' || coalesce((select string_agg(a::text, ',' order by a::text collate "C")
                                    from unnest(coalesce(p.proacl, acldefault('f', p.proowner))) a), '-')
       || ' corps=' || md5(coalesce(p.prosrc, '') || '|' || pg_get_function_result(p.oid))
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace
 order by p.oid::regprocedure::text collate "C";

-- ── Politiques RLS ──────────────────────────────────────────────────────────────────────────────
select 'regle ' || schemaname || '.' || tablename || '.' || policyname
       || ' ' || permissive || ' ' || cmd
       || ' roles=' || (select string_agg(r, ',' order by r collate "C") from unnest(roles) r)
       || ' using=' || coalesce(regexp_replace(qual, '\s+', ' ', 'g'), '-')
       || ' check=' || coalesce(regexp_replace(with_check, '\s+', ' ', 'g'), '-')
  from pg_policies
 where schemaname in ('public', 'storage')
 order by schemaname collate "C", tablename collate "C", policyname collate "C";

-- ── Déclencheurs (verrous S0 compris) : l'ÉTAT compte (D = désactivé) ───────────────────────────
select 'verrou ' || n.nspname || '.' || c.relname || '.' || t.tgname
       || ' etat=' || t.tgenabled::text
       || ' def=' || md5(pg_get_triggerdef(t.oid))
  from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
 where not t.tgisinternal and n.nspname in ('public', 'auth', 'storage')
 order by n.nspname collate "C", c.relname collate "C", t.tgname collate "C";

-- ── Schémas ─────────────────────────────────────────────────────────────────────────────────────
select 'schema ' || n.nspname || ' proprio=' || pg_get_userbyid(n.nspowner)
       || ' droits=' || coalesce((select string_agg(a::text, ',' order by a::text collate "C")
                                    from unnest(coalesce(n.nspacl, acldefault('n', n.nspowner))) a), '-')
  from pg_namespace n
 where n.nspname in ('public', 'auth', 'storage')
 order by n.nspname collate "C";

-- ── Rôles d'accès Supabase (attributs seulement, JAMAIS de mot de passe) ────────────────────────
select 'role ' || r.rolname
       || ' super=' || r.rolsuper || ' herite=' || r.rolinherit || ' creerole=' || r.rolcreaterole
       || ' creerbase=' || r.rolcreatedb || ' connexion=' || r.rolcanlogin
       || ' replication=' || r.rolreplication || ' bypassrls=' || r.rolbypassrls
       || ' membre_de=' || coalesce((select string_agg(distinct g.rolname, ',' order by g.rolname)
                                       from pg_auth_members m join pg_roles g on g.oid = m.roleid
                                      where m.member = r.oid), '-')
  from pg_roles r
 where r.rolname in ('anon', 'authenticated', 'service_role', 'authenticator', 'postgres',
                     'supabase_admin', 'supabase_auth_admin', 'supabase_storage_admin')
 order by r.rolname collate "C";

-- ── Droits par défaut (objets FUTURS) ───────────────────────────────────────────────────────────
select 'defaut ' || pg_get_userbyid(d.defaclrole)
       || ' schema=' || coalesce(n.nspname, '*')
       || ' type=' || d.defaclobjtype::text
       || ' droits=' || (select string_agg(a::text, ',' order by a::text collate "C") from unnest(d.defaclacl) a)
  from pg_default_acl d left join pg_namespace n on n.oid = d.defaclnamespace
 where n.nspname is null or n.nspname in ('public', 'storage')
 order by pg_get_userbyid(d.defaclrole) collate "C", coalesce(n.nspname, '*') collate "C", d.defaclobjtype;
