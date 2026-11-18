-- =====================================================================
-- Sistem Informasi Pengajuan dan Pengelolaan Cuti Pegawai
-- Seed data referensi
--
-- Berkas  : 002_seed.sql
-- Versi   : 1.0
-- Tanggal : 16 November 2026
--
-- Berkas ini hanya memuat data referensi: role, izin, jenis cuti,
-- kebijakan, rute, transisi status, contoh unit, kalender contoh,
-- pengaturan sistem, dan template notifikasi.
-- Data pegawai demo ada di 003_demo_seed.sql.
-- =====================================================================

BEGIN;
SET search_path TO cuti, public;

-- ---------------------------------------------------------------------
-- Role
-- ---------------------------------------------------------------------

INSERT INTO roles (code, name, description) VALUES
    ('EMPLOYEE',    'Pegawai/PIC', 'Pemohon cuti dan pemilik data pribadi.'),
    ('ADMIN',       'Admin',       'Pemeriksa administrasi, pengelola master dan kalender.'),
    ('HR_ANALYST',  'Analis SDM',  'Pemberi pertimbangan SDM.'),
    ('KASUBAG',     'Kasubag',     'Penerus rute PNS TU dan pemutus rute PPPK/PPNPN TU.'),
    ('KEPSTA',      'Kepsta',      'Pemutus rute PNS TU dan non-TU.'),
    ('PPK',         'PPK',         'Pemutus rute Kontrak.')
ON CONFLICT (code) DO UPDATE
    SET name = excluded.name,
        description = excluded.description;

-- ---------------------------------------------------------------------
-- Izin
-- ---------------------------------------------------------------------

INSERT INTO permissions (code, module, name, description) VALUES
    ('request.create.self',        'pengajuan', 'Buat pengajuan sendiri',            'Membuat draft/pengajuan untuk akun sendiri.'),
    ('request.read.own',           'pengajuan', 'Lihat pengajuan sendiri',           'Melihat histori dan detail pengajuan sendiri.'),
    ('request.read.all',           'pengajuan', 'Lihat seluruh pengajuan',           'Melihat seluruh pengajuan sesuai tugas.'),
    ('request.read.scope',         'pengajuan', 'Lihat pengajuan dalam cakupan',     'Melihat pengajuan pada unit/rute yang menjadi kewenangan.'),
    ('request.submit',             'pengajuan', 'Kirim pengajuan',                   'Mengirim atau mengirim ulang pengajuan.'),
    ('request.verify',             'pengajuan', 'Verifikasi administrasi',           'Menyelesaikan pemeriksaan Admin.'),
    ('request.pertimbangan',       'pengajuan', 'Beri pertimbangan SDM',             'Menyimpan pertimbangan Analis SDM.'),
    ('request.forward',            'pengajuan', 'Teruskan ke tahap berikut',         'Meneruskan pengajuan pada rute yang sesuai.'),
    ('request.decide.kasubag',     'pengajuan', 'Putuskan rute PPPK/PPNPN TU',       'Keputusan akhir Kasubag.'),
    ('request.decide.kepsta',      'pengajuan', 'Putuskan rute PNS TU/non-TU',       'Keputusan akhir Kepsta.'),
    ('request.decide.ppk',         'pengajuan', 'Putuskan rute Kontrak',             'Keputusan akhir PPK.'),
    ('request.return',             'pengajuan', 'Kembalikan untuk perbaikan',        'Mengembalikan pengajuan dengan alasan.'),
    ('request.withdraw.own',       'pengajuan', 'Batalkan pengajuan sendiri',        'Pembatalan sebelum verifikasi Admin.'),
    ('request.cancel.admin',       'pengajuan', 'Batalkan cuti sebagai Admin',       'Pembatalan setelah verifikasi atau setelah disetujui.'),
    ('balance.read.own',           'saldo',     'Lihat saldo sendiri',               'Melihat saldo dan ledger sendiri.'),
    ('balance.read.all',           'saldo',     'Lihat seluruh saldo',               'Melihat saldo seluruh pegawai.'),
    ('balance.read.scope',         'saldo',     'Lihat saldo dalam cakupan',         'Melihat saldo pegawai pada cakupan role.'),
    ('balance.adjust',             'saldo',     'Sesuaikan saldo',                   'Membuat transaksi ADJUSTMENT dengan alasan.'),
    ('employee.manage',            'pegawai',   'Kelola master pegawai',             'CRUD master pegawai dan penempatan.'),
    ('employee.read.all',          'pegawai',   'Lihat seluruh pegawai',             'Melihat direktori seluruh pegawai.'),
    ('employee.read.tu',           'pegawai',   'Lihat pegawai lingkup TU',          'Melihat direktori pegawai lingkup TU.'),
    ('employee.read.kontrak',      'pegawai',   'Lihat pegawai rute Kontrak',        'Melihat direktori pegawai rute Kontrak.'),
    ('calendar.manage',            'kalender',  'Kelola kalender kerja',             'Menambah, mengubah, dan menonaktifkan tanggal khusus.'),
    ('report.read',                'laporan',   'Lihat laporan',                     'Melihat dan mengekspor laporan sesuai izin.'),
    ('audit.read',                 'audit',     'Lihat audit log',                   'Melihat audit log tanpa kemampuan mengubah.'),
    ('signature.manage.own',       'tanda_tangan', 'Kelola tanda tangan profil',     'Mengunggah atau menggambar tanda tangan sendiri.'),
    ('document.read.own',          'dokumen',   'Lihat dokumen sendiri',             'Melihat dan mengunduh dokumen milik sendiri.'),
    ('document.read.scope',        'dokumen',   'Lihat dokumen dalam cakupan',       'Melihat dokumen pengajuan yang ditangani.'),
    ('document.verify',            'dokumen',   'Verifikasi lampiran',               'Menandai lampiran valid atau perlu diperiksa.'),
    ('notification.read.own',      'notifikasi','Lihat notifikasi sendiri',          'Membaca dan menandai notifikasi.'),
    ('delegation.manage',          'delegasi',  'Kelola delegasi pejabat',           'Menetapkan pejabat pengganti berdasarkan periode.')
