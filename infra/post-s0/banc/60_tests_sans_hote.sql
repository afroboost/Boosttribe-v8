-- Banc post-S0 — 04 « session sans hôte ». Joué à chaque phase (avant 04, après 04, après rollback…).
-- Chaque écriture est une requête EXACTE de PostgREST, sous le rôle réel (authenticated / anon /
-- service_role) avec les claims de l'acteur, ANNULÉE aussitôt (sous-transaction) : la base ne change pas.
-- Acteurs : H hôte, C co-hôte, T tiers connecté, N anonyme, SR backend (service_role).
-- Sessions (insérées en administrateur, donc sans passer par le verrou) :
--   PS4-HOTE   hôte H, co-hôte C, mode private (lisible)          → session D'AUTRUI pour T
--   PS4-VPRIV  SANS hôte, mode private (lisible par tous)          → l'ancienne faille, cas le plus exposé
--   PS4-VGUEST SANS hôte, mode open, access_mode guest (lisible)
--   PS4-VOPEN  SANS hôte, mode open, access_mode account (illisible sauf accès payé)
-- Résultats dans banc.resultats (banc.verifier) ; lectures dans banc.lectures (comparées entre phases).
\set H '\'a4a4a4a4-0000-0000-0000-0000000000a4\''
\set C '\'c4c4c4c4-0000-0000-0000-0000000000c4\''

-- Créées une seule fois par base (un second passage les retrouve intactes : tous les essais sont annulés).
insert into public.playlists (session_id, host_id, cohosts, mode, access_mode, description, tracks) values
  ('PS4-HOTE',   :H,   jsonb_build_array(:C::text), 'private', 'account', 'origine', '[{"id":1}]'),
  ('PS4-VPRIV',  null, '[]'::jsonb,                 'private', 'account', 'origine', '[{"id":1}]'),
  ('PS4-VGUEST', null, '[]'::jsonb,                 'open',    'guest',   'origine', '[{"id":1}]'),
  ('PS4-VOPEN',  null, '[]'::jsonb,                 'open',    'account', 'origine', '[{"id":1}]')
on conflict (session_id) do nothing;

create table if not exists banc.lectures(phase text, acteur text, session text, n int);
create table if not exists banc.essais(phase text, nom text, acteur text, session text, lignes int, erreur text, apres text);
grant all on banc.lectures, banc.essais to public;

create or replace function banc.ps4_etat(s text) returns text language sql as $$
  select coalesce(string_agg(format('hote=%s prive=%s media=%s desc=%s pistes=%s acces=%s mode=%s',
           coalesce(left(host_id::text, 2), 'NULL'), is_private, coalesce(shared_media->>'url', '-'), coalesce(description, '-'),
           tracks::text, coalesce(access_mode, '-'), mode), ' | '), 'ABSENTE')
    from public.playlists where session_id = s
$$;

-- Exécute `requete` comme `acteur`, relève le nombre de lignes / l'erreur et l'état relu, puis ANNULE.
create or replace function banc.ps4_essai(nom text, acteur text, s text, requete text) returns void language plpgsql as $$
declare uid text; n int; err text; etat text;
begin
  uid := case acteur when 'H' then 'a4a4a4a4-0000-0000-0000-0000000000a4' when 'C' then 'c4c4c4c4-0000-0000-0000-0000000000c4'
                     when 'T' then 'e4e4e4e4-0000-0000-0000-0000000000e4' when 'T2' then 'f4f4f4f4-0000-0000-0000-0000000000f4' end;
  begin
    if acteur = 'SR' then
      perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
      set local role service_role;
    elsif acteur = 'N' then
      perform set_config('request.jwt.claims', '{"role":"anon"}', true);
      set local role anon;
    else
      perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'email', lower(acteur) || '@exemple.invalid')::text, true);
      set local role authenticated;
    end if;
    execute replace(replace(requete, '$S', quote_literal(s)), '$U', coalesce(quote_literal(uid), 'NULL'));
    get diagnostics n = row_count;
    reset role;
    etat := banc.ps4_etat(s);
    raise exception 'annuler_essai';
  exception when others then
    if sqlerrm <> 'annuler_essai' then err := sqlstate; n := null; end if;
  end;
  reset role;
  if etat is null then etat := banc.ps4_etat(s); end if;
  insert into banc.essais values (current_setting('banc.phase'), nom, acteur, s, n, err, etat);
