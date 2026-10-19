#!/bin/bash
# Banc post-S0 — migration 04 « session sans hôte » (infra/post-s0/migrations/04_session_sans_hote*.sql).
# Postgres 16 LOCAL et JETABLE (jamais la production), aux DEUX schémas réels (infra/s0/banc/10_etat_actuel.sql) :
#   bt = boosttribe.pro (playlists_update sans « hôte vide »), live = afroboost.com/live (avec « hôte vide »).
# Rôles comme Supabase 15 (supabase_admin superutilisateur, postgres NON superutilisateur) ; migrations en supabase_admin.
# Par variante, trois bases :
#   e1_<v>  ÉTAT « 01 seul »  : 00+01 → mesure → tests AVANT_04 → 04 ×2 → APRES_04 → rollback ×2 → ROLLBACK
#                               (règles identiques) → 04 → 02 par-dessus → 04_PUIS_02
#   e12_<v> ÉTAT « 01+02 »   : tests S0 AVANT → 01+02 → tests S0 (S0_APRES) → AVANT_04 → 04 ×2 → tests S0 rejoués
#                               (S0_APRES_04) → APRES_04 → rollback ×2 → ROLLBACK → rollback_s0 : règles d'origine
#   d_<v>   DONNÉES réelles synthétiques : 01+02 → 04 → rollback 04 : empreintes (profils, grand livre, sessions…)
#                               et soldes inchangés (tests S0 40/45 rejoués).
# Usage : bash infra/post-s0/banc_session_sans_hote.sh [bt|live]   (sans argument : les deux)
#         BANC_TMP=<dossier> pour les fichiers temporaires (défaut : $TMPDIR ou /tmp) ; connexion TCP 127.0.0.1.
set -u
ICI=$(cd "$(dirname "$0")" && pwd); RACINE=$(cd "$ICI/../.." && pwd); S0B="$RACINE/infra/s0/banc"; M="$ICI/migrations"
PGBIN=${PGBIN:-/opt/homebrew/opt/postgresql@16/bin}
TMP=$(mktemp -d "${BANC_TMP:-${TMPDIR:-/tmp}}/banc_ps4.XXXXXX"); PORT=${PORT:-54334}
trap '"$PGBIN/pg_ctl" -D "$TMP/data" stop -m fast >/dev/null 2>&1; rm -rf "$TMP"' EXIT
"$PGBIN/initdb" -D "$TMP/data" -U supabase_admin -A trust >/dev/null || exit 1
"$PGBIN/pg_ctl" -D "$TMP/data" -o "-p $PORT -k '' -c listen_addresses=127.0.0.1" -l "$TMP/log" start -w >/dev/null || exit 1
P() { "$PGBIN/psql" -h 127.0.0.1 -p "$PORT" -U supabase_admin -d "$1" -v ON_ERROR_STOP=1 -q -X "${@:2}"; }
P postgres -c "create role postgres nosuperuser createrole createdb login; create role anon nologin;
  create role authenticated nologin; create role service_role nologin bypassrls;" >/dev/null || exit 1
