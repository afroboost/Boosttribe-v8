-- Banc post-S0 — ÉCRITURES DU NAVIGATEUR sur public.playlists, schémas RÉELS (bt / live) APRÈS S0 (01 + 02).
-- Chaque essai : charge EXACTE envoyée par PostgREST pour l'appel du front, sous le rôle `authenticated`
-- avec les claims JWT de l'acteur ; erreur Postgres EXACTE consignée ; état relu en administrateur ;
-- puis l'essai est ANNULÉ (sous-transaction) → chaque essai part du même état.
-- Acteurs : H = hôte, C = co-hôte (cohosts), T = tiers connecté, A = admin (adresse fixe, ni hôte ni co-hôte).
-- Sessions : S1 = ligne avec hôte H (mode open, access_mode account, co-hôte C) ;
--            S2 = aucune ligne ; S3 = ligne SANS hôte ; S4 = ligne hôte H, access_mode guest.
\set H '\'aaaaaaaa-0000-0000-0000-00000000000a\''
\set C '\'cccccccc-0000-0000-0000-00000000000c\''
\set T '\'eeeeeeee-0000-0000-0000-00000000000e\''
\set A '\'dddddddd-0000-0000-0000-00000000000d\''

insert into auth.users(id, email) values
  (:H, 'hote@exemple.invalid'), (:C, 'cohote@exemple.invalid'),
  (:T, 'tiers@exemple.invalid'), (:A, 'contact.artboost@gmail.com');
insert into public.profiles(id, full_name, credits) values (:H, 'Hote', 7), (:C, 'Cohote', 3), (:T, 'Tiers', 2);
insert into public.playlists(session_id, host_id, cohosts, mode, access_mode, description) values
  ('S1SESSN-AAAAAA', :H, jsonb_build_array(:C::text), 'open', 'account', 'desc origine'),
  ('S4SESSN-AAAAAA', :H, '[]'::jsonb, 'open', 'guest', null);
insert into public.playlists(session_id, host_id, mode) values ('S3SESSN-AAAAAA', null, 'open');

create table if not exists banc.ecritures(phase text, nom text, acteur text, session text, erreur text, lignes int, etat text);
create table if not exists banc.empreintes(etape text, tableau text, empreinte text);

create or replace function banc.etat(s text) returns text language sql as $$
  select coalesce(string_agg(format('hote=%s mode=%s prive=%s media=%s desc=%s cohotes=%s acces=%s pistes=%s',
           coalesce(left(host_id::text, 1), 'NULL'), mode, is_private, coalesce(shared_media->>'url', '-'),
           coalesce(description, '-'), coalesce(cohosts::text, 'NULL'), coalesce(access_mode, '-'),
           coalesce(jsonb_array_length(tracks), 0)), ' | '), 'ABSENTE')
    from public.playlists where session_id = s
$$;

-- acteur : 'H' | 'C' | 'T' | 'A' ; requete : SQL exact (paramétré par la session)
create or replace function banc.ecrire(nom text, acteur text, s text, requete text) returns void language plpgsql as $$
declare uid uuid; mail text; n int; err text; etat text;
begin
  uid := case acteur when 'H' then 'aaaaaaaa-0000-0000-0000-00000000000a' when 'C' then 'cccccccc-0000-0000-0000-00000000000c'
                     when 'T' then 'eeeeeeee-0000-0000-0000-00000000000e' else 'dddddddd-0000-0000-0000-00000000000d' end;
  select email into mail from auth.users where id = uid;
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'email', mail)::text, true);
    set local role authenticated;
    execute replace(replace(requete, '$S', quote_literal(s)), '$U', quote_literal(uid));
    get diagnostics n = row_count;
    reset role;
    etat := banc.etat(s);
    raise exception 'annuler_essai';
  exception when others then
    if sqlerrm <> 'annuler_essai' then err := sqlstate || ' ' || sqlerrm; end if;
  end;
  if etat is null and err is not null then etat := banc.etat(s) || ' (inchangé)'; end if;
  insert into banc.ecritures values (current_setting('banc.phase'), nom, acteur, s, err, n, etat);
end $$;
