-- Banc post-S0 — CGU et création de profil, APRÈS S0 étapes 1 et 2 (état réel de production au 19/10/2026).
-- Charges EXACTES envoyées par le navigateur (frontend/src/context/AuthContext.tsx), avant / après correction.
-- Chaque essai tourne dans un SAVEPOINT : les erreurs sont capturées, jamais d'arrêt du banc.
create table banc_res(n serial, nom text, ok boolean);
insert into auth.users(id, email) values
  ('20000000-0000-0000-0000-00000000000a', 'sans.profil@exemple.invalid'),
  ('20000000-0000-0000-0000-00000000000b', 'autre@exemple.invalid'),
  ('20000000-0000-0000-0000-00000000000c', 'existant@exemple.invalid');
insert into public.profiles(id, email, full_name) values ('20000000-0000-0000-0000-00000000000c', 'existant@exemple.invalid', 'Existant');
grant all on banc_res to public; grant all on sequence banc_res_n_seq to public;

create function banc_essai(claims text, requete text) returns text language plpgsql as $$
declare etat text;
begin
  perform set_config('request.jwt.claims', claims, true);
  begin
    execute 'set local role authenticated';
    execute requete;
    reset role;
    return 'ok';
  exception when others then
    reset role;
    get stacked diagnostics etat = returned_sqlstate;
    return etat;
  end;
end $$;

do $$
declare
  ca text := '{"sub":"20000000-0000-0000-0000-00000000000a","role":"authenticated","email":"sans.profil@exemple.invalid"}';
  cb text := '{"sub":"20000000-0000-0000-0000-00000000000b","role":"authenticated","email":"autre@exemple.invalid"}';
  cc text := '{"sub":"20000000-0000-0000-0000-00000000000c","role":"authenticated","email":"existant@exemple.invalid"}';
  r text; p record;
begin
  -- AVANT correction : l'acceptation nommait une colonne inexistante → erreur 42703 (PGRST204 côté API)
  r := banc_essai(cc, $q$update public.profiles set has_accepted_terms = true, updated_at = now() where id = '20000000-0000-0000-0000-00000000000c'$q$);
  insert into banc_res(nom, ok) values ('C1 ANCIENNE acceptation (has_accepted_terms) échoue : 42703 — reproduit le bug [' || r || ']', r = '42703');
  -- APRÈS : charge corrigée d'acceptTerms
  r := banc_essai(cc, $q$update public.profiles set terms_accepted = true, updated_at = now() where id = '20000000-0000-0000-0000-00000000000c'$q$);
  insert into banc_res(nom, ok) values ('C2 acceptation corrigée (terms_accepted) acceptée [' || r || ']', r = 'ok');
  insert into banc_res(nom, ok) values ('C3 acceptation ENREGISTRÉE en base',
    (select terms_accepted from public.profiles where id = '20000000-0000-0000-0000-00000000000c'));
  -- Un autre compte ne peut ni accepter ni refuser à la place de quelqu'un
  r := banc_essai(cb, $q$update public.profiles set terms_accepted = false where id = '20000000-0000-0000-0000-00000000000c'$q$);
  insert into banc_res(nom, ok) values ('C4 un AUTRE compte ne change pas les CGU d''autrui',
    (select terms_accepted from public.profiles where id = '20000000-0000-0000-0000-00000000000c'));
  -- Anonyme : rien
  begin
    set local role anon;
    update public.profiles set terms_accepted = false where id = '20000000-0000-0000-0000-00000000000c';
    reset role;
  exception when others then reset role;
  end;
  insert into banc_res(nom, ok) values ('C5 un ANONYME ne change rien',
    (select terms_accepted from public.profiles where id = '20000000-0000-0000-0000-00000000000c'));
  -- Création de profil : ANCIENNE charge (has_accepted_terms) → échec ; charge CORRIGÉE → OK et valeurs sûres
  r := banc_essai(ca, $q$insert into public.profiles(id, email, full_name, avatar_url, role, subscription_status, has_accepted_terms, created_at, updated_at)
    values ('20000000-0000-0000-0000-00000000000a', 'sans.profil@exemple.invalid', 'sans.profil', '', 'user', 'trial', false, now(), now())$q$);
  insert into banc_res(nom, ok) values ('C6 ANCIENNE création (has_accepted_terms) échoue : 42703 [' || r || ']', r = '42703');
  r := banc_essai(ca, $q$insert into public.profiles(id, email, full_name, avatar_url, role, subscription_status, terms_accepted, created_at, updated_at)
    values ('20000000-0000-0000-0000-00000000000a', 'pirate@exemple.invalid', 'sans.profil', '', 'admin', 'enterprise', true, '2020-01-01', now())$q$);
  insert into banc_res(nom, ok) values ('C7 création corrigée acceptée [' || r || ']', r = 'ok');
  select * into p from public.profiles where id = '20000000-0000-0000-0000-00000000000a';
  insert into banc_res(nom, ok) values ('C8 création : aucun privilège (role=' || coalesce(p.role,'-') || ', abo=' || coalesce(p.subscription_status,'-')
    || ', credits=' || coalesce(p.credits,0) || ', comp=' || coalesce(p.comp_access_plan,'-') || ', email du compte)',
    p.role = 'user' and p.subscription_status = 'free' and coalesce(p.credits,0) = 0 and p.comp_access_plan is null
    and p.email = 'sans.profil@exemple.invalid');
  insert into banc_res(nom, ok) values ('C9 création : CGU acceptables par l''utilisateur lui-même (liste blanche S0) = ' || coalesce(p.terms_accepted::text,'null'),
    p.terms_accepted is true);
  -- Un compte ne crée pas le profil d'un autre
  r := banc_essai(cb, $q$insert into public.profiles(id, full_name, terms_accepted) values ('20000000-0000-0000-0000-00000000000c', 'x', true)$q$);
  insert into banc_res(nom, ok) values ('C10 créer le profil d''un AUTRE est refusé [' || r || ']', r <> 'ok');
  -- Les comptes existants ne sont PAS réputés avoir accepté
  insert into banc_res(nom, ok) values ('C11 valeur par défaut d''un profil existant = false (aucun faux consentement)',
    (select column_default = 'false' from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='terms_accepted'));
end $$;
select case when ok then 'OK    ' else 'ECHEC ' end || nom from banc_res order by n;
select 'BILAN ' || count(*) filter (where ok) || '/' || count(*) from banc_res;
