#!/bin/bash
# Banc post-S0 — CGU / création de profil sur les DEUX schémas réels, APRÈS S0 étapes 1 et 2.
# Postgres 16 LOCAL et JETABLE (jamais la production). Usage : bash infra/post-s0/banc_profils.sh [bt|live]
set -u
ICI=$(cd "$(dirname "$0")" && pwd); RACINE=$(cd "$ICI/../.." && pwd); S0="$RACINE/infra/s0"
PGBIN=${PGBIN:-/opt/homebrew/opt/postgresql@16/bin}
TMP=$(mktemp -d /tmp/banc_profils.XXXXXX); PORT=${PORT:-54331}
trap '"$PGBIN/pg_ctl" -D "$TMP/data" stop -m fast >/dev/null 2>&1; rm -rf "$TMP"' EXIT
"$PGBIN/initdb" -D "$TMP/data" -U supabase_admin -A trust >/dev/null || exit 1
"$PGBIN/pg_ctl" -D "$TMP/data" -o "-p $PORT -k $TMP -c listen_addresses=''" -l "$TMP/log" start -w >/dev/null || exit 1
P() { "$PGBIN/psql" -h "$TMP" -p "$PORT" -U supabase_admin -d "$1" -v ON_ERROR_STOP=1 -q -X "${@:2}"; }
P postgres -c "create role postgres nosuperuser createrole createdb login; create role anon nologin;
  create role authenticated nologin; create role service_role nologin bypassrls;" >/dev/null || exit 1
run() { P "$1" -f "$2" "${@:3}" >>"$TMP/sortie" 2>&1 || { echo "ÉCHEC d'exécution : $2 ($1)"; tail -20 "$TMP/sortie"; exit 1; }; }
for V in ${1:-bt live}; do
  B="profils_$V"
  P postgres -c "create database $B" >/dev/null
  run "$B" "$S0/banc/00_supabase_simule.sql"
  if [ "$V" = live ]; then P "$B" -v live=true -c "set role postgres" -f "$S0/banc/10_etat_actuel.sql" >>"$TMP/sortie" 2>&1
  else P "$B" -v live=false -f "$S0/banc/10_etat_actuel.sql" >>"$TMP/sortie" 2>&1; fi || { echo "ÉCHEC état initial ($V)"; tail -15 "$TMP/sortie"; exit 1; }
  run "$B" "$S0/00_urgent_wallet_add.sql"; run "$B" "$S0/01_s0_additif.sql"; run "$B" "$S0/02_s0_verrou.sql"   # = production au 19/10
  echo "── $V ──"; P "$B" -At -f "$ICI/banc/50_tests_profils_cgu.sql" 2>&1 | grep -v '^WARNING'
done
