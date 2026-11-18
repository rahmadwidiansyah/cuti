-- =====================================================================
-- Sistem Informasi Pengajuan dan Pengelolaan Cuti Pegawai
-- Seed demo lokal (OPSIONAL)
--
-- Berkas  : 003_demo_seed.sql
-- Versi   : 1.0
-- Tanggal : 16 November 2026
--
-- PERINGATAN:
-- 1. Jangan menjalankan berkas ini pada database produksi.
-- 2. Seluruh NIP/NIK, nama, dan unit adalah data fiktif.
-- 3. Password demo untuk semua akun: Cuti123!
--    Hash dibuat dengan pgcrypto/bcrypt hanya untuk kemudahan lokal.
--    Aplikasi produksi wajib memakai Argon2id atau bcrypt dengan kebijakan
--    password institusi.
-- =====================================================================

BEGIN;
SET search_path TO cuti, public;

-- ---------------------------------------------------------------------
-- Jabatan demo
-- ---------------------------------------------------------------------

INSERT INTO positions (code, name, position_type) VALUES
    ('ANALIS_SDM', 'Analis SDM Aparatur Ahli Madya', 'FUNCTIONAL'),
    ('KASUBAG_TU', 'Kepala Subbagian Tata Usaha',    'STRUCTURAL'),
    ('KEPSTA',     'Kepala Staf',                    'STRUCTURAL'),
    ('PPK',        'Pejabat Pembuat Komitmen',       'FUNCTIONAL'),
    ('STAF',       'Staf',                           'FUNCTIONAL'),
    ('PENGEMUDI',  'Pengemudi',                      'PROFESSIONAL')
ON CONFLICT (code) DO UPDATE
    SET name = excluded.name,
        position_type = excluded.position_type;

-- ---------------------------------------------------------------------
-- Akun demo
-- ---------------------------------------------------------------------

INSERT INTO users (username, email, password_hash, full_name)
SELECT v.username, v.email, crypt('Cuti123!', gen_salt('bf', 12)), v.full_name
FROM (
    VALUES
        ('admin',    'admin@example.local',    'Admin Cuti'),
        ('analis',   'analis@example.local',   'Analis SDM Demo'),
        ('kasubag',  'kasubag@example.local',  'Kasubag TU Demo'),
        ('kepsta',   'kepsta@example.local',   'Kepsta Demo'),
        ('ppk',      'ppk@example.local',      'PPK Demo'),
        ('pns_tu',   'pns.tu@example.local',   'Budi Santoso'),
        ('pns',      'pns@example.local',      'Siti Aminah'),
        ('pppk_tu',  'pppk.tu@example.local',  'Andi Pratama'),
        ('pppk',     'pppk@example.local',     'Rina Wulandari'),
        ('kontrak',  'kontrak@example.local',  'Joko Susilo')
) AS v(username, email, full_name)
WHERE NOT EXISTS (
    SELECT 1 FROM users u WHERE lower(u.username) = lower(v.username)
);

-- ---------------------------------------------------------------------
-- Role akun demo
-- ---------------------------------------------------------------------

INSERT INTO user_roles (user_id, role_id, organizational_unit_id, is_primary)
SELECT u.id, r.id, NULL, true
FROM users u
JOIN roles r ON r.code = 'ADMIN'
WHERE u.username = 'admin'
  AND NOT EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = u.id AND ur.role_id = r.id AND ur.revoked_at IS NULL
  );

INSERT INTO user_roles (user_id, role_id, organizational_unit_id, is_primary)
SELECT u.id, r.id, NULL, true
FROM users u
JOIN roles r ON r.code = 'HR_ANALYST'
WHERE u.username = 'analis'
  AND NOT EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = u.id AND ur.role_id = r.id AND ur.revoked_at IS NULL
  );

INSERT INTO user_roles (user_id, role_id, organizational_unit_id, is_primary)
SELECT u.id, r.id, ou.id, true
FROM users u
JOIN roles r ON r.code = 'KASUBAG'
CROSS JOIN organizational_units ou
WHERE u.username = 'kasubag'
  AND ou.code = 'TU'
  AND NOT EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = u.id AND ur.role_id = r.id AND ur.revoked_at IS NULL
  );

INSERT INTO user_roles (user_id, role_id, organizational_unit_id, is_primary)
SELECT u.id, r.id, NULL, true
FROM users u
JOIN roles r ON r.code = 'KEPSTA'
WHERE u.username = 'kepsta'
  AND NOT EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = u.id AND ur.role_id = r.id AND ur.revoked_at IS NULL
  );

