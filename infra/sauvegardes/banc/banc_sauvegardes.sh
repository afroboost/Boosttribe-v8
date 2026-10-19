#!/bin/bash
# Banc LOCAL des scripts de sauvegarde (jamais la production) : Postgres 16 Homebrew + faux docker.
# T1 sauvegarde → restauration identique ; T2 une sauvegarde SANS droits (comme la sauvegarde native
# Coolify --no-acl --no-owner) est DÉTECTÉE ; T3 base injoignable → code ≠ 0 ; T4 rotation 7 + 4 sur 35 jours ;
# T5 la copie chiffrée s'ouvre avec la clé privée du Mac (si présente).
set -u
ICI=$(cd "$(dirname "$0")" && pwd); S=$(cd "$ICI/.." && pwd)
T=$(mktemp -d /tmp/banc-sauv.XXXX); mkdir -p "$T/bin" "$T/c"
trap 'for c in $(ls "$T/c" | sed -n "s/\.port$//p"); do DOCKER_FAKE rm -f "$c"; done; rm -rf "$T"' EXIT
DOCKER_FAKE() { FAKE_DIR="$T/c" bash "$ICI/faux_docker.sh" "$@"; }
cp "$ICI/faux_docker.sh" "$T/bin/docker"; chmod +x "$T/bin/docker"
command -v sha256sum >/dev/null || { printf '#!/bin/bash\nexec shasum -a 256 "$@"\n' > "$T/bin/sha256sum"; chmod +x "$T/bin/sha256sum"; }
command -v flock >/dev/null || { printf '#!/bin/bash\nexit 0\n' > "$T/bin/flock"; chmod +x "$T/bin/flock"; }
export FAKE_DIR="$T/c" PATH="$T/bin:$PATH" SAUV_CONF=/nonexistent RACINE="$T/racine" ESPACE_MIN_MO=100 ATTENTE_S=15
export BASES="boosttribe:fausse-bt live:fausse-live"
CLE_MAC="$HOME/.afroboost-s0-sauvegarde"
[ -f "$CLE_MAC/cle_publique.pem" ] && export CLE_PUBLIQUE="$CLE_MAC/cle_publique.pem" || export CLE_PUBLIQUE=/nonexistent
for c in fausse-bt fausse-live; do docker run -d --rm --name $c img >/dev/null && docker exec -i $c psql -U supabase_admin -d postgres -q -v ON_ERROR_STOP=1 < "$ICI/source_factice.sql" || exit 1; done
ok=0; ko=0; res() { if [ "$2" = 0 ]; then echo "OK    $1"; ok=$((ok+1)); else echo "ECHEC $1"; ko=$((ko+1)); fi; }
bash "$S/sauvegarde_bases.sh" > "$T/t1.log" 2>&1 && bash "$S/test_restauration.sh" >> "$T/t1.log" 2>&1; res "T1 sauvegarde puis restauration à l'identique (2 bases)" $?
J=$(ls -d "$RACINE"/quotidien/* | tail -1); N="$T/sans-droits/x"; mkdir -p "$N"; cp "$J/boosttribe-roles.sql" "$J/boosttribe-empreintes.txt" "$N/"
docker exec fausse-bt pg_dump -U supabase_admin -d postgres -Fc --no-acl --no-owner > "$N/boosttribe-postgres.dump"; (cd "$N" && sha256sum ./*.dump ./*.sql ./*.txt > SHA256SUMS)
bash "$S/test_restauration.sh" "$N" > "$T/t2.log" 2>&1; [ $? -ne 0 ] && grep -q "droits" "$T/t2.log"; res "T2 sauvegarde sans droits DÉTECTÉE (perte des REVOKE)" $?
BASES="boosttribe:inexistante" bash "$S/sauvegarde_bases.sh" > "$T/t3.log" 2>&1; [ $? -ne 0 ]; res "T3 base injoignable → code de sortie ≠ 0" $?
rm -rf "$RACINE"; for d in $(seq 0 34); do
  j=$(python3 -c "import datetime as d;x=d.date(2026,11,1)+d.timedelta($d);print(x.isoformat(),x.isoweekday(),'%d-S%02d'%x.isocalendar()[:2])")
  set -- $j; AUJOURDHUI=$1 NUMERO_JOUR=$2 SEMAINE=$3 bash "$S/sauvegarde_bases.sh" > /dev/null 2>&1 || echo "  échec $1"
done
[ "$(ls "$RACINE/quotidien" | wc -l | tr -d ' ')" = 7 ] && [ "$(ls "$RACINE/hebdomadaire" | wc -l | tr -d ' ')" = 4 ]; res "T4 rotation sur 35 jours : 7 quotidiennes + 4 hebdomadaires" $?
if [ -f "$CLE_MAC/cle_privee.pem" ]; then
  C=$(ls "$RACINE"/chiffre/*.tgz.enc | tail -1); V="$T/v"; mkdir -m 700 "$V"
  S0K=$(openssl pkeyutl -decrypt -inkey "$CLE_MAC/cle_privee.pem" -pkeyopt rsa_padding_mode:oaep -pkeyopt rsa_oaep_md:sha256 -in "${C%.tgz.enc}.cle.enc") \
    && S0K=$S0K openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in "$C" -pass env:S0K | tar xzf - -C "$V" \
    && (cd "$V"/* && sha256sum -c --quiet SHA256SUMS); res "T5 copie chiffrée ouverte par la clé privée du Mac, SHA-256 OK" $?
else echo "SAUTÉ T5 (clé privée du Mac absente)"; fi
echo "--- $ok OK / $ko ÉCHEC"; [ "$ko" = 0 ]
