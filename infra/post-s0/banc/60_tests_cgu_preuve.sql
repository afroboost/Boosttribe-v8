-- Banc post-S0 — 03 : preuve datée et versionnée des CGU (accepter_cgu + trigger s0_proteger_profil_cgu).
-- Joué APRÈS 03, sur les états « 01 seul » et « 01 + 02 », schémas bt et live. Mêmes attentes partout :
-- la preuve ne dépend PAS de la présence du verrou 02.
-- Chaque bloc DO = une transaction distincte (now() avance entre deux blocs).
create table banc_res(n serial, nom text, ok boolean);
create table banc_memo(cle text primary key, val timestamptz);
grant all on banc_res, banc_memo to public; grant all on sequence banc_res_n_seq to public;
insert into auth.users(id, email) values
  ('30000000-0000-0000-0000-00000000000a', 'sans.ligne@exemple.invalid'),
  ('30000000-0000-0000-0000-00000000000b', 'tiers@exemple.invalid'),
  ('30000000-0000-0000-0000-00000000000c', 'ancien@exemple.invalid'),
  ('30000000-0000-0000-0000-00000000000d', 'ancien.front@exemple.invalid'),
  ('30000000-0000-0000-0000-00000000000e', 'insertion.directe@exemple.invalid'),
  ('30000000-0000-0000-0000-00000000000f', 'inscrit.email@exemple.invalid');
-- Comptes EXISTANTS avant 03 : jamais réputés avoir accepté.
insert into public.profiles(id, email, full_name) values
  ('30000000-0000-0000-0000-00000000000c', 'ancien@exemple.invalid', 'Ancien'),
  ('30000000-0000-0000-0000-00000000000d', 'ancien.front@exemple.invalid', 'Ancien front');

-- Exécute une requête sous le rôle `authenticated` (ou `anon` si claims = '') ; renvoie 'ok' ou le SQLSTATE.
create function banc_essai(claims text, requete text) returns text language plpgsql as $$
declare etat text;
begin
  perform set_config('request.jwt.claims', claims, true);
  begin
    if claims = '' then execute 'set local role anon'; else execute 'set local role authenticated'; end if;
    execute requete;
    reset role;
    return 'ok';
  exception when others then
    reset role;
    get stacked diagnostics etat = returned_sqlstate;
    return etat;
  end;
end $$;
create function cl(lettre text, extra text default '') returns text language sql as $$
  select '{"sub":"30000000-0000-0000-0000-00000000000' || lettre || '","role":"authenticated","email":"'
    || (select email from auth.users where id = ('30000000-0000-0000-0000-00000000000' || lettre)::uuid) || '"' || extra || '}'
$$;
create function prof(lettre text) returns public.profiles language sql as $$
  select * from public.profiles where id = ('30000000-0000-0000-0000-00000000000' || lettre)::uuid
$$;
create function ok(nom text, cond boolean) returns void language sql as $$
  insert into banc_res(nom, ok) values (nom, coalesce(cond, false))
$$;

-- ── 1. Colonnes : présentes, sans valeur par défaut, aucun remplissage rétroactif ──
do $$ begin
  perform ok('P1 colonnes terms_accepted_at + terms_version présentes, SANS valeur par défaut',
    (select count(*) = 2 and bool_and(column_default is null) from information_schema.columns
      where table_schema = 'public' and table_name = 'profiles' and column_name in ('terms_accepted_at','terms_version')));
  perform ok('P2 ancien compte : terms_accepted=false, aucune date, aucune version (aucun faux consentement)',
    (prof('c')).terms_accepted is false and (prof('c')).terms_accepted_at is null and (prof('c')).terms_version is null);
end $$;

-- ── 2. Anonyme : aucune écriture de preuve ──
do $$ declare r text; begin
  r := banc_essai('', $q$select public.accepter_cgu('2026-10-19')$q$);
  perform ok('P3 ANONYME : accepter_cgu refusée [' || r || ']', r = '42501');
  r := banc_essai('', $q$update public.profiles set terms_accepted = true, terms_accepted_at = '2020-01-01' where id = '30000000-0000-0000-0000-00000000000c'$q$);
  perform ok('P4 ANONYME : écriture directe sans effet [' || r || ']', (prof('c')).terms_accepted is false and (prof('c')).terms_accepted_at is null);
