#!/usr/bin/env bash
# =============================================================================================
# Test de restauration COMPLÈTE d'une sauvegarde (à lancer 1×/mois, et après chaque changement).
# Aucune base de production n'est touchée : chaque base est restaurée dans un conteneur Postgres
# JETABLE, SANS RÉSEAU (--network none), mémoire limitée, supprimé à la fin (même en cas d'échec).
#
# Pour chaque base de la sauvegarde :
#   1. rôles (roles.sql) puis pg_restore --clean --if-exists dans la base « postgres » d'une image
#      Supabase neuve ; CHAQUE message d'erreur (psql et pg_restore) est classé : connu et bénin
#      (liste blanche documentée : erreurs_restauration_connues.txt) ou inconnu → ÉCHEC ;
#   2. empreintes (empreintes.sql) comparées LIGNE À LIGNE à celles relevées sur la production au
#      moment de la sauvegarde (données, propriétaires, RLS, droits, fonctions, règles, verrous…) ;
#   3. protections S0 critiques (protections_s0.sql) vérifiées en valeur absolue : une seule
#      MANQUANTE → ÉCHEC (même si la production l'avait déjà perdue au moment de la sauvegarde) ;
#   4. fichiers (Supabase Storage) : l'archive est extraite dans un dossier jetable, son manifeste
#      recalculé doit être IDENTIQUE à celui de la sauvegarde (sha256 + taille + chemin), et chaque
#      ligne storage.objects restaurée doit avoir son fichier.
#
# Usage : test_restauration.sh [dossier_du_jour]   (par défaut : la sauvegarde quotidienne la plus récente)
# Code de sortie ≠ 0 au moindre écart. ALERTE_CMD est appelée en ÉCHEC comme en SUCCÈS :
#   sh -c "$ALERTE_CMD" alerte <echec|succes> <message> restauration
# =============================================================================================
set -Euo pipefail
umask 077
export COPYFILE_DISABLE=1

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
PROTECTIONS_SQL=${PROTECTIONS_SQL:-$ICI/protections_s0.sql}
ERREURS_CONNUES=${ERREURS_CONNUES:-$ICI/erreurs_restauration_connues.txt}
S0_NIVEAU=${S0_NIVEAU:-complet}
POST_S0_NIVEAU=${POST_S0_NIVEAU:-aucun}      # post-S0 exigé : aucun | 03 | 03_04 (voir protections_s0.sql)
EXIGER_STOCKAGE=${EXIGER_STOCKAGE:-1}         # 1 = une base sans archive de fichiers = ÉCHEC
STOCKAGE_COHERENCE=${STOCKAGE_COHERENCE:-strict}   # strict | avertir : ligne storage.objects sans fichier
VERIF_DIR=${VERIF_DIR:-$RACINE}               # où extraire les fichiers (même disque que les sauvegardes)
ALERTE_CMD=${ALERTE_CMD:-}
ALERTE_DELAI_S=${ALERTE_DELAI_S:-30}

journal() { printf '%s [restauration] %s\n' "$(date -u +%FT%TZ)" "$*"; }
alerter() {  # $1 = echec|succes, $2 = message
  [ -n "$ALERTE_CMD" ] || return 0
  local code=0
  if command -v timeout >/dev/null 2>&1; then
    timeout "$ALERTE_DELAI_S" sh -c "$ALERTE_CMD" alerte "$1" "$2" restauration || code=$?
  else
    sh -c "$ALERTE_CMD" alerte "$1" "$2" restauration || code=$?
  fi
  [ "$code" = 0 ] || journal "alerte « $1 » NON envoyée (code $code)"
}
arreter() { journal "ÉCHEC : $*"; alerter echec "test de restauration : $*"; exit 1; }

case "$S0_NIVEAU" in complet|etape1|aucun) ;; *) arreter "S0_NIVEAU invalide ($S0_NIVEAU)";; esac
case "$POST_S0_NIVEAU" in aucun|03|03_04) ;; *) arreter "POST_S0_NIVEAU invalide ($POST_S0_NIVEAU)";; esac
for f in "$EMPREINTES_SQL" "$PROTECTIONS_SQL" "$ERREURS_CONNUES"; do [ -f "$f" ] || arreter "fichier introuvable : $f"; done