INSERT INTO user_roles (user_id, role_id, organizational_unit_id, is_primary)
SELECT u.id, r.id, NULL, true
FROM users u
JOIN roles r ON r.code = 'PPK'
WHERE u.username = 'ppk'
  AND NOT EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = u.id AND ur.role_id = r.id AND ur.revoked_at IS NULL
  );

INSERT INTO user_roles (user_id, role_id, organizational_unit_id, is_primary)
SELECT u.id, r.id, ou.id, false
FROM (
    VALUES
        ('pns_tu',  'TU'),
        ('pns',     'NON_TU'),
        ('pppk_tu', 'TU'),
        ('pppk',    'NON_TU'),
        ('kontrak', 'UMUM')
) AS v(username, unit_code)
JOIN users u ON u.username = v.username
JOIN roles r ON r.code = 'EMPLOYEE'
JOIN organizational_units ou ON ou.code = v.unit_code
WHERE NOT EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = u.id AND ur.role_id = r.id AND ur.revoked_at IS NULL
);

-- ---------------------------------------------------------------------
-- Pegawai demo
-- ---------------------------------------------------------------------

INSERT INTO employees (
    user_id, nip, nik, full_name, employment_category, profession,
    organizational_unit_id, position_id, join_date, employment_status,
    email, phone, address
)
SELECT
    u.id,
    v.nip,
    v.nik,
    v.full_name,
    v.employment_category,
    v.profession,
    ou.id,
    p.id,
    v.join_date,
    'ACTIVE',
    u.email,
    v.phone,
    v.address
FROM (
    VALUES
        ('pns_tu',  '198501012010011001', NULL::varchar, 'Budi Santoso',   'PNS_TU',        NULL::varchar,
         'TU',     'STAF',       DATE '2010-01-01', '081200000001', 'Jl. Contoh No. 1, Jakarta'),
        ('pns',     '198702022011012002', NULL::varchar, 'Siti Aminah',    'PNS',           NULL::varchar,
         'NON_TU', 'STAF',       DATE '2011-01-01', '081200000002', 'Jl. Contoh No. 2, Jakarta'),
        ('pppk_tu', '199003032020121003', NULL::varchar, 'Andi Pratama',   'PPPK_PPNPN_TU', NULL::varchar,
         'TU',     'STAF',       DATE '2020-01-01', '081200000003', 'Jl. Contoh No. 3, Jakarta'),
        ('pppk',    '199204042021122004', NULL::varchar, 'Rina Wulandari', 'PPPK_PPNPN',    NULL::varchar,
         'NON_TU', 'STAF',       DATE '2021-01-01', '081200000004', 'Jl. Contoh No. 4, Jakarta'),
        ('kontrak', NULL::varchar,        '3273010101900001', 'Joko Susilo', 'KONTRAK', 'PENGEMUDI',
         'UMUM',   'PENGEMUDI',  DATE '2022-01-01', '081200000005', 'Jl. Contoh No. 5, Jakarta')
) AS v(username, nip, nik, full_name, employment_category, profession, unit_code, position_code, join_date, phone, address)
JOIN users u ON u.username = v.username
JOIN organizational_units ou ON ou.code = v.unit_code
JOIN positions p ON p.code = v.position_code
WHERE NOT EXISTS (
    SELECT 1 FROM employees e WHERE e.user_id = u.id AND e.deleted_at IS NULL
);

-- ---------------------------------------------------------------------
-- Histori penempatan awal
-- ---------------------------------------------------------------------

INSERT INTO employee_assignments (
    employee_id, organizational_unit_id, position_id, profession,
    effective_from, effective_to, decision_number, notes, created_by
)
SELECT
    e.id,
    e.organizational_unit_id,
    e.position_id,
    e.profession,
    e.join_date,
    NULL,
    'DEMO-ASSIGNMENT',
    'Penempatan awal data demo.',
    (SELECT id FROM users WHERE username = 'admin')
FROM employees e
WHERE e.deleted_at IS NULL
  AND NOT EXISTS (
      SELECT 1 FROM employee_assignments a
      WHERE a.employee_id = e.id AND a.effective_to IS NULL
  );

-- ---------------------------------------------------------------------
-- Alokasi saldo cuti tahunan 2026
-- ---------------------------------------------------------------------

SELECT fn_allocate_leave_balance(
    e.id,
    lt.id,
    DATE_PART('year', DATE '2026-01-01')::smallint,
    12,
    (SELECT id FROM users WHERE username = 'admin'),
    'Alokasi awal demo tahun 2026'
)
FROM employees e
CROSS JOIN leave_types lt
WHERE e.deleted_at IS NULL
  AND lt.code = 'ANNUAL';

COMMIT;