ON CONFLICT (code) DO UPDATE
    SET module = excluded.module,
        name = excluded.name,
        description = excluded.description;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN (
    'request.create.self', 'request.read.own', 'request.submit',
    'request.withdraw.own', 'balance.read.own', 'signature.manage.own',
    'document.read.own', 'notification.read.own'
)
WHERE r.code = 'EMPLOYEE'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN (
    'request.read.all', 'request.verify', 'request.return', 'request.cancel.admin',
    'balance.read.all', 'balance.adjust', 'employee.manage', 'calendar.manage',
    'report.read', 'audit.read', 'document.read.scope', 'document.verify',
    'notification.read.own', 'delegation.manage'
)
WHERE r.code = 'ADMIN'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN (
    'request.read.scope', 'request.pertimbangan', 'request.return',
    'balance.read.all', 'employee.read.all', 'report.read',
    'signature.manage.own', 'document.read.scope', 'notification.read.own'
)
WHERE r.code = 'HR_ANALYST'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN (
    'request.read.scope', 'request.forward', 'request.decide.kasubag',
    'request.return', 'balance.read.scope', 'employee.read.tu', 'report.read',
    'signature.manage.own', 'document.read.scope', 'notification.read.own'
)
WHERE r.code = 'KASUBAG'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN (
    'request.read.scope', 'request.decide.kepsta', 'request.return',
    'balance.read.scope', 'employee.read.all', 'report.read',
    'signature.manage.own', 'document.read.scope', 'notification.read.own'
)
WHERE r.code = 'KEPSTA'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN (
    'request.read.scope', 'request.decide.ppk', 'request.return',
    'balance.read.scope', 'employee.read.kontrak', 'report.read',
    'signature.manage.own', 'document.read.scope', 'notification.read.own'
)
WHERE r.code = 'PPK'
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------
-- Jenis cuti
-- ---------------------------------------------------------------------

INSERT INTO leave_types (
    code, name, description, deducts_annual_balance,
    default_requires_attachment, is_active, sort_order
) VALUES
    ('ANNUAL',           'Cuti Tahunan',                    'Cuti tahunan yang memotong saldo.', true,  false, true, 1),
    ('LONG',             'Cuti Besar',                      'Cuti besar untuk PNS.',             false, false, true, 2),
    ('SICK',             'Cuti Sakit',                      'Cuti sakit dengan surat keterangan.', false, true, true, 3),
    ('MATERNITY',        'Cuti Melahirkan',                 'Cuti melahirkan dengan dokumen pendukung.', false, true, true, 4),
    ('IMPORTANT_REASON', 'Cuti Alasan Penting',             'Cuti karena alasan penting.',       false, false, true, 5),
    ('UNPAID',           'Cuti di Luar Tanggungan Negara',  'Cuti di luar tanggungan negara.',   false, false, true, 6)
