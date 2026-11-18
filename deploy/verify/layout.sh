#!/bin/sh
# Memastikan layout image hanya berisi berkas yang dibutuhkan saat jalan.
set -eu

status=0

for path in \
    /app/package.json \
    /app/server/index.js \
    /app/server/migrations \
    /app/server/assets/tvri-logo.png \
    /app/dist/index.html \
    /etc/nginx/nginx.conf \
    /usr/local/bin/entrypoint.sh
do
    if [ ! -e "$path" ]; then
        echo "GAGAL: berkas wajib hilang: $path"
        status=1
    fi
done

for path in \
    /app/src \
    /app/server/tests \
    /app/Database \
    /app/deploy \
    /app/.env \
    /app/.github \
    /app/package-lock.json \
    /app/node_modules/.bin \
    /usr/share/nginx/html
do
    if [ -e "$path" ]; then
        echo "GAGAL: berkas tidak perlu ada di image: $path"
        status=1
    fi
done

if command -v npm >/dev/null 2>&1; then
    echo "GAGAL: npm masih ada di image"
    status=1
fi

if command -v npx >/dev/null 2>&1; then
    echo "GAGAL: npx masih ada di image"
    status=1
fi

if find /app/dist -name "*.map" | grep -q .; then
    echo "GAGAL: source map ditemukan di dist"
    status=1
fi

if [ "$status" -ne 0 ]; then
    exit 1
fi

echo "OK: layout image bersih"
echo "--- ukuran komponen ---"
du -sh /app/node_modules /app/server /app/dist 2>/dev/null || true
du -sh /usr/local/lib/node_modules /usr/lib/nginx /etc/nginx 2>/dev/null || true
