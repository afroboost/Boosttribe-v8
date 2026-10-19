-- Banc S0 — après migration : ce que le Live affiche des AUTRES participants reste disponible.
begin; set local role anon; set local request.jwt.claims = '{"role":"anon"}';
create temp table v1 on commit drop as
  select count(*) n from public.profiles_public where id = 'bbbbbbbb-0000-0000-0000-00000000000b' and full_name = 'Bob';
select banc.verifier('V1. anonyme voit nom/photo d''un participant (profiles_public)', (select n from v1) = 1);
commit;
do $$ begin
  set local role anon;
  begin
    perform credits from public.profiles_public limit 1;
    reset role; perform banc.verifier('V2. profiles_public n''expose PAS les crédits', false);
  exception when undefined_column then
    reset role; perform banc.verifier('V2. profiles_public n''expose PAS les crédits', true);
  end;
end $$;
select banc.verifier('V3. profiles_public = 3 colonnes exactement (id, full_name, avatar_url)',
  (select array_agg(column_name::text order by column_name) from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles_public') = array['avatar_url','full_name','id']);