run() { P "$1" -f "$2" "${@:3}" >>"$TMP/sortie" 2>&1 || { echo "ÉCHEC d'exécution : $2 ($1)"; tail -20 "$TMP/sortie"; exit 1; }; }
phase() { P postgres -c "alter database $1 set banc.phase = '$2'" >/dev/null; }
verif() { P "$1" -c "select banc.verifier($2);" >/dev/null || { echo "ÉCHEC contrôle ($1)"; exit 1; }; }
prep() {   # identique à infra/s0/banc/banc_s0.sh
  P postgres -c "create database $1" >/dev/null
  P "$1" -c "create schema banc; create table banc.resultats(n serial, phase text, nom text, ok boolean);
    create table banc.instantanes(etape text, tableau text, empreinte text);
    grant usage on schema banc to public; grant all on all tables in schema banc to public;
    grant all on all sequences in schema banc to public;
    create function banc.verifier(nom text, ok boolean) returns void language sql security definer as
      \$\$ insert into banc.resultats(phase, nom, ok) values (current_setting('banc.phase'), nom, coalesce(ok,false)) \$\$;
    grant execute on function banc.verifier(text, boolean) to public;
    create table banc.comportement(phase text, nom text, ok boolean);
    create function banc.noter(nom text, ok boolean) returns void language sql security definer as
      \$\$ insert into banc.comportement values (current_setting('banc.phase'), nom, ok) \$\$;
    grant execute on function banc.noter(text, boolean) to public;
    create function banc.essai(nom text, claims text, requete text) returns void language plpgsql as \$\$
    begin
      perform set_config('request.jwt.claims', claims, true);
      begin
        set local role authenticated;
        execute requete;
        reset role; perform banc.noter(nom, true);
      exception when others then
        reset role; perform banc.noter(nom, false);
      end;
    end \$\$;" >/dev/null
  P postgres -c "alter database $1 set banc.variante = '$2'" >/dev/null
  run "$1" "$S0B/00_supabase_simule.sql"
  if [ "$2" = live ]; then
    P "$1" -v live=true -c "set role postgres" -f "$S0B/10_etat_actuel.sql" >>"$TMP/sortie" 2>&1
  else
    P "$1" -v live=false -f "$S0B/10_etat_actuel.sql" >>"$TMP/sortie" 2>&1
  fi || { echo "ÉCHEC état initial ($1)"; tail -15 "$TMP/sortie"; exit 1; }
  run "$1" "$RACINE/infra/s0/00_urgent_wallet_add.sql"
}
# Instantané des règles RLS (profiles, playlists, access_requests) sous le nom $2.
snap() { P "$1" -c "create table if not exists banc.regles(etape text, tablename text, policyname text, cmd text, permissive text, qual text, wc text, roles text);
  delete from banc.regles where etape = '$2';
  insert into banc.regles select '$2', tablename, policyname, cmd, permissive, coalesce(qual,''), coalesce(with_check,''), roles::text
    from pg_policies where schemaname='public' and tablename in ('profiles','access_requests','playlists');" >/dev/null; }
memes_regles() {   # $1 base, $2 étape de référence, $3 libellé
  snap "$1" courant
  verif "$1" "\$L\$$3\$L\$, (select count(*) = 0 from (
      (select tablename, policyname, cmd, permissive, qual, wc, roles from banc.regles where etape = '$2'
       except select tablename, policyname, cmd, permissive, qual, wc, roles from banc.regles where etape = 'courant')
      union all
      (select tablename, policyname, cmd, permissive, qual, wc, roles from banc.regles where etape = 'courant'
       except select tablename, policyname, cmd, permissive, qual, wc, roles from banc.regles where etape = '$2')) d)"
}
empreintes() { P "$1" -c "create table if not exists banc.emp(etape text, tableau text, e text);
  insert into banc.emp select '$2', t, e from (
    select 'profiles' t, md5(coalesce(string_agg(to_jsonb(p)::text, '|' order by p.id), '')) e from public.profiles p
    union all select 'credit_ledger', md5(coalesce(string_agg(to_jsonb(l)::text, '|' order by l.id), '')) from public.credit_ledger l
    union all select 'playlists', md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.session_id), '')) from public.playlists x) z;" >/dev/null; }
memes_empreintes() { verif "$1" "\$L\$$3\$L\$, (select count(*) = 0 from banc.emp a join banc.emp b using (tableau)
    where a.etape = '$2' and b.etape = '$4' and a.e is distinct from b.e) and (select count(*) = 3 from banc.emp where etape = '$4')"; }
etat04() { verif "$1" "\$L\$$2\$L\$, (select (regexp_replace(qual, '\s+', '', 'g') like '%host_idISNULL%') = $3
    from pg_policies where tablename = 'playlists' and policyname = 'playlists_update')"; }

