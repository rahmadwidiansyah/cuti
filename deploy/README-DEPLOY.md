# Deploy Production

Panduan menjalankan Web Pengajuan Cuti dengan Docker Compose di belakang Cloudflare Tunnel. Satu image memuat frontend dan API sekaligus. Compose ini tidak menjalankan database. PostgreSQL disiapkan terpisah.

## Prasyarat

- Docker 24 atau lebih baru dan Docker Compose v2.
- PostgreSQL yang bisa dijangkau dari container.
- Domain yang sudah terhubung ke Cloudflare.

## Struktur

```
Web/
├── Dockerfile
├── .dockerignore
├── .github/workflows/ci.yml
└── deploy/
    ├── docker-compose.yml
    ├── entrypoint.sh
    ├── nginx/nginx.conf
    ├── verify/
    │   ├── deps.sh            verifikasi dependensi runtime
    │   └── layout.sh          verifikasi layout berkas image
    ├── .env.production.example
    ├── README-DEPLOY.md
    └── data/                  (dibuat saat deploy, tidak di-commit)
        └── storage/           lampiran, avatar, dokumen, tanda tangan
```

Di dalam container, nginx melayani `dist` pada port 80 dan meneruskan `/api/` ke Express pada `127.0.0.1:3001`. Keduanya dijalankan oleh `deploy/entrypoint.sh`.

## 1. Siapkan database

Compose ini tidak membuat database. Jalankan sekali pada server PostgreSQL:

```bash
psql -U postgres -f "../Database/001_schema.sql"
```

File itu membuat extension `btree_gist` dan `pgcrypto`, schema `cuti`, serta tabel dasarnya. Migrasi berikutnya dijalankan otomatis oleh aplikasi saat start dan dicatat di `cuti.schema_migrations`.

User database aplikasi butuh izin membuat tabel dan menulis data pada schema `cuti`.

## 2. Siapkan environment

```bash
cd deploy
cp .env.production.example .env
```

Isi `DATABASE_URL` atau pasangan `DB_*`. `APP_PORT` sudah bernilai `3989`.

Alamat database harus bisa dijangkau dari dalam container. `127.0.0.1` di dalam container menunjuk ke container itu sendiri, bukan ke host.

### Tombol login demo (auto-isi akun)

Tombol floating di halaman login **sengaja nonaktif di image produksi**. Dua variabel di `.env` mengaturnya:

| Variabel | Dipakai saat | Fungsi |
|---|---|---|
| `VITE_SHOW_DEMO_LOGIN=true` | build image | Menyertakan tombol di bundle frontend |
| `SEED_DEMO_ACCOUNTS=true` | container start | Membuat 10 akun demo bila belum ada (idempoten) |
| `DEMO_PASSWORD` | seed | Kata sandi demo, bawaan `Cuti123!` |

Contoh untuk lingkungan demo:

```bash
VITE_SHOW_DEMO_LOGIN=true SEED_DEMO_ACCOUNTS=true docker compose up -d --build
```

Karena `VITE_SHOW_DEMO_LOGIN` dipakai saat build, **image harus di-build ulang** setelah mengubahnya. Workflow CI (`.github/workflows/ci.yml`) sudah meneruskan build-arg ini ke image GHCR, dengan nilai bawaan `true`. Nilai bawaan bisa ditimpa lewat GitHub Actions variable repository `VITE_SHOW_DEMO_LOGIN`. Untuk produksi, set variable itu ke `false` agar kredensial demo tidak terekspos.

Image hasil CI juga perlu `SEED_DEMO_ACCOUNTS=true` saat container dijalankan supaya akun-akun demo tersedia di database.

## 3. Siapkan direktori penyimpanan

Node berjalan sebagai user `node` dengan uid 1000, jadi direktori harus bisa ditulis:

```bash
install -d -o 1000 -g 1000 data/storage
```

Tanpa langkah ini, unggahan lampiran gagal dengan `EACCES`.

## 4. Jalankan

```bash
docker compose up -d --build
docker compose ps
```

Cek dari host:

```bash
curl -fsS http://127.0.0.1:3989/healthz
curl -fsS http://127.0.0.1:3989/api/health
```

`/healthz` hanya memeriksa nginx. `/api/health` menembak database, jadi kegagalan di sini berarti koneksi PostgreSQL bermasalah.

## 5. Verifikasi image

`Dockerfile` memakai beberapa stage. Tiga stage terakhir hanya untuk memastikan image akhir bersih, dan alat verifikasinya tidak ikut ke image.

| Stage | Isi | Gagal bila |
|---|---|---|
| `deps` | `npm ci --omit=dev` | Dependensi produksi tidak terpasang |
| `build` | `npm ci` penuh lalu `vite build` | Build frontend gagal |
| `runtime` | nginx, Express, `dist`, `node_modules` produksi | Berkas wajib hilang |
| `verify-deps` | `deploy/verify/deps.sh` | Paket khusus build (`vue`, `@vue`, `lucide-vue-next`, `vite`, `@vitejs`, `concurrently`) atau `node_modules/.bin` ada di image |
| `verify-layout` | `deploy/verify/layout.sh` | `src`, `server/tests`, `Database`, `deploy`, `.env`, `.github`, `package-lock.json`, `/usr/share/nginx/html`, `npm`, `npx`, atau source map ada di image |
| `verify` | Menggabungkan hasil kedua verifikasi | Salah satu verifikasi gagal |
| `app` | Image akhir | - |

