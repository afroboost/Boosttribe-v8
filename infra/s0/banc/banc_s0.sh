#!/bin/bash
# Banc S0 — Postgres 16 LOCAL et JETABLE (jamais la production), aux DEUX schémas réels :
#   bt   = boosttribe.pro      (objets à supabase_admin, cohosts jsonb nullable, playlists_update sans « hôte vide »)
#   live = afroboost.com/live  (objets à postgres, cohosts jsonb NOT NULL, playlists_update avec « hôte vide »,
#                               tickets sans colonnes de paiement mobile, profiles sans colonnes Stripe)
# Rôles comme Supabase 15 : supabase_admin = superutilisateur, postgres = NON superutilisateur.
# Les migrations sont exécutées en supabase_admin, comme en production.
# Par variante :
#   base « tests »   : état initial (+00) → tests AVANT → 01 ×2 → compat → 02 ×2 → tests APRÈS → rollback → réappliqué
#   base « données » : données réelles synthétiques → 01 ×2 → invariance + soldes + propriétaires → 02 ×2 → idem → rollback
# Usage : bash infra/s0/banc/banc_s0.sh [bt|live]   (sans argument : les deux)
set -u
ICI=$(cd "$(dirname "$0")" && pwd); RACINE=$(cd "$ICI/../../.." && pwd)
PGBIN=${PGBIN:-/opt/homebrew/opt/postgresql@16/bin}
TMP=$(mktemp -d /tmp/banc_s0.XXXXXX); PORT=${PORT:-54329}
trap '"$PGBIN/pg_ctl" -D "$TMP/data" stop -m fast >/dev/null 2>&1; rm -rf "$TMP"' EXIT
"$PGBIN/initdb" -D "$TMP/data" -U supabase_admin -A trust >/dev/null || exit 1
"$PGBIN/pg_ctl" -D "$TMP/data" -o "-p $PORT -k $TMP -c listen_addresses=''" -l "$TMP/log" start -w >/dev/null || exit 1
P() { "$PGBIN/psql" -h "$TMP" -p "$PORT" -U supabase_admin -d "$1" -v ON_ERROR_STOP=1 -q -X "${@:2}"; }
P postgres -c "create role postgres nosuperuser createrole createdb login; create role anon nologin;
  create role authenticated nologin; create role service_role nologin bypassrls;" >/dev/null || exit 1

