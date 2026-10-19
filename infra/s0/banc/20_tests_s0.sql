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
update public.profiles set full_name = 'Alice Nouveau', avatar_url = 'https://x/a.png', terms_accepted = true where id = :A;
update public.profiles set credits = 0 where id = :B;      -- et sur le profil d'un AUTRE
commit;
select banc.verifier('3. A modifie ses credits → refus (reste 5)', (select credits from public.profiles where id = :A) = 5);
select banc.verifier('4. A change son role → refus', (select role from public.profiles where id = :A) = 'user');
select banc.verifier('4b. A change subscription_status → refus', (select subscription_status from public.profiles where id = :A) = 'free');
select banc.verifier('5. A se donne comp_access → refus', (select comp_access_plan from public.profiles where id = :A) is null);
select banc.verifier('5b. A change son e-mail / coach_payment_type → refus',
  (select email = 'a@exemple.test' and coach_payment_type = 'subscription' from public.profiles where id = :A));
select banc.verifier('5c. A modifie nom / photo / CGU → OK (légitime)',
  (select full_name = 'Alice Nouveau' and avatar_url = 'https://x/a.png' and terms_accepted from public.profiles where id = :A));
select banc.verifier('5d. A modifie le profil de B → refus', (select credits from public.profiles where id = :B) = 2);

