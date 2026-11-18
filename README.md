# Web Pengajuan Cuti

MVP internal TU Digital dengan Vue 3, Vite, Express, dan PostgreSQL. Fitur yang tersedia: dashboard pegawai, pengajuan cuti dengan pratinjau hari kerja, riwayat dan detail pengajuan, antrean reviewer, tanda tangan internal reviewer, direktori pegawai dengan filter unit, kategori, dan status cuti, serta halaman Admin untuk melihat dan menyesuaikan kuota cuti tahunan pegawai.

## Menjalankan aplikasi

1. Pastikan database PostgreSQL sudah berisi schema `cuti` dan data referensi yang diperlukan. Skema dibuat dari `Database/001_schema.sql`.
2. Jika belum memiliki `.env`, salin `.env.example` menjadi `.env`. Jangan menimpa `.env` yang sudah ada.
3. Isi koneksi PostgreSQL. Server menerima `DB_CONNECTION=pgsql` beserta `DB_HOST`, `DB_PORT`, `DB_DATABASE`, `DB_USERNAME`, dan `DB_PASSWORD`. `DATABASE_URL` juga didukung.
4. Pasang dependensi dengan `npm install`, lalu jalankan `npm run dev`.
5. Buka alamat Vite yang ditampilkan di terminal. API berjalan pada port `3001` secara lokal.

Untuk seed demo lokal, akun berasal dari `Database/003_demo_seed.sql`. Seed tersebut menggunakan kata sandi bersama `Cuti123!`; pakai hanya pada database demo yang terisolasi, bukan untuk penggunaan produksi.

Lampiran disimpan pada `server/storage/`. Tanda tangan yang disimpan aplikasi merupakan tanda tangan internal dan tidak menggantikan tanda tangan elektronik tersertifikasi.