end $$;

-- Lecture (playlists_select inchangée par 04) : combien de lignes chaque acteur VOIT-il ?
create or replace function banc.ps4_lire(acteur text, s text) returns int language plpgsql as $$
declare n int; uid text;
begin
  uid := case acteur when 'H' then 'a4a4a4a4-0000-0000-0000-0000000000a4' when 'T' then 'e4e4e4e4-0000-0000-0000-0000000000e4' end;
  if acteur = 'N' then
    perform set_config('request.jwt.claims', '{"role":"anon"}', true); set local role anon;
  elsif acteur = 'SR' then
    perform set_config('request.jwt.claims', '{"role":"service_role"}', true); set local role service_role;
  else
    perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
    set local role authenticated;
  end if;
  select count(*) into n from public.playlists where session_id = s;
  reset role;
  return n;
end $$;

do $$
declare
  media constant text := '''{"url":"https://exemple.invalid/t.mp4","type":"video"}''::jsonb';
  -- Écritures du NAVIGATEUR (front actuel) : UPDATE + relecture (ecrireReglageSession), PATCH sans
  -- relecture (return=minimal), upsert savePlaylist avec host_id = soi, saveAccessMode avec host_id.
  ecritures constant text[][] := array[
    ['DESC  update+relecture', 'update public.playlists set description = ''pirate'', updated_at = now() where session_id = $S returning session_id, description'],
    ['DESC  update sans relecture', 'update public.playlists set description = ''pirate'', updated_at = now() where session_id = $S'],
    ['PRIVE update+relecture', 'update public.playlists set is_private = true, updated_at = now() where session_id = $S returning session_id, is_private'],
    ['MEDIA update+relecture', 'update public.playlists set shared_media = ' || media || ', updated_at = now() where session_id = $S returning session_id, shared_media'],
    ['PISTES update', 'update public.playlists set tracks = ''[{"id":99}]''::jsonb, selected_track_id = ''99'' where session_id = $S'],
    ['HOTE  update host_id=soi', 'update public.playlists set host_id = $U::uuid where session_id = $S'],
    ['ACCES update+host_id (saveAccessMode)', 'update public.playlists set access_mode = ''guest'', host_id = $U::uuid, updated_at = now() where session_id = $S returning session_id'],
    ['PISTES upsert+host_id (savePlaylist)', 'insert into public.playlists(host_id, selected_track_id, session_id, tracks, updated_at) values ($U::uuid, ''99'', $S, ''[{"id":99}]''::jsonb, now()) on conflict (session_id) do update set host_id = excluded.host_id, selected_track_id = excluded.selected_track_id, session_id = excluded.session_id, tracks = excluded.tracks, updated_at = excluded.updated_at']
  ];
  intrus constant text[][] := array[['T','PS4-HOTE'],['T','PS4-VPRIV'],['T','PS4-VGUEST'],['T','PS4-VOPEN'],
                                    ['N','PS4-HOTE'],['N','PS4-VPRIV'],['N','PS4-VGUEST'],['N','PS4-VOPEN']];
  i int; j int; a text; s text;
begin
  for i in 1 .. array_length(ecritures, 1) loop
    for j in 1 .. array_length(intrus, 1) loop
      perform banc.ps4_essai(ecritures[i][1], intrus[j][1], intrus[j][2], ecritures[i][2]);
    end loop;
  end loop;
  -- Hôte et co-hôte : leurs réglages (contenu) sur LEUR session.
  foreach a in array array['H','C'] loop
    perform banc.ps4_essai('LEGIT desc', a, 'PS4-HOTE', ecritures[1][2]);
    perform banc.ps4_essai('LEGIT prive', a, 'PS4-HOTE', ecritures[3][2]);
    perform banc.ps4_essai('LEGIT media', a, 'PS4-HOTE', ecritures[4][2]);
    perform banc.ps4_essai('LEGIT pistes', a, 'PS4-HOTE', ecritures[5][2]);
  end loop;
  perform banc.ps4_essai('LEGIT savePlaylist hote', 'H', 'PS4-HOTE', ecritures[8][2]);
  -- Création d'une session NEUVE par le navigateur (host_id = soi), puis sa mise à jour.
  perform banc.ps4_essai('LEGIT creation session neuve', 'T', 'PS4-NEUVE',
    'insert into public.playlists(host_id, selected_track_id, session_id, tracks, updated_at) values ($U::uuid, ''1'', $S, ''[{"id":1}]''::jsonb, now())');
  perform banc.ps4_essai('LEGIT creation puis maj', 'T', 'PS4-NEUVE',
    'insert into public.playlists(host_id, session_id) values ($U::uuid, $S); update public.playlists set description = ''ok'' where session_id = $S returning 1');
  -- Backend (service_role, hors RLS) : prise d'hôte CONDITIONNELLE de /session/claim-host
  -- (_s0_poser_hote_si_libre), libération après 402 (_s0_liberer_hote), écriture de promo / configure.
  foreach s in array array['PS4-VPRIV','PS4-VGUEST','PS4-VOPEN'] loop
    perform banc.ps4_essai('BACKEND claim-host', 'SR', s,
      'update public.playlists set host_id = ''a4a4a4a4-0000-0000-0000-0000000000a4'' where session_id = $S and host_id is null returning session_id, host_id');
  end loop;
  perform banc.ps4_essai('BACKEND claim-host session absente (création)', 'SR', 'PS4-ABS',
    'insert into public.playlists(session_id, host_id) values ($S, ''a4a4a4a4-0000-0000-0000-0000000000a4'') returning session_id');
  perform banc.ps4_essai('BACKEND claim-host déjà pris = 0 ligne', 'SR', 'PS4-HOTE',
    'update public.playlists set host_id = ''e4e4e4e4-0000-0000-0000-0000000000e4'' where session_id = $S and host_id is null returning session_id');
  perform banc.ps4_essai('BACKEND libérer après 402', 'SR', 'PS4-HOTE',
    'update public.playlists set host_id = null where session_id = $S and host_id = ''a4a4a4a4-0000-0000-0000-0000000000a4''');
  perform banc.ps4_essai('BACKEND configure/promo sans hôte', 'SR', 'PS4-VOPEN',
    'update public.playlists set mode = ''private'', promo_enabled = true where session_id = $S returning 1');
  -- Après revendication par le backend, l'hôte modifie bien sa session (même transaction d'essai).
  foreach s in array array['PS4-VPRIV','PS4-VGUEST','PS4-VOPEN'] loop
    perform banc.ps4_essai('LEGIT hote apres claim-host', 'H', s,
      'set local role service_role; update public.playlists set host_id = ''a4a4a4a4-0000-0000-0000-0000000000a4'' where session_id = $S and host_id is null; '
      || 'set local role authenticated; update public.playlists set description = ''apres claim'' where session_id = $S');
  end loop;
