-- Empreintes de contrôle d'une base BoostTribe / Afroboost Live (lecture seule).
-- Calculées au moment de la sauvegarde (sur la production) puis après restauration (conteneur jetable) :
-- les deux sorties doivent être IDENTIQUES. Aucune donnée personnelle n'apparaît (comptes, sommes, md5).
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
-- Droits sensibles (S0) : une restauration qui perdrait les GRANT/REVOKE rouvrirait les failles.
select 'droits ' || coalesce(string_agg(p.proname || '=' || coalesce(p.proacl::text, 'DEFAUT'), ' ' order by p.proname), '-')
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace
   and p.proname in ('add_credits', 'spend_credits', 'recalc_user_credits', 'wallet_add', 'credits_disponibles');
select 'regles n=' || count(*) || ' md5=' || md5(coalesce(string_agg(tablename || '.' || policyname || ':' || cmd || ':' || roles::text
       || ':' || coalesce(qual, '') || ':' || coalesce(with_check, ''), '|' order by tablename, policyname), ''))
  from pg_policies where schemaname = 'public';
select 'verrous ' || coalesce(string_agg(tgrelid::regclass::text || '.' || tgname, ' ' order by tgname), '-')
  from pg_trigger where not tgisinternal and tgname like 's0\_%';
