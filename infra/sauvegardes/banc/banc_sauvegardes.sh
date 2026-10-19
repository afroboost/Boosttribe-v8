#!/bin/bash
# =============================================================================================
# Banc LOCAL des scripts de sauvegarde (JAMAIS la production) : Postgres 16 Homebrew + faux docker
# (Docker n'est pas installé sur le Mac ; sur le serveur, le test utilise la vraie image Supabase).
# Sources : les SCHÉMAS RÉELS des 2 bases (banc S0 : infra/s0/banc/00 + 10, variantes bt et live)
# + migrations S0 00, 01, 02 (état de la production depuis le 19/10) + compléments factices
# (storage, données, fichiers audio factices). Aucune donnée réelle.
#
# Tout vit dans un dossier jetable créé par mktemp (sous $TMPDIR), supprimé à la fin avec les faux
# conteneurs, même en cas d'échec. Usage : bash infra/sauvegardes/banc/banc_sauvegardes.sh
#
# Familles de cas :
#   N  nominal : sauvegarde → restauration identique (2 bases + fichiers), alertes de succès ;
#   P  une protection RETIRÉE après la sauvegarde → le test de restauration DOIT échouer (un cas par
#      protection : RLS, FORCE RLS, SECURITY DEFINER, GRANT, déclencheur, propriétaire, règle…) ;
#   Q  production DÉJÀ privée d'une protection → la sauvegarde ALERTE et le test échoue (empreintes
#      pourtant identiques : seul le contrôle absolu des protections le voit) ;
#   R  erreurs de restauration : connues tolérées, inconnues / sauvegarde corrompue → échec ;
#   E  envoi et chiffrement : envoi en échec, clé absente ou illisible → échec ; envoi réussi ;
#   F  fichiers audio : restauration identique, fichier altéré / manquant détecté, archive réutilisée ;
#   T  rotation 7 + 4 sur 35 jours, copie chiffrée ouverte par la clé privée (clé de BANC) ;
#   S  post-S0 : sources 00+01+02+03 (bt) et 00+01+02+03+04 (live), POST_S0_NIVEAU=03_04 : nominal OK ;
#      03 retirée / affaiblie, 04 perdue → échec ; 03 / 04 perdues EN ENTIER → vues seulement grâce au niveau.
# =============================================================================================
set -u
ICI=$(cd "$(dirname "$0")" && pwd); S=$(cd "$ICI/.." && pwd); S0=$(cd "$S/../s0" && pwd)
T=$(mktemp -d "${TMPDIR:-/tmp}/banc-sauv.XXXXXX") || exit 1
mkdir -p "$T/bin" "$T/c"
D() { FAKE_DIR="$T/c" bash "$ICI/faux_docker.sh" "$@"; }
nettoyage() {
  for c in $(ls "$T/c" 2>/dev/null | sed -n 's/\.port$//p'); do D rm -f "$c"; done
  if [ "${BANC_GARDER:-0}" = 1 ]; then echo "Dossier du banc CONSERVÉ (BANC_GARDER=1) : $T"; else rm -rf "$T"; fi
}
trap nettoyage EXIT
cp "$ICI/faux_docker.sh" "$T/bin/docker"; chmod +x "$T/bin/docker"
command -v sha256sum >/dev/null || { printf '#!/bin/bash\nexec shasum -a 256 "$@"\n' > "$T/bin/sha256sum"; chmod +x "$T/bin/sha256sum"; }
command -v flock >/dev/null || { printf '#!/bin/bash\nexit 0\n' > "$T/bin/flock"; chmod +x "$T/bin/flock"; }
export FAKE_DIR="$T/c" PATH="$T/bin:$PATH" SAUV_CONF=/nonexistent ESPACE_MIN_MO=100 ATTENTE_S=15 ATTENTE_FIN_S=0
export S0_NIVEAU=complet ALERTES="$T/alertes.log"
# Alerte de banc : on note « statut|source|message » (aucun envoi réel).
export ALERTE_CMD='printf "%s|%s|%s\n" "$1" "$3" "$2" >> "$ALERTES"'
# Clé RSA de BANC (jamais celle du Mac).
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$T/cle_privee.pem" 2>/dev/null
openssl pkey -in "$T/cle_privee.pem" -pubout -out "$T/cle_publique.pem"
export CLE_PUBLIQUE="$T/cle_publique.pem"

