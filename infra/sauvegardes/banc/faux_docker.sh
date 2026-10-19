#!/bin/bash
# Faux « docker » pour le banc LOCAL : chaque « conteneur » = un cluster Postgres 16 Homebrew jetable,
# joignable en TCP sur 127.0.0.1 seulement (aucune socket dans /tmp ; tout vit sous $FAKE_DIR).
# Commandes : run, exec, rm, inspect (montage simulé) et clone (banc uniquement : copie exacte d'un
# conteneur arrêté-redémarré, pour rejouer une même base avec une protection retirée).
F=${FAKE_DIR:?}; PGB=${PGBIN:-/opt/homebrew/opt/postgresql@16/bin}
cmd=$1; shift
demarrer() {  # $1 = nom
  local port
  for _ in 1 2 3 4 5; do
    port=$(( 56000 + RANDOM % 3000 ))
    if "$PGB/pg_ctl" -D "$F/$1.data" -o "-p $port -k '' -c listen_addresses=127.0.0.1" \
         -l "$F/$1.log" start -w >/dev/null 2>&1; then echo "$port" > "$F/$1.port"; return 0; fi
  done
  return 1
}
case "$cmd" in
  exec)
    envs=()
    while [ $# -gt 0 ]; do case "$1" in -i) shift;; -e) envs+=("$2"); shift 2;; *) break;; esac; done
    c=$1; shift
    [ -f "$F/$c.port" ] || { echo "Error: No such container: $c" >&2; exit 1; }
    args=(); while [ $# -gt 0 ]; do if [ "$1" = -h ]; then shift 2; continue; fi; args+=("$1"); shift; done
    p=${args[0]}; args=("${args[@]:1}")
    env LC_ALL=C ${envs[@]+"${envs[@]}"} PGHOST=127.0.0.1 PGPORT="$(cat "$F/$c.port")" "$PGB/$p" ${args[@]+"${args[@]}"};;
  run)
    name=""; while [ $# -gt 1 ]; do case "$1" in --name) name=$2; shift 2;; -e|--network|--memory) shift 2;; *) shift;; esac; done
    [ -n "${FAUX_RUN_ECHEC:-}" ] && { echo "faux docker : démarrage refusé" >&2; exit 125; }
    "$PGB/initdb" -D "$F/$name.data" -U supabase_admin -A trust --locale=C >/dev/null && demarrer "$name" && echo "faux-$name";;
  clone)  # clone <source> <copie>
    s=$1; d=$2
    [ -f "$F/$s.port" ] || { echo "Error: No such container: $s" >&2; exit 1; }
    "$PGB/pg_ctl" -D "$F/$s.data" stop -m fast >/dev/null && cp -R "$F/$s.data" "$F/$d.data" \
      && rm -f "$F/$d.data/postmaster.pid" && demarrer "$s" && demarrer "$d";;
  inspect)  # inspect -f <format> <nom> : renvoie le dossier « monté » ($F/<nom>.montage)
    name=${*: -1}
    [ -f "$F/$name.montage" ] || { echo "Error: No such object: $name" >&2; exit 1; }
    cat "$F/$name.montage";;
  rm)
    name=${*: -1}
    [ -f "$F/$name.port" ] && "$PGB/pg_ctl" -D "$F/$name.data" stop -m fast >/dev/null 2>&1
    rm -rf "$F/$name.data" "$F/$name.port" "$F/$name.log";;
  *) echo "faux docker : commande $cmd non gérée" >&2; exit 1;;
esac