VARIANTES=${1:-"bt live"}
for V in $VARIANTES; do
  [ "$V" = live ] && FAILLE=true || FAILLE=false
  # ── ÉTAT « 01 seul » ──────────────────────────────────────────────────────────────────
  B="e1_$V"; prep "$B" "$V"
  run "$B" "$RACINE/infra/s0/01_s0_additif.sql"
  P "$B" -f "$M/04_session_sans_hote_mesure.sql" >"$TMP/mesure_$B" 2>&1 || { echo "ÉCHEC mesure ($B)"; cat "$TMP/mesure_$B"; exit 1; }
  phase "$B" "$V:E1:AVANT_04"; run "$B" "$ICI/banc/60_tests_sans_hote.sql"
  snap "$B" avant_04; empreintes "$B" avant_04
  run "$B" "$M/04_session_sans_hote.sql"; run "$B" "$M/04_session_sans_hote.sql"
  phase "$B" "$V:E1:APRES_04"; run "$B" "$ICI/banc/60_tests_sans_hote.sql"
  etat04 "$B" "M1. après 04 : plus aucun « host_id IS NULL » dans playlists_update" false
  verif "$B" "'M2. 04 rejouée 2× sans erreur ; sauvegarde présente seulement si la base avait la faille',
    (to_regclass('public.ps0_04_sauvegarde_policy') is not null) = $FAILLE"
  empreintes "$B" apres_04; memes_empreintes "$B" avant_04 "M3. 04 ne modifie AUCUNE donnée (profils, grand livre, sessions)" apres_04
  run "$B" "$M/04_session_sans_hote_rollback.sql"; run "$B" "$M/04_session_sans_hote_rollback.sql"
  phase "$B" "$V:E1:ROLLBACK"
  memes_regles "$B" avant_04 "R1. rollback (×2) : règles RLS IDENTIQUES à l'état d'avant 04 (01 seul)"
  verif "$B" "'R2. rollback : sauvegarde retirée', to_regclass('public.ps0_04_sauvegarde_policy') is null"
  run "$B" "$ICI/banc/60_tests_sans_hote.sql"
  run "$B" "$M/04_session_sans_hote.sql"; run "$B" "$RACINE/infra/s0/02_s0_verrou.sql"
  phase "$B" "$V:E1:04_PUIS_02"; run "$B" "$ICI/banc/60_tests_sans_hote.sql"
  empreintes "$B" fin; memes_empreintes "$B" avant_04 "M4. tous les essais annulés : données identiques" fin

  # ── ÉTAT « 01 + 02 » (production depuis le 19/10) ───────────────────────────────────────
  B="e12_$V"; prep "$B" "$V"
  snap "$B" origine
  phase "$B" "$V:AVANT"; run "$B" "$S0B/20_tests_s0.sql"
  run "$B" "$RACINE/infra/s0/01_s0_additif.sql"; run "$B" "$RACINE/infra/s0/02_s0_verrou.sql"
  phase "$B" "$V:S0_APRES"; run "$B" "$S0B/20_tests_s0.sql"; run "$B" "$S0B/30_tests_vue.sql"
  P "$B" -f "$M/04_session_sans_hote_mesure.sql" >"$TMP/mesure_$B" 2>&1 || { echo "ÉCHEC mesure ($B)"; cat "$TMP/mesure_$B"; exit 1; }
  phase "$B" "$V:E12:AVANT_04"; run "$B" "$ICI/banc/60_tests_sans_hote.sql"
  snap "$B" avant_04; empreintes "$B" avant_04
  run "$B" "$M/04_session_sans_hote.sql"; run "$B" "$M/04_session_sans_hote.sql"
  phase "$B" "$V:E12:MIGRATION_04"
  etat04 "$B" "M1. après 04 : plus aucun « host_id IS NULL » dans playlists_update" false
  phase "$B" "$V:S0_APRES_04"; run "$B" "$S0B/20_tests_s0.sql"; run "$B" "$S0B/30_tests_vue.sql"
  verif "$B" "'S0. verrous S0 intacts après 04 (3 règles profils s0_*, 2 déclencheurs)',
    (select count(*) = 3 from pg_policies where tablename = 'profiles' and policyname like 's0\_%')
    and (select count(*) = 2 from pg_trigger where tgname in ('s0_proteger_profil', 's0_proteger_playlist'))"
  empreintes "$B" apres_s0_04
  phase "$B" "$V:E12:APRES_04"; run "$B" "$ICI/banc/60_tests_sans_hote.sql"
  run "$B" "$M/04_session_sans_hote_rollback.sql"; run "$B" "$M/04_session_sans_hote_rollback.sql"
  phase "$B" "$V:E12:ROLLBACK"
  memes_regles "$B" avant_04 "R1. rollback (×2) : règles RLS IDENTIQUES à l'état d'avant 04 (01+02)"
  etat04 "$B" "R3. rollback : règle d'origine de la base rétablie (« hôte vide » = $FAILLE)" "$FAILLE"
  run "$B" "$ICI/banc/60_tests_sans_hote.sql"
  run "$B" "$RACINE/infra/s0/rollback_s0.sql"
  phase "$B" "$V:E12:ROLLBACK_S0"
  memes_regles "$B" origine "R4. 04 + rollback 04 + rollback_s0 : règles d'ORIGINE (avant S0) recréées à l'identique"

  # ── DONNÉES réelles synthétiques ────────────────────────────────────────────────────────
  B="d_$V"; prep "$B" "$V"
  run "$B" "$S0B/15_donnees_reelles.sql"
  phase "$B" "$V:DONNEES"
  run "$B" "$S0B/40_tests_donnees_reelles.sql" -v etape=avant_m1
  run "$B" "$RACINE/infra/s0/01_s0_additif.sql"; run "$B" "$RACINE/infra/s0/02_s0_verrou.sql"
  run "$B" "$S0B/40_tests_donnees_reelles.sql" -v etape=apres_m2
  P "$B" -f "$M/04_session_sans_hote_mesure.sql" >"$TMP/mesure_$B" 2>&1 || { echo "ÉCHEC mesure ($B)"; cat "$TMP/mesure_$B"; exit 1; }
  run "$B" "$M/04_session_sans_hote.sql"
  run "$B" "$S0B/40_tests_donnees_reelles.sql" -v etape=apres_04
  run "$B" "$S0B/45_tests_solde_et_proprietaires.sql"
  run "$B" "$M/04_session_sans_hote_rollback.sql"
  run "$B" "$S0B/40_tests_donnees_reelles.sql" -v etape=apres_rollback_04
  run "$B" "$S0B/45_tests_solde_et_proprietaires.sql"
  # État inattendu : une 2e règle UPDATE (ou une forme inconnue) → 04 S'ARRÊTE sans rien modifier.
  snap "$B" avant_refus
  P "$B" -c "create policy banc_intrus on public.playlists for update to authenticated using (true)" >/dev/null
  if P "$B" -f "$M/04_session_sans_hote.sql" >>"$TMP/sortie" 2>&1; then OKR=false; else OKR=true; fi
  P "$B" -c "drop policy banc_intrus on public.playlists" >/dev/null
  memes_regles "$B" avant_refus "X1. 2e règle UPDATE présente : 04 s'arrête (refus=$OKR) et ne change aucune règle"
  verif "$B" "'X1b. refus constaté', $OKR"
  P "$B" -c "alter policy playlists_update on public.playlists using (true)" >/dev/null
  if P "$B" -f "$M/04_session_sans_hote.sql" >>"$TMP/sortie" 2>&1; then OKR=false; else OKR=true; fi
  verif "$B" "'X2. forme inconnue de playlists_update : 04 s''arrête', $OKR and to_regclass('public.ps0_04_sauvegarde_policy') is null"

  for B in "e1_$V" "e12_$V" "d_$V"; do
    P "$B" -At -F ' ' -c "select phase, case when ok then 'OK    ' else 'ECHEC ' end, nom from banc.resultats order by n" >>"$TMP/resultats"
  done
done
cat "$TMP/resultats"
echo "--- mesure (lecture seule) avant 04 — base « données réelles » :"
for V in $VARIANTES; do echo "[$V]"; grep -v '^$' "$TMP/mesure_d_$V"; done
echo "--- bilan par phase"
for V in $VARIANTES; do for B in "e1_$V" "e12_$V" "d_$V"; do
  P "$B" -At -c "select phase || ' : ' || count(*) filter (where ok) || '/' || count(*) from banc.resultats group by phase order by min(n)"
done; done
grep -c "ECHEC" "$TMP/resultats" | sed 's/^/échecs (dont failles attendues AVANT_04 \/ ROLLBACK sur live) : /'