# ── Sources ─────────────────────────────────────────────────────────────────────────────────────
construire() {  # $1 = conteneur, $2 = bt|live
  local c=$1
  P() { D exec "$c" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -q -X "$@"; }
  D run -d --rm --name "$c" img >/dev/null || return 1
  P -c "create role postgres nosuperuser createrole createdb login; create role anon nologin;
        create role authenticated nologin; create role service_role nologin bypassrls;
        create role authenticator noinherit login; grant anon, authenticated, service_role to authenticator;" || return 1
  P -f "$S0/banc/00_supabase_simule.sql" || return 1
  if [ "$2" = live ]; then P -v live=true -c "set role postgres" -f "$S0/banc/10_etat_actuel.sql"
  else P -v live=false -f "$S0/banc/10_etat_actuel.sql"; fi || return 1
  P -f "$S0/00_urgent_wallet_add.sql" && P -f "$S0/01_s0_additif.sql" && P -f "$S0/02_s0_verrou.sql" \
    && P -f "$ICI/source_factice.sql"
}
fichiers() {  # $1 = dossier : fichiers factices à la disposition Supabase (stub/stub/<seau>/<nom>/<version>)
  local r=$1/stub/stub
  for o in "audio-tracks/S1/1760000000_intro.mp3:4096" "audio-tracks/S1/1760000001_danse.mp3:8192" \
           "audio-tracks/S2/1760000002_final.mp3:2048" "session-recordings/S1/enregistrement.webm:16384"; do
    mkdir -p "$r/${o%%:*}"; head -c "${o##*:}" /dev/urandom > "$r/${o%%:*}/v-$(openssl rand -hex 4)"
  done
}
echo "Construction des sources (schémas réels bt + live, S0 00/01/02, fichiers factices)…"
construire src-bt bt > "$T/construction.log" 2>&1 && construire src-live live >> "$T/construction.log" 2>&1 \
  || { echo "ÉCHEC de construction"; grep -v NOTICE "$T/construction.log" | tail -20; exit 1; }
fichiers "$T/fichiers-bt"; fichiers "$T/fichiers-live"
echo "$T/fichiers-bt" > "$T/c/stockage-bt.montage"          # bt : dossier trouvé par « docker inspect »
export BASES="boosttribe:src-bt live:src-live"
export STOCKAGES="boosttribe:stockage-bt live:$T/fichiers-live"   # live : chemin direct

ok=0; ko=0; LISTE=""
res() {  # $1 = nom, $2 = 0 si conforme
  if [ "$2" = 0 ]; then echo "OK     $1"; ok=$((ok + 1)); else echo "ÉCHEC  $1"; ko=$((ko + 1)); LISTE="$LISTE
  - $1"; fi
}
sauv() { bash "$S/sauvegarde_bases.sh" "$@"; }
rest() { bash "$S/test_restauration.sh" "$@"; }
alerte_vue() { grep -q "^$1|$2|" "$ALERTES" 2>/dev/null; }   # $1 statut, $2 source