end $$;

-- ── 3. Acceptation SANS ligne profiles : la ligne est créée, preuve serveur ──
do $$ declare r text; p public.profiles; begin
  r := banc_essai(cl('a'), $q$select public.accepter_cgu('2026-10-19')$q$);
  p := prof('a');
  perform ok('P5 sans ligne : accepter_cgu réussit [' || r || ']', r = 'ok');
  perform ok('P6 sans ligne : ligne CRÉÉE, acceptée, version 2026-10-19, date = maintenant (serveur)',
    p.id is not null and p.terms_accepted is true and p.terms_version = '2026-10-19' and p.terms_accepted_at = now());
  perform ok('P7 ligne créée sans privilège (role=' || coalesce(p.role,'-') || ', abo=' || coalesce(p.subscription_status,'-')
    || ', email du compte)', p.role = 'user' and p.subscription_status = 'none' and coalesce(p.credits, 0) = 0 and p.email = 'sans.ligne@exemple.invalid'
    and p.comp_access_plan is null);
  insert into banc_memo values ('a', p.terms_accepted_at);
end $$;
-- Le retour de la fonction est la ligne RELUE (ce que le front confirme)
do $$ declare r record; begin
  perform set_config('request.jwt.claims', cl('a'), true);
  set local role authenticated;
  select * into r from public.accepter_cgu('2026-10-19');
  reset role;
  perform ok('P8 ré-acceptation même version : idempotente, date d''ORIGINE gardée, retour = ligne relue',
    r.accepte is true and r.version = '2026-10-19' and r.accepte_le = (select val from banc_memo where cle = 'a')
    and r.accepte_le < now());
end $$;

-- ── 4. Antidater / falsifier / revenir à false : impossible ──
do $$ declare r text; avant timestamptz := (select val from banc_memo where cle = 'a'); begin
  r := banc_essai(cl('a'), $q$update public.profiles set terms_accepted_at = '2020-01-01', terms_version = '2099-12-31' where id = '30000000-0000-0000-0000-00000000000a'$q$);
  perform ok('P9 antidater / changer la version à la main : sans effet [' || r || ']',
    (prof('a')).terms_accepted_at = avant and (prof('a')).terms_version = '2026-10-19');
  r := banc_essai(cl('a'), $q$update public.profiles set terms_accepted = false where id = '30000000-0000-0000-0000-00000000000a'$q$);
  perform ok('P10 revenir à false : sans effet [' || r || ']', (prof('a')).terms_accepted is true and (prof('a')).terms_accepted_at = avant);
  r := banc_essai(cl('a'), $q$insert into public.profiles(id, terms_accepted, terms_accepted_at, terms_version) values ('30000000-0000-0000-0000-00000000000a', false, '2020-01-01', 'x')
      on conflict (id) do update set terms_accepted = false, terms_accepted_at = '2020-01-01', terms_version = 'x'$q$);
  perform ok('P11 upsert falsifié (false + date + version) : sans effet [' || r || ']',
    (prof('a')).terms_accepted is true and (prof('a')).terms_accepted_at = avant and (prof('a')).terms_version = '2026-10-19');
  r := banc_essai(cl('a'), $q$select public.accepter_cgu('2026-01-01')$q$);
  perform ok('P12 recul de version refusé (version conservée) [' || r || ']', (prof('a')).terms_version = '2026-10-19' and (prof('a')).terms_accepted_at = avant);
end $$;
do $$ declare r text; begin
  r := banc_essai(cl('a'), $q$select public.accepter_cgu('2099-01-01')$q$);
  perform ok('P13 version FUTURE refusée [' || r || ']', r = '22023');
  r := banc_essai(cl('a'), $q$select public.accepter_cgu('2026-02-30')$q$);
  perform ok('P14 version impossible refusée [' || r || ']', r = '22023');
  r := banc_essai(cl('a'), $q$select public.accepter_cgu('v1; drop table x')$q$);
  perform ok('P15 version non conforme refusée [' || r || ']', r = '22023');
  r := banc_essai(cl('a'), $q$select public.accepter_cgu(null)$q$);
  perform ok('P16 version absente refusée [' || r || ']', r = '22023');
end $$;