JOUR=${1:-$(find "$RACINE/quotidien" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort | tail -1)}
[ -n "$JOUR" ] && [ -d "$JOUR" ] || arreter "aucune sauvegarde trouvée"
journal "sauvegarde testée : $JOUR"
( cd "$JOUR" && sha256sum -c --quiet SHA256SUMS ) || arreter "empreintes SHA-256 invalides ($JOUR)"

TRAVAIL=$(mktemp -d "${VERIF_DIR%/}/.test-restauration.XXXXXX") || arreter "dossier de travail impossible dans $VERIF_DIR"
# Motifs d'erreurs connues : commentaires et lignes vides retirés.
grep -Ev '^[[:space:]]*(#|$)' "$ERREURS_CONNUES" > "$TRAVAIL/motifs" || true

RESULTAT=0
BILAN=""
CONTENEUR=""
nettoyer() { [ -n "$CONTENEUR" ] && "$DOCKER" rm -f "$CONTENEUR" >/dev/null 2>&1; CONTENEUR=""; }
trap 'nettoyer; rm -rf "$TRAVAIL"' EXIT
ko() { journal "$nom : ÉCHEC — $*"; RESULTAT=1; ok_base=0; }

# Manifeste d'un dossier : « sha256 taille ./chemin », trié (octets) — identique à sauvegarde_bases.sh.
manifeste() {
  ( cd "$1" && find . -type f -print0 | LC_ALL=C sort -z | while IFS= read -r -d '' f; do
      h=$(sha256sum < "$f" | cut -d' ' -f1) && [ -n "$h" ] || exit 1
      printf '%s %s %s\n' "$h" "$(wc -c < "$f" | tr -d ' ')" "$f"
    done )
}

