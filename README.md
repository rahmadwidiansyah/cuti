# Web Pengajuan Cuti

MVP internal TU Digital dengan Vue 3, Vite, Express, dan PostgreSQL. Fitur yang tersedia: dashboard pegawai, pengajuan cuti dengan pratinjau hari kerja, riwayat dan detail pengajuan, antrean reviewer, tanda tangan internal reviewer, direktori pegawai dengan filter unit, kategori, dan status cuti, serta halaman Admin untuk melihat dan menyesuaikan kuota cuti tahunan pegawai.

## Tech stack

| Bagian | Teknologi | Versi | Kegunaan |
|---|---|---|---|
| Frontend | Vue 3 | ^3.5.44 | UI reaktif dan komponen halaman |
| Frontend | Vite | ^8.3.6 | Dev server dan build aset produksi |
| Frontend | @vitejs/plugin-vue | ^6.0.10 | Kompilasi Single File Component Vue |
| Frontend | lucide-vue-next | ^1.0.0 | Pustaka ikon |
| Backend | Node.js | 24 | Runtime API (ES modules) |
| Backend | Express | ^5.1.0 | REST API dan routing |
| Backend | Multer | ^2.0.2 | Unggahan lampiran, avatar, dan tanda tangan |
| Backend | file-type | ^21.0.0 | Validasi magic byte berkas unggahan |
| Backend | PDFKit | ^0.20.2 | Pembuatan formulir PDF final dan pratinjau |
| Backend | qrcode | ^1.5.4 | QR verifikasi dokumen |
| Database | PostgreSQL | - | Schema `cuti`, migrasi otomatis saat API start |
| Database | `pg` | ^8.16.3 | Driver PostgreSQL |
| Font PDF | Gotham Light | - | Font tertanam di dokumen hasil (OTF) |
| Testing | node:test | bawaan Node | 45 tes unit dan integrasi |
| Dev tooling | concurrently | ^10.0.7 | Menjalankan API dan Vite bersamaan |
| Deployment | Docker + nginx | - | Satu image berisi frontend statis dan API |
| Deployment | Cloudflare Tunnel | - | Publikasi HTTPS tanpa port terbuka |

## Menjalankan aplikasi

1. Pastikan database PostgreSQL sudah berisi schema `cuti` dan data referensi yang diperlukan. Skema dibuat dari `Database/001_schema.sql`.
2. Jika belum memiliki `.env`, salin `.env.example` menjadi `.env`. Jangan menimpa `.env` yang sudah ada.
3. Isi koneksi PostgreSQL. Server menerima `DB_CONNECTION=pgsql` beserta `DB_HOST`, `DB_PORT`, `DB_DATABASE`, `DB_USERNAME`, dan `DB_PASSWORD`. `DATABASE_URL` juga didukung.
4. Pasang dependensi dengan `npm install`, lalu jalankan `npm run dev`.
5. Buka alamat Vite yang ditampilkan di terminal. API berjalan pada port `3001` secara lokal.

Untuk seed demo lokal, akun berasal dari `Database/003_demo_seed.sql`. Seed tersebut menggunakan kata sandi bersama `Cuti123!`; pakai hanya pada database demo yang terisolasi, bukan untuk penggunaan produksi.

Lampiran disimpan pada `server/storage/`. Tanda tangan yang disimpan aplikasi merupakan tanda tangan internal dan tidak menggantikan tanda tangan elektronik tersertifikasi.