-- ── 5. Tiers : ne touche jamais la preuve d'autrui ──
do $$ declare r text; avant timestamptz := (select val from banc_memo where cle = 'a'); begin
  r := banc_essai(cl('b'), $q$update public.profiles set terms_accepted = false, terms_accepted_at = '2020-01-01' where id = '30000000-0000-0000-0000-00000000000a'$q$);
  perform ok('P17 TIERS : mise à jour de la preuve d''autrui sans effet [' || r || ']',
    (prof('a')).terms_accepted is true and (prof('a')).terms_accepted_at = avant);
  r := banc_essai(cl('b'), $q$update public.profiles set terms_accepted = true where id = '30000000-0000-0000-0000-00000000000c'$q$);
  perform ok('P18 TIERS : ne peut pas accepter POUR un autre [' || r || ']', (prof('c')).terms_accepted is false);
  r := banc_essai(cl('b', ',"sub_cible":"30000000-0000-0000-0000-00000000000c"'), $q$select public.accepter_cgu('2026-10-19')$q$);
  perform ok('P19 accepter_cgu n''agit QUE sur l''appelant (tiers accepté, ancien intact)',
    (prof('b')).terms_accepted is true and (prof('c')).terms_accepted is false);
end $$;

-- ── 6. Ancien front (écriture directe terms_accepted=true) : datée par le serveur, version non précisée ──
do $$ declare r text; begin
  r := banc_essai(cl('d'), $q$update public.profiles set terms_accepted = true, terms_accepted_at = '2020-01-01', terms_version = '2026-10-19', updated_at = now() where id = '30000000-0000-0000-0000-00000000000d'$q$);
  perform ok('P20 ancien front : acceptation enregistrée, date SERVEUR (pas 2020), version NULLE [' || r || ']',
    (prof('d')).terms_accepted is true and (prof('d')).terms_accepted_at = now() and (prof('d')).terms_version is null);
  r := banc_essai(cl('e'), $q$insert into public.profiles(id, email, full_name, terms_accepted, terms_accepted_at, terms_version)
      values ('30000000-0000-0000-0000-00000000000e', 'insertion.directe@exemple.invalid', 'E', true, '2020-01-01', '2026-10-19')$q$);
  perform ok('P21 création directe acceptée : date SERVEUR, version NULLE [' || r || ']',
    (prof('e')).terms_accepted is true and (prof('e')).terms_accepted_at = now() and (prof('e')).terms_version is null);
end $$;
do $$ declare r text; begin
  r := banc_essai(cl('d'), $q$select public.accepter_cgu('2026-10-19')$q$);
  perform ok('P22 version non précisée puis accepter_cgu : version posée, date renouvelée [' || r || ']',
    (prof('d')).terms_version = '2026-10-19' and (prof('d')).terms_accepted_at = now());
end $$;

-- ── 7. Inscription e-mail (métadonnées) : profil créé au 1er appel, nom repris du compte ──
do $$ declare r text; begin
  r := banc_essai(cl('f', ',"user_metadata":{"full_name":"Inscrite Mail","cgu_version":"2026-10-19"}'),
    $q$select public.accepter_cgu('2026-10-19')$q$);
  perform ok('P23 inscription e-mail : preuve enregistrée, nom = métadonnées [' || r || ']',
    (prof('f')).terms_accepted is true and (prof('f')).terms_version = '2026-10-19' and (prof('f')).full_name = 'Inscrite Mail');
end $$;

-- ── 8. Backend : libre, mais jamais une date sans acceptation ──
do $$ declare r text; begin
  begin
    set local role service_role;
    update public.profiles set terms_accepted = false where id = '30000000-0000-0000-0000-00000000000a';
    r := 'ok';
  exception when others then get stacked diagnostics r = returned_sqlstate;
  end;
  reset role;
  perform ok('P24 contrainte : une date d''acceptation sans acceptation est impossible [' || r || ']', r = '23514');
  perform ok('P25 l''ancien compte jamais sollicité reste false', (prof('c')).terms_accepted is false and (prof('c')).terms_accepted_at is null);
end $$;

select case when ok then 'OK    ' else 'ECHEC ' end || nom from banc_res order by n;
select 'BILAN ' || count(*) filter (where ok) || '/' || count(*) from banc_res;
