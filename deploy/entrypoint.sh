#!/bin/sh
set -eu

# Node berjalan sebagai user node, nginx tetap master root agar bisa bind port 80.
su-exec node node server/index.js &
api_pid=$!

nginx -g 'daemon off;' &
web_pid=$!

shutdown() {
    kill -TERM "$web_pid" "$api_pid" 2>/dev/null || true
    wait "$web_pid" 2>/dev/null || true
    wait "$api_pid" 2>/dev/null || true
    exit 0
}

trap shutdown TERM INT

# Bila salah satu proses berhenti, hentikan container agar dijalankan ulang.
while kill -0 "$api_pid" 2>/dev/null && kill -0 "$web_pid" 2>/dev/null; do
    sleep 1
done

kill -TERM "$web_pid" "$api_pid" 2>/dev/null || true
wait "$web_pid" 2>/dev/null || true
wait "$api_pid" 2>/dev/null || true
exit 1
