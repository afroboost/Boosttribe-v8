#!/usr/bin/env bash
# =============================================================================================
# Sauvegarde quotidienne des DEUX bases Supabase (boosttribe.pro et afroboost.com/live)
# ET de leurs FICHIERS (Supabase Storage : sons des sessions, enregistrements).
# À lancer en root sur le serveur Hetzner (cron, 1×/jour) — voir README.md (installation APRÈS GO).
#
# Pour CHAQUE base, séparément :
#   - pg_dump -Fc COMPLET (données, structures, fonctions, règles RLS, DROITS, propriétaires),
#     en supabase_admin — contrairement à la sauvegarde native Coolify (--no-acl --no-owner), qui
#     perd les GRANT/REVOKE dont dépend la sécurité S0 ;
#   - pg_dumpall --globals-only --no-role-passwords (rôles, sans aucun mot de passe) ;
#   - empreintes de contrôle (empreintes.sql) relevées avant ET après, pour le test de restauration ;
#   - protections S0 critiques (protections_s0.sql) : une protection MANQUANTE en production
#     déclenche une ALERTE (la sauvegarde est tout de même enregistrée et envoyée) ;
#   - vérification que la sauvegarde se relit (pg_restore --list).
# Pour CHAQUE stockage de fichiers : archive tar du dossier du service storage (volume monté sur
# /var/lib/storage), lecture seule, + manifeste (sha256, taille, chemin) ; si rien n'a changé depuis
# la veille, l'archive de la veille est réutilisée (lien physique, aucun espace en plus).
# Puis : SHA256SUMS, rotation 7 quotidiennes + 4 hebdomadaires (dimanche), copie CHIFFRÉE pour
# l'extérieur (AES-256 + clé RSA PUBLIQUE du Mac : seule la clé privée du Mac l'ouvre), envoi.
#
# Code de sortie ≠ 0 au moindre échec. ALERTE_CMD est appelée en ÉCHEC comme en SUCCÈS :
#   sh -c "$ALERTE_CMD" alerte <echec|succes> <message> sauvegarde
# Échec en particulier si : un envoi est configuré (ENVOI_CMD) et échoue, ou si la clé publique est
# absente / illisible alors qu'un envoi est configuré, ou si une protection S0 manque en production.
# Aucune écriture dans les bases ni dans les dossiers de fichiers : lecture seule.
# =============================================================================================
set -Eeuo pipefail
umask 077
export COPYFILE_DISABLE=1   # tar macOS (banc) : pas de fichiers « ._* » parasites