ON CONFLICT (code) DO UPDATE
    SET name = excluded.name,
        description = excluded.description,
        deducts_annual_balance = excluded.deducts_annual_balance,
        default_requires_attachment = excluded.default_requires_attachment,
        is_active = excluded.is_active,
        sort_order = excluded.sort_order;

-- Matriks kelayakan sesuai PRD bagian 7:
-- PNS TU/PNS: enam jenis; PPPK/PPNPN TU, PPPK/PPNPN, Kontrak: tiga jenis.
INSERT INTO leave_policies (
    leave_type_id, employee_category, is_allowed, annual_quota,
    min_days, max_days, requires_attachment, attachment_min_count,
    allowed_document_types, advance_notice_days, policy_config,
    effective_from, effective_to
)
SELECT
    lt.id,
    v.employee_category,
    v.is_allowed,
    v.annual_quota,
    1,
    NULL,
    v.requires_attachment,
    v.attachment_min_count,
    v.allowed_document_types,
    0,
    v.policy_config,
    DATE '2026-01-01',
    NULL
FROM (
    VALUES
        ('ANNUAL',           'PNS_TU',        true,  12,   false, 0, NULL::text[],                                    '{"deducts_annual_balance":true}'::jsonb),
        ('ANNUAL',           'PNS',           true,  12,   false, 0, NULL::text[],                                    '{"deducts_annual_balance":true}'::jsonb),
        ('ANNUAL',           'PPPK_PPNPN_TU', true,  12,   false, 0, NULL::text[],                                    '{"deducts_annual_balance":true}'::jsonb),
        ('ANNUAL',           'PPPK_PPNPN',    true,  12,   false, 0, NULL::text[],                                    '{"deducts_annual_balance":true}'::jsonb),
        ('ANNUAL',           'KONTRAK',       true,  12,   false, 0, NULL::text[],                                    '{"deducts_annual_balance":true}'::jsonb),
        ('LONG',             'PNS_TU',        true,  NULL, false, 0, NULL::text[],                                    '{}'::jsonb),
        ('LONG',             'PNS',           true,  NULL, false, 0, NULL::text[],                                    '{}'::jsonb),
        ('LONG',             'PPPK_PPNPN_TU', false, NULL, false, 0, NULL::text[],                                    '{}'::jsonb),
        ('LONG',             'PPPK_PPNPN',    false, NULL, false, 0, NULL::text[],                                    '{}'::jsonb),
        ('LONG',             'KONTRAK',       false, NULL, false, 0, NULL::text[],                                    '{}'::jsonb),
        ('SICK',             'PNS_TU',        true,  NULL, true,  1, ARRAY['SURAT_DOKTER','SURAT_KETERANGAN']::text[], '{"attachment_required_from_submit":true}'::jsonb),
        ('SICK',             'PNS',           true,  NULL, true,  1, ARRAY['SURAT_DOKTER','SURAT_KETERANGAN']::text[], '{"attachment_required_from_submit":true}'::jsonb),
        ('SICK',             'PPPK_PPNPN_TU', true,  NULL, true,  1, ARRAY['SURAT_DOKTER','SURAT_KETERANGAN']::text[], '{"attachment_required_from_submit":true}'::jsonb),
        ('SICK',             'PPPK_PPNPN',    true,  NULL, true,  1, ARRAY['SURAT_DOKTER','SURAT_KETERANGAN']::text[], '{"attachment_required_from_submit":true}'::jsonb),
        ('SICK',             'KONTRAK',       true,  NULL, true,  1, ARRAY['SURAT_DOKTER','SURAT_KETERANGAN']::text[], '{"attachment_required_from_submit":true}'::jsonb),
        ('MATERNITY',        'PNS_TU',        true,  NULL, true,  1, ARRAY['SURAT_DOKTER','SURAT_KETERANGAN']::text[], '{"attachment_required_from_submit":true}'::jsonb),
        ('MATERNITY',        'PNS',           true,  NULL, true,  1, ARRAY['SURAT_DOKTER','SURAT_KETERANGAN']::text[], '{"attachment_required_from_submit":true}'::jsonb),
        ('MATERNITY',        'PPPK_PPNPN_TU', true,  NULL, true,  1, ARRAY['SURAT_DOKTER','SURAT_KETERANGAN']::text[], '{"attachment_required_from_submit":true}'::jsonb),
        ('MATERNITY',        'PPPK_PPNPN',    true,  NULL, true,  1, ARRAY['SURAT_DOKTER','SURAT_KETERANGAN']::text[], '{"attachment_required_from_submit":true}'::jsonb),
        ('MATERNITY',        'KONTRAK',       true,  NULL, true,  1, ARRAY['SURAT_DOKTER','SURAT_KETERANGAN']::text[], '{"attachment_required_from_submit":true}'::jsonb),
        ('IMPORTANT_REASON', 'PNS_TU',        true,  NULL, false, 0, NULL::text[],                                    '{}'::jsonb),
        ('IMPORTANT_REASON', 'PNS',           true,  NULL, false, 0, NULL::text[],                                    '{}'::jsonb),
        ('IMPORTANT_REASON', 'PPPK_PPNPN_TU', false, NULL, false, 0, NULL::text[],                                    '{}'::jsonb),
        ('IMPORTANT_REASON', 'PPPK_PPNPN',    false, NULL, false, 0, NULL::text[],                                    '{}'::jsonb),
        ('IMPORTANT_REASON', 'KONTRAK',       false, NULL, false, 0, NULL::text[],                                    '{}'::jsonb),
        ('UNPAID',           'PNS_TU',        true,  NULL, false, 0, NULL::text[],                                    '{}'::jsonb),
        ('UNPAID',           'PNS',           true,  NULL, false, 0, NULL::text[],                                    '{}'::jsonb),
        ('UNPAID',           'PPPK_PPNPN_TU', false, NULL, false, 0, NULL::text[],                                    '{}'::jsonb),
        ('UNPAID',           'PPPK_PPNPN',    false, NULL, false, 0, NULL::text[],                                    '{}'::jsonb),
        ('UNPAID',           'KONTRAK',       false, NULL, false, 0, NULL::text[],                                    '{}'::jsonb)
) AS v(type_code, employee_category, is_allowed, annual_quota, requires_attachment, attachment_min_count, allowed_document_types, policy_config)
JOIN leave_types lt ON lt.code = v.type_code
ON CONFLICT (leave_type_id, employee_category, effective_from) DO UPDATE
    SET is_allowed = excluded.is_allowed,
        annual_quota = excluded.annual_quota,
        requires_attachment = excluded.requires_attachment,
        attachment_min_count = excluded.attachment_min_count,
        allowed_document_types = excluded.allowed_document_types,
        policy_config = excluded.policy_config;