-- 5e. création de SON profil avec des valeurs forgées
begin; set local role authenticated;
set local request.jwt.claims = '{"sub":"cccccccc-0000-0000-0000-00000000000c","email":"c@exemple.test","role":"authenticated"}';
insert into public.profiles (id, email, full_name, role, subscription_status, credits, comp_access_plan, coach_payment_type, live_preferences)
values (:C, 'contact.artboost@gmail.com', 'Carl', 'admin', 'enterprise', 999999, 'enterprise', 'commission', '{"x":1}');
commit;
select banc.verifier('5e. création forgée → valeurs sûres (crédits 0, user, sans accès, vrai e-mail)',
  (select credits = 0 and role = 'user' and subscription_status = 'free' and comp_access_plan is null
          and coach_payment_type = 'subscription' and email = 'c@exemple.test' and full_name = 'Carl'
     and live_preferences is null
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
-- (en postgres : ces lignes de départ ne passent pas par le verrou)
insert into public.access_requests (id, session_id, requester_user_id, requester_name)
  values (1, 'HOTE-A', :B, 'Bob'), (2, 'LIBRE', :B, 'Bob');
begin; set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-00000000000b","email":"b@exemple.test","role":"authenticated"}';
update public.playlists set host_id = :B, mode = 'private', cohosts = '["bbbbbbbb-0000-0000-0000-00000000000b"]'::jsonb,
                            price_chf = 0 where session_id = 'LIBRE';
update public.access_requests set status = 'approved' where id in (1, 2);
insert into public.playlists (session_id, host_id, mode, cohosts, live_ended_at)
  values ('NEUVE-B', :B, 'private', '["x"]'::jsonb, now());
commit;
select banc.verifier('P1. un tiers ne s''inscrit pas hôte d''une session non revendiquée',
  (select host_id is null from public.playlists where session_id = 'LIBRE'));
select banc.verifier('P2. un tiers ne change ni mode, ni prix, ni co-hôtes',
  (select mode = 'paid' and price_chf is null and coalesce(cohosts, '[]'::jsonb) = '[]'::jsonb from public.playlists where session_id = 'LIBRE'));
select banc.verifier('P3. un participant n''approuve pas sa propre demande d''accès',
  (select count(*) from public.access_requests where status = 'approved') = 0);
select banc.verifier('P4. nouvelle session créée par un compte : colonnes d''accès vides (backend)',
  (select host_id = :B and mode = 'open' and coalesce(cohosts, '[]'::jsonb) = '[]'::jsonb and live_ended_at is null
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

-- ── upserts du navigateur (onConflict session_id) : résultat IDENTIQUE avant et après S0 ──
-- Constat du 19/10 : sur les DEUX bases réelles, la RLS existante REFUSE déjà l'upsert SANS host_id
-- (saveSessionPrivacy / saveSharedMedia / saveSessionDescription) — défaut antérieur à S0. S0 ne doit
-- ni le casser davantage ni le masquer : chaque essai est noté, et comparé à la phase AVANT.
-- Comparaison à données ÉGALES : en phase AVANT, le test 5 a pu donner à A un accès illimité forgé
-- (la faille existe avant S0) — ce qui ouvrirait la règle de lecture. On remet A à l'état neutre.
update public.profiles set comp_access_plan = null, comp_access_until = null, role = 'user', subscription_status = 'free',
       coach_payment_type = 'subscription', email = 'a@exemple.test' where id = :A;
\set essai_hote '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","email":"a@exemple.test","role":"authenticated"}'
select banc.essai('upsert_sans_host_id', :'essai_hote',
  $q$insert into public.playlists (session_id, is_private, description, updated_at) values ('HOTE-A', true, 'upsert', now())
     on conflict (session_id) do update set is_private = excluded.is_private, description = excluded.description,
                                            updated_at = excluded.updated_at$q$);
select banc.essai('upsert_avec_host_id', :'essai_hote',
  $q$insert into public.playlists (session_id, tracks, selected_track_id, updated_at, host_id)
     values ('HOTE-A', '[{"id":2}]', '2', now(), 'aaaaaaaa-0000-0000-0000-00000000000a')
     on conflict (session_id) do update set tracks = excluded.tracks, selected_track_id = excluded.selected_track_id,
       updated_at = excluded.updated_at, host_id = excluded.host_id$q$);
select banc.essai('update_hote', :'essai_hote',
  $q$update public.playlists set description = 'maj hôte', access_mode = 'guest' where session_id = 'HOTE-A'$q$);
select banc.essai('insert_session_neuve', :'essai_hote',
  $q$insert into public.playlists (session_id, access_mode, updated_at, host_id)
     values ('SESS-NEUVE-A', 'guest', now(), 'aaaaaaaa-0000-0000-0000-00000000000a')$q$);
select banc.verifier('U1. écritures navigateur de l''hôte : même résultat qu''avant S0 (' || string_agg(b.nom || '=' || b.ok, ', ') || ')',
  bool_and(a.ok = b.ok))
  from banc.comportement b join banc.comportement a on a.nom = b.nom and a.phase like '%:AVANT'
 where b.phase = current_setting('banc.phase') and current_setting('banc.phase') not like '%:AVANT';
select banc.verifier('U1b. l''hôte peut toujours mettre à jour SA session et créer une session neuve (accès)',
  (select bool_and(ok) from banc.comportement where phase = current_setting('banc.phase')
     and nom in ('upsert_avec_host_id','update_hote','insert_session_neuve')));
-- session SANS hôte : un tiers ne pose ni access_mode, ni is_private, ni lien de promo
insert into public.playlists (session_id) values ('VIDE');
-- Chaque tentative est isolée : selon la règle RLS de la base, elle échoue (erreur) ou passe sans effet.
do $$ begin
  perform set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-00000000000b","email":"b@exemple.test","role":"authenticated"}', true);
  set local role authenticated;
  begin update public.playlists set access_mode = 'guest', is_private = true, description = 'tiers' where session_id = 'VIDE';
  exception when insufficient_privilege then null; end;
  begin insert into public.playlists (session_id, access_mode, is_private) values ('VIDE', 'guest', true)
          on conflict (session_id) do update set access_mode = excluded.access_mode, is_private = excluded.is_private;
  exception when insufficient_privilege then null; end;
  begin insert into public.playlists (session_id, access_mode, is_private, created_at) values ('VIDE-NEUVE', 'guest', true, '1970-01-01');
  exception when insufficient_privilege then null; end;
  reset role;
end $$;
select banc.verifier('U2. session sans hôte : un tiers ne pose PAS access_mode / is_private',
  (select access_mode is distinct from 'guest' and coalesce(is_private, false) = false from public.playlists where session_id = 'VIDE'));
-- U3 dépend de la RÈGLE RLS réelle : /live laisse écrire une session sans hôte, boosttribe.pro non.
select banc.verifier('U3. session sans hôte : le contenu suit la règle RLS de la base (' || current_setting('banc.variante') || ')',
  (select case when current_setting('banc.variante') = 'live' then description = 'tiers' else description is distinct from 'tiers' end
     from public.playlists where session_id = 'VIDE'));
select banc.verifier('U4. création sans hôte : réglages d''accès vides, created_at jamais antidaté',
  (select access_mode is distinct from 'guest' and coalesce(is_private, false) = false and created_at > now() - interval '1 hour'
     from public.playlists where session_id = 'VIDE-NEUVE'));

-- ── portefeuille CHF : un utilisateur (ou un anonyme) ne peut pas se créditer ──
do $$ begin
  set local role anon;
  begin
    perform public.wallet_add('aaaaaaaa-0000-0000-0000-00000000000a', 50000, 'sale', 'pirate', true);
    reset role; perform banc.verifier('W0. anonyme appelle wallet_add (portefeuille CHF) → refus', false);
  exception when insufficient_privilege then
    reset role; perform banc.verifier('W0. anonyme appelle wallet_add (portefeuille CHF) → refus', true);
  end;
end $$;
-- ── création du profil d'UN AUTRE compte ──
insert into auth.users values ('dddddddd-0000-0000-0000-00000000000d', 'd@exemple.test') on conflict do nothing;
do $$ begin
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","email":"a@exemple.test","role":"authenticated"}', true);
  begin
    insert into public.profiles (id, full_name) values ('dddddddd-0000-0000-0000-00000000000d', 'Faux');
    reset role; perform banc.verifier('I0. A crée le profil d''un AUTRE compte → refus', false);
  exception when insufficient_privilege then
    reset role; perform banc.verifier('I0. A crée le profil d''un AUTRE compte → refus', true);
  end;
end $$;

select banc.verifier('U5. upsert de l''hôte AVEC host_id (savePlaylist) appliqué malgré les colonnes NOT NULL',
  (select tracks = '[{"id":2}]'::jsonb and mode = 'paid' from public.playlists where session_id = 'HOTE-A'));
select banc.verifier('U6. création de SA session : mode par défaut ''open'', access_mode de l''hôte conservé',
  (select mode = 'open' and access_mode = 'guest' and host_id = :A from public.playlists where session_id = 'SESS-NEUVE-A'));