nb_bases=0
for dump in "$JOUR"/*-postgres.dump; do
  [ -f "$dump" ] || arreter "aucune base (*-postgres.dump) dans $JOUR"
  nom=$(basename "$dump" -postgres.dump)
  nb_bases=$((nb_bases + 1)); ok_base=1
  for f in roles.sql empreintes.txt protections.txt; do
    [ -f "$JOUR/$nom-$f" ] || { ko "fichier $nom-$f absent de la sauvegarde"; }
  done
  [ "$ok_base" = 1 ] || continue
  CONTENEUR="restauration-test-$nom-$$"
  journal "$nom : conteneur jetable $CONTENEUR (sans réseau)"
  # Mot de passe aléatoire jamais affiché ; authentification locale « trust » sans danger : aucun réseau.
  if ! "$DOCKER" run -d --rm --name "$CONTENEUR" --network none --memory 512m \
       -e POSTGRES_PASSWORD="$(openssl rand -hex 24)" -e POSTGRES_HOST_AUTH_METHOD=trust "$IMAGE" >/dev/null; then
    CONTENEUR=""; ko "démarrage du conteneur"; continue
  fi
  pret=0
  for _ in $(seq 1 "$ATTENTE_S"); do
    if "$DOCKER" exec "$CONTENEUR" psql -U "$PG_USER" -h localhost -d postgres -Atc 'select 1' >/dev/null 2>&1; then pret=1; break; fi
    sleep 1
  done
  sleep "${ATTENTE_FIN_S:-3}"   # l'image Supabase finit ses scripts d'initialisation
  [ "$pret" = 1 ] || { ko "base de test non prête"; nettoyer; continue; }

  # 1. Rôles puis données — chaque message d'erreur est classé.
  "$DOCKER" exec -i "$CONTENEUR" psql -U "$PG_USER" -h localhost -d postgres -X -q \
    < "$JOUR/$nom-roles.sql" > "$TRAVAIL/$nom-roles.log" 2>&1
  code_roles=$?
  "$DOCKER" exec -i "$CONTENEUR" pg_restore -U "$PG_USER" -h localhost -d postgres --clean --if-exists \
    < "$dump" > "$TRAVAIL/$nom-restore.log" 2>&1
  code_restore=$?
  # Messages d'erreur SQL (le texte après « ERROR: »), et erreurs fatales sans message SQL.
  cat "$TRAVAIL/$nom-roles.log" "$TRAVAIL/$nom-restore.log" | sed -n 's/.*ERROR: *//p' > "$TRAVAIL/$nom-erreurs"
  grep -E '(^pg_restore: error:|FATAL:|could not connect|connection to server)' "$TRAVAIL/$nom-restore.log" "$TRAVAIL/$nom-roles.log" -h \
    | { grep -v 'ERROR:' || true; } | sed 's/^/FATALE /' >> "$TRAVAIL/$nom-erreurs"
  total=$(wc -l < "$TRAVAIL/$nom-erreurs" | tr -d ' ')
  if [ -s "$TRAVAIL/motifs" ]; then
    grep -Ev -f "$TRAVAIL/motifs" "$TRAVAIL/$nom-erreurs" > "$TRAVAIL/$nom-inconnues" || true
  else
    cp "$TRAVAIL/$nom-erreurs" "$TRAVAIL/$nom-inconnues"
  fi
  inconnues=$(wc -l < "$TRAVAIL/$nom-inconnues" | tr -d ' ')
  connues=$((total - inconnues))
  if [ "$inconnues" -gt 0 ]; then
    ko "$inconnues erreur(s) de restauration NON répertoriée(s) (sur $total) :"
    sort "$TRAVAIL/$nom-inconnues" | uniq -c | head -20 | cut -c1-200 | sed 's/^/    /'
  elif [ "$code_restore" != 0 ] && [ "$total" = 0 ]; then
    ko "pg_restore a échoué (code $code_restore) sans message exploitable"
  elif [ "$code_roles" != 0 ]; then
    ko "psql roles.sql a échoué (code $code_roles)"
  fi
  [ "$connues" -gt 0 ] && journal "$nom : $connues message(s) connu(s) et bénin(s) (liste blanche) :" \
    && grep -E -f "$TRAVAIL/motifs" "$TRAVAIL/$nom-erreurs" | sort | uniq -c | head -10 | cut -c1-160 | sed 's/^/    /'

  # 2. Empreintes : identiques ligne à ligne.
  if "$DOCKER" exec -i "$CONTENEUR" psql -U "$PG_USER" -h localhost -d postgres -At -X -v ON_ERROR_STOP=1 \
       -v niveau="$S0_NIVEAU" < "$EMPREINTES_SQL" > "$TRAVAIL/$nom-empreintes" 2> "$TRAVAIL/$nom-empreintes.err"; then
    if ! diff -q "$JOUR/$nom-empreintes.txt" "$TRAVAIL/$nom-empreintes" >/dev/null; then
      ko "empreintes DIFFÉRENTES (< sauvegardé, > restauré) :"
      diff "$JOUR/$nom-empreintes.txt" "$TRAVAIL/$nom-empreintes" | grep '^[<>]' | head -40 | cut -c1-200 | sed 's/^/    /'
    fi
  else
    ko "calcul des empreintes impossible : $(head -3 "$TRAVAIL/$nom-empreintes.err" | tr '\n' ' ' | cut -c1-200)"
  fi

  # 3. Protections S0 critiques, en valeur absolue.
  if "$DOCKER" exec -i "$CONTENEUR" psql -U "$PG_USER" -h localhost -d postgres -At -X -v ON_ERROR_STOP=1 \
       -v niveau="$S0_NIVEAU" -v post_s0="$POST_S0_NIVEAU" < "$PROTECTIONS_SQL" > "$TRAVAIL/$nom-protections" 2> "$TRAVAIL/$nom-protections.err"; then
    nprot=$(grep -c '^PROTECTION ' "$TRAVAIL/$nom-protections" || true)
    nok=$(grep -c ' OK — ' "$TRAVAIL/$nom-protections" || true)
    if [ "$nprot" -lt 20 ]; then
      ko "contrôle des protections incomplet ($nprot lignes)"
    elif grep -q ' MANQUANTE ' "$TRAVAIL/$nom-protections"; then
      ko "protection(s) S0 MANQUANTE(S) après restauration :"
      grep ' MANQUANTE ' "$TRAVAIL/$nom-protections" | cut -c1-200 | sed 's/^/    /'
    fi
  else
    nok=0; ko "contrôle des protections impossible : $(head -3 "$TRAVAIL/$nom-protections.err" | tr '\n' ' ' | cut -c1-200)"
  fi

  # 4. Fichiers (Supabase Storage).
  fichiers="aucun"
  if [ -f "$JOUR/$nom-stockage.tar" ] && [ -f "$JOUR/$nom-stockage.manifeste" ]; then
    X=$(mktemp -d "$TRAVAIL/fichiers-$nom.XXXXXX")
    if ! tar -xf "$JOUR/$nom-stockage.tar" -C "$X" 2> "$TRAVAIL/$nom-tar.err"; then
      ko "archive des fichiers illisible : $(head -2 "$TRAVAIL/$nom-tar.err" | tr '\n' ' ' | cut -c1-200)"
    elif ! manifeste "$X" > "$TRAVAIL/$nom-manifeste"; then
      ko "fichiers extraits illisibles"
    elif ! cmp -s "$JOUR/$nom-stockage.manifeste" "$TRAVAIL/$nom-manifeste"; then
      ko "fichiers restaurés DIFFÉRENTS du manifeste (< sauvegardé, > restauré) :"
      diff "$JOUR/$nom-stockage.manifeste" "$TRAVAIL/$nom-manifeste" | grep '^[<>]' | head -20 | cut -c1-200 | sed 's/^/    /'
    else
      nfich=$(wc -l < "$TRAVAIL/$nom-manifeste" | tr -d ' ')
      fichiers="$nfich identiques"
      # Cohérence avec storage.objects restauré : chaque objet doit avoir son fichier.
      # Disposition Supabase (backend « file ») : <racine>/<seau global>/<tenant>/<seau>/<nom>/<version> ;
      # la comparaison est tolérante : on cherche « <seau>/<nom> » comme suite de dossiers d'un fichier.
      if "$DOCKER" exec -i "$CONTENEUR" psql -U "$PG_USER" -h localhost -d postgres -At -X -v ON_ERROR_STOP=1 \
           -c "select case when to_regclass('storage.objects') is null then '' else 'x' end" 2>/dev/null | grep -q x; then
        "$DOCKER" exec -i "$CONTENEUR" psql -U "$PG_USER" -h localhost -d postgres -At -X -v ON_ERROR_STOP=1 \
          -c "select bucket_id || '/' || name from storage.objects order by 1" > "$TRAVAIL/$nom-objets" 2>/dev/null \
          || ko "lecture de storage.objects impossible"
        awk 'NR == FNR { p = $0; sub(/^[^ ]+ [^ ]+ \.\//, "", p); n = split(p, c, "/");
                         for (i = 1; i <= n; i++) { s = c[i]; for (j = i + 1; j <= n; j++) s = s "/" c[j]; vus[s] = 1;
                           if (i < n) { d = c[i]; for (j = i + 1; j < n; j++) d = d "/" c[j]; vus[d] = 1 } }
                         next }
             !($0 in vus) { print }' "$TRAVAIL/$nom-manifeste" "$TRAVAIL/$nom-objets" > "$TRAVAIL/$nom-sans-fichier"
        nobj=$(wc -l < "$TRAVAIL/$nom-objets" | tr -d ' ')
        nsans=$(wc -l < "$TRAVAIL/$nom-sans-fichier" | tr -d ' ')
        fichiers="$fichiers, $nobj objet(s) en base"
        if [ "$nsans" -gt 0 ]; then
          if [ "$STOCKAGE_COHERENCE" = strict ]; then
            ko "$nsans ligne(s) storage.objects SANS fichier dans l'archive (ex. : $(head -3 "$TRAVAIL/$nom-sans-fichier" | paste -sd' ' - | cut -c1-160))"
          else
            journal "$nom : AVERTISSEMENT — $nsans ligne(s) storage.objects sans fichier"
          fi
        fi
      fi
    fi
    rm -rf "$X"
  elif [ "$EXIGER_STOCKAGE" = 1 ]; then
    ko "aucune archive des fichiers ($nom-stockage.tar) dans la sauvegarde"
  else
    journal "$nom : AVERTISSEMENT — fichiers non sauvegardés (pas de $nom-stockage.tar)"
  fi

  if [ "$ok_base" = 1 ]; then
    journal "$nom : RESTAURATION OK — empreintes IDENTIQUES ($(wc -l < "$TRAVAIL/$nom-empreintes" | tr -d ' ') lignes), protections S0 $nok OK, messages connus $connues, inconnus 0, fichiers : $fichiers"
    BILAN="$BILAN $nom=OK"
  else
    BILAN="$BILAN $nom=ÉCHEC"
  fi
  nettoyer
done

if [ "$RESULTAT" -eq 0 ]; then
  journal "TERMINÉ : toutes les bases se restaurent à l’identique ($nb_bases base(s) :$BILAN)"
  alerter succes "test de restauration $(basename "$JOUR") : $nb_bases base(s) restaurée(s) à l'identique"
else
  journal "TERMINÉ AVEC ÉCHEC ($BILAN )"
  alerter echec "test de restauration $(basename "$JOUR") : ÉCHEC ($BILAN )"
fi
exit "$RESULTAT"
