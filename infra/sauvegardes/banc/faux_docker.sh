#!/bin/bash
# Faux « docker » pour le banc LOCAL : chaque « conteneur » = un cluster Postgres 16 Homebrew jetable.
F=${FAKE_DIR:?}; PGB=${PGBIN:-/opt/homebrew/opt/postgresql@16/bin}
cmd=$1; shift
case "$cmd" in
  exec)
    envs=()
    while [ $# -gt 0 ]; do case "$1" in -i) shift;; -e) envs+=("$2"); shift 2;; *) break;; esac; done
    c=$1; shift
    [ -f "$F/$c.port" ] || { echo "Error: No such container: $c" >&2; exit 1; }
    args=(); while [ $# -gt 0 ]; do if [ "$1" = -h ]; then shift 2; continue; fi; args+=("$1"); shift; done
    p=${args[0]}; args=("${args[@]:1}")
    env "${envs[@]}" PGHOST="$(cat "$F/$c.sockdir")" PGPORT="$(cat "$F/$c.port")" "$PGB/$p" "${args[@]}";;
  run)
    name=""; while [ $# -gt 1 ]; do case "$1" in --name) name=$2; shift 2;; -e|--network|--memory) shift 2;; *) shift;; esac; done
    port=$(( 56000 + RANDOM % 900 )); sd=$(mktemp -d /tmp/fd.XXXX); echo "$sd" > "$F/$name.sockdir"
    "$PGB/initdb" -D "$F/$name.data" -U supabase_admin -A trust >/dev/null &&
    "$PGB/pg_ctl" -D "$F/$name.data" -o "-p $port -k $sd -c listen_addresses=''" -l "$F/$name.log" start -w >/dev/null &&
    echo "$port" > "$F/$name.port" && echo "faux-$name";;
  rm)
    name=${*: -1}
    [ -f "$F/$name.port" ] && "$PGB/pg_ctl" -D "$F/$name.data" stop -m fast >/dev/null 2>&1
    rm -rf "$(cat "$F/$name.sockdir" 2>/dev/null)" "$F/$name.data" "$F/$name.port" "$F/$name.sockdir" "$F/$name.log";;
  *) echo "faux docker : commande $cmd non gérée" >&2; exit 1;;
esac