-- ---------------------------------------------------------------------
-- Rute persetujuan
-- ---------------------------------------------------------------------

INSERT INTO approval_routes (code, name, description) VALUES
    ('PNS_TU',  'Rute PNS TU',              'Admin > Analis SDM > Kasubag > Kepsta.'),
    ('PPPK_TU', 'Rute PPPK/PPNPN TU',       'Admin > Analis SDM > Kasubag.'),
    ('NON_TU',  'Rute Non-TU',              'Admin > Analis SDM > Kepsta.'),
    ('KONTRAK', 'Rute Kontrak',             'Admin > Analis SDM > PPK.')
ON CONFLICT (code) DO UPDATE
    SET name = excluded.name,
        description = excluded.description;

INSERT INTO approval_route_categories (employee_category, route_id)
SELECT v.employee_category, r.id
FROM (
    VALUES
        ('PNS_TU',        'PNS_TU'),
        ('PNS',           'NON_TU'),
        ('PPPK_PPNPN_TU', 'PPPK_TU'),
        ('PPPK_PPNPN',    'NON_TU'),
        ('KONTRAK',       'KONTRAK')
) AS v(employee_category, route_code)
JOIN approval_routes r ON r.code = v.route_code
ON CONFLICT (employee_category) DO UPDATE
    SET route_id = excluded.route_id;

-- SLA di bawah adalah nilai awal yang harus disahkan pemilik proses.
INSERT INTO approval_route_steps (
    route_id, step_no, stage_code, role_code, unit_scope,
    decision_mode, is_final, sla_hours
)
SELECT r.id, v.step_no, v.stage_code, v.role_code, v.unit_scope,
       v.decision_mode, v.is_final, v.sla_hours
