-- ============================================================================
-- Post-S0 — 04 : une session SANS HÔTE n'est plus modifiable par un compte tiers (19/10/2026).
-- Base concernée : supabase-live.afroboost.com (afroboost.com/live). Sur api.boosttribe.pro la faille
-- n'existe pas : ce script y est SANS EFFET (il le vérifie et le dit).
-- Correct et idempotent dans les DEUX états de production : 01 seul, ou 01 + 02 (02 appliqué le 19/10).
-- Ne touche à AUCUNE donnée, ni à la lecture (playlists_select), ni à la création (playlists_insert),
-- ni au verrou S0 (trigger s0_proteger_playlist), ni à la liste des participants.
-- Exécution : psql -U supabase_admin -v ON_ERROR_STOP=1 -f 04_session_sans_hote.sql
-- Avant : 04_session_sans_hote_mesure.sql (lecture seule). Retour arrière : 04_session_sans_hote_rollback.sql.
--
-- AVANT (live) : playlists_update USING/WITH CHECK
--     (host_id IS NULL) OR host_id = auth.uid() OR cohosts @> auth.uid()
--   → tout compte connecté modifie une session pas (ou plus) revendiquée :
--       01 seul  : TOUTES les colonnes, host_id compris (prise d'hôte gratuite) ;
--       01 + 02  : le verrou ne laisse passer que le contenu (description, pistes, morceau choisi).
-- APRÈS (live = règle de boosttribe.pro, qui n'a jamais eu « host_id IS NULL ») :
--     host_id = auth.uid() OR coalesce(cohosts,'[]') @> auth.uid()      (rôle authenticated)
--   → seuls l'hôte et ses co-hôtes modifient une session ; une session sans hôte n'est modifiable que
--     par le BACKEND (service_role, hors RLS) : /session/claim-host (prise conditionnelle host_id IS NULL),
--     /session/configure, promo, enregistrement, co-hôtes. Aucun de ces chemins ne passe par la RLS.
--
-- Flux légitimes vérifiés dans le code (frontend/src, backend/main.py, cee82c6) :
--   - création d'une session par le navigateur : INSERT avec host_id = soi (playlists_insert, inchangée) ;
--   - revendication : uniquement backend (claim-host), service_role → non concerné ;
--   - écritures navigateur de l'hôte / co-hôte (pistes, description, média, is_private, access_mode) :
--     host_id = soi ou co-hôte → toujours permises ;
--   - aucun flux navigateur légitime n'écrit une ligne SANS hôte : depuis 02 il ne peut plus y poser
--     host_id, et sur boosttribe.pro (même code) ces écritures sont déjà refusées.
-- ============================================================================
begin;

-- 0) Pré-vérifications : l'état DOIT être l'un des trois connus, sinon arrêt (rien n'est modifié).
create temp table ps0_04_etat(etat text) on commit drop;
do $$
declare
  n_autres int;
  p record;
  q text; w text;
  -- Formes EXACTES (pg_policies, espaces retirés) des trois états acceptés.
  live_avant constant text := '((host_idISNULL)OR((host_id)::text=(auth.uid())::text)OR(COALESCE(cohosts,''[]''::jsonb)@>to_jsonb((auth.uid())::text)))';
  bt_avant   constant text := '(((host_id)::text=(auth.uid())::text)OR(cohosts@>to_jsonb((auth.uid())::text)))';
  apres_04   constant text := '(((host_id)::text=(auth.uid())::text)OR(COALESCE(cohosts,''[]''::jsonb)@>to_jsonb((auth.uid())::text)))';
  etat text;
begin
  if to_regclass('public.playlists') is null then
    raise exception 'Post-S0 04 : table public.playlists absente — arrêt';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.playlists'::regclass) then
    raise exception 'Post-S0 04 : RLS désactivée sur public.playlists — état inattendu, arrêt';
  end if;
  -- 01 doit être passé (prérequis de S0) : session_id UNIQUE.
  if not exists (select 1 from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
                  where i.indrelid = 'public.playlists'::regclass and i.indisunique and i.indnatts = 1 and a.attname = 'session_id') then
    raise exception 'Post-S0 04 : playlists.session_id n''est pas UNIQUE (01 non appliqué ?) — arrêt';
  end if;
  -- Aucune AUTRE règle permissive de modification (une seconde règle ouvrirait la même porte).
  select count(*) into n_autres from pg_policies
   where schemaname = 'public' and tablename = 'playlists' and cmd in ('UPDATE', 'ALL') and policyname <> 'playlists_update';
  if n_autres > 0 then
    raise exception 'Post-S0 04 : % autre(s) règle(s) UPDATE/ALL sur playlists — état inattendu, examiner avant d''appliquer', n_autres;
  end if;
  select * into p from pg_policies where schemaname = 'public' and tablename = 'playlists' and policyname = 'playlists_update';
  if not found then
    raise exception 'Post-S0 04 : règle playlists_update absente — état inattendu, arrêt';
  end if;
  q := regexp_replace(coalesce(p.qual, ''), '\s+', '', 'g');
  w := regexp_replace(coalesce(p.with_check, ''), '\s+', '', 'g');
  if p.cmd <> 'UPDATE' or p.permissive <> 'PERMISSIVE' then
    raise exception 'Post-S0 04 : playlists_update (%/%) inattendue — arrêt', p.cmd, p.permissive;
  end if;
  if q = live_avant and w = live_avant and p.roles::text = '{authenticated}' then
    etat := 'live_faille';
  elsif q = apres_04 and w = apres_04 and p.roles::text = '{authenticated}' then
    etat := 'deja_04';
  elsif q = bt_avant and w = bt_avant and p.roles::text = '{public}' then
    etat := 'bt_sans_faille';
  else
    raise exception 'Post-S0 04 : playlists_update a une forme inconnue — arrêt. roles=% USING=% CHECK=%',
      p.roles, p.qual, p.with_check;
  end if;
  insert into ps0_04_etat values (etat);
  raise notice 'Post-S0 04 : état constaté = % ; verrou 02 présent = % ; sessions sans hôte = % (dont owner-* = %)',
    etat,
    exists (select 1 from pg_trigger where tgrelid = 'public.playlists'::regclass and tgname = 's0_proteger_playlist' and not tgisinternal),
    (select count(*) from public.playlists where host_id is null),
    (select count(*) from public.playlists where host_id is null and session_id like 'owner-%');
end $$;

-- 1) Sauvegarde EXACTE de la règle remplacée (une seule fois : un second passage ne l'écrase pas).
--    Lue par 04_session_sans_hote_rollback.sql. Table serveur seulement (RLS sans règle, droits retirés).
--    Créée UNIQUEMENT sur une base qui avait la faille : sur boosttribe.pro, 04 ne crée rien.
do $$
begin
  if (select etat from ps0_04_etat) = 'live_faille' then
    create table if not exists public.ps0_04_sauvegarde_policy (
      policyname text primary key,
      permissive text not null,
      roles      text[] not null,
      qual       text,
      with_check text,
      saved_at   timestamptz not null default now()
    );
    alter table public.ps0_04_sauvegarde_policy enable row level security;
    revoke all on public.ps0_04_sauvegarde_policy from anon, authenticated;
    insert into public.ps0_04_sauvegarde_policy (policyname, permissive, roles, qual, with_check)
    select policyname, permissive, roles::text[], qual, with_check
      from pg_policies
     where schemaname = 'public' and tablename = 'playlists' and policyname = 'playlists_update'
    on conflict (policyname) do nothing;
  end if;
end $$;

-- 2) Remplacement (live seulement). Même nom, même rôle : seule la clause « host_id IS NULL » disparaît.
do $$
begin
  if (select etat from ps0_04_etat) = 'live_faille' then
    drop policy playlists_update on public.playlists;
    create policy playlists_update on public.playlists as permissive for update to authenticated
      using      (((host_id)::text = (auth.uid())::text) or (coalesce(cohosts, '[]'::jsonb) @> to_jsonb((auth.uid())::text)))
      with check (((host_id)::text = (auth.uid())::text) or (coalesce(cohosts, '[]'::jsonb) @> to_jsonb((auth.uid())::text)));
    raise notice 'Post-S0 04 : playlists_update remplacée (host_id IS NULL retiré), règle d''origine sauvegardée';
  elsif (select etat from ps0_04_etat) = 'deja_04' then
    raise notice 'Post-S0 04 : déjà appliquée — aucun changement';
  else
    raise notice 'Post-S0 04 : base sans la faille (boosttribe.pro) — aucun changement';
  end if;
end $$;

-- 3) Post-vérification dans la même transaction : plus aucune règle de modification n'accepte un hôte vide.
do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'playlists'
              and cmd in ('UPDATE', 'ALL')
              and (coalesce(qual, '') ilike '%host_id IS NULL%' or coalesce(with_check, '') ilike '%host_id IS NULL%')) then
    raise exception 'Post-S0 04 : une règle UPDATE accepte encore host_id IS NULL — annulation';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'playlists' and cmd in ('UPDATE', 'ALL')) <> 1 then
    raise exception 'Post-S0 04 : nombre de règles UPDATE inattendu après migration — annulation';
  end if;
end $$;

commit;
