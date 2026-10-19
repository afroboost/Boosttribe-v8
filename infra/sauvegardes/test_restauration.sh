#!/usr/bin/env bash
# =============================================================================================
# Test de restauration COMPLÈTE d'une sauvegarde (à lancer 1×/mois, et après chaque changement).
# Aucune base de production n'est touchée : chaque base est restaurée dans un conteneur Postgres
# JETABLE, SANS RÉSEAU (--network none), mémoire limitée, supprimé à la fin (même en cas d'échec).
#
# Procédure (validée le 19/10/2026) : rôles (roles.sql) → pg_restore --clean --if-exists dans la
# base « postgres » d'une image Supabase neuve → empreintes (empreintes.sql) comparées à celles
# relevées sur la production au moment de la sauvegarde. Les droits (GRANT/REVOKE), règles RLS et
# verrous S0 font partie des empreintes.
#
# Usage : test_restauration.sh [dossier_du_jour]   (par défaut : la sauvegarde quotidienne la plus récente)
# Code de sortie ≠ 0 si une empreinte diffère ou si la restauration échoue.
# =============================================================================================
set -Euo pipefail
umask 077

CONF=${SAUV_CONF:-/root/.sauvegarde-bases.env}
# shellcheck disable=SC1090
[ -f "$CONF" ] && . "$CONF"
RACINE=${RACINE:-/root/sauvegardes-bases}
IMAGE=${IMAGE:-supabase/postgres:15.8.1.085}       # la MÊME image que la production
DOCKER=${DOCKER:-docker}
PG_USER=${PG_USER:-supabase_admin}
ATTENTE_S=${ATTENTE_S:-90}
ICI=$(cd "$(dirname "$0")" && pwd)
EMPREINTES_SQL=${EMPREINTES_SQL:-$ICI/empreintes.sql}
ALERTE_CMD=${ALERTE_CMD:-}

journal() { printf '%s [restauration] %s\n' "$(date -u +%FT%TZ)" "$*"; }

JOUR=${1:-$(find "$RACINE/quotidien" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort | tail -1)}
[ -n "$JOUR" ] && [ -d "$JOUR" ] || { journal "ÉCHEC : aucune sauvegarde trouvée"; exit 1; }
journal "sauvegarde testée : $JOUR"
( cd "$JOUR" && sha256sum -c --quiet SHA256SUMS ) || { journal "ÉCHEC : empreintes SHA-256 invalides"; exit 1; }

RESULTAT=0
CONTENEUR=""
nettoyer() { [ -n "$CONTENEUR" ] && "$DOCKER" rm -f "$CONTENEUR" >/dev/null 2>&1; CONTENEUR=""; }
trap nettoyer EXIT

for dump in "$JOUR"/*-postgres.dump; do
  nom=$(basename "$dump" -postgres.dump)
  CONTENEUR="restauration-test-$nom-$$"
  journal "$nom : conteneur jetable $CONTENEUR (sans réseau)"
  # Mot de passe aléatoire jamais affiché ; authentification locale « trust » sans danger : aucun réseau.
  "$DOCKER" run -d --rm --name "$CONTENEUR" --network none --memory 512m \
    -e POSTGRES_PASSWORD="$(openssl rand -hex 24)" -e POSTGRES_HOST_AUTH_METHOD=trust "$IMAGE" >/dev/null \
    || { journal "$nom : ÉCHEC démarrage du conteneur"; RESULTAT=1; continue; }
  pret=0
  for _ in $(seq 1 "$ATTENTE_S"); do
    if "$DOCKER" exec "$CONTENEUR" psql -U "$PG_USER" -h localhost -d postgres -Atc 'select 1' >/dev/null 2>&1; then pret=1; break; fi
    sleep 1
  done
  sleep 3   # l'image Supabase finit ses scripts d'initialisation
  [ "$pret" = 1 ] || { journal "$nom : ÉCHEC base de test non prête"; RESULTAT=1; nettoyer; continue; }

  "$DOCKER" exec -i "$CONTENEUR" psql -U "$PG_USER" -h localhost -d postgres -q < "$JOUR/$nom-roles.sql" >/dev/null 2>&1 || true
  "$DOCKER" exec -i "$CONTENEUR" pg_restore -U "$PG_USER" -h localhost -d postgres --clean --if-exists \
    < "$dump" > "$JOUR/.restauration-$nom.log" 2>&1 || true
  erreurs=$(grep -c 'error:' "$JOUR/.restauration-$nom.log" || true)
  rm -f "$JOUR/.restauration-$nom.log"
  "$DOCKER" exec -i "$CONTENEUR" psql -U "$PG_USER" -h localhost -d postgres -At < "$EMPREINTES_SQL" 2>/dev/null \
    > "$JOUR/.empreintes-restaurees-$nom.txt"
  if diff -q "$JOUR/$nom-empreintes.txt" "$JOUR/.empreintes-restaurees-$nom.txt" >/dev/null; then
    journal "$nom : RESTAURATION OK — empreintes IDENTIQUES (messages pg_restore : $erreurs, attendus ≤ 4 sur une image Supabase neuve)"
  else
    journal "$nom : ÉCHEC — empreintes DIFFÉRENTES :"
    diff "$JOUR/$nom-empreintes.txt" "$JOUR/.empreintes-restaurees-$nom.txt" | sed 's/^/    /' | cut -c1-160
    RESULTAT=1
  fi
  rm -f "$JOUR/.empreintes-restaurees-$nom.txt"
  nettoyer
done

if [ "$RESULTAT" -ne 0 ] && [ -n "$ALERTE_CMD" ]; then sh -c "$ALERTE_CMD" "echec" "test de restauration" || true; fi
journal "$([ "$RESULTAT" -eq 0 ] && echo 'TERMINÉ : toutes les bases se restaurent à l’identique' || echo 'TERMINÉ AVEC ÉCHEC')"
exit "$RESULTAT"