FROM (
    VALUES
        ('PNS_TU',  1, 'ADMIN_REVIEW',        'ADMIN',      'ALL',         'FORWARD', false, 8),
        ('PNS_TU',  2, 'PERTIMBANGAN_REVIEW', 'HR_ANALYST', 'ALL',         'FORWARD', false, 16),
        ('PNS_TU',  3, 'KASUBAG_REVIEW',      'KASUBAG',    'TU',          'FORWARD', false, 16),
        ('PNS_TU',  4, 'KEPSTA_REVIEW',       'KEPSTA',     'NON_KONTRAK', 'FINAL',   true,  24),
        ('PPPK_TU', 1, 'ADMIN_REVIEW',        'ADMIN',      'ALL',         'FORWARD', false, 8),
        ('PPPK_TU', 2, 'PERTIMBANGAN_REVIEW', 'HR_ANALYST', 'ALL',         'FORWARD', false, 16),
        ('PPPK_TU', 3, 'KASUBAG_REVIEW',      'KASUBAG',    'TU',          'FINAL',   true,  16),
        ('NON_TU',  1, 'ADMIN_REVIEW',        'ADMIN',      'ALL',         'FORWARD', false, 8),
        ('NON_TU',  2, 'PERTIMBANGAN_REVIEW', 'HR_ANALYST', 'ALL',         'FORWARD', false, 16),
        ('NON_TU',  3, 'KEPSTA_REVIEW',       'KEPSTA',     'NON_KONTRAK', 'FINAL',   true,  24),
        ('KONTRAK', 1, 'ADMIN_REVIEW',        'ADMIN',      'ALL',         'FORWARD', false, 8),
        ('KONTRAK', 2, 'PERTIMBANGAN_REVIEW', 'HR_ANALYST', 'ALL',         'FORWARD', false, 16),
        ('KONTRAK', 3, 'PPK_REVIEW',          'PPK',        'KONTRAK',     'FINAL',   true,  24)
) AS v(route_code, step_no, stage_code, role_code, unit_scope, decision_mode, is_final, sla_hours)
JOIN approval_routes r ON r.code = v.route_code
ON CONFLICT (route_id, step_no) DO UPDATE
    SET stage_code = excluded.stage_code,
        role_code = excluded.role_code,
        unit_scope = excluded.unit_scope,
        decision_mode = excluded.decision_mode,
        is_final = excluded.is_final,
        sla_hours = excluded.sla_hours;

-- ---------------------------------------------------------------------
-- Transisi status
-- ---------------------------------------------------------------------

INSERT INTO leave_status_transitions (from_status, to_status, actor_role_code, description) VALUES
    ('DRAFT',                  'SUBMITTED',              'EMPLOYEE',    'Draft dikirim.'),
    ('DRAFT',                  'CANCELLED',              'EMPLOYEE',    'Draft dibatalkan.'),
    ('SUBMITTED',              'ADMIN_REVIEW',           'ADMIN',       'Masuk antrean Admin.'),
    ('SUBMITTED',              'WITHDRAWN',              'EMPLOYEE',    'Ditarik sebelum verifikasi Admin.'),
    ('ADMIN_REVIEW',           'ADMIN_VERIFIED',         'ADMIN',       'Pemeriksaan administrasi selesai.'),
    ('ADMIN_REVIEW',           'RETURNED_FOR_REVISION',  'ADMIN',       'Dikembalikan oleh Admin.'),
    ('ADMIN_REVIEW',           'WITHDRAWN',              'EMPLOYEE',    'Ditarik sebelum verifikasi Admin.'),
    ('ADMIN_VERIFIED',         'PERTIMBANGAN_REVIEW',    'ADMIN',       'Diteruskan ke Analis SDM.'),
    ('ADMIN_VERIFIED',         'CANCELLED',              'ADMIN',       'Dibatalkan setelah verifikasi.'),
    ('PERTIMBANGAN_REVIEW',    'KASUBAG_REVIEW',         'HR_ANALYST',  'Diteruskan ke Kasubag.'),
    ('PERTIMBANGAN_REVIEW',    'KEPSTA_REVIEW',          'HR_ANALYST',  'Diteruskan ke Kepsta.'),
    ('PERTIMBANGAN_REVIEW',    'PPK_REVIEW',             'HR_ANALYST',  'Diteruskan ke PPK.'),
    ('PERTIMBANGAN_REVIEW',    'RETURNED_FOR_REVISION',  'HR_ANALYST',  'Dikembalikan oleh Analis SDM.'),
    ('PERTIMBANGAN_REVIEW',    'CANCELLED',              'ADMIN',       'Dibatalkan saat pertimbangan.'),
    ('KASUBAG_REVIEW',         'KEPSTA_REVIEW',          'KASUBAG',     'PNS TU diteruskan ke Kepsta.'),
    ('KASUBAG_REVIEW',         'APPROVED',               'KASUBAG',     'PPPK/PPNPN TU disetujui.'),
    ('KASUBAG_REVIEW',         'REJECTED',               'KASUBAG',     'PPPK/PPNPN TU tidak disetujui.'),
    ('KASUBAG_REVIEW',         'RETURNED_FOR_REVISION',  'KASUBAG',     'Dikembalikan oleh Kasubag.'),
    ('KASUBAG_REVIEW',         'CANCELLED',              'ADMIN',       'Dibatalkan saat tinjauan Kasubag.'),
    ('KEPSTA_REVIEW',          'APPROVED',               'KEPSTA',      'Disetujui Kepsta.'),
    ('KEPSTA_REVIEW',          'REJECTED',               'KEPSTA',      'Tidak disetujui Kepsta.'),
    ('KEPSTA_REVIEW',          'RETURNED_FOR_REVISION',  'KEPSTA',      'Dikembalikan oleh Kepsta.'),
    ('KEPSTA_REVIEW',          'CANCELLED',              'ADMIN',       'Dibatalkan saat keputusan Kepsta.'),
    ('PPK_REVIEW',             'APPROVED',               'PPK',         'Disetujui PPK.'),
    ('PPK_REVIEW',             'REJECTED',               'PPK',         'Tidak disetujui PPK.'),
    ('PPK_REVIEW',             'RETURNED_FOR_REVISION',  'PPK',         'Dikembalikan oleh PPK.'),
    ('PPK_REVIEW',             'CANCELLED',              'ADMIN',       'Dibatalkan saat keputusan PPK.'),
    ('RETURNED_FOR_REVISION',  'SUBMITTED',              'EMPLOYEE',    'Diperbaiki dan dikirim ulang.'),
    ('RETURNED_FOR_REVISION',  'WITHDRAWN',              'EMPLOYEE',    'Ditarik sebelum verifikasi Admin.'),
    ('RETURNED_FOR_REVISION',  'CANCELLED',              'ADMIN',       'Dibatalkan setelah verifikasi.'),
    ('APPROVED',               'CANCELLED',              'ADMIN',       'Cuti disetujui dibatalkan Admin.')
