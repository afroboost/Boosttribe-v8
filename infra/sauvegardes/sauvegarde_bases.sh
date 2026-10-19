#!/usr/bin/env bash
# =============================================================================================
# Sauvegarde quotidienne des DEUX bases Supabase (boosttribe.pro et afroboost.com/live).
# À lancer en root sur le serveur Hetzner (cron, 1×/jour) — voir README.md (installation APRÈS GO).
#
# Pour CHAQUE base, séparément :
#   - pg_dump -Fc COMPLET (données, structures, fonctions, règles RLS, DROITS, propriétaires),
#     en supabase_admin — contrairement à la sauvegarde native Coolify (--no-acl --no-owner), qui
#     perd les GRANT/REVOKE dont dépend la sécurité S0 ;
#   - pg_dumpall --globals-only --no-role-passwords (rôles, sans aucun mot de passe) ;
#   - empreintes de contrôle (empreintes.sql) relevées au même moment, pour le test de restauration ;
#   - vérification que la sauvegarde se relit (pg_restore --list) ;
#   - SHA256SUMS.
# Puis : rotation 7 quotidiennes + 4 hebdomadaires (dimanche), copie CHIFFRÉE prête pour l'envoi hors
# serveur (AES-256 + clé RSA PUBLIQUE du Mac : seule la clé privée du Mac l'ouvre), envoi optionnel.
#
# Code de sortie ≠ 0 au moindre échec (et appel de ALERTE_CMD s'il est défini).
# Aucune écriture dans les bases : pg_dump/pg_dumpall/psql en lecture seule.
# =============================================================================================
set -Eeuo pipefail
umask 077

# ── Réglages (surchargeables par /root/.sauvegarde-bases.env, droits 600) ───────────────────────
CONF=${SAUV_CONF:-/root/.sauvegarde-bases.env}
# shellcheck disable=SC1090
[ -f "$CONF" ] && . "$CONF"
BASES=${BASES:-"boosttribe:supabase-db-gneo8v4uuw94cpmf5fh2db3a live:supabase-db-l12j96qw3srbix6s5h29yoo4"}
RACINE=${RACINE:-/root/sauvegardes-bases}
CLE_PUBLIQUE=${CLE_PUBLIQUE:-/root/s0-sauvegardes/cle_publique_mac.pem}
GARDER_QUOTIDIENNES=${GARDER_QUOTIDIENNES:-7}
GARDER_HEBDOMADAIRES=${GARDER_HEBDOMADAIRES:-4}
JOUR_HEBDO=${JOUR_HEBDO:-7}              # 1 = lundi … 7 = dimanche
ESPACE_MIN_MO=${ESPACE_MIN_MO:-2048}     # refuse de tourner sous 2 Go libres
PG_USER=${PG_USER:-supabase_admin}
DOCKER=${DOCKER:-docker}                 # remplaçable par un faux « docker » pour les tests locaux
ENVOI_CMD=${ENVOI_CMD:-}                 # ex. rsync/rclone vers la destination HORS serveur (après GO)
ALERTE_CMD=${ALERTE_CMD:-}               # ex. ping d'un service de surveillance / e-mail (après GO)
AUJOURDHUI=${AUJOURDHUI:-$(date -u +%F)}
NUMERO_JOUR=${NUMERO_JOUR:-$(date -u +%u)}
SEMAINE=${SEMAINE:-$(date -u +%G-S%V)}
ICI=$(cd "$(dirname "$0")" && pwd)
EMPREINTES_SQL=${EMPREINTES_SQL:-$ICI/empreintes.sql}

journal() { printf '%s [sauvegarde] %s\n' "$(date -u +%FT%TZ)" "$*"; }
echec() {
  journal "ÉCHEC : $*"
  if [ -n "$ALERTE_CMD" ]; then sh -c "$ALERTE_CMD" "echec" "$*" || journal "alerte NON envoyée"; fi
  exit 1
}
trap 'echec "ligne $LINENO (commande : $BASH_COMMAND)"' ERR

