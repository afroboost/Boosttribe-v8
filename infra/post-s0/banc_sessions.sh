#!/bin/bash
# Banc post-S0 — écritures du navigateur sur `playlists` (is_private, média partagé, description…).
# Postgres 16 LOCAL et JETABLE, aux DEUX schémas réels (bt = boosttribe.pro, live = afroboost.com/live),
# même préparation que infra/s0/banc/banc_s0.sh (rôles Supabase, propriétaire réel, 00 + 01 + 02).
# Phases par variante :
#   PRE_S0:AVANT  charges actuelles du front sur l'état d'AVANT S0 (preuve : l'échec existait déjà)
#   S0:AVANT      charges actuelles du front APRÈS S0 (état de production depuis le 19/10)
#   S0:APRES      charges de la correction APRÈS S0
# Puis contrôles (40_controles.sql) et empreintes (sessions, profils, grand livre) inchangées.
# Usage : bash infra/post-s0/banc_sessions.sh [bt|live]   (sans argument : les deux)
set -u
ICI=$(cd "$(dirname "$0")" && pwd); RACINE=$(cd "$ICI/../.." && pwd); S0B="$RACINE/infra/s0/banc"
PGBIN=${PGBIN:-/opt/homebrew/opt/postgresql@16/bin}
TMP=$(mktemp -d /tmp/banc_sessions.XXXXXX); PORT=${PORT:-54332}
trap '"$PGBIN/pg_ctl" -D "$TMP/data" stop -m fast >/dev/null 2>&1; rm -rf "$TMP"' EXIT
"$PGBIN/initdb" -D "$TMP/data" -U supabase_admin -A trust >/dev/null || exit 1
"$PGBIN/pg_ctl" -D "$TMP/data" -o "-p $PORT -k $TMP -c listen_addresses=''" -l "$TMP/log" start -w >/dev/null || exit 1
P() { "$PGBIN/psql" -h "$TMP" -p "$PORT" -U supabase_admin -d "$1" -v ON_ERROR_STOP=1 -q -X "${@:2}"; }
P postgres -c "create role postgres nosuperuser createrole createdb login; create role anon nologin;
  create role authenticated nologin; create role service_role nologin bypassrls;" >/dev/null || exit 1
run() { P "$1" -f "$2" "${@:3}" >>"$TMP/sortie" 2>&1 || { echo "ÉCHEC d'exécution : $2 ($1)"; tail -20 "$TMP/sortie"; exit 1; }; }
phase() { P postgres -c "alter database $1 set banc.phase = '$2'" >/dev/null; }

for V in ${1:-bt live}; do
  B="sessions_$V"
  P postgres -c "create database $B" >/dev/null
  P "$B" -c "create schema banc; grant usage on schema banc to public;
    create table banc.resultats(n serial, phase text, nom text, ok boolean);
    create function banc.verifier(nom text, ok boolean) returns void language sql security definer as
      \$\$ insert into banc.resultats(phase, nom, ok) values (current_setting('banc.phase'), nom, coalesce(ok,false)) \$\$;" >/dev/null
  run "$B" "$S0B/00_supabase_simule.sql"
  if [ "$V" = live ]; then
    P "$B" -v live=true -c "set role postgres" -f "$S0B/10_etat_actuel.sql" >>"$TMP/sortie" 2>&1
  else
    P "$B" -v live=false -f "$S0B/10_etat_actuel.sql" >>"$TMP/sortie" 2>&1
  fi || { echo "ÉCHEC état initial ($B)"; tail -15 "$TMP/sortie"; exit 1; }
  run "$B" "$RACINE/infra/s0/00_urgent_wallet_add.sql"
  run "$B" "$ICI/banc/20_ecritures_navigateur.sql"
  P "$B" -c "insert into banc.empreintes select 'depart', t, e from (
      select 'playlists' t, md5(string_agg(to_jsonb(x)::text, '|' order by x.session_id)) e from public.playlists x
      union all select 'profiles', md5(string_agg(to_jsonb(p)::text, '|' order by p.id)) from public.profiles p
      union all select 'credit_ledger', md5(coalesce(string_agg(to_jsonb(l)::text, '|' order by l.id), '')) from public.credit_ledger l) z;" >/dev/null
  phase "$B" "$V:PRE_S0:AVANT"; run "$B" "$ICI/banc/30_scenarios.sql"
  run "$B" "$RACINE/infra/s0/01_s0_additif.sql"; run "$B" "$RACINE/infra/s0/02_s0_verrou.sql"
  phase "$B" "$V:S0:AVANT"; run "$B" "$ICI/banc/30_scenarios.sql"
  phase "$B" "$V:S0:APRES"; run "$B" "$ICI/banc/30_scenarios.sql"
  phase "$B" "$V:CONTROLES"; run "$B" "$ICI/banc/40_controles.sql"
  P "$B" -At -F ' | ' -c "select phase, nom, acteur, session, coalesce(lignes::text,'-') lignes, coalesce(erreur,'OK') erreur, etat
                          from banc.ecritures order by phase, nom, acteur, session" >>"$TMP/ecritures"
  P "$B" -At -F ' ' -c "select phase, case when ok then 'OK    ' else 'ECHEC ' end, nom from banc.resultats order by n" >>"$TMP/resultats"
done
[ "${DETAIL:-0}" = 1 ] && cat "$TMP/ecritures"
cat "$TMP/resultats"
echo "---"; awk '{print $1}' "$TMP/resultats" | sort | uniq -c | sed 's/^/total /'
grep -c ECHEC "$TMP/resultats" | sed 's/^/échecs : /'
