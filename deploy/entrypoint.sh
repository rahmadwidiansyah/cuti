#!/bin/sh
set -eu

# Node berjalan sebagai user node, nginx tetap master root agar bisa bind port 80.
su-exec node node server/index.js &
api_pid=$!

nginx -g 'daemon off;' &
web_pid=$!

# Opsional: isi akun demo setelah migrasi selesai (API siap menerima request).
if [ "${SEED_DEMO_ACCOUNTS:-false}" = "true" ]; then
    i=0
    while [ "$i" -lt 60 ]; do
        if wget -qO- http://127.0.0.1:3001/api/health >/dev/null 2>&1; then
            break
        fi
        i=$((i + 1))
        sleep 1
    done
    su-exec node node server/seed-demo.js || echo "Seed akun demo gagal." >&2
fi

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
