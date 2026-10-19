-- Banc S0 — tests 1-6 (+ solde autoritaire). Joué AVANT et APRÈS la migration : avant, les
-- défauts apparaissent en ÉCHEC ; après, tout doit être OK. Chaque « requête » d'utilisateur est
-- simulée comme PostgREST le fait : SET LOCAL ROLE + request.jwt.claims.
\set A   '''aaaaaaaa-0000-0000-0000-00000000000a'''
\set B   '''bbbbbbbb-0000-0000-0000-00000000000b'''
\set C   '''cccccccc-0000-0000-0000-00000000000c'''
\set E   '''eeeeeeee-0000-0000-0000-00000000000e'''
\set ADM '''adadadad-0000-0000-0000-0000000000ad'''

-- ── jeu de données (en postgres) ────────────────────────────────────────────────────────
truncate public.credit_ledger;
delete from public.profiles; delete from auth.users;
insert into auth.users values (:A, 'a@exemple.test'), (:B, 'b@exemple.test'), (:C, 'c@exemple.test'),
                              (:E, 'e@exemple.test'), (:ADM, 'contact.artboost@gmail.com');
insert into public.profiles (id, email, full_name, role, subscription_status) values
  (:A, 'a@exemple.test', 'Alice', 'user', 'free'), (:B, 'b@exemple.test', 'Bob', 'user', 'free'),
  (:E, 'e@exemple.test', 'Eve', 'user', 'free'), (:ADM, 'contact.artboost@gmail.com', 'Admin', 'user', 'free');
select public.add_credits(:A, 5, 'purchase', 'fixture-a');
select public.add_credits(:B, 2, 'purchase', 'fixture-b');

-- 1. anonyme lit les crédits d'un profil
begin; set local role anon; set local request.jwt.claims = '{"role":"anon"}';
create temp table t1 on commit drop as select count(*) n from public.profiles where id = :B;
select banc.verifier('1. anonyme lit les crédits d''un profil → refus', (select n from t1) = 0);
commit;

-- 2. A lit les crédits de B / A lit les siens
begin; set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","email":"a@exemple.test","role":"authenticated"}';
create temp table t2 on commit drop as
  select (select count(*) from public.profiles where id = :B) autre,
         (select credits from public.profiles where id = :A) soi;
select banc.verifier('2. A lit les crédits de B → refus', (select autre from t2) = 0);
select banc.verifier('2b. A lit SES crédits → OK (5)', (select soi from t2) = 5);
commit;

-- 3, 4, 5. A tente de modifier ses colonnes sensibles (et une colonne légitime)
begin; set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","email":"a@exemple.test","role":"authenticated"}';
update public.profiles set credits = 999999 where id = :A;
update public.profiles set role = 'admin', subscription_status = 'enterprise' where id = :A;
update public.profiles set comp_access_plan = 'enterprise', comp_access_until = null where id = :A;
update public.profiles set email = 'b@exemple.test', coach_payment_type = 'commission' where id = :A;
update public.profiles set full_name = 'Alice Nouveau', avatar_url = 'https://x/a.png', has_accepted_terms = true where id = :A;
update public.profiles set credits = 0 where id = :B;      -- et sur le profil d'un AUTRE
commit;
select banc.verifier('3. A modifie ses credits → refus (reste 5)', (select credits from public.profiles where id = :A) = 5);
select banc.verifier('4. A change son role → refus', (select role from public.profiles where id = :A) = 'user');
select banc.verifier('4b. A change subscription_status → refus', (select subscription_status from public.profiles where id = :A) = 'free');
select banc.verifier('5. A se donne comp_access → refus', (select comp_access_plan from public.profiles where id = :A) is null);
select banc.verifier('5b. A change son e-mail / coach_payment_type → refus',
  (select email = 'a@exemple.test' and coach_payment_type is null from public.profiles where id = :A));
select banc.verifier('5c. A modifie nom / photo / CGU → OK (légitime)',
  (select full_name = 'Alice Nouveau' and avatar_url = 'https://x/a.png' and has_accepted_terms from public.profiles where id = :A));