ON CONFLICT (from_status, to_status) DO UPDATE
    SET actor_role_code = excluded.actor_role_code,
        description = excluded.description;

-- ---------------------------------------------------------------------
-- Unit contoh (ganti dengan struktur institusi sebenarnya)
-- ---------------------------------------------------------------------

INSERT INTO organizational_units (code, name, parent_id, unit_type, level, effective_from) VALUES
    ('INSTITUSI', 'Institusi', NULL, 'ROOT', 1, DATE '2026-01-01')
ON CONFLICT (code) DO UPDATE
    SET name = excluded.name,
        unit_type = excluded.unit_type,
        level = excluded.level;

INSERT INTO organizational_units (code, name, parent_id, unit_type, level, effective_from)
SELECT v.code, v.name, u.id, v.unit_type, 2, DATE '2026-01-01'
FROM (
    VALUES
        ('TU',     'Tata Usaha',    'TU'),
        ('NON_TU', 'Bidang Non-TU', 'NON_TU'),
        ('UMUM',   'Umum',          'UMUM')
) AS v(code, name, unit_type)
CROSS JOIN organizational_units u
WHERE u.code = 'INSTITUSI'
ON CONFLICT (code) DO UPDATE
    SET name = excluded.name,
        parent_id = excluded.parent_id,
        unit_type = excluded.unit_type,
        level = excluded.level;

-- ---------------------------------------------------------------------
-- Kalender contoh
-- ---------------------------------------------------------------------

INSERT INTO work_calendar_versions (
    code, name, effective_from, effective_to, status, published_at
) VALUES
    ('2026.11', 'Kalender Kerja 2026', DATE '2026-01-01', DATE '2026-12-31', 'ACTIVE', now()),
    ('2027.01', 'Kalender Kerja 2027', DATE '2027-01-01', DATE '2027-12-31', 'DRAFT', NULL)
ON CONFLICT (code) DO UPDATE
    SET name = excluded.name,
        effective_from = excluded.effective_from,
        effective_to = excluded.effective_to,
        status = excluded.status;

INSERT INTO work_calendar_dates (
    calendar_version_id, calendar_date, date_type, title, description,
    scope_type, organizational_unit_id, is_active, created_by
)
SELECT v.calendar_version_id, v.calendar_date, v.date_type, v.title, v.description,
       'ALL', NULL, v.is_active, NULL