# ═════ N — nominal ═══════════════════════════════════════════════════════════════════════════════
export RACINE="$T/racine"
: > "$ALERTES"
sauv > "$T/n1.log" 2>&1; c=$?
[ $c = 0 ] && grep -q 'TERMINÉ' "$T/n1.log" && alerte_vue succes sauvegarde && ! alerte_vue echec sauvegarde
res "N1 sauvegarde nominale (2 bases + 2 stockages) : code 0, alerte de SUCCÈS envoyée" $?
[ $c = 0 ] || { sed 's/^/      /' "$T/n1.log" | tail -15; echo "Sauvegarde nominale impossible : arrêt du banc."; exit 1; }
J=$(ls -d "$RACINE"/quotidien/* | tail -1)
! grep -q MANQUANTE "$J"/*-protections.txt && [ "$(grep -c ' OK — ' "$J/boosttribe-protections.txt")" -ge 30 ]
res "N2 protections S0 de la source : toutes OK ($(grep -c ' OK — ' "$J/boosttribe-protections.txt") contrôles par base)" $?
: > "$ALERTES"
rest > "$T/n3.log" 2>&1; c=$?
[ $c = 0 ] && [ "$(grep -c 'RESTAURATION OK' "$T/n3.log")" = 2 ] && grep -q 'fichiers : 4 identiques, 4 objet(s) en base' "$T/n3.log" \
  && alerte_vue succes restauration && grep -q 'message(s) connu(s)' "$T/n3.log"
res "N3 restauration nominale : 2 bases identiques, 4 fichiers identiques, erreurs connues tolérées, alerte de SUCCÈS" $?
[ $c = 0 ] || sed 's/^/      /' "$T/n3.log" | tail -30

# ═════ P — chaque protection retirée APRÈS la sauvegarde : le test DOIT échouer ═════════════════
# Méthode : copie exacte de la source (clone), protection retirée sur la copie, nouveau pg_dump +
# rôles, empreintes / protections / fichiers de la sauvegarde nominale conservés.
cas_mutation() {  # $1 = id, $2 = libellé, $3 = SQL, $4 = base (boosttribe|live), $5 = motif attendu (grep -E)
  local id=$1 lib=$2 sql=$3 nom=${4:-boosttribe} motif=${5:-'empreintes DIFFÉRENTES|MANQUANTE'}
  local src; [ "$nom" = live ] && src=${SRC_LIVE:-src-live} || src=${SRC_BT:-src-bt}
  local jr=${JREF:-$J}     # sauvegarde de référence (famille S : celle des sources post-S0)
  local d="$T/cas/$id"; mkdir -p "$d"
  D clone "$src" mut >/dev/null 2>&1 || { res "$id $lib (clone impossible)" 1; return; }
  if [ -n "$sql" ]; then
    local q=(-c "$sql"); [ "${sql#@}" != "$sql" ] && q=(-f "${sql#@}")   # « @fichier » = script SQL
    D exec mut psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -q -X "${q[@]}" > "$T/cas/$id.sql.log" 2>&1 \
      || { res "$id $lib (SQL refusé : $(head -1 "$T/cas/$id.sql.log"))" 1; D rm -f mut; return; }
  fi
  cp "$jr/$nom-empreintes.txt" "$jr/$nom-protections.txt" "$jr/$nom-stockage.tar" "$jr/$nom-stockage.manifeste" "$d/"
  D exec mut pg_dump -U supabase_admin -d postgres -Fc > "$d/$nom-postgres.dump"
  D exec mut pg_dumpall -U supabase_admin --globals-only --no-role-passwords > "$d/$nom-roles.sql"
  D rm -f mut
  (cd "$d" && sha256sum ./* > SHA256SUMS)
  rest "$d" > "$T/cas/$id.log" 2>&1; local c=$?
  if [ -z "$sql" ]; then
    [ $c = 0 ]; res "$id $lib" $?
  else
    local vu=""
    grep -q 'empreintes DIFFÉRENTES' "$T/cas/$id.log" && vu="empreintes"
    grep -q 'MANQUANTE' "$T/cas/$id.log" && vu="${vu:+$vu + }protections"
    [ $c -ne 0 ] && grep -Eq "$motif" "$T/cas/$id.log"; res "$id $lib → échec (vu par : ${vu:-RIEN})" $?
  fi
}
cas_mutation P0  "témoin : copie exacte SANS modification → restauration OK (la méthode ne crée pas d'écart)" ""
cas_mutation P1  "RLS désactivée sur profiles" "alter table public.profiles disable row level security"
cas_mutation P2  "RLS désactivée sur credit_ledger" "alter table public.credit_ledger disable row level security"
cas_mutation P3  "FORCE RLS retirée (coach_subscriptions)" "alter table public.coach_subscriptions no force row level security" boosttribe 'empreintes DIFFÉRENTES'
cas_mutation P4  "SECURITY DEFINER retiré de wallet_add" "alter function public.wallet_add(uuid,numeric,text,text,boolean) security invoker"
cas_mutation P5  "GRANT ALL sur credit_ledger à anon + authenticated" "grant all on public.credit_ledger to anon, authenticated" boosttribe 'empreintes DIFFÉRENTES'
cas_mutation P6  "GRANT ALL sur s0_sauvegarde_policies à anon" "grant all on public.s0_sauvegarde_policies to anon"
cas_mutation P7  "wallet_add rouverte à anon (EXECUTE)" "grant execute on function public.wallet_add(uuid,numeric,text,text,boolean) to anon"
cas_mutation P8  "déclencheur s0_proteger_profil désactivé" "alter table public.profiles disable trigger s0_proteger_profil"
cas_mutation P9  "déclencheur s0_proteger_playlist en mode REPLICA (inactif)" "alter table public.playlists enable replica trigger s0_proteger_playlist"
cas_mutation P10 "propriétaire de credits_disponibles changé" "alter function public.credits_disponibles(uuid) owner to postgres"
cas_mutation P11 "propriétaire de la table credit_ledger changé" "alter table public.credit_ledger owner to postgres" boosttribe 'empreintes DIFFÉRENTES'
cas_mutation P12 "règle s0_profiles_select_soi élargie (USING true)" "alter policy s0_profiles_select_soi on public.profiles using (true)"
cas_mutation P13 "règle d'écriture ajoutée sur credit_ledger" "create policy x on public.credit_ledger for insert to authenticated with check (true)"
cas_mutation P14 "vue profiles_public élargie (+ email)" "create or replace view public.profiles_public as select id, full_name, avatar_url, email from public.profiles"
cas_mutation P15 "search_path retiré de spend_credits" "alter function public.spend_credits(uuid,integer,text,text,text) reset search_path"
cas_mutation P16 "s0_proteger_profil passé en SECURITY DEFINER (verrou contourné)" "alter function public.s0_proteger_profil() security definer"
cas_mutation P17 "droit de colonne retiré (profiles.full_name)" "revoke update (full_name) on public.profiles from authenticated" boosttribe 'empreintes DIFFÉRENTES'
cas_mutation P18 "droits par défaut modifiés (tables futures)" "alter default privileges in schema public revoke all on tables from anon" boosttribe 'empreintes DIFFÉRENTES'
cas_mutation P19 "règle storage modifiée (suppression ouverte à tous)" "alter policy \"Allow owner delete\" on storage.objects to public using (true)" boosttribe 'empreintes DIFFÉRENTES'
cas_mutation P20 "rôle anon passé en BYPASSRLS" "alter role anon bypassrls" boosttribe 'empreintes DIFFÉRENTES'
cas_mutation P21 "corps d'une fonction remplacé (s0_defaut)" "create or replace function public.s0_defaut(p_table regclass, p_col text) returns jsonb language sql stable set search_path = public as 'select null::jsonb'" boosttribe 'empreintes DIFFÉRENTES'
cas_mutation P22 "access_requests_host_update recréée (live)" "create policy access_requests_host_update on public.access_requests for update to authenticated using (true)" live
cas_mutation P23 "donnée modifiée (crédits d'un profil)" "update public.profiles set credits = 999 where id = '00000000-0000-0000-0000-000000000001'" boosttribe 'empreintes DIFFÉRENTES'

# ═════ Q — production DÉJÀ privée d'une protection ══════════════════════════════════════════════
D clone src-bt prod-trouee >/dev/null 2>&1
D exec prod-trouee psql -U supabase_admin -d postgres -q -X -c "alter table public.profiles disable trigger s0_proteger_profil" >/dev/null
: > "$ALERTES"
RACINE="$T/racine-q" BASES="boosttribe:prod-trouee" STOCKAGES="" sauv > "$T/q1.log" 2>&1; c=$?
[ $c -ne 0 ] && grep -q 'MANQUANTE(S) EN PRODUCTION' "$T/q1.log" && alerte_vue echec sauvegarde \
  && [ -f "$(ls -d "$T"/racine-q/quotidien/*)/boosttribe-postgres.dump" ] && [ -f "$T/racine-q/chiffre/$(ls "$T/racine-q/chiffre" | grep tgz.enc)" ]
res "Q1 production sans verrou : sauvegarde ENREGISTRÉE et chiffrée, mais code ≠ 0 + alerte d'ÉCHEC" $?
RACINE="$T/racine-q" EXIGER_STOCKAGE=0 rest > "$T/q2.log" 2>&1; c=$?
[ $c -ne 0 ] && grep -q 'MANQUANTE' "$T/q2.log" && ! grep -q 'empreintes DIFFÉRENTES' "$T/q2.log"
res "Q2 restauration de cette sauvegarde : empreintes identiques MAIS protection manquante → échec" $?
D rm -f prod-trouee

# ═════ S — post-S0 : 03 (2 bases) + 04 (/live), POST_S0_NIVEAU=03_04 ═════════════════════════════
MIG=$(cd "$S/../post-s0/migrations" && pwd)
D clone src-bt src-bt3 >/dev/null 2>&1 && D clone src-live src-live34 >/dev/null 2>&1 \
  && D exec src-bt3 psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -q -X -f "$MIG/03_cgu_preuve.sql" > "$T/s-construction.log" 2>&1 \
  && D exec src-live34 psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -q -X -f "$MIG/03_cgu_preuve.sql" >> "$T/s-construction.log" 2>&1 \
  && D exec src-live34 psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -q -X -f "$MIG/04_session_sans_hote.sql" >> "$T/s-construction.log" 2>&1
res "S0 sources post-S0 construites (bt : 00+01+02+03 ; live : 00+01+02+03+04)" $?
: > "$ALERTES"
RACINE="$T/racine-s" BASES="boosttribe:src-bt3 live:src-live34" POST_S0_NIVEAU=03_04 sauv > "$T/s1.log" 2>&1; c=$?
JS=$(ls -d "$T"/racine-s/quotidien/* 2>/dev/null | tail -1)
[ $c = 0 ] && alerte_vue succes sauvegarde && ! grep -q MANQUANTE "$JS"/*-protections.txt \
  && [ "$(grep -c ' OK — ' "$JS/boosttribe-protections.txt")" -ge 48 ] && [ "$(grep -c ' OK — ' "$JS/live-protections.txt")" -ge 49 ] \
  && [ "$(grep -Ec '^PROTECTION cgu\.[a-z_.]+ OK' "$JS/live-protections.txt")" = 8 ] \
  && grep -q '^PROTECTION regle.playlists.sans_hote_vide OK' "$JS/live-protections.txt" \
  && grep -q '^PROTECTION table.ps0_04_sauvegarde_policy.fermee OK' "$JS/live-protections.txt" \
  && grep -q '^PROTECTION table.ps0_04_sauvegarde_policy.fermee SANS_OBJET' "$JS/boosttribe-protections.txt"
res "S1 sauvegarde post-S0 nominale (niveau 03_04) : code 0, 03 + 04 OK ($(grep -c ' OK — ' "$JS/boosttribe-protections.txt" 2>/dev/null) / $(grep -c ' OK — ' "$JS/live-protections.txt" 2>/dev/null) contrôles OK)" $?
[ $c = 0 ] || { sed 's/^/      /' "$T/s1.log" | tail -15; }
: > "$ALERTES"
RACINE="$T/racine-s" POST_S0_NIVEAU=03_04 rest > "$T/s2.log" 2>&1; c=$?
[ $c = 0 ] && [ "$(grep -c 'RESTAURATION OK' "$T/s2.log")" = 2 ] && alerte_vue succes restauration
res "S2 restauration post-S0 nominale (niveau 03_04) : 2 bases identiques, protections OK" $?
[ $c = 0 ] || sed 's/^/      /' "$T/s2.log" | tail -20
export POST_S0_NIVEAU=03_04 SRC_BT=src-bt3 SRC_LIVE=src-live34 JREF="$JS"
cas_mutation S3 "accepter_cgu rouverte à anon (GRANT EXECUTE)" "grant execute on function public.accepter_cgu(text) to anon" boosttribe 'MANQUANTE'
cas_mutation S4 "déclencheur s0_proteger_profil_cgu désactivé" "alter table public.profiles disable trigger s0_proteger_profil_cgu" boosttribe 'MANQUANTE'
cas_mutation S5 "accepter_cgu passée en SECURITY INVOKER (live)" "alter function public.accepter_cgu(text) security invoker" live 'MANQUANTE'
cas_mutation S6 "contrainte profiles_cgu_preuve_coherente retirée (live)" "alter table public.profiles drop constraint profiles_cgu_preuve_coherente" live 'MANQUANTE'
cas_mutation S7 "04 perdue : playlists_update remise avec host_id IS NULL (live)" "drop policy playlists_update on public.playlists;
  create policy playlists_update on public.playlists for update to authenticated
    using ((host_id is null) or ((host_id)::text = (auth.uid())::text) or (coalesce(cohosts, '[]'::jsonb) @> to_jsonb((auth.uid())::text)))
    with check ((host_id is null) or ((host_id)::text = (auth.uid())::text) or (coalesce(cohosts, '[]'::jsonb) @> to_jsonb((auth.uid())::text)))" live 'MANQUANTE'
cas_mutation S8 "03 perdue EN ENTIER (rollback 03 joué sur la copie)" "@$MIG/03_cgu_preuve_rollback.sql" boosttribe 'MANQUANTE'
unset SRC_BT SRC_LIVE JREF; export POST_S0_NIVEAU=aucun
# Production DÉJÀ privée de 04 en entier (rollback 04 : règle d'origine + table de sauvegarde retirée) :
# seul le niveau explicite le voit ; en « aucun », l'absence ressemble à « jamais appliquée ».
D clone src-live34 prod-sans04 >/dev/null 2>&1
D exec prod-sans04 psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -q -X -f "$MIG/04_session_sans_hote_rollback.sql" >/dev/null 2>&1
: > "$ALERTES"
RACINE="$T/racine-s9" BASES="live:prod-sans04" STOCKAGES="" POST_S0_NIVEAU=03_04 sauv > "$T/s9.log" 2>&1; c1=$?
RACINE="$T/racine-s9b" BASES="live:prod-sans04" STOCKAGES="" POST_S0_NIVEAU=aucun sauv > "$T/s9b.log" 2>&1; c2=$?
[ $c1 -ne 0 ] && grep -q 'MANQUANTE(S) EN PRODUCTION.*regle.playlists.sans_hote_vide' "$T/s9.log" && alerte_vue echec sauvegarde \
  && [ $c2 = 0 ] && grep -q '^PROTECTION regle.playlists.sans_hote_vide SANS_OBJET' "$(ls -d "$T"/racine-s9b/quotidien/*)/live-protections.txt"
res "S9 production /live sans 04 (rollback complet) : niveau 03_04 → code ≠ 0 + alerte ; niveau aucun → non vu (SANS_OBJET)" $?
D rm -f prod-sans04
RACINE="$T/racine-s" POST_S0_NIVEAU=O3 rest > "$T/s10.log" 2>&1; c=$?
[ $c -ne 0 ] && grep -q 'POST_S0_NIVEAU invalide' "$T/s10.log"
res "S10 POST_S0_NIVEAU inconnu (faute de frappe « O3 ») → refus immédiat" $?
D rm -f src-bt3; D rm -f src-live34

# ═════ R — erreurs de restauration ═════════════════════════════════════════════════════════════
copie_jour() { local d="$T/cas/$1"; mkdir -p "$d"; cp "$J"/* "$d/"; echo "$d"; }
d=$(copie_jour R1); sed -i '' '/service_role/d' "$d/boosttribe-roles.sql"; (cd "$d" && sha256sum ./*.dump ./*.sql ./*.txt ./*.tar ./*.manifeste > SHA256SUMS)
rest "$d" > "$T/r1.log" 2>&1; c=$?
[ $c -ne 0 ] && grep -q 'NON répertoriée' "$T/r1.log" && grep -q 'role "service_role" does not exist' "$T/r1.log"
res "R1 erreur de restauration inconnue (rôle service_role manquant) → échec, message affiché" $?
d=$(copie_jour R2); head -c 20000 "$J/live-postgres.dump" > "$d/live-postgres.dump"; (cd "$d" && sha256sum ./*.dump ./*.sql ./*.txt ./*.tar ./*.manifeste > SHA256SUMS)
rest "$d" > "$T/r2.log" 2>&1; c=$?
[ $c -ne 0 ] && grep -q 'live : ÉCHEC' "$T/r2.log"
res "R2 sauvegarde tronquée (SHA-256 recalculés) → échec" $?
d=$(copie_jour R3); printf 'x' >> "$d/boosttribe-empreintes.txt"
rest "$d" > "$T/r3.log" 2>&1; c=$?
[ $c -ne 0 ] && grep -q 'SHA-256 invalides' "$T/r3.log"
res "R3 fichier modifié sans SHA-256 à jour → échec immédiat" $?
d=$(copie_jour R4); rm "$d"/live-*; D exec src-bt pg_dump -U supabase_admin -d postgres -Fc --no-acl --no-owner > "$d/boosttribe-postgres.dump"
(cd "$d" && sha256sum ./*.dump ./*.sql ./*.txt ./*.tar ./*.manifeste > SHA256SUMS)
rest "$d" > "$T/r4.log" 2>&1; c=$?
[ $c -ne 0 ] && grep -q 'empreintes DIFFÉRENTES' "$T/r4.log" && grep -q 'MANQUANTE' "$T/r4.log"
res "R4 sauvegarde SANS droits (comme Coolify --no-acl --no-owner) → échec (empreintes + protections)" $?
: > "$ALERTES"
FAUX_RUN_ECHEC=1 rest "$J" > "$T/r5.log" 2>&1; c=$?
[ $c -ne 0 ] && alerte_vue echec restauration
res "R5 conteneur de test impossible à démarrer → échec + alerte d'ÉCHEC" $?

# ═════ E — chiffrement, envoi, alertes ═════════════════════════════════════════════════════════
: > "$ALERTES"
RACINE="$T/racine-e1" ENVOI_CMD='exit 3' sauv > "$T/e1.log" 2>&1; c=$?
[ $c -ne 0 ] && grep -q 'envoi hors serveur ÉCHOUÉ (code 3)' "$T/e1.log" && alerte_vue echec sauvegarde
res "E1 envoi configuré qui échoue → code ≠ 0 + alerte d'ÉCHEC" $?
: > "$ALERTES"
RACINE="$T/racine-e2" ENVOI_CMD='true' CLE_PUBLIQUE="$T/absente.pem" sauv > "$T/e2.log" 2>&1; c=$?
[ $c -ne 0 ] && grep -q 'clé publique ABSENTE' "$T/e2.log" && alerte_vue echec sauvegarde && [ ! -d "$T/racine-e2/chiffre" ]
res "E2 envoi configuré mais clé publique absente → code ≠ 0 + alerte, rien d'envoyé" $?
printf 'pas une clé\n' > "$T/fausse.pem"
RACINE="$T/racine-e3" ENVOI_CMD='true' CLE_PUBLIQUE="$T/fausse.pem" sauv > "$T/e3.log" 2>&1; c=$?
[ $c -ne 0 ] && grep -q 'clé publique illisible' "$T/e3.log"
res "E3 clé publique illisible → code ≠ 0" $?
mkdir -p "$T/distant"
: > "$ALERTES"
RACINE="$T/racine-e4" DISTANT="$T/distant" ENVOI_CMD='cp "$1/$2".* "$DISTANT"/' sauv > "$T/e4.log" 2>&1; c=$?
[ $c = 0 ] && [ "$(ls "$T/distant" | wc -l | tr -d ' ')" = 3 ] && alerte_vue succes sauvegarde && grep -q 'envoi oui' "$ALERTES"
res "E4 envoi réussi : 3 fichiers chiffrés arrivés (tgz.enc, cle.enc, sha256), alerte de SUCCÈS" $?
RACINE="$T/racine-e5" CLE_PUBLIQUE="$T/absente.pem" sauv > "$T/e5.log" 2>&1; c1=$?
RACINE="$T/racine-e5b" CLE_PUBLIQUE="$T/absente.pem" EXIGER_HORS_SERVEUR=1 sauv > "$T/e5b.log" 2>&1; c2=$?
[ $c1 = 0 ] && grep -q AVERTISSEMENT "$T/e5.log" && [ $c2 -ne 0 ]
res "E5 ni clé ni envoi : avertissement (code 0) ; avec EXIGER_HORS_SERVEUR=1 → code ≠ 0" $?
mkdir -p "$T/racine-e6/chiffre"; : > "$T/racine-e6/chiffre/autre-fichier"
RACINE="$T/racine-e6" sauv > "$T/e6.log" 2>&1; c=$?
[ $c = 0 ]; res "E6 rotation des copies chiffrées sans correspondance (grep sous pipefail) → pas d'échec" $?
RACINE="$T/racine-e7" ALERTE_CMD='exit 1' sauv > "$T/e7.log" 2>&1; c=$?
[ $c = 0 ] && grep -q 'alerte « succes » NON envoyée' "$T/e7.log"
res "E7 service d'alerte en panne : sauvegarde réussie quand même, panne journalisée" $?
: > "$ALERTES"
RACINE="$T/racine-e8" BASES="boosttribe:inexistante" sauv > "$T/e8.log" 2>&1; c=$?
[ $c -ne 0 ] && alerte_vue echec sauvegarde
res "E8 base injoignable → code ≠ 0 + alerte d'ÉCHEC" $?
RACINE="$T/racine-e9" STOCKAGES="boosttribe:$T/absent" sauv > "$T/e9.log" 2>&1; c=$?
[ $c -ne 0 ] && grep -q 'dossier des fichiers introuvable' "$T/e9.log"
res "E9 dossier des fichiers introuvable → code ≠ 0" $?
! grep -qi 'PRIVATE KEY' "$T"/*.log "$ALERTES" && ! grep -q 'S0K=' "$T"/*.log "$ALERTES"
res "E10 aucune clé dans les journaux / alertes" $?

# ═════ F — fichiers audio ══════════════════════════════════════════════════════════════════════
d=$(copie_jour F1); X="$T/cas/F1x"; mkdir -p "$X"; tar -xf "$d/boosttribe-stockage.tar" -C "$X"
f=$(find "$X" -type f -name 'v-*' | sort | head -1); printf 'Z' | dd of="$f" bs=1 seek=100 conv=notrunc 2>/dev/null
(cd "$X" && tar -cf "$d/boosttribe-stockage.tar" .); (cd "$d" && sha256sum ./*.dump ./*.sql ./*.txt ./*.tar ./*.manifeste > SHA256SUMS)
rest "$d" > "$T/f1.log" 2>&1; c=$?
[ $c -ne 0 ] && grep -q 'DIFFÉRENTS du manifeste' "$T/f1.log"
res "F1 un octet altéré dans un fichier audio de l'archive → échec (manifeste)" $?
d=$(copie_jour F2); X="$T/cas/F2x"; mkdir -p "$X"; tar -xf "$d/live-stockage.tar" -C "$X"
rm -rf "$X/stub/stub/audio-tracks/S2"
(cd "$X" && tar -cf "$d/live-stockage.tar" .)
(cd "$X" && find . -type f -print0 | LC_ALL=C sort -z | while IFS= read -r -d '' g; do printf '%s %s %s\n' "$(sha256sum < "$g" | cut -d' ' -f1)" "$(wc -c < "$g" | tr -d ' ')" "$g"; done) > "$d/live-stockage.manifeste"
(cd "$d" && sha256sum ./*.dump ./*.sql ./*.txt ./*.tar ./*.manifeste > SHA256SUMS)
rest "$d" > "$T/f2.log" 2>&1; c=$?
[ $c -ne 0 ] && grep -q 'SANS fichier' "$T/f2.log" && grep -q 'audio-tracks/S2/1760000002_final.mp3' "$T/f2.log"
res "F2 fichier absent de l'archive alors que storage.objects le référence → échec (cohérence)" $?
d=$(copie_jour F3); rm "$d"/boosttribe-stockage.*; (cd "$d" && sha256sum ./*.dump ./*.sql ./*.txt ./*.tar ./*.manifeste > SHA256SUMS)
rest "$d" > "$T/f3.log" 2>&1; c=$?
[ $c -ne 0 ] && grep -q 'aucune archive des fichiers' "$T/f3.log"
res "F3 sauvegarde sans archive de fichiers → échec (EXIGER_STOCKAGE=1)" $?
RACINE="$T/racine-f4" AUJOURDHUI=2026-11-01 sauv > /dev/null 2>&1 && RACINE="$T/racine-f4" AUJOURDHUI=2026-11-02 sauv > "$T/f4.log" 2>&1; c=$?
i1=$(ls -i "$T/racine-f4/quotidien/2026-11-01/boosttribe-stockage.tar" | awk '{print $1}')
i2=$(ls -i "$T/racine-f4/quotidien/2026-11-02/boosttribe-stockage.tar" | awk '{print $1}')
[ $c = 0 ] && [ "$i1" = "$i2" ] && grep -q 'archive réutilisée' "$T/f4.log"
res "F4 fichiers inchangés depuis la veille → archive réutilisée (lien physique, 0 octet en plus)" $?
head -c 1000 /dev/urandom > "$T/fichiers-bt/stub/stub/audio-tracks/S1/nouveau.mp3"
RACINE="$T/racine-f4" AUJOURDHUI=2026-11-03 sauv > "$T/f5.log" 2>&1; c=$?
i3=$(ls -i "$T/racine-f4/quotidien/2026-11-03/boosttribe-stockage.tar" | awk '{print $1}')
[ $c = 0 ] && [ "$i3" != "$i2" ] && grep -q '5 fichiers' "$T/f5.log" && RACINE="$T/racine-f4" STOCKAGE_COHERENCE=strict rest > "$T/f5r.log" 2>&1
res "F5 nouveau fichier → nouvelle archive (5 fichiers) ; restauration OK (fichier sans ligne en base toléré)" $?
rm -f "$T/fichiers-bt/stub/stub/audio-tracks/S1/nouveau.mp3"

# ═════ T — rotation + copie chiffrée ═══════════════════════════════════════════════════════════
export RACINE="$T/racine-t"
for n in $(seq 0 34); do
  j=$(python3 -c "import datetime as d;x=d.date(2026,11,1)+d.timedelta($n);print(x.isoformat(),x.isoweekday(),'%d-S%02d'%x.isocalendar()[:2])")
  set -- $j; AUJOURDHUI=$1 NUMERO_JOUR=$2 SEMAINE=$3 sauv > /dev/null 2>&1 || echo "  échec du jour $1"
done
[ "$(ls "$RACINE/quotidien" | wc -l | tr -d ' ')" = 7 ] && [ "$(ls "$RACINE/hebdomadaire" | wc -l | tr -d ' ')" = 4 ] \
  && [ "$(ls "$RACINE/chiffre" | grep -c '\.sha256$')" = 7 ]
res "T1 rotation sur 35 jours : 7 quotidiennes + 4 hebdomadaires + 7 copies chiffrées" $?
C=$(ls "$RACINE"/chiffre/*.tgz.enc | tail -1); V="$T/v"; mkdir -m 700 "$V"
S0K=$(openssl pkeyutl -decrypt -inkey "$T/cle_privee.pem" -pkeyopt rsa_padding_mode:oaep -pkeyopt rsa_oaep_md:sha256 -in "${C%.tgz.enc}.cle.enc") \
  && S0K=$S0K openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in "$C" -pass env:S0K | tar xzf - -C "$V" \
  && (cd "$V"/* && sha256sum -c --quiet SHA256SUMS) && ls "$V"/*/boosttribe-stockage.tar >/dev/null
res "T2 copie chiffrée ouverte par la clé privée (de banc) : SHA-256 OK, fichiers audio inclus" $?
rest "$(ls -d "$V"/*)" > "$T/t3.log" 2>&1
res "T3 restauration complète depuis la copie chiffrée déchiffrée" $?

echo "--- $ok OK / $ko ÉCHEC"
[ "$ko" = 0 ] || { echo "Cas en échec :$LISTE"; exit 1; }