# ── Réglages (surchargeables par /root/.sauvegarde-bases.env, droits 600) ───────────────────────
CONF=${SAUV_CONF:-/root/.sauvegarde-bases.env}
# shellcheck disable=SC1090
[ -f "$CONF" ] && . "$CONF"
BASES=${BASES:-"boosttribe:supabase-db-gneo8v4uuw94cpmf5fh2db3a live:supabase-db-l12j96qw3srbix6s5h29yoo4"}
# Fichiers : « nom:conteneur » (le dossier est lu par docker inspect, montage $STOCKAGE_MONTAGE)
# ou « nom:/chemin/absolu » (dossier donné directement). Vide = fichiers NON sauvegardés.
STOCKAGES=${STOCKAGES-"boosttribe:supabase-storage-gneo8v4uuw94cpmf5fh2db3a live:supabase-storage-l12j96qw3srbix6s5h29yoo4"}
STOCKAGE_MONTAGE=${STOCKAGE_MONTAGE:-/var/lib/storage}
RACINE=${RACINE:-/root/sauvegardes-bases}
CLE_PUBLIQUE=${CLE_PUBLIQUE:-/root/s0-sauvegardes/cle_publique_mac.pem}
GARDER_QUOTIDIENNES=${GARDER_QUOTIDIENNES:-7}
GARDER_HEBDOMADAIRES=${GARDER_HEBDOMADAIRES:-4}
JOUR_HEBDO=${JOUR_HEBDO:-7}              # 1 = lundi … 7 = dimanche
ESPACE_MIN_MO=${ESPACE_MIN_MO:-2048}     # refuse de tourner sous 2 Go libres (+ 2× la taille des fichiers)
PG_USER=${PG_USER:-supabase_admin}
DOCKER=${DOCKER:-docker}                 # remplaçable par un faux « docker » pour les tests locaux
S0_NIVEAU=${S0_NIVEAU:-complet}          # protections exigées : complet (00+01+02) | etape1 | aucun
POST_S0_NIVEAU=${POST_S0_NIVEAU:-aucun}  # post-S0 exigé : aucun (03/04 contrôlées si présentes) | 03 | 03_04
ENVOI_CMD=${ENVOI_CMD:-}                 # ex. rsync vers la destination HORS serveur (après GO)
EXIGER_HORS_SERVEUR=${EXIGER_HORS_SERVEUR:-0}   # 1 = échec s'il n'y a ni copie chiffrée ni envoi
ALERTE_CMD=${ALERTE_CMD:-}               # ex. ping healthchecks.io / e-mail (après GO) — voir README § 4
ALERTE_DELAI_S=${ALERTE_DELAI_S:-30}
AUJOURDHUI=${AUJOURDHUI:-$(date -u +%F)}
NUMERO_JOUR=${NUMERO_JOUR:-$(date -u +%u)}
SEMAINE=${SEMAINE:-$(date -u +%G-S%V)}
ICI=$(cd "$(dirname "$0")" && pwd)
EMPREINTES_SQL=${EMPREINTES_SQL:-$ICI/empreintes.sql}
PROTECTIONS_SQL=${PROTECTIONS_SQL:-$ICI/protections_s0.sql}

journal() { printf '%s [sauvegarde] %s\n' "$(date -u +%FT%TZ)" "$*"; }
alerter() {  # $1 = echec|succes, $2 = message
  [ -n "$ALERTE_CMD" ] || return 0
  local code=0
  if command -v timeout >/dev/null 2>&1; then
    timeout "$ALERTE_DELAI_S" sh -c "$ALERTE_CMD" alerte "$1" "$2" sauvegarde || code=$?
  else
    sh -c "$ALERTE_CMD" alerte "$1" "$2" sauvegarde || code=$?
  fi
  [ "$code" = 0 ] || journal "alerte « $1 » NON envoyée (code $code)"
}
echec() {
  trap - ERR
  # Dans un sous-shell (set -E) : on sort sans alerter, le shell principal s'en charge.
  [ -n "${BASHPID:-}" ] && [ "$BASHPID" != "$$" ] && exit 1
  journal "ÉCHEC : $*"
  alerter echec "$*"
  exit 1
}
trap 'echec "ligne $LINENO (commande : $BASH_COMMAND)"' ERR

case "$S0_NIVEAU" in complet|etape1|aucun) ;; *) echec "S0_NIVEAU invalide ($S0_NIVEAU)";; esac
case "$POST_S0_NIVEAU" in aucun|03|03_04) ;; *) echec "POST_S0_NIVEAU invalide ($POST_S0_NIVEAU)";; esac

# ── Un seul passage à la fois ────────────────────────────────────────────────────────────────────
mkdir -p "$RACINE"; chmod 700 "$RACINE"
exec 9>"$RACINE/.verrou"
flock -n 9 || echec "une sauvegarde tourne déjà"

# ── Garde-fous ───────────────────────────────────────────────────────────────────────────────────
[ -f "$EMPREINTES_SQL" ] || echec "empreintes.sql introuvable ($EMPREINTES_SQL)"
[ -f "$PROTECTIONS_SQL" ] || echec "protections_s0.sql introuvable ($PROTECTIONS_SQL)"