FROM (
    VALUES
        ((SELECT id FROM work_calendar_versions WHERE code = '2026.11'),
         DATE '2026-11-18', 'LEAVE_BLACKOUT', 'Persiapan kegiatan institusi',
         'Tanggal larangan contoh sesuai mockup.', true),
        ((SELECT id FROM work_calendar_versions WHERE code = '2026.11'),
         DATE '2026-11-25', 'INSTITUTIONAL_HOLIDAY', 'Hari libur institusi',
         'Hari libur institusi contoh.', true),
        ((SELECT id FROM work_calendar_versions WHERE code = '2026.11'),
         DATE '2026-12-25', 'NATIONAL_HOLIDAY', 'Hari Raya Natal',
         'Contoh hari libur nasional.', true),
        ((SELECT id FROM work_calendar_versions WHERE code = '2026.11'),
         DATE '2026-12-29', 'LEAVE_BLACKOUT', 'Penutupan layanan akhir tahun',
         'Contoh larangan nonaktif.', false),
        ((SELECT id FROM work_calendar_versions WHERE code = '2027.01'),
         DATE '2027-01-01', 'NATIONAL_HOLIDAY', 'Tahun Baru',
         'Contoh hari libur nasional.', true)
) AS v(calendar_version_id, calendar_date, date_type, title, description, is_active)
WHERE NOT EXISTS (
    SELECT 1
    FROM work_calendar_dates d
    WHERE d.calendar_version_id = v.calendar_version_id
      AND d.calendar_date = v.calendar_date
      AND d.date_type = v.date_type
      AND d.organizational_unit_id IS NULL
      AND d.is_active = v.is_active
);

-- ---------------------------------------------------------------------
-- Pengaturan sistem
-- ---------------------------------------------------------------------

INSERT INTO system_settings (key, value, description) VALUES
    ('app.timezone',                             '"Asia/Jakarta"'::jsonb,                         'Zona waktu tampilan dan perhitungan SLA.'),
    ('document.request_number_pattern',          '"CUTI-{YYYY}-{SEQ}"'::jsonb,                    'Pola nomor pengajuan.'),
    ('document.letter_number_pattern',           '"{SEQ}/{UNIT}/{YYYY}"'::jsonb,                  'Pola nomor surat per unit dan tahun.'),
    ('leave.max_request_days',                   '30'::jsonb,                                     'Batas maksimum hari per pengajuan.'),
    ('leave.max_carry_over_days',                'null'::jsonb,                                   'Belum disahkan; null berarti menunggu kebijakan.'),
    ('leave.carry_over_expiry_month',            'null'::jsonb,                                   'Belum disahkan.'),
    ('leave.cancellation.used_days_source',      '"WORKING_DAYS_CALCULATION"'::jsonb,             'Sumber hari digunakan saat pembatalan.'),
    ('attachment.max_file_size_mb',              '10'::jsonb,                                     'Batas ukuran per file.'),
    ('attachment.max_files_per_request',         '5'::jsonb,                                      'Batas jumlah lampiran per pengajuan.'),
    ('sla.calculation',                          '"WORKING_HOURS"'::jsonb,                        'SLA dihitung dalam jam kerja.'),
    ('sla.workday_start',                        '"08:00"'::jsonb,                                'Awal jam kerja; nilai awal perlu disahkan.'),
    ('sla.workday_end',                          '"16:00"'::jsonb,                                'Akhir jam kerja; nilai awal perlu disahkan.'),
    ('sla.default_hours',                        '24'::jsonb,                                     'Cadangan bila langkah rute tidak memiliki SLA.'),
    ('verification.qr_base_url',                 '"https://cuti.internal/verifikasi"'::jsonb,      'Basis URL halaman verifikasi internal.'),
    ('verification.qr_public',                   'false'::jsonb,                                  'Halaman verifikasi belum dibuka untuk publik.'),
    ('notification.channels',                    '["IN_APP","EMAIL","WHATSAPP"]'::jsonb,          'Kanal yang disiapkan.'),
    ('notification.email.enabled',               'true'::jsonb,                                   'Email disiapkan sejak v1; provider belum ditetapkan.'),
    ('notification.whatsapp.enabled',            'true'::jsonb,                                   'WhatsApp disiapkan sejak v1; provider belum ditetapkan.'),
    ('auth.max_failed_attempts',                 '5'::jsonb,                                      'Percobaan login sebelum akun terkunci sementara.'),
    ('auth.lock_minutes',                        '15'::jsonb,                                     'Durasi penguncian akun.'),
    ('session.ttl_hours',                        '8'::jsonb,                                      'Masa berlaku sesi.'),
    ('password.min_length',                      '12'::jsonb,                                     'Panjang minimum password.'),
    ('signature.reuse_requires_confirmation',    'true'::jsonb,                                   'Tanda tangan profil wajib dikonfirmasi per tindakan.'),
    ('feature.attendance_integration',           'false'::jsonb,                                  'Integrasi absensi ditunda.'),
    ('data.retention.attachments_years',         'null'::jsonb,                                   'Belum disahkan.'),
    ('data.retention.audit_years',               'null'::jsonb,                                   'Belum disahkan.')