select banc.verifier('5d. A modifie le profil de B → refus', (select credits from public.profiles where id = :B) = 2);

-- 5e. création de SON profil avec des valeurs forgées
begin; set local role authenticated;
set local request.jwt.claims = '{"sub":"cccccccc-0000-0000-0000-00000000000c","email":"c@exemple.test","role":"authenticated"}';
insert into public.profiles (id, email, full_name, role, subscription_status, credits, comp_access_plan, coach_payment_type)
values (:C, 'contact.artboost@gmail.com', 'Carl', 'admin', 'enterprise', 999999, 'enterprise', 'commission');
commit;
select banc.verifier('5e. création forgée → valeurs sûres (crédits 0, user, sans accès, vrai e-mail)',
  (select credits = 0 and role = 'user' and subscription_status = 'free' and comp_access_plan is null
          and coach_payment_type is null and email = 'c@exemple.test' and full_name = 'Carl'
     from public.profiles where id = :C));

-- 5f. l'admin (adresse fixe) garde son auto-correction de rôle
begin; set local role authenticated;
set local request.jwt.claims = '{"sub":"adadadad-0000-0000-0000-0000000000ad","email":"contact.artboost@gmail.com","role":"authenticated"}';
update public.profiles set role = 'admin', subscription_status = 'enterprise' where id = :ADM;
commit;
select banc.verifier('5f. admin : auto-correction role/subscription_status → OK',
  (select role = 'admin' and subscription_status = 'enterprise' from public.profiles where id = :ADM));

-- 6. backend (service_role) et fonctions serveur modifient légalement
begin; set local role service_role;
update public.profiles set comp_access_plan = 'pro', comp_access_until = now() + interval '12 hours' where id = :B;
commit;
select public.add_credits(:B, 10, 'offered', 'fixture-b-2');
select banc.verifier('6. backend (service_role) accorde un accès → OK', (select comp_access_plan from public.profiles where id = :B) = 'pro');
select banc.verifier('6b. fonction serveur add_credits → OK (2 + 10)', (select credits from public.profiles where id = :B) = 12);

-- 6c. un utilisateur ne peut PAS appeler les fonctions de crédit
do $$ begin
  set local role authenticated;
  begin
    perform public.spend_credits('aaaaaaaa-0000-0000-0000-00000000000a', 1, 'spend_join', 'x', null);
    reset role; perform banc.verifier('6c. utilisateur appelle spend_credits → refus', false);
  exception when insufficient_privilege then
    reset role; perform banc.verifier('6c. utilisateur appelle spend_credits → refus', true);
  end;
end $$;

-- 7. Solde autoritaire : crédits expirés exclus, profiles.credits n'est plus cru.
--    E : +5 expirés, +3, puis −2 → il reste 1 (les 5 expirés ne servent à rien).
insert into public.credit_ledger (user_id, delta, reason, ref, expires_at)
  values (:E, 5, 'offered', 'e-expire', now() - interval '1 day');
select public.add_credits(:E, 3, 'purchase', 'e-vivant');
select public.spend_credits(:E, 2, 'spend_join', 'e-s1');
do $$ begin
  begin
    perform public.spend_credits('eeeeeeee-0000-0000-0000-00000000000e', 4, 'spend_join', 'e-s2', null);
    perform banc.verifier('7. crédits expirés NON dépensables (1 dispo, 4 demandés → refus)', false);
  exception when others then
    perform banc.verifier('7. crédits expirés NON dépensables (1 dispo, 4 demandés → refus)', sqlerrm = 'insufficient_credits');
  end;
