-- ============================================================================
-- Post-S0 — ROLLBACK de 04 : recrée À L'IDENTIQUE la règle playlists_update d'avant 04 (sauvegardée par
-- 04 dans public.ps0_04_sauvegarde_policy), dans l'état 01 seul comme dans l'état 01 + 02 (02 ne touche
-- pas aux règles de playlists : la règle d'origine est la même dans les deux états).
-- ⚠️ Rétablit la faille (session sans hôte modifiable par tout compte connecté sur /live) : à n'utiliser
--    qu'en cas de régression prouvée.
-- Idempotent : sans sauvegarde (base où 04 était sans effet — boosttribe.pro — ou rollback déjà fait),
-- il ne fait RIEN. S'arrête si la règle actuelle n'est plus celle posée par 04 (jamais d'écrasement aveugle).
-- Exécution : psql -U supabase_admin -v ON_ERROR_STOP=1 -f 04_session_sans_hote_rollback.sql
-- ============================================================================
begin;

do $$
declare
  s record;
  p record;
  roles_sql text;
  apres_04 constant text := '(((host_id)::text=(auth.uid())::text)OR(COALESCE(cohosts,''[]''::jsonb)@>to_jsonb((auth.uid())::text)))';
begin
  if to_regclass('public.ps0_04_sauvegarde_policy') is null then
    raise notice 'Post-S0 04 rollback : aucune sauvegarde — 04 n''a rien modifié sur cette base (ou rollback déjà fait), rien à faire';
    return;
  end if;
  select * into s from public.ps0_04_sauvegarde_policy where policyname = 'playlists_update';
  if not found then
    raise notice 'Post-S0 04 rollback : sauvegarde vide — rien à restaurer';
    drop table public.ps0_04_sauvegarde_policy;
    return;
  end if;
  select * into p from pg_policies where schemaname = 'public' and tablename = 'playlists' and policyname = 'playlists_update';
  if found and not (regexp_replace(coalesce(p.qual, ''), '\s+', '', 'g') = apres_04
                    and regexp_replace(coalesce(p.with_check, ''), '\s+', '', 'g') = apres_04
                    and p.roles::text = '{authenticated}') then
    raise exception 'Post-S0 04 rollback : playlists_update n''est plus celle posée par 04 (USING=%) — arrêt, examiner', p.qual;
  end if;
  select string_agg(case when r = 'public' then 'public' else quote_ident(r) end, ', ') into roles_sql from unnest(s.roles) r;
  execute 'drop policy if exists playlists_update on public.playlists';
  execute format('create policy playlists_update on public.playlists as %s for update to %s',
                 s.permissive, roles_sql)
       || case when s.qual is not null then format(' using (%s)', s.qual) else '' end
       || case when s.with_check is not null then format(' with check (%s)', s.with_check) else '' end;
  drop table public.ps0_04_sauvegarde_policy;
  raise notice 'Post-S0 04 rollback : playlists_update d''origine recréée à l''identique';
end $$;

commit;
