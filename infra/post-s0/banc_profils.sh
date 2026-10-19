#!/bin/bash
# Banc post-S0 — CGU / création de profil sur les DEUX schémas réels (bt = boosttribe.pro,
# live = afroboost.com/live), dans les DEUX états de production possibles :
#   01    : S0 étape 1 seule (RLS d'origine, aucune liste blanche)
#   01+02 : S0 étapes 1 et 2 (liste blanche + triggers s0_proteger_profil) — prod au 19/10
# Pour chaque combinaison : migration post-S0 03 (preuve CGU) puis 60_tests_cgu_preuve.sql ;
# 03 rejouée (idempotence), rollback (preuves sauvegardées), ré-application (aucun remplissage).
# En 01+02 : 50_tests_profils_cgu.sql (banc CGU d'origine) rejoué AVEC 03 (non-régression).
# Postgres 16 LOCAL et JETABLE (jamais la production).
# Usage : bash infra/post-s0/banc_profils.sh [bt|live] [01|01+02]   (sans argument : tout)
# Temporaires : $BANC_TMP (défaut /tmp) ; socket dans un dossier court (limite 104 car.).
set -u
ICI=$(cd "$(dirname "$0")" && pwd); RACINE=$(cd "$ICI/../.." && pwd); S0="$RACINE/infra/s0"
MIG="$ICI/migrations"
PGBIN=${PGBIN:-/opt/homebrew/opt/postgresql@16/bin}
TMP=$(mktemp -d "${BANC_TMP:-/tmp}/banc_profils.XXXXXX"); SOCK=$(mktemp -d /tmp/bpc.XXXXXX); PORT=${PORT:-54331}
trap '"$PGBIN/pg_ctl" -D "$TMP/data" stop -m fast >/dev/null 2>&1; rm -rf "$TMP" "$SOCK"' EXIT
"$PGBIN/initdb" -D "$TMP/data" -U supabase_admin -A trust >/dev/null || exit 1
"$PGBIN/pg_ctl" -D "$TMP/data" -o "-p $PORT -k $SOCK -c listen_addresses=''" -l "$TMP/log" start -w >/dev/null || exit 1
P() { "$PGBIN/psql" -h "$SOCK" -p "$PORT" -U supabase_admin -d "$1" -v ON_ERROR_STOP=1 -q -X "${@:2}"; }
P postgres -c "create role postgres nosuperuser createrole createdb login; create role anon nologin;
  create role authenticated nologin; create role service_role nologin bypassrls;" >/dev/null || exit 1
run() { P "$1" -f "$2" "${@:3}" >>"$TMP/sortie" 2>&1 || { echo "ÉCHEC d'exécution : $2 ($1)"; tail -20 "$TMP/sortie"; exit 1; }; }
compter() { tee -a "$TMP/bilan"; }

preparer() {  # $1 base, $2 variante, $3 état
  P postgres -c "create database $1" >/dev/null
  run "$1" "$S0/banc/00_supabase_simule.sql"
  if [ "$2" = live ]; then P "$1" -v live=true -c "set role postgres" -f "$S0/banc/10_etat_actuel.sql" >>"$TMP/sortie" 2>&1
  else P "$1" -v live=false -f "$S0/banc/10_etat_actuel.sql" >>"$TMP/sortie" 2>&1; fi || { echo "ÉCHEC état initial ($2)"; tail -15 "$TMP/sortie"; exit 1; }
  run "$1" "$S0/00_urgent_wallet_add.sql"; run "$1" "$S0/01_s0_additif.sql"
  if [ "$3" = "01+02" ]; then run "$1" "$S0/02_s0_verrou.sql"; fi
  return 0
}
verifier() {  # $1 base, $2 nom, $3 requête booléenne
  local r; r=$(P "$1" -At -c "$3" 2>&1)
  if [ "$r" = t ]; then echo "OK    $2"; else echo "ECHEC $2 [$r]"; fi
}

for V in ${1:-bt live}; do
  for E in ${2:-01 01+02}; do
    B="cgu_${V}_$(echo "$E" | tr -d '+')"
    preparer "$B" "$V" "$E"
    run "$B" "$MIG/03_cgu_preuve.sql"
    echo "── $V · état $E · 03 appliquée ──"
    P "$B" -At -f "$ICI/banc/60_tests_cgu_preuve.sql" 2>&1 | grep -v -e WARNING -e ATTENTION | compter
    run "$B" "$MIG/03_cgu_preuve.sql"
    verifier "$B" "R1 03 rejouée (idempotente) : preuves intactes" \
      "select terms_version = '2026-10-19' from public.profiles where id = '30000000-0000-0000-0000-00000000000a'" | compter
    run "$B" "$MIG/03_cgu_preuve_rollback.sql"
    verifier "$B" "R2 rollback : colonnes, fonction et trigger retirés" \
      "select not exists (select 1 from information_schema.columns where table_name='profiles' and column_name in ('terms_accepted_at','terms_version'))
         and to_regprocedure('public.accepter_cgu(text)') is null
         and not exists (select 1 from pg_trigger where tgname = 's0_proteger_profil_cgu')" | compter
    verifier "$B" "R3 rollback : preuves SAUVEGARDÉES (5 comptes ayant une preuve), illisibles du navigateur" \
      "select count(*) = 5 and bool_and(terms_accepted_at is not null)
         and not has_table_privilege('authenticated', 'public.s0c_cgu_preuve_sauvegarde', 'select')
         and not has_table_privilege('anon', 'public.s0c_cgu_preuve_sauvegarde', 'select')
         from public.s0c_cgu_preuve_sauvegarde" | compter
    verifier "$B" "R4 rollback : terms_accepted (ancien front) conservé" \
      "select terms_accepted from public.profiles where id = '30000000-0000-0000-0000-00000000000a'" | compter
    run "$B" "$MIG/03_cgu_preuve_rollback.sql"
    run "$B" "$MIG/03_cgu_preuve.sql"
    verifier "$B" "R5 rollback rejoué puis 03 ré-appliquée : AUCUN remplissage rétroactif" \
      "select count(*) filter (where terms_accepted_at is not null or terms_version is not null) = 0 from public.profiles" | compter
    if [ "$E" = "01+02" ]; then
      B2="${B}_ancien"
      preparer "$B2" "$V" "$E"; run "$B2" "$MIG/03_cgu_preuve.sql"
      echo "── $V · état $E · banc CGU d'origine (50) AVEC 03 ──"
      P "$B2" -At -f "$ICI/banc/50_tests_profils_cgu.sql" 2>&1 | grep -v -e WARNING -e ATTENTION | compter
    fi
  done
done
OK=$(grep -c '^OK' "$TMP/bilan"); KO=$(grep -c '^ECHEC' "$TMP/bilan")
echo "══ TOTAL : $OK OK, $KO ÉCHEC ══"
[ "$KO" = 0 ]