Kedua stage verifikasi berjalan paralel. Masing-masing menulis stamp file, lalu stage `verify` menyalin stamp itu dan menghapus `/usr/local/bin/verify`. Stage `app` adalah target yang dipakai Compose dan CI.

Untuk memeriksa ulang secara manual:

```bash
docker build --target verify -t cuti-app:verify .
docker build --target app --build-arg VITE_SHOW_DEMO_LOGIN=true -t cuti-app:local .

docker run --rm cuti-app:local sh -c '
  du -sh node_modules
  ls -d node_modules/vue node_modules/vite 2>/dev/null || echo "paket build bersih"
  command -v npm || echo "npm tidak ada"
'
```

Hasil build 18 November 2026:

| Ukuran | Sebelum | Sesudah |
|---|---|---|
| Image | 470 MB | 292 MB |
| `node_modules` | 90.0 MB | 34.4 MB |
| Paket top-level | 139 | 126 |

Pengurangan berasal dari `vue`, `@vue/*`, dan `lucide-vue-next` yang pindah ke `devDependencies`, penghapusan `npm`/`npx`/`corepack`/`yarn`, serta pembersihan `node_modules/.bin` dan `node_modules/.package-lock.json`. `@swc/helpers` tetap ada karena dibutuhkan `fontkit`, dependensi `pdfkit`.

## 6. Cloudflare Tunnel

Ada dua pilihan.

**A. Tunnel sebagai service Compose**

Isi `CLOUDFLARE_TUNNEL_TOKEN` di `.env`, lalu:

```bash
docker compose --profile tunnel up -d
```

Di dashboard Cloudflare, origin service diarahkan ke `http://app:80`.

**B. Tunnel di host**

Jalankan cloudflared di host dan arahkan origin ke `http://127.0.0.1:3989`. Port hanya terikat ke loopback, jadi tidak terbuka ke jaringan luar.

Pada kedua pilihan, TLS diputus Cloudflare. nginx hanya mendengarkan HTTP di port 80 di dalam container.

## 7. Update dan rollback

```bash
docker compose pull
docker compose up -d
```

Untuk kembali ke image sebelumnya, ganti tag pada `image:` di `docker-compose.yml` ke digest atau tag lama, lalu jalankan ulang.

Data di `data/storage` tidak terhapus oleh `docker compose down`. Jangan pakai `down -v` bila tidak ingin menghapus volume.

## 8. CI dan image GHCR

Workflow `.github/workflows/ci.yml` berjalan pada push ke `main`, tag `v*`, dan pull request. Isinya:

1. `npm ci`, cek sintaks file server, test unit tanpa database, lalu `npm run build`.
2. Build satu image `cuti-app`, push ke GHCR saat bukan pull request.
3. Ukur ukuran image dari cache build dan gagalkan job bila melewati 400 MB. Hasilnya muncul di ringkasan job.

Nama image mengikuti pemilik repo, misalnya `ghcr.io/<owner>/cuti-app`. Untuk memakai image dari GHCR di server:

```bash
docker login ghcr.io -u <user> -p <token>
```

lalu ubah `build:` menjadi `image: ghcr.io/<owner>/cuti-app:<tag>` pada compose.

## Troubleshooting

| Gejala | Penyebab | Tindakan |
|---|---|---|
| Container restart terus | Koneksi database gagal atau schema `cuti` belum ada | `docker compose logs app`, jalankan `Database/001_schema.sql` |
| `502 Bad Gateway` | Express belum siap atau berhenti | `docker compose logs app`, cek `curl http://127.0.0.1:3989/api/health` |
| Login berhasil tetapi langsung keluar | Cookie `Secure` aktif karena `NODE_ENV=production`, tetapi diakses lewat HTTP | Akses melalui domain HTTPS Cloudflare |
| Unggah gagal `EACCES` | `data/storage` bukan milik uid 1000 | `chown -R 1000:1000 data/storage` |
| `413 Request Entity Too Large` | Berkas melebihi batas | Batas 50 MB per request, 10 MB per berkas |
| IP di audit log `127.0.0.1` | Header `CF-Connecting-IP` tidak sampai | Pastikan trafik lewat Cloudflare Tunnel, bukan port langsung |

## Catatan keamanan

- Port 3989 sengaja diikat ke `127.0.0.1`, bukan `0.0.0.0`.
- Node berjalan sebagai user `node`, bukan root. Nginx master tetap root agar bisa bind port 80, sedangkan worker-nya memakai user `nginx`.
- Jangan commit `deploy/.env` dan isi `deploy/data`.
- Seed demo `Database/003_demo_seed.sql` memakai kata sandi bersama. Jangan dipakai di production.