end $$;

-- Lectures (inchangées par 04) : enregistrées pour comparaison entre phases.
insert into banc.lectures
select current_setting('banc.phase'), a, s, banc.ps4_lire(a, s)
  from unnest(array['H','T','N','SR']) a, unnest(array['PS4-HOTE','PS4-VPRIV','PS4-VGUEST','PS4-VOPEN']) s;
reset role;

-- ── verdicts de la phase ────────────────────────────────────────────────────────────────
create temp view ps4 as select * from banc.essais where phase = current_setting('banc.phase');
select banc.verifier('SH1. tiers sur la session D''AUTRUI : 0 ligne / refus, rien ne change (' ||
  (select count(*) from ps4 where acteur = 'T' and session = 'PS4-HOTE') || ' essais)',
  (select bool_and(coalesce(lignes, 0) = 0 and apres like 'hote=a4 prive=f media=- desc=origine pistes=[{"id": 1}]%')
     from ps4 where acteur = 'T' and session = 'PS4-HOTE'));
select banc.verifier('SH2. tiers sur une session SANS HÔTE : 0 ligne / refus, rien ne change (' ||
  (select count(*) from ps4 where acteur = 'T' and session like 'PS4-V%') || ' essais ; lignes atteintes : ' ||
  coalesce((select string_agg(distinct session || '/' || split_part(nom, ' ', 1), ',') from ps4
             where acteur = 'T' and session like 'PS4-V%' and coalesce(lignes, 0) > 0), 'aucune') || ' ; valeurs réellement changées : ' ||
  coalesce((select string_agg(distinct session || '/' || split_part(nom, ' ', 1), ',') from ps4
             where acteur = 'T' and session like 'PS4-V%'
               and apres not like 'hote=NULL prive=f media=- desc=origine pistes=[{"id": 1}] acces=' || case session when 'PS4-VGUEST' then 'guest' else 'account' end || '%'), 'aucune') || ')',
  (select bool_and(coalesce(lignes, 0) = 0 and apres like 'hote=NULL prive=f media=- desc=origine pistes=[{"id": 1}]%')
     from ps4 where acteur = 'T' and session like 'PS4-V%'));