# Dossier des fichiers d'un stockage (lecture seule).
stockage_source() {  # $1 = conteneur ou /chemin
  case "$1" in
    /*) printf '%s\n' "$1" ;;
    *)  "$DOCKER" inspect -f "{{range .Mounts}}{{if eq .Destination \"$STOCKAGE_MONTAGE\"}}{{.Source}}{{end}}{{end}}" "$1" ;;
  esac
}
# Manifeste d'un dossier : « sha256 taille ./chemin », trié (octets), fichiers ordinaires seulement.
manifeste() {  # $1 = dossier
  ( cd "$1" && find . -type f -print0 | LC_ALL=C sort -z | while IFS= read -r -d '' f; do
      h=$(sha256sum < "$f" | cut -d' ' -f1) && [ -n "$h" ] || { echo "illisible : $f" >&2; exit 1; }
      t=$(wc -c < "$f" | tr -d ' ')
      printf '%s %s %s\n' "$h" "$t" "$f"
    done )
}
TAR_OPTS=()
if tar --version 2>/dev/null | grep -q 'GNU tar'; then
  # Les métadonnées des objets (type, cache) sont des attributs étendus des fichiers.
  TAR_OPTS=(--xattrs --xattrs-include='*' --numeric-owner)
fi

# Sources de fichiers résolues AVANT de commencer (échec immédiat si un dossier est introuvable).
declare -a ST_NOMS=() ST_SOURCES=()
taille_fichiers_mo=0
for entree in $STOCKAGES; do
  nom=${entree%%:*}; val=${entree#*:}
  src=$(stockage_source "$val") || echec "$nom : dossier des fichiers introuvable ($val)"
  [ -n "$src" ] && [ -d "$src" ] && [ -r "$src" ] || echec "$nom : dossier des fichiers introuvable ou illisible (« $src », depuis $val)"
  ST_NOMS+=("$nom"); ST_SOURCES+=("$src")
  taille_fichiers_mo=$(( taille_fichiers_mo + $(du -sm "$src" | cut -f1) ))
done
[ -n "$STOCKAGES" ] || journal "AVERTISSEMENT : STOCKAGES vide — les FICHIERS (sons, enregistrements) ne sont PAS sauvegardés"

libre_mo=$(df -Pm "$RACINE" | awk 'NR==2 {print $4}')
besoin_mo=$(( ESPACE_MIN_MO + 2 * taille_fichiers_mo ))
[ "$libre_mo" -ge "$besoin_mo" ] || echec "espace disque insuffisant (${libre_mo} Mo libres < ${besoin_mo} Mo requis)"

JOUR="$RACINE/quotidien/$AUJOURDHUI"
TMP="$RACINE/.en-cours-$AUJOURDHUI"
rm -rf "$TMP"; mkdir -p "$TMP"
# Sauvegarde précédente (pour réutiliser une archive de fichiers inchangée).
PRECEDENT=$({ ls -1 "$RACINE/quotidien" 2>/dev/null || true; } | { grep -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' || true; } \
            | { grep -vx "$AUJOURDHUI" || true; } | sort | tail -1)

# ── Sauvegarde de chaque base ────────────────────────────────────────────────────────────────────
releve() {  # $1 = conteneur, $2 = fichier SQL — lecture seule
  "$DOCKER" exec -i -e PGOPTIONS='-c default_transaction_read_only=on' "$1" \
    psql -U "$PG_USER" -d postgres -At -X -v ON_ERROR_STOP=1 -v niveau="$S0_NIVEAU" -v post_s0="$POST_S0_NIVEAU" < "$2"
}
MANQUE=""
nb_bases=0
for entree in $BASES; do
  nom=${entree%%:*}; conteneur=${entree#*:}
  journal "$nom : début ($conteneur)"
  # Empreintes relevées AVANT et APRÈS la sauvegarde : si une écriture tombe entre les deux, on
  # recommence (sinon le test de restauration signalerait un faux écart). 3 essais au plus.
  stable=0
  for essai in 1 2 3; do
    releve "$conteneur" "$EMPREINTES_SQL" > "$TMP/$nom-empreintes.avant"
    "$DOCKER" exec "$conteneur" pg_dump -U "$PG_USER" -d postgres -Fc > "$TMP/$nom-postgres.dump"
    "$DOCKER" exec "$conteneur" pg_dumpall -U "$PG_USER" --globals-only --no-role-passwords > "$TMP/$nom-roles.sql"
    releve "$conteneur" "$EMPREINTES_SQL" > "$TMP/$nom-empreintes.txt"
    if cmp -s "$TMP/$nom-empreintes.avant" "$TMP/$nom-empreintes.txt"; then stable=1; break; fi
    journal "$nom : écriture pendant la sauvegarde (essai $essai) — on recommence"
  done
  rm -f "$TMP/$nom-empreintes.avant"
  [ "$stable" = 1 ] || echec "$nom : base modifiée pendant chaque essai — empreintes non fiables"
  # La sauvegarde doit se relire entièrement (table des matières complète).
  entrees=$("$DOCKER" exec -i "$conteneur" pg_restore --list < "$TMP/$nom-postgres.dump" | { grep -vc '^;' || true; })
  [ "$entrees" -gt 50 ] || echec "$nom : sauvegarde illisible ou vide ($entrees entrées)"
  grep -q '^grand_livre n=' "$TMP/$nom-empreintes.txt" && grep -q '^rel public\.profiles ' "$TMP/$nom-empreintes.txt" \
    || echec "$nom : empreintes incomplètes"
  # Protections S0 critiques, relevées sur la production.
  releve "$conteneur" "$PROTECTIONS_SQL" > "$TMP/$nom-protections.txt"
  [ "$(grep -c '^PROTECTION ' "$TMP/$nom-protections.txt" || true)" -ge 20 ] || echec "$nom : contrôle des protections S0 incomplet"
  if grep -q ' MANQUANTE ' "$TMP/$nom-protections.txt"; then
    m=$(grep ' MANQUANTE ' "$TMP/$nom-protections.txt" | awk '{print $2}' | paste -sd, -)
    MANQUE="$MANQUE $nom:[$m]"
    journal "$nom : ⚠ PROTECTION(S) S0 MANQUANTE(S) EN PRODUCTION : $m"
  fi
  nb_bases=$((nb_bases + 1))
  journal "$nom : OK ($(wc -c < "$TMP/$nom-postgres.dump" | tr -d ' ') octets, $entrees entrées, $(wc -l < "$TMP/$nom-empreintes.txt" | tr -d ' ') empreintes)"
done

# ── Fichiers (Supabase Storage) — APRÈS les bases : un fichier ajouté entre-temps est en trop (sans
#    gravité) ; jamais une ligne storage.objects sans son fichier. ────────────────────────────────
i=0
while [ "$i" -lt "${#ST_NOMS[@]}" ]; do
  nom=${ST_NOMS[$i]}; src=${ST_SOURCES[$i]}; i=$((i + 1))
  stable=0
  for essai in 1 2 3; do
    manifeste "$src" > "$TMP/$nom-stockage.manifeste.avant"
    ancien="$RACINE/quotidien/$PRECEDENT"
    rm -f "$TMP/$nom-stockage.tar"
    if [ -n "$PRECEDENT" ] && [ -f "$ancien/$nom-stockage.tar" ] \
       && cmp -s "$ancien/$nom-stockage.manifeste" "$TMP/$nom-stockage.manifeste.avant"; then
      ln "$ancien/$nom-stockage.tar" "$TMP/$nom-stockage.tar"; reutilise=1
    else
      tar -cf "$TMP/$nom-stockage.tar" ${TAR_OPTS[@]+"${TAR_OPTS[@]}"} -C "$src" .; reutilise=0
    fi
    manifeste "$src" > "$TMP/$nom-stockage.manifeste"
    if cmp -s "$TMP/$nom-stockage.manifeste.avant" "$TMP/$nom-stockage.manifeste"; then stable=1; break; fi
    journal "$nom : fichiers modifiés pendant l'archive (essai $essai) — on recommence"
  done
  rm -f "$TMP/$nom-stockage.manifeste.avant"
  [ "$stable" = 1 ] || echec "$nom : fichiers modifiés pendant chaque essai — archive non fiable"
  # L'archive doit se relire et contenir autant de fichiers que le manifeste.
  dans_tar=$(tar -tf "$TMP/$nom-stockage.tar" | { grep -vc '/$' || true; })
  attendus=$(wc -l < "$TMP/$nom-stockage.manifeste" | tr -d ' ')
  [ "$dans_tar" = "$attendus" ] || echec "$nom : archive des fichiers incohérente ($dans_tar dans l'archive, $attendus attendus)"
  journal "$nom : fichiers OK ($attendus fichiers, $(wc -c < "$TMP/$nom-stockage.tar" | tr -d ' ') octets$([ "$reutilise" = 1 ] && echo ', inchangés depuis la veille : archive réutilisée'))"
done

( cd "$TMP" && shopt -s nullglob && sha256sum -- *.dump *.sql *.txt *.tar *.manifeste > SHA256SUMS )
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

# ── Copie CHIFFRÉE pour l'extérieur ──────────────────────────────────────────────────────────────
CHIFFRE="$RACINE/chiffre"
chiffree=0
if [ -n "$ENVOI_CMD" ] || [ -f "$CLE_PUBLIQUE" ]; then
  [ -f "$CLE_PUBLIQUE" ] || echec "envoi hors serveur configuré mais clé publique ABSENTE ($CLE_PUBLIQUE) : aucune copie chiffrée, rien n'est envoyé"
  openssl pkey -pubin -in "$CLE_PUBLIQUE" -noout 2>/dev/null || echec "clé publique illisible ($CLE_PUBLIQUE)"
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
  [ -s "$base.tgz.enc" ] && [ -s "$base.cle.enc" ] || echec "copie chiffrée vide"
  ( cd "$CHIFFRE" && sha256sum -- "sauvegarde-$AUJOURDHUI.tgz.enc" "sauvegarde-$AUJOURDHUI.cle.enc" > "sauvegarde-$AUJOURDHUI.sha256" )
  chiffree=1
  journal "copie chiffrée prête : $base.tgz.enc"
else
  [ "$EXIGER_HORS_SERVEUR" = 1 ] && echec "aucune copie chiffrée (clé publique absente : $CLE_PUBLIQUE) alors que EXIGER_HORS_SERVEUR=1"
  journal "AVERTISSEMENT : clé publique absente ($CLE_PUBLIQUE) et aucun envoi configuré — aucune copie chiffrée"
fi
if [ -d "$CHIFFRE" ]; then
  # shellcheck disable=SC2012
  ls -1 "$CHIFFRE" | { grep -E '^sauvegarde-[0-9-]{10}\.sha256$' || true; } | sort -r \
    | tail -n +"$(( GARDER_QUOTIDIENNES + 1 ))" | sed 's/\.sha256$//' | while read -r vieux; do
        rm -f -- "$CHIFFRE/$vieux".*; journal "rotation : copie chiffrée $vieux retirée"
      done
fi

# ── Envoi hors serveur (uniquement la copie CHIFFRÉE) ────────────────────────────────────────────
envoyee=0
if [ -n "$ENVOI_CMD" ]; then
  code=0
  sh -c "$ENVOI_CMD" envoi "$CHIFFRE" "sauvegarde-$AUJOURDHUI" || code=$?
  [ "$code" = 0 ] || echec "envoi hors serveur ÉCHOUÉ (code $code) — la copie n'est que sur ce serveur"
  envoyee=1
  journal "copie chiffrée envoyée hors serveur"
else
  [ "$EXIGER_HORS_SERVEUR" = 1 ] && echec "aucun envoi hors serveur configuré (ENVOI_CMD vide) alors que EXIGER_HORS_SERVEUR=1"
  journal "AVERTISSEMENT : aucun envoi hors serveur configuré (copie sur ce serveur seulement)"
fi

# ── Protections manquantes en production : la sauvegarde est faite, mais on ALERTE ───────────────
[ -z "$MANQUE" ] || echec "sauvegarde $AUJOURDHUI ENREGISTRÉE, mais protection(s) S0 MANQUANTE(S) EN PRODUCTION :$MANQUE"

trap - ERR
alerter succes "sauvegarde $AUJOURDHUI : $nb_bases base(s), ${#ST_NOMS[@]} stockage(s) de fichiers, copie chiffrée $([ $chiffree = 1 ] && echo oui || echo NON), envoi $([ $envoyee = 1 ] && echo oui || echo NON)"
journal "TERMINÉ"