ON CONFLICT (key) DO UPDATE
    SET value = excluded.value,
        description = excluded.description;

-- ---------------------------------------------------------------------
-- Template notifikasi
-- ---------------------------------------------------------------------

INSERT INTO notification_templates (code, channel, subject, body) VALUES
    ('REQUEST_SUBMITTED', 'IN_APP', 'Pengajuan cuti terkirim',
        'Pengajuan {{request_number}} telah dikirim dan menunggu pemeriksaan Admin.'),
    ('REQUEST_SUBMITTED', 'EMAIL', 'Pengajuan cuti {{request_number}} terkirim',
        'Pengajuan cuti {{request_number}} telah dikirim. Buka aplikasi untuk melihat detail.'),
    ('REQUEST_SUBMITTED', 'WHATSAPP', NULL,
        'Pengajuan cuti {{request_number}} telah dikirim. Cek aplikasi untuk detail.'),
    ('REQUEST_RETURNED', 'IN_APP', 'Pengajuan perlu diperbaiki',
        'Pengajuan {{request_number}} dikembalikan untuk perbaikan.'),
    ('REQUEST_RETURNED', 'EMAIL', 'Pengajuan {{request_number}} perlu diperbaiki',
        'Pengajuan cuti {{request_number}} dikembalikan. Buka aplikasi untuk melihat alasan.'),
    ('REQUEST_RETURNED', 'WHATSAPP', NULL,
        'Pengajuan {{request_number}} dikembalikan untuk perbaikan.'),
    ('REQUEST_FORWARDED', 'IN_APP', 'Pengajuan diteruskan',
        'Pengajuan {{request_number}} diteruskan ke tahap berikutnya.'),
    ('REQUEST_FORWARDED', 'EMAIL', 'Pengajuan {{request_number}} diteruskan',
        'Pengajuan cuti {{request_number}} diteruskan ke tahap berikutnya.'),
    ('REQUEST_FORWARDED', 'WHATSAPP', NULL,
        'Pengajuan {{request_number}} diteruskan ke tahap berikutnya.'),
    ('REQUEST_APPROVED', 'IN_APP', 'Pengajuan cuti disetujui',
        'Pengajuan {{request_number}} telah disetujui.'),
    ('REQUEST_APPROVED', 'EMAIL', 'Pengajuan cuti {{request_number}} disetujui',
        'Pengajuan cuti {{request_number}} telah disetujui. PDF final tersedia di aplikasi.'),
    ('REQUEST_APPROVED', 'WHATSAPP', NULL,
        'Pengajuan {{request_number}} disetujui. PDF tersedia di aplikasi.'),
    ('REQUEST_REJECTED', 'IN_APP', 'Pengajuan cuti tidak disetujui',
        'Pengajuan {{request_number}} tidak disetujui. Lihat alasan di aplikasi.'),
    ('REQUEST_REJECTED', 'EMAIL', 'Pengajuan cuti {{request_number}} tidak disetujui',
        'Pengajuan cuti {{request_number}} tidak disetujui. Buka aplikasi untuk melihat alasan.'),
    ('REQUEST_REJECTED', 'WHATSAPP', NULL,
        'Pengajuan {{request_number}} tidak disetujui.'),
    ('REQUEST_CANCELLED', 'IN_APP', 'Pengajuan cuti dibatalkan',
        'Pengajuan {{request_number}} telah dibatalkan.'),
    ('REQUEST_CANCELLED', 'EMAIL', 'Pengajuan cuti {{request_number}} dibatalkan',
        'Pengajuan cuti {{request_number}} telah dibatalkan. Buka aplikasi untuk melihat rincian saldo.'),
    ('REQUEST_CANCELLED', 'WHATSAPP', NULL,
        'Pengajuan {{request_number}} telah dibatalkan.'),
    ('ACTION_REQUIRED', 'IN_APP', 'Tindakan diperlukan',
        'Ada pengajuan {{request_number}} yang menunggu tindakan Anda.'),
    ('ACTION_REQUIRED', 'EMAIL', 'Tindakan diperlukan untuk {{request_number}}',
        'Pengajuan cuti {{request_number}} menunggu tindakan Anda. Buka aplikasi untuk menindaklanjuti.'),
    ('ACTION_REQUIRED', 'WHATSAPP', NULL,
        'Pengajuan {{request_number}} menunggu tindakan Anda.')
ON CONFLICT (code, channel) DO UPDATE
    SET subject = excluded.subject,
        body = excluded.body;

COMMIT;