end $$;
do $$ begin perform public.spend_credits('eeeeeeee-0000-0000-0000-00000000000e', 1, 'spend_join', 'e-s3', null);
  exception when others then null; end $$;   -- (avant S0 : peut échouer, le test 7 l'a déjà mesuré)
update public.profiles set credits = 999 where id = :E;     -- copie d'affichage falsifiée
do $$ begin
  begin
    perform public.spend_credits('eeeeeeee-0000-0000-0000-00000000000e', 1, 'spend_join', 'e-s4', null);
    perform banc.verifier('7b. profiles.credits falsifié ne permet PAS de dépenser', false);
  exception when others then
    perform banc.verifier('7b. profiles.credits falsifié ne permet PAS de dépenser', sqlerrm = 'insufficient_credits');
  end;
end $$;

-- 8. Idempotence : même action rejouée = un seul débit
select public.spend_credits(:A, 1, 'spend_join', 'SESS1:a');
select public.spend_credits(:A, 1, 'spend_join', 'SESS1:a');
select banc.verifier('7c. solde E après dépense du dernier crédit = 0 (copie profiles.credits ignorée)',
  (select coalesce(sum(delta),0) from public.credit_ledger where user_id = :E and delta < 0) = -3);
select banc.verifier('8. même débit rejoué → 1 seule ligne',
  (select count(*) from public.credit_ledger where ref = 'SESS1:a') = 1);

-- ── playlists / access_requests : l'autorité d'une session ne s'écrit pas depuis le navigateur ──
delete from public.access_requests; delete from public.playlists;
insert into public.playlists (session_id, host_id, mode) values ('LIBRE', null, 'paid'), ('HOTE-A', :A, 'paid');
insert into public.access_requests (id, session_id, requester_user_id, requester_name)
  values (1, 'HOTE-A', :B, 'Bob'), (2, 'LIBRE', :B, 'Bob');
begin; set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-00000000000b","email":"b@exemple.test","role":"authenticated"}';
update public.playlists set host_id = :B, mode = 'private', cohosts = array['bbbbbbbb-0000-0000-0000-00000000000b'],
                            price_chf = 0 where session_id = 'LIBRE';
update public.access_requests set status = 'approved' where id in (1, 2);
insert into public.playlists (session_id, host_id, mode, cohosts, live_ended_at)
  values ('NEUVE-B', :B, 'private', array['x'], now());
commit;
select banc.verifier('P1. un tiers ne s''inscrit pas hôte d''une session non revendiquée',
  (select host_id is null from public.playlists where session_id = 'LIBRE'));
select banc.verifier('P2. un tiers ne change ni mode, ni prix, ni co-hôtes',
  (select mode = 'paid' and price_chf is null and cohosts is null from public.playlists where session_id = 'LIBRE'));
select banc.verifier('P3. un participant n''approuve pas sa propre demande d''accès',
  (select count(*) from public.access_requests where status = 'approved') = 0);
select banc.verifier('P4. nouvelle session créée par un compte : colonnes d''accès vides (backend)',
  (select host_id = :B and mode is null and cohosts is null and live_ended_at is null
     from public.playlists where session_id = 'NEUVE-B'));
begin; set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","email":"a@exemple.test","role":"authenticated"}';
update public.playlists set access_mode = 'guest', description = 'Mon live', tracks = '[{"id":1}]',
                            mode = 'private', live_ended_at = now() where session_id = 'HOTE-A';
commit;
select banc.verifier('P5. l''hôte garde ses réglages navigateur (access_mode, description, pistes)',
  (select access_mode = 'guest' and description = 'Mon live' and tracks = '[{"id":1}]'::jsonb from public.playlists where session_id = 'HOTE-A'));
select banc.verifier('P6. l''hôte ne pose pas mode / fin du Live hors backend',
  (select mode = 'paid' and live_ended_at is null from public.playlists where session_id = 'HOTE-A'));
begin; set local role service_role;
update public.playlists set host_id = :A where session_id = 'LIBRE';
update public.access_requests set status = 'approved' where id = 1;
commit;
select banc.verifier('P7. le backend revendique et approuve normalement',
  (select host_id = :A from public.playlists where session_id = 'LIBRE')
  and (select status = 'approved' from public.access_requests where id = 1));
