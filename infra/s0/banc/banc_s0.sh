#!/bin/bash
# Banc S0 — Postgres 16 LOCAL et JETABLE (jamais la production).
#   1. état actuel reproduit → tests (les défauts apparaissent)
#   2. migration étape 1 + 2 → tests (tout doit être OK) ; rejouée 2× (idempotence)
#   3. rollback → l'état d'origine est restauré à l'identique
# Usage : bash infra/s0/banc/banc_s0.sh   (depuis la racine du dépôt)
set -u
ICI=$(cd "$(dirname "$0")" && pwd); RACINE=$(cd "$ICI/../../.." && pwd)
PGBIN=${PGBIN:-/opt/homebrew/opt/postgresql@16/bin}
TMP=$(mktemp -d /tmp/banc_s0.XXXXXX); PORT=${PORT:-54329}
trap '"$PGBIN/pg_ctl" -D "$TMP/data" stop -m fast >/dev/null 2>&1; rm -rf "$TMP"' EXIT
"$PGBIN/initdb" -D "$TMP/data" -U postgres -A trust >/dev/null || exit 1
"$PGBIN/pg_ctl" -D "$TMP/data" -o "-p $PORT -k $TMP -c listen_addresses=''" -l "$TMP/log" start -w >/dev/null || exit 1
PSQL=("$PGBIN/psql" -h "$TMP" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -X)

run() { "${PSQL[@]}" -f "$1" >>"$TMP/sortie" 2>&1 || { echo "ÉCHEC d'exécution : $1"; tail -20 "$TMP/sortie"; exit 1; }; }
"${PSQL[@]}" -c "create schema banc; create table banc.resultats(n serial, phase text, nom text, ok boolean);
  grant usage on schema banc to public; grant all on all tables in schema banc to public;
  grant all on all sequences in schema banc to public;" >/dev/null
"${PSQL[@]}" -c "create function banc.verifier(nom text, ok boolean) returns void language sql security definer as
  \$\$ insert into banc.resultats(phase, nom, ok) values (current_setting('banc.phase'), nom, coalesce(ok,false)) \$\$;
  grant execute on function banc.verifier(text, boolean) to public;" >/dev/null

phase() { "${PSQL[@]}" -c "alter database postgres set banc.phase = '$1'" >/dev/null; }

run "$ICI/00_supabase_simule.sql"
run "$ICI/10_etat_actuel.sql"
run "$RACINE/infra/credits/schema.sql"
"${PSQL[@]}" -c "alter table public.credit_ledger drop constraint credit_ledger_reason_chk;
  alter table public.credit_ledger add constraint credit_ledger_reason_chk check (reason in
  ('purchase','spend_join','spend_host','offered','signup_bonus','referral','launch_bonus','refund','gift','spend_record'));" >/dev/null

phase AVANT;   run "$ICI/20_tests_s0.sql"
run "$RACINE/infra/s0/01_s0_additif.sql"; run "$RACINE/infra/s0/02_s0_verrou.sql"
run "$RACINE/infra/s0/01_s0_additif.sql"; run "$RACINE/infra/s0/02_s0_verrou.sql"   # idempotence
phase APRES;   run "$ICI/20_tests_s0.sql"; run "$ICI/30_tests_vue.sql"
"${PSQL[@]}" -c "select banc.verifier('M1. migration rejouée 2× sans erreur (idempotente)', true);" >/dev/null
"${PSQL[@]}" -c "select banc.verifier('M2. règles d''origine sauvegardées (3)', (select count(*) = 3 from public.s0_sauvegarde_policies));" >/dev/null
run "$RACINE/infra/s0/rollback_s0.sql"
phase ROLLBACK
"${PSQL[@]}" -c "select banc.verifier('R1. règles d''origine recréées à l''identique',
   (select array_agg(policyname || '|' || cmd || '|' || coalesce(qual,'') || '|' || coalesce(with_check,'') order by policyname)
      from pg_policies where tablename = 'profiles') =
   array['profiles_insert|INSERT||(auth.uid() = id)','profiles_select|SELECT|true|','profiles_update|UPDATE|(auth.uid() = id)|']);
  select banc.verifier('R2. verrou retiré, vue et solde autoritaire retirés',
   to_regprocedure('public.s0_proteger_profil()') is null and to_regclass('public.profiles_public') is null
   and to_regprocedure('public.credits_disponibles(uuid)') is null);" >/dev/null

"${PSQL[@]}" -A -F ' ' -t -c "select phase, case when ok then 'OK    ' else 'ECHEC ' end, nom from banc.resultats order by n"
echo "---"
"${PSQL[@]}" -A -t -c "select phase || ' : ' || count(*) filter (where ok) || '/' || count(*) from banc.resultats group by phase order by min(n)"
grep -c "\[S0\] colonnes protégées ignorées" "$TMP/log" | sed 's/^/avertissements [S0] journalisés : /'