# ── Un seul passage à la fois ────────────────────────────────────────────────────────────────────
mkdir -p "$RACINE"; chmod 700 "$RACINE"
exec 9>"$RACINE/.verrou"
flock -n 9 || echec "une sauvegarde tourne déjà"

# ── Garde-fous ───────────────────────────────────────────────────────────────────────────────────
libre_mo=$(df -Pm "$RACINE" | awk 'NR==2 {print $4}')
[ "$libre_mo" -ge "$ESPACE_MIN_MO" ] || echec "espace disque insuffisant (${libre_mo} Mo libres < ${ESPACE_MIN_MO})"
[ -f "$EMPREINTES_SQL" ] || echec "empreintes.sql introuvable ($EMPREINTES_SQL)"

JOUR="$RACINE/quotidien/$AUJOURDHUI"
TMP="$RACINE/.en-cours-$AUJOURDHUI"
rm -rf "$TMP"; mkdir -p "$TMP"

# ── Sauvegarde de chaque base ────────────────────────────────────────────────────────────────────
for entree in $BASES; do
  nom=${entree%%:*}; conteneur=${entree#*:}
  journal "$nom : début ($conteneur)"
  # Empreintes relevées AVANT et APRÈS la sauvegarde : si une écriture tombe entre les deux, on
  # recommence (sinon le test de restauration signalerait un faux écart). 3 essais au plus.
  empreintes() {
    "$DOCKER" exec -i -e PGOPTIONS='-c default_transaction_read_only=on' "$conteneur" \
      psql -U "$PG_USER" -d postgres -At -v ON_ERROR_STOP=1 < "$EMPREINTES_SQL"
  }
  stable=0
  for essai in 1 2 3; do
    empreintes > "$TMP/$nom-empreintes.avant"
    "$DOCKER" exec "$conteneur" pg_dump -U "$PG_USER" -d postgres -Fc > "$TMP/$nom-postgres.dump"
    "$DOCKER" exec "$conteneur" pg_dumpall -U "$PG_USER" --globals-only --no-role-passwords > "$TMP/$nom-roles.sql"
    empreintes > "$TMP/$nom-empreintes.txt"
    if cmp -s "$TMP/$nom-empreintes.avant" "$TMP/$nom-empreintes.txt"; then stable=1; break; fi
    journal "$nom : écriture pendant la sauvegarde (essai $essai) — on recommence"
  done
  rm -f "$TMP/$nom-empreintes.avant"
  [ "$stable" = 1 ] || echec "$nom : base modifiée pendant chaque essai — empreintes non fiables"
  # La sauvegarde doit se relire entièrement (table des matières complète).
  entrees=$("$DOCKER" exec -i "$conteneur" pg_restore --list < "$TMP/$nom-postgres.dump" | grep -vc '^;')
  [ "$entrees" -gt 50 ] || echec "$nom : sauvegarde illisible ou vide ($entrees entrées)"
  grep -q '^grand_livre n=' "$TMP/$nom-empreintes.txt" || echec "$nom : empreintes incomplètes"
  journal "$nom : OK ($(wc -c < "$TMP/$nom-postgres.dump" | tr -d ' ') octets, $entrees entrées)"
done
( cd "$TMP" && sha256sum -- *.dump *.sql *.txt > SHA256SUMS )
rm -rf "$JOUR"; mkdir -p "$RACINE/quotidien"; mv "$TMP" "$JOUR"
journal "jour $AUJOURDHUI enregistré dans $JOUR"

# ── Hebdomadaire : copie (liens physiques, aucun espace en plus) le dimanche ─────────────────────
if [ "$NUMERO_JOUR" = "$JOUR_HEBDO" ]; then
  mkdir -p "$RACINE/hebdomadaire"
  rm -rf "$RACINE/hebdomadaire/$SEMAINE"
  mkdir -p "$RACINE/hebdomadaire/$SEMAINE"
  ln "$JOUR"/* "$RACINE/hebdomadaire/$SEMAINE"/
  journal "copie hebdomadaire $SEMAINE"
fi

# ── Copie CHIFFRÉE pour l'extérieur (si la clé publique du Mac est présente) ──────────────────────
CHIFFRE="$RACINE/chiffre"
if [ -f "$CLE_PUBLIQUE" ]; then
  mkdir -p "$CHIFFRE"
  base="$CHIFFRE/sauvegarde-$AUJOURDHUI"
  # Clé AES jamais exportée : transmise à openssl par un descripteur (absente de l'environnement
  # des autres commandes, dont la commande d'alerte en cas d'échec).
  S0K=$(openssl rand -hex 32)
  tar czf - -C "$RACINE/quotidien" "$AUJOURDHUI" \
    | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -out "$base.tgz.enc" -pass fd:3 3< <(printf %s "$S0K")
  printf %s "$S0K" | openssl pkeyutl -encrypt -pubin -inkey "$CLE_PUBLIQUE" \
    -pkeyopt rsa_padding_mode:oaep -pkeyopt rsa_oaep_md:sha256 -out "$base.cle.enc"
  unset S0K
  ( cd "$CHIFFRE" && sha256sum -- "sauvegarde-$AUJOURDHUI.tgz.enc" "sauvegarde-$AUJOURDHUI.cle.enc" > "sauvegarde-$AUJOURDHUI.sha256" )
  journal "copie chiffrée prête : $base.tgz.enc"
else
  journal "AVERTISSEMENT : clé publique absente ($CLE_PUBLIQUE) — aucune copie chiffrée"
fi

# ── Rotation : on garde les N plus récentes (tri par nom = tri par date) ─────────────────────────
garder() {  # $1 = dossier, $2 = nombre, $3 = motif
  [ -d "$1" ] || return 0
  # shellcheck disable=SC2012
  ls -1 "$1" | { grep -E "$3" || true; } | sort -r | tail -n +"$(( $2 + 1 ))" | while read -r vieux; do
    rm -rf -- "${1:?}/$vieux"; journal "rotation : $1/$vieux retiré"
  done
}
garder "$RACINE/quotidien" "$GARDER_QUOTIDIENNES" '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
garder "$RACINE/hebdomadaire" "$GARDER_HEBDOMADAIRES" '^[0-9]{4}-S[0-9]{2}$'
if [ -d "$CHIFFRE" ]; then
  # shellcheck disable=SC2012
  ls -1 "$CHIFFRE" | grep -E '^sauvegarde-[0-9-]{10}\.sha256$' | sort -r | tail -n +"$(( GARDER_QUOTIDIENNES + 1 ))" \
    | sed 's/\.sha256$//' | while read -r vieux; do
        rm -f -- "$CHIFFRE/$vieux".*; journal "rotation : copie chiffrée $vieux retirée"
      done
fi

# ── Envoi hors serveur (optionnel, uniquement la copie CHIFFRÉE) ─────────────────────────────────
if [ -n "$ENVOI_CMD" ] && [ -f "$CHIFFRE/sauvegarde-$AUJOURDHUI.tgz.enc" ]; then
  sh -c "$ENVOI_CMD" "envoi" "$CHIFFRE" "sauvegarde-$AUJOURDHUI" || echec "envoi hors serveur"
  journal "copie chiffrée envoyée hors serveur"
else
  journal "AVERTISSEMENT : aucun envoi hors serveur configuré (copie sur ce serveur seulement)"
fi

trap - ERR
[ -n "$ALERTE_CMD" ] && { sh -c "$ALERTE_CMD" "succes" "$AUJOURDHUI" || journal "signal de succès NON envoyé"; }
journal "TERMINÉ"
