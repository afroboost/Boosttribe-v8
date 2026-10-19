-- Scénarios : AVANT = charges actuelles du front ; APRES = charges de la correction.
-- Les écritures sont annulées une par une (banc.ecrire) : la base ne change jamais.
do $$
declare
  media constant text := '''{"url":"https://exemple.invalid/v.mp4","type":"video"}''::jsonb';
  -- Charges EXACTES émises par PostgREST pour les appels actuels (supabase-js upsert onConflict session_id,
  -- Prefer return=minimal → pas de RETURNING ; colonnes = clés du corps JSON, triées).
  avant constant text[][] := array[
    ['PRIVE  upsert (saveSessionPrivacy)',
     'insert into public.playlists(is_private, session_id, updated_at) values (true, $S, now()) on conflict (session_id) do update set is_private = excluded.is_private, session_id = excluded.session_id, updated_at = excluded.updated_at'],
    ['MEDIA  upsert (saveSharedMedia)',
     'insert into public.playlists(session_id, shared_media, updated_at) values ($S, ' || media || ', now()) on conflict (session_id) do update set session_id = excluded.session_id, shared_media = excluded.shared_media, updated_at = excluded.updated_at'],
    ['DESC   upsert (saveSessionDescription)',
     'insert into public.playlists(description, session_id, updated_at) values (''nouvelle desc'', $S, now()) on conflict (session_id) do update set description = excluded.description, session_id = excluded.session_id, updated_at = excluded.updated_at'],
    ['PISTES upsert+host_id (savePlaylist)',
     'insert into public.playlists(host_id, selected_track_id, session_id, tracks, updated_at) values ($U, ''1'', $S, ''[{"id":1}]''::jsonb, now()) on conflict (session_id) do update set host_id = excluded.host_id, selected_track_id = excluded.selected_track_id, session_id = excluded.session_id, tracks = excluded.tracks, updated_at = excluded.updated_at'],
    ['ACCES  update+host_id (saveAccessMode)',
     'update public.playlists set access_mode = ''guest'', host_id = $U, updated_at = now() where session_id = $S returning session_id']
  ];
  -- Correction : UPDATE ciblé avec relecture (RETURNING), puis INSERT avec host_id = soi SEULEMENT si aucune ligne.
  apres constant text[][] := array[
    ['PRIVE  update+relecture',
     'update public.playlists set is_private = true, updated_at = now() where session_id = $S returning session_id, is_private'],
    ['MEDIA  update+relecture',
     'update public.playlists set shared_media = ' || media || ', updated_at = now() where session_id = $S returning session_id, shared_media'],
    ['MEDIA  retrait (null)',
     'update public.playlists set shared_media = null, updated_at = now() where session_id = $S returning session_id, shared_media'],
    ['DESC   update+relecture',
     'update public.playlists set description = ''nouvelle desc'', updated_at = now() where session_id = $S returning session_id, description'],
    ['PRIVE  insert host_id=soi (ligne absente)',
     'insert into public.playlists(session_id, is_private, updated_at, host_id) values ($S, true, now(), $U) returning session_id, is_private'],
    ['MEDIA  insert host_id=soi (ligne absente)',
     'insert into public.playlists(session_id, shared_media, updated_at, host_id) values ($S, ' || media || ', now(), $U) returning session_id, shared_media']
  ];
  cas constant text[][] := array[['H','S1SESSN-AAAAAA'],['C','S1SESSN-AAAAAA'],['T','S1SESSN-AAAAAA'],['A','S1SESSN-AAAAAA'],
                                 ['H','S2SESSN-AAAAAA'],['T','S2SESSN-AAAAAA'],['H','S3SESSN-AAAAAA'],['T','S3SESSN-AAAAAA'],
                                 ['T','S4SESSN-AAAAAA']];
  jeu text[][]; i int; j int;
begin
  jeu := case when current_setting('banc.phase') like '%AVANT' then avant else apres end;
  for i in 1 .. array_length(jeu, 1) loop
    for j in 1 .. array_length(cas, 1) loop
      perform banc.ecrire(jeu[i][1], cas[j][1], cas[j][2], jeu[i][2]);
    end loop;
  end loop;
end $$;
