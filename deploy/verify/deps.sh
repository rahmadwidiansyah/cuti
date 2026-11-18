#!/bin/sh
# Memastikan image hanya memuat dependensi yang dipakai server.
set -eu

cd /app
status=0

for paket in vue @vue lucide-vue-next vite @vitejs concurrently; do
    if [ -e "node_modules/$paket" ]; then
        echo "GAGAL: paket khusus build ada di image: $paket"
        status=1
    fi
done

for paket in express file-type multer pdfkit pg qrcode; do
    if [ ! -d "node_modules/$paket" ]; then
        echo "GAGAL: paket runtime hilang: $paket"
        status=1
    fi
done

if [ -e node_modules/.bin/vite ]; then
    echo "GAGAL: binari vite ada di image"
    status=1
fi

if [ -e node_modules/.package-lock.json ]; then
    echo "GAGAL: metadata npm tertinggal di image"
    status=1
fi

if [ "$status" -ne 0 ]; then
    exit 1
fi

echo "OK: dependensi runtime bersih, tanpa paket build"
