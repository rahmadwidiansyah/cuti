# Database Modul Pengajuan dan Pengelolaan Cuti

Skema PostgreSQL 15+ untuk modul cuti. Semua objek berada pada schema `cuti`.

## Berkas

| Berkas | Isi |
|---|---|
| `001_schema.sql` | Tabel, constraint, index, view, fungsi, dan trigger. |
| `002_seed.sql` | Data referensi: role, izin, jenis cuti, kebijakan, rute, transisi status, unit contoh, kalender contoh, setting, template notifikasi. |
| `003_demo_seed.sql` | Data demo lokal: 10 akun, 5 pegawai (satu per kategori), penempatan, dan saldo 12 hari. **Jangan dijalankan di produksi.** |
| `tools/generate_data_dictionary.py` | Menghasilkan `../../Docs/Database_Data_Dictionary.md` dari database yang sudah dimigrasikan. |

## Menjalankan

```bash
createdb cuti
psql -d cuti -v ON_ERROR_STOP=1 -f 001_schema.sql
psql -d cuti -v ON_ERROR_STOP=1 -f 002_seed.sql
psql -d cuti -v ON_ERROR_STOP=1 -f 003_demo_seed.sql   # opsional
```

Dengan Docker:

```bash
docker run --name cuti-db \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=cuti \
  -p 5432:5432 \
  -d postgres:15-alpine

docker exec -i cuti-db psql -U postgres -d cuti -v ON_ERROR_STOP=1 -f - < 001_schema.sql
docker exec -i cuti-db psql -U postgres -d cuti -v ON_ERROR_STOP=1 -f - < 002_seed.sql
docker exec -i cuti-db psql -U postgres -d cuti -v ON_ERROR_STOP=1 -f - < 003_demo_seed.sql
```

## Akun demo

Semua akun memakai password `Cuti123!`.

| Username | Role | Pegawai |
|---|---|---|
| `admin` | Admin | - |
| `analis` | Analis SDM | - |
| `kasubag` | Kasubag | - |
| `kepsta` | Kepsta | - |
| `ppk` | PPK | - |
| `pns_tu` | Pegawai | Budi Santoso (PNS TU) |
| `pns` | Pegawai | Siti Aminah (PNS) |
| `pppk_tu` | Pegawai | Andi Pratama (PPPK/PPNPN TU) |
| `pppk` | Pegawai | Rina Wulandari (PPPK/PPNPN) |
| `kontrak` | Pegawai | Joko Susilo (Kontrak, Pengemudi) |

Hash password demo memakai `pgcrypto` hanya untuk lokal. Produksi wajib memakai Argon2id/bcrypt dan kebijakan password institusi.

## Catatan implementasi

- `leave_balances` hanya dibuat untuk Cuti Tahunan. Jenis non-tahunan dihitung dari pengajuan `APPROVED`.
- Saldo tidak boleh diubah langsung. Insert ke `leave_balance_transactions`; trigger `fn_apply_balance_transaction()` yang menerapkan delta.
- Gunakan `fn_allocate_leave_balance()` untuk alokasi awal agar idempoten.
- Gunakan `fn_next_document_number()` untuk nomor pengajuan/surat agar aman terhadap pembuatan bersamaan.
- Pengajuan, approval, ledger, event, tanda tangan dokumen, dan audit bersifat append-only.
- Perubahan kalender tidak mengubah snapshot pengajuan lama.
- Integrasi absensi tidak ada pada rilis ini. `used_days_source` hanya `WORKING_DAYS_CALCULATION` atau `ADMIN_CONFIRMED`.
- SLA dan jam kerja pada seed adalah nilai awal, bukan kebijakan final.

## Regenerasi data dictionary

```bash
CUTI_DSN=postgresql://postgres:postgres@localhost:55432/cuti_test \
  python3 tools/generate_data_dictionary.py
```

## Validasi singkat

```sql
SET search_path TO cuti, public;

SELECT count(*) FROM information_schema.tables
WHERE table_schema = 'cuti' AND table_type = 'BASE TABLE';

SELECT * FROM v_employee_directory ORDER BY employee_id;
SELECT * FROM v_leave_balance_summary ORDER BY employee_id;
```

Uji constraint yang sudah dilakukan:

- pengajuan tahunan tumpang tindih ditolak exclusion constraint;
- transisi status liar ditolak trigger;
- draft yang dibatalkan boleh memiliki `submitted_at` kosong, tetapi pengajuan `SUBMITTED` wajib memiliki timestamp;
- `UPDATE audit_logs` dan ledger ditolak trigger append-only;
- reservasi, konsumsi, dan restorasi mengubah saldo sesuai ledger;
- pembatalan dengan pengembalian melebihi batas ditolak constraint.