select banc.verifier('SH3. anonyme : 0 ligne partout (' || (select count(*) from ps4 where acteur = 'N') || ' essais)',
  (select bool_and(coalesce(lignes, 0) = 0 and apres like '%desc=origine pistes=[{"id": 1}]%') from ps4 where acteur = 'N'));
select banc.verifier('SH4. hôte ET co-hôte modifient leur session (description, is_private, média, pistes : 1 ligne, valeur relue)',
  (select count(*) = 8 and bool_and(lignes = 1 and erreur is null and case split_part(nom, ' ', 2)
       when 'desc' then apres like '%desc=pirate%' when 'prive' then apres like '%prive=t%'
       when 'media' then apres like '%media=https://exemple.invalid/t.mp4%' else apres like '%pistes=[{"id": 99}]%' end)
     from ps4 where nom like 'LEGIT %' and acteur in ('H','C') and session = 'PS4-HOTE' and nom <> 'LEGIT savePlaylist hote'));
select banc.verifier('SH5. savePlaylist de l''hôte sur SA session : pistes écrites, hôte inchangé',
  (select lignes = 1 and erreur is null and apres like 'hote=a4 %pistes=[{"id": 99}]%' from ps4 where nom = 'LEGIT savePlaylist hote'));
select banc.verifier('SH6. le navigateur crée SA session neuve (host_id = soi) et la modifie',
  (select bool_and(erreur is null and apres like 'hote=e4 %') from ps4 where nom like 'LEGIT creation%'));
select banc.verifier('SH7. backend : claim-host revendique chaque session sans hôte (1 ligne), crée une session absente',
  (select count(*) = 4 and bool_and(lignes = 1 and erreur is null and apres like 'hote=a4 %') from ps4 where nom like 'BACKEND claim-host%' and nom not like '%déjà pris%'));
select banc.verifier('SH8. backend : claim-host sur une session déjà prise = 0 ligne ; libération après 402 et configure OK',
  (select lignes = 0 and apres like 'hote=a4 %' from ps4 where nom like 'BACKEND claim-host déjà pris%')
  and (select lignes = 1 and apres like 'hote=NULL %' from ps4 where nom = 'BACKEND libérer après 402')
  and (select lignes = 1 and apres like '%mode=private' from ps4 where nom = 'BACKEND configure/promo sans hôte'));
select banc.verifier('SH9. après revendication par le backend, l''hôte modifie la session (ancienne session sans hôte)',
  (select count(*) = 3 and bool_and(erreur is null and apres like 'hote=a4 %desc=apres claim%') from ps4 where nom = 'LEGIT hote apres claim-host'));
select banc.verifier('SH10. aucune écriture ne subsiste (sessions de test identiques à leur insertion)',
  (select banc.ps4_etat('PS4-VPRIV') like 'hote=NULL prive=f media=- desc=origine%' and banc.ps4_etat('PS4-HOTE') like 'hote=a4 prive=f media=- desc=origine%'
          and banc.ps4_etat('PS4-NEUVE') = 'ABSENTE' and banc.ps4_etat('PS4-ABS') = 'ABSENTE'));
select banc.verifier('SH11. lectures : H voit sa session, tous voient les sessions sans hôte privées / invité, le backend voit tout',
  (select bool_and(case when acteur = 'SR' then n = 1
                        when session = 'PS4-VOPEN' then n = 0
                        else n = 1 end)
     from banc.lectures where phase = current_setting('banc.phase')));
select banc.verifier('SH12. lectures IDENTIQUES à la première phase de cette base (04 ne change pas la lecture)',
  (select count(*) = 0 from banc.lectures a join banc.lectures b using (acteur, session)
    where a.phase = (select phase from banc.lectures order by ctid limit 1) and b.phase = current_setting('banc.phase')
      and a.n <> b.n));
drop view ps4;