run() { P "$1" -f "$2" "${@:3}" >>"$TMP/sortie" 2>&1 || { echo "ÉCHEC d'exécution : $2 ($1)"; tail -20 "$TMP/sortie"; exit 1; }; }
phase() { P postgres -c "alter database $1 set banc.phase = '$2'" >/dev/null; }
prep() {   # $1 = base, $2 = variante
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
  run "$1" "$ICI/00_supabase_simule.sql"
  if [ "$2" = live ]; then
    P "$1" -v live=true -c "set role postgres" -f "$ICI/10_etat_actuel.sql" >>"$TMP/sortie" 2>&1
  else
    P "$1" -v live=false -f "$ICI/10_etat_actuel.sql" >>"$TMP/sortie" 2>&1
  fi || { echo "ÉCHEC état initial ($1)"; tail -15 "$TMP/sortie"; exit 1; }
  run "$1" "$RACINE/infra/s0/00_urgent_wallet_add.sql"            # déjà appliqué en production le 19/10
}
snap_pol() { P "$1" -c "create table if not exists banc.pol_avant as select tablename::text tablename, policyname::text policyname, cmd,
  coalesce(qual,'') qual, coalesce(with_check,'') wc, roles::text roles from pg_policies
  where schemaname='public' and tablename in ('profiles','access_requests','playlists');" >/dev/null; }

VARIANTES=${1:-"bt live"}
for V in $VARIANTES; do
  T="tests_$V"; D="donnees_$V"
  # ── base « tests » ─────────────────────────────────────────────────────────────────
  prep "$T" "$V"
  phase "$T" "$V:AVANT"; run "$T" "$ICI/20_tests_s0.sql"
  snap_pol "$T"
  run "$T" "$RACINE/infra/s0/01_s0_additif.sql"; run "$T" "$RACINE/infra/s0/01_s0_additif.sql"
  phase "$T" "$V:COMPAT_M1"; run "$T" "$ICI/25_tests_compat_migration1.sql"
  run "$T" "$RACINE/infra/s0/02_s0_verrou.sql"; run "$T" "$RACINE/infra/s0/02_s0_verrou.sql"
  phase "$T" "$V:APRES"; run "$T" "$ICI/20_tests_s0.sql"; run "$T" "$ICI/30_tests_vue.sql"
  P "$T" -c "select banc.verifier('M1. migrations 1 et 2 rejouées chacune 2× sans erreur', true);
    select banc.verifier('M2. règles d''origine sauvegardées = celles de la base',
      (select count(*) from public.s0_sauvegarde_policies) =
      (select count(*) from banc.pol_avant where tablename = 'profiles' or policyname = 'access_requests_host_update'));" >/dev/null
  run "$T" "$RACINE/infra/s0/rollback_s0.sql"
  phase "$T" "$V:ROLLBACK"
  P "$T" -c "select banc.verifier('R1. règles RLS d''origine recréées À L''IDENTIQUE (profiles, playlists, access_requests)',
      (select count(*) = 0 from (
        (select tablename, policyname, cmd, qual, wc, roles from banc.pol_avant
         except select tablename::text, policyname::text, cmd, coalesce(qual,''), coalesce(with_check,''), roles::text
                  from pg_policies where schemaname='public' and tablename in ('profiles','access_requests','playlists'))
        union all
        (select tablename::text, policyname::text, cmd, coalesce(qual,''), coalesce(with_check,''), roles::text
           from pg_policies where schemaname='public' and tablename in ('profiles','access_requests','playlists')
         except select tablename, policyname, cmd, qual, wc, roles from banc.pol_avant)) d));
    select banc.verifier('R2. verrous, vue et solde autoritaire retirés',
      to_regprocedure('public.s0_proteger_profil()') is null and to_regprocedure('public.s0_proteger_playlist()') is null
      and to_regclass('public.profiles_public') is null and to_regprocedure('public.credits_disponibles(uuid)') is null);" >/dev/null
  run "$T" "$RACINE/infra/s0/01_s0_additif.sql"; run "$T" "$RACINE/infra/s0/02_s0_verrou.sql"
  phase "$T" "$V:REAPPLIQUE"; run "$T" "$ICI/20_tests_s0.sql"; run "$T" "$ICI/30_tests_vue.sql"

  # ── base « données réelles » ──────────────────────────────────────────────────────
  prep "$D" "$V"
  run "$D" "$ICI/15_donnees_reelles.sql"
  phase "$D" "$V:DONNEES"
  run "$D" "$ICI/40_tests_donnees_reelles.sql" -v etape=avant_m1
  run "$D" "$RACINE/infra/s0/01_s0_additif.sql"; run "$D" "$RACINE/infra/s0/01_s0_additif.sql"
  run "$D" "$ICI/40_tests_donnees_reelles.sql" -v etape=apres_m1
  run "$D" "$ICI/45_tests_solde_et_proprietaires.sql"
  run "$D" "$RACINE/infra/s0/02_s0_verrou.sql"; run "$D" "$RACINE/infra/s0/02_s0_verrou.sql"
  run "$D" "$ICI/40_tests_donnees_reelles.sql" -v etape=apres_m2
  run "$D" "$ICI/45_tests_solde_et_proprietaires.sql"
  run "$D" "$RACINE/infra/s0/rollback_s0.sql"
  run "$D" "$ICI/40_tests_donnees_reelles.sql" -v etape=apres_rollback

  for B in "$T" "$D"; do
    P "$B" -At -F ' ' -c "select phase, case when ok then 'OK    ' else 'ECHEC ' end, nom from banc.resultats order by n" >>"$TMP/resultats"
    P "$B" -At -F ' ' -c "select 'COMPORTEMENT', phase, nom, ok from banc.comportement order by phase, nom" >>"$TMP/resultats"
  done
done
cat "$TMP/resultats"
echo "---"
for V in $VARIANTES; do for B in "tests_$V" "donnees_$V"; do
  P "$B" -At -c "select phase || ' : ' || count(*) filter (where ok) || '/' || count(*) from banc.resultats group by phase order by min(n)"
done; done
grep -c "\[S0\] colonnes protégées ignorées" "$TMP/log" | sed 's/^/avertissements [S0] journalisés : /'
