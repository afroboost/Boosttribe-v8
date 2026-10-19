-- ============================================================================
-- Post-S0 — 04 : MESURE (LECTURE SEULE) des sessions SANS HÔTE, à lancer AVANT 04_session_sans_hote.sql
-- sur chacune des deux bases. Ne modifie rien (transaction READ ONLY) ; n'affiche AUCUN identifiant de
-- session (un session_id = un lien d'invitation) ni aucune donnée personnelle : des comptes seulement.
--
-- Ce qu'il faut regarder :
--   - etat_regle  : 'live_faille' (host_id IS NULL autorisé → 04 corrige), 'bt_sans_faille' (04 sans effet),
--                   'deja_04' (04 déjà passé), sinon 04 S'ARRÊTERA (état inattendu, à examiner) ;
--   - verrou_02   : true si 02_s0_verrou.sql est en place (trigger s0_proteger_playlist) ;
--   - sans_hote_* : lignes que, sur /live, tout compte connecté peut aujourd'hui modifier ; APRÈS 04 plus
--                   aucun navigateur ne les modifie (lecture inchangée ; revendication par le backend) ;
--   - owner_sans_hote : anciennes playlists PERSONNELLES (owner-<uid>) sans hôte : déjà illisibles par
--                   leur coach (playlists_select) ; après 04 elles ne sont plus écrasables non plus.
--                   Aucune donnée n'est corrigée par 04 (voir README / rapport).
-- ============================================================================
begin transaction read only;

with pol as (
  select policyname, cmd, roles::text roles, regexp_replace(coalesce(qual, ''), '\s+', '', 'g') q,
         regexp_replace(coalesce(with_check, ''), '\s+', '', 'g') w
    from pg_policies where schemaname = 'public' and tablename = 'playlists'
)
select (select count(*) from pol where cmd in ('UPDATE', 'ALL')) as regles_update,
       (select case
          when q like '%host_idISNULL%' then 'live_faille'
          when roles = '{authenticated}' and q = w and q like '%COALESCE(cohosts%' then 'deja_04'
          when roles = '{public}' and q = w then 'bt_sans_faille'
          else 'INATTENDU' end
          from pol where policyname = 'playlists_update') as etat_regle,
       exists (select 1 from pg_trigger where tgrelid = 'public.playlists'::regclass
                and tgname = 's0_proteger_playlist' and not tgisinternal) as verrou_02,
       (select relrowsecurity from pg_class where oid = 'public.playlists'::regclass) as rls_active;

select count(*)                                                              as sessions_total,
       count(*) filter (where host_id is null)                               as sans_hote_total,
       count(*) filter (where host_id is null and session_id like 'owner-%') as owner_sans_hote,
       count(*) filter (where host_id is null and session_id not like 'owner-%'
                          and updated_at > now() - interval '1 day')         as sans_hote_maj_24h,
       count(*) filter (where host_id is null and session_id not like 'owner-%'
                          and updated_at > now() - interval '7 days')        as sans_hote_maj_7j,
       count(*) filter (where host_id is null and session_id not like 'owner-%'
                          and updated_at > now() - interval '30 days')       as sans_hote_maj_30j,
       count(*) filter (where host_id is null and created_at < now() - interval '30 days') as sans_hote_plus_30j,
       count(*) filter (where host_id is null and coalesce(jsonb_array_length(case when jsonb_typeof(tracks) = 'array'
                                                then tracks end), 0) > 0)     as sans_hote_avec_pistes,
       count(*) filter (where host_id is null and coalesce(description, '') <> '') as sans_hote_avec_description,
       count(*) filter (where host_id is null and shared_media is not null)  as sans_hote_avec_media,
       count(*) filter (where host_id is null and is_private)                as sans_hote_privees,
       count(*) filter (where host_id is null and mode <> 'open')            as sans_hote_mode_non_open,
       count(*) filter (where host_id is null and access_mode = 'guest')     as sans_hote_acces_invite,
       count(*) filter (where host_id is null and live_ended_at is not null) as sans_hote_live_termine
  from public.playlists;

-- Doublons éventuels (01 exige session_id UNIQUE : doit être 0).
select count(*) as session_id_en_double
  from (select session_id from public.playlists group by session_id having count(*) > 1) d;

rollback;
