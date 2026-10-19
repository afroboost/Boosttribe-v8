-- Banc S0 — FENÊTRE « migration 1 appliquée, migration 2 pas encore » : l'ANCIEN front et l'ANCIEN
-- backend doivent continuer à fonctionner, et le NOUVEAU front/backend aussi.
-- (Le jeu de données est celui laissé par 20_tests_s0.sql.)
begin; set local role anon; set local request.jwt.claims = '{"role":"anon"}';
create temp table c1 on commit drop as select count(*) n from public.profiles where full_name is not null;
select banc.verifier('C1. ancien front : noms des participants lisibles via profiles (inchangé)', (select n from c1) > 0);
create temp table c5 on commit drop as select count(*) n from public.profiles_public;
select banc.verifier('C5. nouveau front : vue profiles_public disponible', (select n from c5) > 0);
commit;
begin; set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","email":"a@exemple.test","role":"authenticated"}';
create temp table c2 on commit drop as select (select credits from public.profiles where id = 'aaaaaaaa-0000-0000-0000-00000000000a') soi;
select banc.verifier('C2. front : son propre profil (solde affiché) lisible', (select soi from c2) is not null);
commit;
-- C3/C4. ancien backend : mêmes RPC, mêmes signatures ; profiles.credits reste tenu à jour
select public.add_credits('bbbbbbbb-0000-0000-0000-00000000000b', 3, 'purchase', 'compat-b');
select public.spend_credits('bbbbbbbb-0000-0000-0000-00000000000b', 1, 'spend_join', 'COMPAT:b');
select banc.verifier('C3. ancien backend : add_credits / spend_credits inchangés (signatures, idempotence)',
  (select count(*) from public.credit_ledger where ref in ('compat-b', 'COMPAT:b')) = 2);
select banc.verifier('C4. copie profiles.credits = solde autoritaire (ancien front l''affiche)',
  (select credits from public.profiles where id = 'bbbbbbbb-0000-0000-0000-00000000000b')
  = public.credits_disponibles('bbbbbbbb-0000-0000-0000-00000000000b'));
-- C6. ancien front : l'hôte écrit toujours ses réglages playlists (aucun verrou avant la migration 2)
begin; set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","email":"a@exemple.test","role":"authenticated"}';
update public.playlists set description = 'compat' where session_id = 'HOTE-A';
commit;
select banc.verifier('C6. hôte : réglages playlists inchangés entre migration 1 et 2',
  (select description = 'compat' from public.playlists where session_id = 'HOTE-A'));
