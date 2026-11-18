-- =====================================================================
-- Sistem Informasi Pengajuan dan Pengelolaan Cuti Pegawai
-- Skema database PostgreSQL 15+
--
-- Berkas  : 001_schema.sql
-- Versi   : 1.0
-- Tanggal : 16 November 2026
-- Sumber  : PRD v1.3, UI/UX v1.9, Design System v1.10, Acceptance Criteria v1.5
--
-- Catatan:
-- 1. Semua objek berada pada schema `cuti`.
-- 2. Waktu disimpan sebagai timestamptz (UTC); tanggal cuti memakai date.
-- 3. Status memakai varchar + CHECK agar perubahan nilai tidak memerlukan
--    ALTER TYPE, tetapi tetap divalidasi database.
-- 4. Penghapusan keras hanya diizinkan pada data master tertentu melalui
--    soft delete. Pengajuan, approval, ledger, dan audit bersifat append-only.
-- =====================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS cuti;
SET search_path TO cuti, public;

-- ---------------------------------------------------------------------
-- Fungsi umum
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION fn_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'Tabel %.% bersifat append-only; % tidak diizinkan.',
        TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP
        USING ERRCODE = '55000';
END;
$$;

-- ---------------------------------------------------------------------
-- 1. Akses, akun, dan sesi
-- ---------------------------------------------------------------------

CREATE TABLE roles (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code            varchar(30) NOT NULL,
    name            varchar(80) NOT NULL,
    description     text,
    is_system       boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_roles_code UNIQUE (code)
);

COMMENT ON TABLE roles IS 'Role aplikasi: Pegawai/PIC, Admin, Analis SDM, Kasubag, Kepsta, PPK.';

CREATE TABLE permissions (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code            varchar(80) NOT NULL,
    module          varchar(40) NOT NULL,
    name            varchar(120) NOT NULL,
    description     text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_permissions_code UNIQUE (code)
);

CREATE TABLE role_permissions (
    role_id         bigint NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id   bigint NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (role_id, permission_id)
);

-- Organisasi dan jabatan dibuat sebelum user_roles karena user_roles dapat
-- dibatasi pada satu unit organisasi.
CREATE TABLE organizational_units (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code            varchar(30) NOT NULL,
    name            varchar(150) NOT NULL,
    parent_id       bigint REFERENCES organizational_units(id) ON DELETE RESTRICT,
    unit_type       varchar(20) NOT NULL DEFAULT 'OTHER',
    level           smallint NOT NULL DEFAULT 1,
    is_active       boolean NOT NULL DEFAULT true,
    effective_from  date NOT NULL DEFAULT current_date,
    effective_to    date,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    deleted_at      timestamptz,
    CONSTRAINT uq_organizational_units_code UNIQUE (code),
    CONSTRAINT ck_organizational_units_type
        CHECK (unit_type IN ('ROOT', 'TU', 'NON_TU', 'UMUM', 'OTHER')),
    CONSTRAINT ck_organizational_units_not_self CHECK (parent_id IS NULL OR parent_id <> id),
    CONSTRAINT ck_organizational_units_level CHECK (level >= 1),
    CONSTRAINT ck_organizational_units_effective
        CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE INDEX ix_organizational_units_parent ON organizational_units (parent_id);

CREATE TABLE positions (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code            varchar(30) NOT NULL,
    name            varchar(150) NOT NULL,
    position_type   varchar(20) NOT NULL DEFAULT 'OTHER',
    is_active       boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    deleted_at      timestamptz,
    CONSTRAINT uq_positions_code UNIQUE (code),
    CONSTRAINT ck_positions_type
        CHECK (position_type IN ('STRUCTURAL', 'FUNCTIONAL', 'PROFESSIONAL', 'OTHER'))
);

CREATE TABLE users (
    id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    username                varchar(60) NOT NULL,
    email                   varchar(254) NOT NULL,
    password_hash           text NOT NULL,
    full_name               varchar(150) NOT NULL,
    is_active               boolean NOT NULL DEFAULT true,
    must_change_password    boolean NOT NULL DEFAULT false,
    failed_login_count      smallint NOT NULL DEFAULT 0,
    locked_until            timestamptz,
    last_login_at           timestamptz,
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),
    deactivated_at          timestamptz,
    CONSTRAINT ck_users_username CHECK (length(btrim(username)) >= 3),
    CONSTRAINT ck_users_email CHECK (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
    CONSTRAINT ck_users_failed_login CHECK (failed_login_count >= 0)
);

CREATE UNIQUE INDEX uq_users_username_lower ON users (lower(username));
CREATE UNIQUE INDEX uq_users_email_lower ON users (lower(email));

COMMENT ON TABLE users IS 'Akun login lokal. password_hash diisi aplikasi (Argon2id/bcrypt).';

CREATE TABLE user_roles (
    id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id                 bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id                 bigint NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
    organizational_unit_id  bigint REFERENCES organizational_units(id) ON DELETE RESTRICT,
    is_primary              boolean NOT NULL DEFAULT false,
    granted_at              timestamptz NOT NULL DEFAULT now(),
    granted_by              bigint REFERENCES users(id) ON DELETE SET NULL,
    revoked_at              timestamptz,
    CONSTRAINT ck_user_roles_revoked CHECK (revoked_at IS NULL OR revoked_at >= granted_at)
);

CREATE UNIQUE INDEX uq_user_roles_active
    ON user_roles (user_id, role_id, COALESCE(organizational_unit_id, 0))
    WHERE revoked_at IS NULL;

CREATE UNIQUE INDEX uq_user_roles_primary
    ON user_roles (user_id)
    WHERE is_primary AND revoked_at IS NULL;

CREATE TABLE user_sessions (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id         bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash      char(64) NOT NULL,
    ip_address      inet,
    user_agent      text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    last_seen_at    timestamptz NOT NULL DEFAULT now(),
    expires_at      timestamptz NOT NULL,
    revoked_at      timestamptz,
    CONSTRAINT uq_user_sessions_token UNIQUE (token_hash),
    CONSTRAINT ck_user_sessions_expiry CHECK (expires_at > created_at)
);

CREATE INDEX ix_user_sessions_user ON user_sessions (user_id, expires_at DESC);

CREATE TABLE login_attempts (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    username_attempted  varchar(254) NOT NULL,
    user_id             bigint REFERENCES users(id) ON DELETE SET NULL,
    is_success          boolean NOT NULL,
    failure_reason      varchar(60),
    ip_address          inet,
    user_agent          text,
    attempted_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_login_attempts_username_time
    ON login_attempts (lower(username_attempted), attempted_at DESC);
CREATE INDEX ix_login_attempts_ip_time
    ON login_attempts (ip_address, attempted_at DESC);

CREATE TABLE password_reset_tokens (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id         bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash      char(64) NOT NULL,
    requested_ip    inet,
    created_at      timestamptz NOT NULL DEFAULT now(),
    expires_at      timestamptz NOT NULL,
    used_at         timestamptz,
    CONSTRAINT uq_password_reset_token UNIQUE (token_hash),
    CONSTRAINT ck_password_reset_expiry CHECK (expires_at > created_at)
);

-- ---------------------------------------------------------------------
-- 2. Pegawai dan histori penempatan
-- ---------------------------------------------------------------------

CREATE TABLE employees (
    id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id                 bigint REFERENCES users(id) ON DELETE SET NULL,
    nip                     varchar(18),
    nik                     varchar(16),
    full_name               varchar(150) NOT NULL,
    employment_category     varchar(20) NOT NULL,
    profession              varchar(30),
    organizational_unit_id  bigint NOT NULL REFERENCES organizational_units(id) ON DELETE RESTRICT,
    position_id             bigint REFERENCES positions(id) ON DELETE RESTRICT,
    join_date               date NOT NULL,
    employment_status       varchar(20) NOT NULL DEFAULT 'ACTIVE',
    email                   varchar(254),
    phone                   varchar(30),
    address                 text,
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),
    deactivated_at          timestamptz,
    deleted_at              timestamptz,
    CONSTRAINT uq_employees_user UNIQUE (user_id),
    CONSTRAINT ck_employees_name CHECK (length(btrim(full_name)) >= 3),
    CONSTRAINT ck_employees_category
        CHECK (employment_category IN ('PNS_TU', 'PNS', 'PPPK_PPNPN_TU', 'PPPK_PPNPN', 'KONTRAK')),
    CONSTRAINT ck_employees_status
        CHECK (employment_status IN ('ACTIVE', 'INACTIVE')),
    CONSTRAINT ck_employees_profession
        CHECK (profession IS NULL OR profession IN ('PENGEMUDI', 'PETUGAS_KEBERSIHAN', 'PETUGAS_KEAMANAN')),
    CONSTRAINT ck_employees_identity
        CHECK (
            (employment_category = 'KONTRAK'
                AND nik IS NOT NULL AND nip IS NULL AND profession IS NOT NULL)
            OR
            (employment_category <> 'KONTRAK'
                AND nip IS NOT NULL AND nik IS NULL AND profession IS NULL)
        ),
    CONSTRAINT ck_employees_nip CHECK (nip IS NULL OR nip ~ '^[0-9]{8,18}$'),
    CONSTRAINT ck_employees_nik CHECK (nik IS NULL OR nik ~ '^[0-9]{16}$'),
    CONSTRAINT ck_employees_phone CHECK (phone IS NULL OR phone ~ '^[0-9+]{8,20}$'),
    CONSTRAINT ck_employees_email CHECK (email IS NULL OR email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);

CREATE UNIQUE INDEX uq_employees_nip
    ON employees (nip)
    WHERE nip IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX uq_employees_nik
    ON employees (nik)
    WHERE nik IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX ix_employees_unit ON employees (organizational_unit_id);
CREATE INDEX ix_employees_category_status ON employees (employment_category, employment_status);
CREATE INDEX ix_employees_name ON employees (full_name);

COMMENT ON TABLE employees IS
    'Master pegawai penuh. NIP wajib untuk PNS/PPPK; NIK wajib untuk Kontrak.';

CREATE TABLE employee_assignments (
    id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    employee_id             bigint NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
    organizational_unit_id  bigint NOT NULL REFERENCES organizational_units(id) ON DELETE RESTRICT,
    position_id             bigint REFERENCES positions(id) ON DELETE RESTRICT,
    profession              varchar(30),
    effective_from          date NOT NULL,
    effective_to            date,
    decision_number         varchar(100),
    notes                   text,
    created_by              bigint REFERENCES users(id) ON DELETE SET NULL,
    created_at              timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_employee_assignments_effective
        CHECK (effective_to IS NULL OR effective_to >= effective_from),
    CONSTRAINT ck_employee_assignments_profession
        CHECK (profession IS NULL OR profession IN ('PENGEMUDI', 'PETUGAS_KEBERSIHAN', 'PETUGAS_KEAMANAN')),
    CONSTRAINT ex_employee_assignments_no_overlap
        EXCLUDE USING gist (
            employee_id WITH =,
            daterange(effective_from, effective_to, '[]') WITH &&
        )
);

CREATE UNIQUE INDEX uq_employee_assignments_current
    ON employee_assignments (employee_id)
    WHERE effective_to IS NULL;

CREATE INDEX ix_employee_assignments_unit
    ON employee_assignments (organizational_unit_id, effective_from DESC);

-- ---------------------------------------------------------------------
-- 3. Jenis cuti, kebijakan, rute, dan delegasi
-- ---------------------------------------------------------------------

CREATE TABLE leave_types (
    id                          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code                        varchar(30) NOT NULL,
    name                        varchar(100) NOT NULL,
    description                 text,
    deducts_annual_balance      boolean NOT NULL DEFAULT false,
    default_requires_attachment boolean NOT NULL DEFAULT false,
    is_active                   boolean NOT NULL DEFAULT true,
    sort_order                  smallint NOT NULL DEFAULT 0,
    created_at                  timestamptz NOT NULL DEFAULT now(),
    updated_at                  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_leave_types_code UNIQUE (code)
);

CREATE TABLE leave_policies (
    id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    leave_type_id           bigint NOT NULL REFERENCES leave_types(id) ON DELETE RESTRICT,
    employee_category       varchar(20) NOT NULL,
    is_allowed              boolean NOT NULL DEFAULT true,
    annual_quota            integer,
    min_days                integer NOT NULL DEFAULT 1,
    max_days                integer,
    requires_attachment     boolean NOT NULL DEFAULT false,
    attachment_min_count    smallint NOT NULL DEFAULT 0,
    allowed_document_types  text[],
    advance_notice_days     integer NOT NULL DEFAULT 0,
    policy_config           jsonb NOT NULL DEFAULT '{}'::jsonb,
    effective_from          date NOT NULL,
    effective_to            date,
    created_by              bigint REFERENCES users(id) ON DELETE SET NULL,
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_leave_policies_version
        UNIQUE (leave_type_id, employee_category, effective_from),
    CONSTRAINT ck_leave_policies_category
        CHECK (employee_category IN ('PNS_TU', 'PNS', 'PPPK_PPNPN_TU', 'PPPK_PPNPN', 'KONTRAK')),
    CONSTRAINT ck_leave_policies_quota CHECK (annual_quota IS NULL OR annual_quota >= 0),
    CONSTRAINT ck_leave_policies_min_days CHECK (min_days > 0),
    CONSTRAINT ck_leave_policies_max_days CHECK (max_days IS NULL OR max_days >= min_days),
    CONSTRAINT ck_leave_policies_attachment
        CHECK (attachment_min_count >= 0 AND (requires_attachment OR attachment_min_count = 0)),
    CONSTRAINT ck_leave_policies_notice CHECK (advance_notice_days >= 0),
    CONSTRAINT ck_leave_policies_effective
        CHECK (effective_to IS NULL OR effective_to >= effective_from),
    CONSTRAINT ex_leave_policies_no_overlap
        EXCLUDE USING gist (
            leave_type_id WITH =,
            employee_category WITH =,
            daterange(effective_from, effective_to, '[]') WITH &&
        )
);

CREATE INDEX ix_leave_policies_lookup
    ON leave_policies (employee_category, leave_type_id, effective_from DESC);

CREATE TABLE approval_routes (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code            varchar(30) NOT NULL,
    name            varchar(100) NOT NULL,
    description     text,
    is_active       boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_approval_routes_code UNIQUE (code)
);

CREATE TABLE approval_route_categories (
    employee_category  varchar(20) NOT NULL PRIMARY KEY,
    route_id           bigint NOT NULL REFERENCES approval_routes(id) ON DELETE RESTRICT,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_approval_route_categories
        CHECK (employee_category IN ('PNS_TU', 'PNS', 'PPPK_PPNPN_TU', 'PPPK_PPNPN', 'KONTRAK'))
);

CREATE TABLE approval_route_steps (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    route_id        bigint NOT NULL REFERENCES approval_routes(id) ON DELETE CASCADE,
    step_no         smallint NOT NULL,
    stage_code      varchar(30) NOT NULL,
    role_code       varchar(30) NOT NULL REFERENCES roles(code) ON DELETE RESTRICT,
    unit_scope      varchar(20) NOT NULL DEFAULT 'ALL',
    decision_mode   varchar(10) NOT NULL,
    is_final        boolean NOT NULL DEFAULT false,
    sla_hours       smallint NOT NULL DEFAULT 24,
    created_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_approval_route_steps_no UNIQUE (route_id, step_no),
    CONSTRAINT uq_approval_route_steps_stage UNIQUE (route_id, stage_code),
    CONSTRAINT ck_approval_route_steps_stage
        CHECK (stage_code IN ('ADMIN_REVIEW', 'PERTIMBANGAN_REVIEW', 'KASUBAG_REVIEW', 'KEPSTA_REVIEW', 'PPK_REVIEW')),
    CONSTRAINT ck_approval_route_steps_scope
        CHECK (unit_scope IN ('ALL', 'TU', 'NON_TU', 'NON_KONTRAK', 'KONTRAK')),
    CONSTRAINT ck_approval_route_steps_mode
        CHECK (decision_mode IN ('FORWARD', 'FINAL')),
    CONSTRAINT ck_approval_route_steps_final
        CHECK ((decision_mode = 'FINAL') = is_final),
    CONSTRAINT ck_approval_route_steps_no CHECK (step_no > 0),
    CONSTRAINT ck_approval_route_steps_sla CHECK (sla_hours > 0)
);

CREATE INDEX ix_approval_route_steps_route ON approval_route_steps (route_id, step_no);

CREATE TABLE delegations (
    id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    delegator_user_id       bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    delegate_user_id        bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    role_code               varchar(30) NOT NULL REFERENCES roles(code) ON DELETE RESTRICT,
    organizational_unit_id  bigint REFERENCES organizational_units(id) ON DELETE RESTRICT,
    starts_at               timestamptz NOT NULL,
    ends_at                 timestamptz NOT NULL,
    reason                  text NOT NULL,
    status                  varchar(20) NOT NULL DEFAULT 'SCHEDULED',
    created_by              bigint REFERENCES users(id) ON DELETE SET NULL,
    created_at              timestamptz NOT NULL DEFAULT now(),
    cancelled_at            timestamptz,
    CONSTRAINT ck_delegations_not_self CHECK (delegator_user_id <> delegate_user_id),
    CONSTRAINT ck_delegations_period CHECK (ends_at > starts_at),
    CONSTRAINT ck_delegations_status
        CHECK (status IN ('SCHEDULED', 'ACTIVE', 'ENDED', 'CANCELLED')),
    CONSTRAINT ck_delegations_reason CHECK (length(btrim(reason)) >= 5),
    CONSTRAINT ex_delegations_no_overlap
        EXCLUDE USING gist (
            delegate_user_id WITH =,
            role_code WITH =,
            COALESCE(organizational_unit_id, 0) WITH =,
            tstzrange(starts_at, ends_at, '[]') WITH &&
        )
        WHERE (status IN ('SCHEDULED', 'ACTIVE'))
);

CREATE INDEX ix_delegations_delegator ON delegations (delegator_user_id, starts_at DESC);
CREATE INDEX ix_delegations_delegate ON delegations (delegate_user_id, starts_at DESC);

-- ---------------------------------------------------------------------
-- 4. Kalender kerja dan versi snapshot
-- ---------------------------------------------------------------------

CREATE TABLE work_calendar_versions (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code            varchar(30) NOT NULL,
    name            varchar(150) NOT NULL,
    effective_from  date NOT NULL,
    effective_to    date,
    status          varchar(20) NOT NULL DEFAULT 'DRAFT',
    created_by      bigint REFERENCES users(id) ON DELETE SET NULL,
    published_at    timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_work_calendar_versions_code UNIQUE (code),
    CONSTRAINT ck_work_calendar_versions_status
        CHECK (status IN ('DRAFT', 'ACTIVE', 'ARCHIVED')),
    CONSTRAINT ck_work_calendar_versions_effective
        CHECK (effective_to IS NULL OR effective_to >= effective_from),
    CONSTRAINT ex_work_calendar_versions_active
        EXCLUDE USING gist (
            daterange(effective_from, effective_to, '[]') WITH &&
        )
        WHERE (status = 'ACTIVE')
);

CREATE TABLE work_calendar_dates (
    id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    calendar_version_id     bigint NOT NULL REFERENCES work_calendar_versions(id) ON DELETE CASCADE,
    calendar_date           date NOT NULL,
    date_type               varchar(30) NOT NULL,
    title                   varchar(150) NOT NULL,
    description             text,
    scope_type              varchar(10) NOT NULL DEFAULT 'ALL',
    organizational_unit_id  bigint REFERENCES organizational_units(id) ON DELETE RESTRICT,
    is_active               boolean NOT NULL DEFAULT true,
    created_by              bigint REFERENCES users(id) ON DELETE SET NULL,
    updated_by              bigint REFERENCES users(id) ON DELETE SET NULL,
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_work_calendar_dates_type
        CHECK (date_type IN ('NATIONAL_HOLIDAY', 'INSTITUTIONAL_HOLIDAY', 'LEAVE_BLACKOUT')),
    CONSTRAINT ck_work_calendar_dates_scope
        CHECK (scope_type IN ('ALL', 'UNIT')),
    CONSTRAINT ck_work_calendar_dates_scope_unit
        CHECK (
            (scope_type = 'ALL' AND organizational_unit_id IS NULL)
            OR (scope_type = 'UNIT' AND organizational_unit_id IS NOT NULL)
        )
);

CREATE UNIQUE INDEX uq_work_calendar_dates_active
    ON work_calendar_dates (
        calendar_version_id,
        calendar_date,
        date_type,
        COALESCE(organizational_unit_id, 0)
    )
    WHERE is_active;

CREATE INDEX ix_work_calendar_dates_lookup
    ON work_calendar_dates (calendar_date, date_type, is_active);

-- ---------------------------------------------------------------------
-- 5. Penomoran surat dan pengajuan
-- ---------------------------------------------------------------------

CREATE TABLE document_sequences (
    sequence_key    varchar(80) PRIMARY KEY,
    unit_id         bigint REFERENCES organizational_units(id) ON DELETE RESTRICT,
    year            smallint NOT NULL,
    sequence_type   varchar(30) NOT NULL,
    last_number     integer NOT NULL DEFAULT 0,
    format_pattern  varchar(100) NOT NULL,
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_document_sequences_type
        CHECK (sequence_type IN ('REQUEST_NUMBER', 'LETTER_NUMBER')),
    CONSTRAINT ck_document_sequences_number CHECK (last_number >= 0),
    CONSTRAINT ck_document_sequences_year CHECK (year BETWEEN 2000 AND 2100)
);

CREATE TABLE leave_requests (
    id                          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    request_number              varchar(40) NOT NULL,
    letter_number               varchar(80),
    letter_number_year         smallint,
    letter_unit_id             bigint REFERENCES organizational_units(id) ON DELETE RESTRICT,
    employee_id                 bigint NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
    employee_category           varchar(20) NOT NULL,
    employee_name               varchar(150) NOT NULL,
    employee_identity_type      varchar(3) NOT NULL,
    employee_identity_number    varchar(18) NOT NULL,
    employee_unit_id            bigint REFERENCES organizational_units(id) ON DELETE RESTRICT,
    employee_unit_name          varchar(150),
    employee_position_name      varchar(150),
    employee_profession         varchar(30),
    employee_join_date          date,
    leave_type_id               bigint NOT NULL REFERENCES leave_types(id) ON DELETE RESTRICT,
    leave_policy_id             bigint REFERENCES leave_policies(id) ON DELETE RESTRICT,
    route_id                    bigint NOT NULL REFERENCES approval_routes(id) ON DELETE RESTRICT,
    calendar_version_id         bigint NOT NULL REFERENCES work_calendar_versions(id) ON DELETE RESTRICT,
    status                      varchar(30) NOT NULL DEFAULT 'DRAFT',
    decision                    varchar(20),
    start_date                  date NOT NULL,
    end_date                    date NOT NULL,
    requested_working_days      integer NOT NULL,
    approved_working_days       integer,
    reason                      text NOT NULL,
    address_during_leave        text NOT NULL,
    phone                       varchar(30) NOT NULL,
    is_annual_leave             boolean NOT NULL DEFAULT false,
    balance_period_year         smallint,
    balance_snapshot            jsonb NOT NULL DEFAULT '{}'::jsonb,
    leave_history_snapshot      jsonb NOT NULL DEFAULT '{}'::jsonb,
    calculation_snapshot        jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_by_user_id          bigint REFERENCES users(id) ON DELETE SET NULL,
    submitted_at                timestamptz,
    decided_at                  timestamptz,
    letter_number_updated_at    timestamptz,
    letter_number_updated_by    bigint REFERENCES users(id) ON DELETE SET NULL,
    version                     integer NOT NULL DEFAULT 0,
    created_at                  timestamptz NOT NULL DEFAULT now(),
    updated_at                  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_leave_requests_number UNIQUE (request_number),
    CONSTRAINT ck_leave_requests_category
        CHECK (employee_category IN ('PNS_TU', 'PNS', 'PPPK_PPNPN_TU', 'PPPK_PPNPN', 'KONTRAK')),
    CONSTRAINT ck_leave_requests_identity_type
        CHECK (employee_identity_type IN ('NIP', 'NIK')),
    CONSTRAINT ck_leave_requests_identity_category
        CHECK (
            (employee_category = 'KONTRAK' AND employee_identity_type = 'NIK')
            OR (employee_category <> 'KONTRAK' AND employee_identity_type = 'NIP')
        ),
    CONSTRAINT ck_leave_requests_profession
        CHECK (employee_profession IS NULL OR employee_profession IN ('PENGEMUDI', 'PETUGAS_KEBERSIHAN', 'PETUGAS_KEAMANAN')),
    CONSTRAINT ck_leave_requests_status
        CHECK (status IN (
            'DRAFT', 'SUBMITTED', 'ADMIN_REVIEW', 'RETURNED_FOR_REVISION',
            'ADMIN_VERIFIED', 'PERTIMBANGAN_REVIEW', 'KASUBAG_REVIEW',
            'KEPSTA_REVIEW', 'PPK_REVIEW', 'APPROVED', 'REJECTED',
            'WITHDRAWN', 'CANCELLED'
        )),
    CONSTRAINT ck_leave_requests_decision
        CHECK (decision IS NULL OR decision IN ('APPROVED', 'REJECTED')),
    CONSTRAINT ck_leave_requests_dates CHECK (end_date >= start_date),
    CONSTRAINT ck_leave_requests_days CHECK (requested_working_days > 0),
    CONSTRAINT ck_leave_requests_approved_days
        CHECK (approved_working_days IS NULL OR (approved_working_days >= 0 AND approved_working_days <= requested_working_days)),
    CONSTRAINT ck_leave_requests_reason CHECK (length(btrim(reason)) >= 10),
    CONSTRAINT ck_leave_requests_address CHECK (length(btrim(address_during_leave)) >= 10),
    CONSTRAINT ck_leave_requests_phone CHECK (phone ~ '^[0-9+]{8,20}$'),
    CONSTRAINT ck_leave_requests_final_decision
        CHECK (
            (status = 'APPROVED' AND decision = 'APPROVED')
            OR (status = 'REJECTED' AND decision = 'REJECTED')
            OR status NOT IN ('APPROVED', 'REJECTED')
        ),
    CONSTRAINT ck_leave_requests_decided_at
        CHECK (status NOT IN ('APPROVED', 'REJECTED') OR decided_at IS NOT NULL),
    CONSTRAINT ck_leave_requests_submitted_at
        CHECK (status IN ('DRAFT', 'CANCELLED') OR submitted_at IS NOT NULL),
    CONSTRAINT ck_leave_requests_letter
        CHECK (letter_number IS NULL OR (letter_number_year IS NOT NULL AND letter_unit_id IS NOT NULL)),
    CONSTRAINT ck_leave_requests_balance_year
        CHECK (balance_period_year IS NULL OR balance_period_year BETWEEN 2000 AND 2100),
    CONSTRAINT ck_leave_requests_annual_balance
        CHECK (NOT is_annual_leave OR balance_period_year IS NOT NULL),
    CONSTRAINT ex_leave_requests_annual_overlap
        EXCLUDE USING gist (
            employee_id WITH =,
            daterange(start_date, end_date, '[]') WITH &&
        )
        WHERE (
            is_annual_leave
            AND status IN (
                'SUBMITTED', 'ADMIN_REVIEW', 'RETURNED_FOR_REVISION',
                'ADMIN_VERIFIED', 'PERTIMBANGAN_REVIEW', 'KASUBAG_REVIEW',
                'KEPSTA_REVIEW', 'PPK_REVIEW', 'APPROVED'
            )
        )
);

CREATE UNIQUE INDEX uq_leave_requests_letter
    ON leave_requests (letter_unit_id, letter_number_year, letter_number)
    WHERE letter_number IS NOT NULL;

CREATE INDEX ix_leave_requests_employee_status_start
    ON leave_requests (employee_id, status, start_date DESC);
CREATE INDEX ix_leave_requests_status_submitted
    ON leave_requests (status, submitted_at);
CREATE INDEX ix_leave_requests_route_status_submitted
    ON leave_requests (route_id, status, submitted_at);
CREATE INDEX ix_leave_requests_dates ON leave_requests (start_date, end_date);
CREATE INDEX ix_leave_requests_unit ON leave_requests (employee_unit_id, start_date DESC);

COMMENT ON TABLE leave_requests IS
    'Pengajuan cuti beserta snapshot pegawai, rute, saldo, dan perhitungan kalender.';

CREATE TABLE leave_request_days (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    leave_request_id    bigint NOT NULL REFERENCES leave_requests(id) ON DELETE RESTRICT,
    leave_date          date NOT NULL,
    day_index           smallint NOT NULL,
    day_class           varchar(20) NOT NULL,
    is_counted          boolean NOT NULL,
    calendar_date_id    bigint REFERENCES work_calendar_dates(id) ON DELETE SET NULL,
    note                varchar(200),
    created_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_leave_request_days UNIQUE (leave_request_id, leave_date),
    CONSTRAINT ck_leave_request_days_index CHECK (day_index > 0),
    CONSTRAINT ck_leave_request_days_class
        CHECK (day_class IN ('WORKING', 'WEEKEND', 'HOLIDAY', 'BLACKOUT'))
);

CREATE INDEX ix_leave_request_days_request
    ON leave_request_days (leave_request_id, leave_date);

CREATE TABLE leave_request_stages (
    id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    leave_request_id        bigint NOT NULL REFERENCES leave_requests(id) ON DELETE RESTRICT,
    attempt_no              smallint NOT NULL DEFAULT 1,
    route_step_id           bigint REFERENCES approval_route_steps(id) ON DELETE RESTRICT,
    step_no                 smallint NOT NULL,
    stage_code              varchar(30) NOT NULL,
    role_code               varchar(30) NOT NULL REFERENCES roles(code) ON DELETE RESTRICT,
    unit_scope              varchar(20) NOT NULL DEFAULT 'ALL',
    decision_mode           varchar(10) NOT NULL DEFAULT 'FORWARD',
    is_final                boolean NOT NULL DEFAULT false,
    status                  varchar(20) NOT NULL DEFAULT 'PENDING',
    assignee_user_id        bigint REFERENCES users(id) ON DELETE SET NULL,
    delegated_from_user_id  bigint REFERENCES users(id) ON DELETE SET NULL,
    sla_hours               smallint NOT NULL DEFAULT 24,
    due_at                  timestamptz,
    activated_at            timestamptz,
    completed_at            timestamptz,
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_leave_request_stages UNIQUE (leave_request_id, attempt_no, step_no),
    CONSTRAINT ck_leave_request_stages_attempt CHECK (attempt_no > 0),
    CONSTRAINT ck_leave_request_stages_step CHECK (step_no > 0),
    CONSTRAINT ck_leave_request_stages_stage
        CHECK (stage_code IN ('ADMIN_REVIEW', 'PERTIMBANGAN_REVIEW', 'KASUBAG_REVIEW', 'KEPSTA_REVIEW', 'PPK_REVIEW')),
    CONSTRAINT ck_leave_request_stages_scope
        CHECK (unit_scope IN ('ALL', 'TU', 'NON_TU', 'NON_KONTRAK', 'KONTRAK')),
    CONSTRAINT ck_leave_request_stages_mode
        CHECK (decision_mode IN ('FORWARD', 'FINAL')),
    CONSTRAINT ck_leave_request_stages_final
        CHECK ((decision_mode = 'FINAL') = is_final),
    CONSTRAINT ck_leave_request_stages_status
        CHECK (status IN ('PENDING', 'ACTIVE', 'COMPLETED', 'RETURNED', 'CANCELLED', 'SKIPPED')),
    CONSTRAINT ck_leave_request_stages_sla CHECK (sla_hours > 0),
    CONSTRAINT ck_leave_request_stages_completed
        CHECK (completed_at IS NULL OR activated_at IS NULL OR completed_at >= activated_at)
);

CREATE INDEX ix_leave_request_stages_active
    ON leave_request_stages (status, due_at)
    WHERE status = 'ACTIVE';
CREATE INDEX ix_leave_request_stages_request
    ON leave_request_stages (leave_request_id, attempt_no, step_no);

-- ---------------------------------------------------------------------
-- 6. Lampiran, tanda tangan, dan dokumen
-- ---------------------------------------------------------------------

CREATE TABLE leave_attachments (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    leave_request_id    bigint NOT NULL REFERENCES leave_requests(id) ON DELETE RESTRICT,
    uploaded_by         bigint REFERENCES users(id) ON DELETE SET NULL,
    document_type       varchar(50) NOT NULL,
    original_filename   varchar(255) NOT NULL,
    storage_key         varchar(255) NOT NULL,
    detected_mime       varchar(100) NOT NULL,
    file_size           bigint NOT NULL,
    sha256              char(64) NOT NULL,
    status              varchar(20) NOT NULL DEFAULT 'PENDING',
    scan_status         varchar(20) NOT NULL DEFAULT 'NOT_SCANNED',
    scan_note           text,
    uploaded_at         timestamptz NOT NULL DEFAULT now(),
    verified_by         bigint REFERENCES users(id) ON DELETE SET NULL,
    verified_at         timestamptz,
    deleted_at          timestamptz,
    deleted_by          bigint REFERENCES users(id) ON DELETE SET NULL,
    deletion_reason     text,
    CONSTRAINT uq_leave_attachments_storage UNIQUE (storage_key),
    CONSTRAINT ck_leave_attachments_mime
        CHECK (detected_mime IN ('application/pdf', 'image/jpeg', 'image/png')),
    CONSTRAINT ck_leave_attachments_size CHECK (file_size > 0),
    CONSTRAINT ck_leave_attachments_sha CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT ck_leave_attachments_status
        CHECK (status IN ('PENDING', 'VERIFIED', 'REJECTED', 'QUARANTINED')),
    CONSTRAINT ck_leave_attachments_scan
        CHECK (scan_status IN ('NOT_SCANNED', 'CLEAN', 'INFECTED', 'ERROR')),
    CONSTRAINT ck_leave_attachments_delete
        CHECK (deleted_at IS NULL OR length(btrim(coalesce(deletion_reason, ''))) > 0)
);

CREATE INDEX ix_leave_attachments_request
    ON leave_attachments (leave_request_id, uploaded_at);
CREATE INDEX ix_leave_attachments_scan
    ON leave_attachments (scan_status)
    WHERE status = 'PENDING';

CREATE TABLE user_signatures (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id         bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    storage_key     varchar(255) NOT NULL,
    mime_type       varchar(30) NOT NULL,
    file_size       integer NOT NULL,
    sha256          char(64) NOT NULL,
    is_active       boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now(),
    revoked_at      timestamptz,
    CONSTRAINT uq_user_signatures_storage UNIQUE (storage_key),
    CONSTRAINT ck_user_signatures_mime
        CHECK (mime_type IN ('image/png', 'image/jpeg')),
    CONSTRAINT ck_user_signatures_size
        CHECK (file_size > 0 AND file_size <= 2097152),
    CONSTRAINT ck_user_signatures_sha CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT ck_user_signatures_active
        CHECK ((is_active AND revoked_at IS NULL) OR (NOT is_active AND revoked_at IS NOT NULL))
);

CREATE UNIQUE INDEX uq_user_signatures_active
    ON user_signatures (user_id)
    WHERE is_active;

CREATE TABLE documents (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    leave_request_id    bigint NOT NULL REFERENCES leave_requests(id) ON DELETE RESTRICT,
    document_type       varchar(30) NOT NULL,
    version             integer NOT NULL DEFAULT 1,
    storage_key         varchar(255) NOT NULL,
    original_filename   varchar(255) NOT NULL,
    mime_type           varchar(100) NOT NULL DEFAULT 'application/pdf',
    file_size           bigint NOT NULL,
    sha256              char(64) NOT NULL,
    source_hash         char(64) NOT NULL,
    verification_token  varchar(64),
    is_final            boolean NOT NULL DEFAULT false,
    generated_by        bigint REFERENCES users(id) ON DELETE SET NULL,
    generated_at        timestamptz NOT NULL DEFAULT now(),
    superseded_by_id    bigint REFERENCES documents(id) ON DELETE SET NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_documents_storage UNIQUE (storage_key),
    CONSTRAINT uq_documents_version UNIQUE (leave_request_id, document_type, version),
    CONSTRAINT ck_documents_type
        CHECK (document_type IN ('FORM_PREVIEW', 'FORM_FINAL', 'SUMMARY')),
    CONSTRAINT ck_documents_version CHECK (version > 0),
    CONSTRAINT ck_documents_size CHECK (file_size > 0),
    CONSTRAINT ck_documents_sha CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT ck_documents_source_hash CHECK (source_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT ck_documents_token
        CHECK (verification_token IS NULL OR length(verification_token) >= 24),
    CONSTRAINT ck_documents_superseded CHECK (superseded_by_id IS NULL OR superseded_by_id <> id)
);

CREATE UNIQUE INDEX uq_documents_verification_token
    ON documents (verification_token)
    WHERE verification_token IS NOT NULL;
CREATE UNIQUE INDEX uq_documents_final
    ON documents (leave_request_id)
    WHERE is_final AND document_type = 'FORM_FINAL';
CREATE INDEX ix_documents_request ON documents (leave_request_id, generated_at DESC);

CREATE TABLE document_signatures (
    id                          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    leave_request_id            bigint NOT NULL REFERENCES leave_requests(id) ON DELETE RESTRICT,
    leave_request_stage_id      bigint REFERENCES leave_request_stages(id) ON DELETE RESTRICT,
    document_id                 bigint REFERENCES documents(id) ON DELETE SET NULL,
    signer_user_id              bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    signer_role_code            varchar(30) NOT NULL REFERENCES roles(code) ON DELETE RESTRICT,
    signer_name                 varchar(150) NOT NULL,
    signer_identity_number      varchar(18),
    signer_position_name        varchar(150),
    user_signature_id           bigint NOT NULL REFERENCES user_signatures(id) ON DELETE RESTRICT,
    signature_image_hash        char(64) NOT NULL,
    document_hash               char(64) NOT NULL,
    signature_hash              char(64) NOT NULL,
    signed_payload              jsonb NOT NULL DEFAULT '{}'::jsonb,
    signed_at                   timestamptz NOT NULL DEFAULT now(),
    created_at                  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_document_signatures_image_hash CHECK (signature_image_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT ck_document_signatures_document_hash CHECK (document_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT ck_document_signatures_signature_hash CHECK (signature_hash ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX uq_document_signatures_stage
    ON document_signatures (leave_request_stage_id, signer_user_id)
    WHERE leave_request_stage_id IS NOT NULL;
CREATE INDEX ix_document_signatures_request
    ON document_signatures (leave_request_id, signed_at);

-- ---------------------------------------------------------------------
-- 7. Riwayat tindakan dan pembatalan
-- ---------------------------------------------------------------------

CREATE TABLE leave_approvals (
    id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    leave_request_id        bigint NOT NULL REFERENCES leave_requests(id) ON DELETE RESTRICT,
    stage_id                bigint NOT NULL REFERENCES leave_request_stages(id) ON DELETE RESTRICT,
    attempt_no              smallint NOT NULL,
    step_no                 smallint NOT NULL,
    stage_code              varchar(30) NOT NULL,
    action                  varchar(20) NOT NULL,
    actor_user_id           bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    actor_role_code         varchar(30) NOT NULL REFERENCES roles(code) ON DELETE RESTRICT,
    actor_name              varchar(150) NOT NULL,
    actor_identity_number   varchar(18),
    actor_position_name     varchar(150),
    decision                varchar(20),
    notes                   text,
    status_before           varchar(30) NOT NULL,
    status_after            varchar(30) NOT NULL,
    signature_id            bigint REFERENCES document_signatures(id) ON DELETE RESTRICT,
    document_hash           char(64),
    idempotency_key         varchar(120) NOT NULL,
    ip_address              inet,
    user_agent              text,
    acted_at                timestamptz NOT NULL DEFAULT now(),
    created_at              timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_leave_approvals_stage UNIQUE (stage_id),
    CONSTRAINT uq_leave_approvals_idempotency UNIQUE (idempotency_key),
    CONSTRAINT ck_leave_approvals_stage
        CHECK (stage_code IN ('ADMIN_REVIEW', 'PERTIMBANGAN_REVIEW', 'KASUBAG_REVIEW', 'KEPSTA_REVIEW', 'PPK_REVIEW')),
    CONSTRAINT ck_leave_approvals_action
        CHECK (action IN ('VERIFY', 'RETURN', 'PERTIMBANGAN', 'FORWARD', 'DECIDE')),
    CONSTRAINT ck_leave_approvals_decision
        CHECK (decision IS NULL OR decision IN ('APPROVED', 'REJECTED')),
    CONSTRAINT ck_leave_approvals_action_decision
        CHECK ((action = 'DECIDE' AND decision IS NOT NULL) OR (action <> 'DECIDE' AND decision IS NULL)),
    CONSTRAINT ck_leave_approvals_return_reason
        CHECK (action <> 'RETURN' OR length(btrim(coalesce(notes, ''))) >= 10),
    CONSTRAINT ck_leave_approvals_reject_reason
        CHECK (decision <> 'REJECTED' OR length(btrim(coalesce(notes, ''))) >= 10),
    CONSTRAINT ck_leave_approvals_signature
        CHECK ((action IN ('PERTIMBANGAN', 'FORWARD', 'DECIDE')) = (signature_id IS NOT NULL)),
    CONSTRAINT ck_leave_approvals_document_hash
        CHECK (document_hash IS NULL OR document_hash ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX uq_leave_approvals_signature ON leave_approvals (signature_id)
    WHERE signature_id IS NOT NULL;
CREATE INDEX ix_leave_approvals_request ON leave_approvals (leave_request_id, acted_at);
CREATE INDEX ix_leave_approvals_actor ON leave_approvals (actor_user_id, acted_at DESC);

CREATE TABLE leave_request_events (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    leave_request_id    bigint NOT NULL REFERENCES leave_requests(id) ON DELETE RESTRICT,
    event_type          varchar(40) NOT NULL,
    from_status         varchar(30),
    to_status           varchar(30),
    stage_code          varchar(30),
    description         text NOT NULL,
    actor_user_id       bigint REFERENCES users(id) ON DELETE SET NULL,
    actor_role_code     varchar(30) REFERENCES roles(code) ON DELETE RESTRICT,
    payload             jsonb NOT NULL DEFAULT '{}'::jsonb,
    correlation_id      uuid,
    created_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_leave_request_events_type
        CHECK (event_type IN (
            'CREATED', 'SUBMITTED', 'RESUBMITTED', 'STATUS_CHANGED',
            'VERIFIED', 'RETURNED', 'PERTIMBANGAN', 'FORWARDED', 'DECIDED',
            'WITHDRAWN', 'CANCELLED', 'LETTER_NUMBER_CHANGED',
            'DOCUMENT_GENERATED', 'ATTACHMENT_ADDED', 'ATTACHMENT_REMOVED',
            'SLA_BREACHED', 'DELEGATED'
        )),
    CONSTRAINT ck_leave_request_events_stage
        CHECK (stage_code IS NULL OR stage_code IN ('ADMIN_REVIEW', 'PERTIMBANGAN_REVIEW', 'KASUBAG_REVIEW', 'KEPSTA_REVIEW', 'PPK_REVIEW'))
);

CREATE INDEX ix_leave_request_events_request
    ON leave_request_events (leave_request_id, created_at, id);

CREATE TABLE leave_cancellations (
    id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    leave_request_id        bigint NOT NULL REFERENCES leave_requests(id) ON DELETE RESTRICT,
    cancellation_source     varchar(30) NOT NULL,
    reason                  text NOT NULL,
    effective_date          date NOT NULL,
    approved_days           integer NOT NULL,
    used_days               integer NOT NULL,
    used_days_source        varchar(30) NOT NULL DEFAULT 'WORKING_DAYS_CALCULATION',
    restored_days           integer NOT NULL DEFAULT 0,
    balance_id              bigint,
    balance_before          integer,
    balance_after           integer,
    processed_by_user_id    bigint REFERENCES users(id) ON DELETE SET NULL,
    processed_role_code     varchar(30) REFERENCES roles(code) ON DELETE RESTRICT,
    notes                   text,
    idempotency_key         varchar(120) NOT NULL,
    cancelled_at            timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_leave_cancellations_request UNIQUE (leave_request_id),
    CONSTRAINT uq_leave_cancellations_idempotency UNIQUE (idempotency_key),
    CONSTRAINT ck_leave_cancellations_source
        CHECK (cancellation_source IN ('EMPLOYEE_WITHDRAWAL', 'EMPLOYEE_REQUEST', 'ADMIN_INITIATED')),
    CONSTRAINT ck_leave_cancellations_reason CHECK (length(btrim(reason)) >= 10),
    CONSTRAINT ck_leave_cancellations_days
        CHECK (approved_days >= 0 AND used_days >= 0 AND used_days <= approved_days),
    CONSTRAINT ck_leave_cancellations_restored
        CHECK (restored_days >= 0 AND restored_days <= approved_days - used_days),
    CONSTRAINT ck_leave_cancellations_source_used
        CHECK (used_days_source IN ('WORKING_DAYS_CALCULATION', 'ADMIN_CONFIRMED')),
    CONSTRAINT ck_leave_cancellations_balance
        CHECK (balance_before IS NULL OR balance_before >= 0),
    CONSTRAINT ck_leave_cancellations_balance_after
        CHECK (balance_after IS NULL OR balance_after >= 0)
);

CREATE INDEX ix_leave_cancellations_date ON leave_cancellations (cancelled_at DESC);

-- ---------------------------------------------------------------------
-- 8. Saldo dan ledger
-- ---------------------------------------------------------------------

CREATE TABLE leave_balances (
    id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    employee_id             bigint NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
    leave_type_id           bigint NOT NULL REFERENCES leave_types(id) ON DELETE RESTRICT,
    period_year             smallint NOT NULL,
    allocated_days          integer NOT NULL DEFAULT 0,
    adjustment_days         integer NOT NULL DEFAULT 0,
    carry_over_days         integer NOT NULL DEFAULT 0,
    used_days               integer NOT NULL DEFAULT 0,
    reserved_days           integer NOT NULL DEFAULT 0,
    carry_over_expires_on   date,
    version                 integer NOT NULL DEFAULT 0,
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),
    available_days          integer GENERATED ALWAYS AS (
        allocated_days + adjustment_days + carry_over_days - used_days - reserved_days
    ) STORED,
    CONSTRAINT uq_leave_balances UNIQUE (employee_id, leave_type_id, period_year),
    CONSTRAINT ck_leave_balances_year CHECK (period_year BETWEEN 2000 AND 2100),
    CONSTRAINT ck_leave_balances_allocated CHECK (allocated_days >= 0),
    CONSTRAINT ck_leave_balances_carry CHECK (carry_over_days >= 0),
    CONSTRAINT ck_leave_balances_used CHECK (used_days >= 0),
    CONSTRAINT ck_leave_balances_reserved CHECK (reserved_days >= 0),
    CONSTRAINT ck_leave_balances_available
        CHECK (allocated_days + adjustment_days + carry_over_days - used_days - reserved_days >= 0),
    CONSTRAINT ck_leave_balances_version CHECK (version >= 0)
);

CREATE INDEX ix_leave_balances_employee
    ON leave_balances (employee_id, period_year DESC);

ALTER TABLE leave_cancellations
    ADD CONSTRAINT fk_leave_cancellations_balance
    FOREIGN KEY (balance_id) REFERENCES leave_balances(id) ON DELETE RESTRICT;

CREATE TABLE leave_balance_transactions (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    balance_id          bigint NOT NULL REFERENCES leave_balances(id) ON DELETE RESTRICT,
    leave_request_id    bigint REFERENCES leave_requests(id) ON DELETE RESTRICT,
    cancellation_id     bigint REFERENCES leave_cancellations(id) ON DELETE RESTRICT,
    transaction_type    varchar(30) NOT NULL,
    allocated_delta     integer NOT NULL DEFAULT 0,
    carry_over_delta    integer NOT NULL DEFAULT 0,
    adjustment_delta    integer NOT NULL DEFAULT 0,
    used_delta          integer NOT NULL DEFAULT 0,
    reserved_delta      integer NOT NULL DEFAULT 0,
    available_delta     integer GENERATED ALWAYS AS (
        allocated_delta + carry_over_delta + adjustment_delta - used_delta - reserved_delta
    ) STORED,
    reason              text NOT NULL,
    created_by_user_id  bigint REFERENCES users(id) ON DELETE SET NULL,
    idempotency_key     varchar(120) NOT NULL,
    metadata            jsonb NOT NULL DEFAULT '{}'::jsonb,
    occurred_at         timestamptz NOT NULL DEFAULT now(),
    created_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_leave_balance_transactions_idem UNIQUE (idempotency_key),
    CONSTRAINT ck_leave_balance_transactions_type
        CHECK (transaction_type IN (
            'ALLOCATION', 'CARRY_OVER', 'ADJUSTMENT', 'RESERVATION',
            'RELEASE', 'CONSUMPTION', 'RESTORATION'
        )),
    CONSTRAINT ck_leave_balance_transactions_reason CHECK (length(btrim(reason)) >= 3),
    CONSTRAINT ck_leave_balance_transactions_delta
        CHECK (
            CASE transaction_type
                WHEN 'ALLOCATION' THEN
                    allocated_delta > 0 AND carry_over_delta = 0 AND adjustment_delta = 0
                    AND used_delta = 0 AND reserved_delta = 0
                WHEN 'CARRY_OVER' THEN
                    carry_over_delta > 0 AND allocated_delta = 0 AND adjustment_delta = 0
                    AND used_delta = 0 AND reserved_delta = 0
                WHEN 'ADJUSTMENT' THEN
                    adjustment_delta <> 0 AND allocated_delta = 0 AND carry_over_delta = 0
                    AND used_delta = 0 AND reserved_delta = 0
                WHEN 'RESERVATION' THEN
                    reserved_delta > 0 AND allocated_delta = 0 AND carry_over_delta = 0
                    AND adjustment_delta = 0 AND used_delta = 0
                WHEN 'RELEASE' THEN
                    reserved_delta < 0 AND allocated_delta = 0 AND carry_over_delta = 0
                    AND adjustment_delta = 0 AND used_delta = 0
                WHEN 'CONSUMPTION' THEN
                    reserved_delta < 0 AND used_delta = -reserved_delta
                    AND allocated_delta = 0 AND carry_over_delta = 0 AND adjustment_delta = 0
                WHEN 'RESTORATION' THEN
                    used_delta < 0 AND allocated_delta = 0 AND carry_over_delta = 0
                    AND adjustment_delta = 0 AND reserved_delta = 0
                ELSE false
            END
        )
);

CREATE INDEX ix_leave_balance_transactions_balance
    ON leave_balance_transactions (balance_id, occurred_at, id);
CREATE INDEX ix_leave_balance_transactions_request
    ON leave_balance_transactions (leave_request_id);

-- ---------------------------------------------------------------------
-- 9. Notifikasi, outbox, audit, dan pengaturan
-- ---------------------------------------------------------------------

CREATE TABLE notifications (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id             bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    leave_request_id    bigint REFERENCES leave_requests(id) ON DELETE SET NULL,
    notification_type   varchar(50) NOT NULL,
    title               varchar(200) NOT NULL,
    body                text NOT NULL,
    action_url          varchar(500),
    severity            varchar(20) NOT NULL DEFAULT 'INFO',
    is_read             boolean NOT NULL DEFAULT false,
    read_at             timestamptz,
    dedupe_key          varchar(120),
    created_at          timestamptz NOT NULL DEFAULT now(),
    expires_at          timestamptz,
    CONSTRAINT uq_notifications_dedupe UNIQUE (dedupe_key),
    CONSTRAINT ck_notifications_severity
        CHECK (severity IN ('INFO', 'ACTION', 'SUCCESS', 'WARNING', 'DANGER')),
    CONSTRAINT ck_notifications_read
        CHECK ((is_read AND read_at IS NOT NULL) OR (NOT is_read AND read_at IS NULL))
);

CREATE INDEX ix_notifications_user_unread
    ON notifications (user_id, created_at DESC)
    WHERE NOT is_read;

CREATE TABLE notification_templates (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code            varchar(60) NOT NULL,
    channel         varchar(20) NOT NULL,
    subject         varchar(200),
    body            text NOT NULL,
    is_active       boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_notification_templates UNIQUE (code, channel),
    CONSTRAINT ck_notification_templates_channel
        CHECK (channel IN ('IN_APP', 'EMAIL', 'WHATSAPP'))
);

CREATE TABLE notification_outbox (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    notification_id     bigint REFERENCES notifications(id) ON DELETE SET NULL,
    channel             varchar(20) NOT NULL,
    recipient           varchar(254) NOT NULL,
    template_code       varchar(60),
    payload             jsonb NOT NULL DEFAULT '{}'::jsonb,
    status              varchar(20) NOT NULL DEFAULT 'PENDING',
    attempts            smallint NOT NULL DEFAULT 0,
    max_attempts        smallint NOT NULL DEFAULT 5,
    next_attempt_at     timestamptz NOT NULL DEFAULT now(),
    last_error          text,
    provider_message_id varchar(150),
    idempotency_key     varchar(120) NOT NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),
    sent_at             timestamptz,
    CONSTRAINT uq_notification_outbox_idem UNIQUE (idempotency_key),
    CONSTRAINT ck_notification_outbox_channel CHECK (channel IN ('EMAIL', 'WHATSAPP')),
    CONSTRAINT ck_notification_outbox_status
        CHECK (status IN ('PENDING', 'SENDING', 'SENT', 'FAILED', 'CANCELLED')),
    CONSTRAINT ck_notification_outbox_attempts
        CHECK (attempts >= 0 AND max_attempts > 0 AND attempts <= max_attempts),
    CONSTRAINT ck_notification_outbox_sent
        CHECK ((status = 'SENT' AND sent_at IS NOT NULL) OR status <> 'SENT')
);

CREATE INDEX ix_notification_outbox_pending
    ON notification_outbox (next_attempt_at)
    WHERE status = 'PENDING';

CREATE TABLE audit_logs (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    actor_user_id       bigint REFERENCES users(id) ON DELETE SET NULL,
    actor_name          varchar(150),
    actor_role_code     varchar(30),
    action              varchar(80) NOT NULL,
    entity_type         varchar(80) NOT NULL,
    entity_id           bigint,
    entity_key          varchar(120),
    entity_label        varchar(200),
    before_values       jsonb,
    after_values        jsonb,
    reason              text,
    correlation_id      uuid,
    ip_address          inet,
    user_agent          text,
    created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_audit_logs_entity ON audit_logs (entity_type, entity_id, created_at DESC);
CREATE INDEX ix_audit_logs_actor ON audit_logs (actor_user_id, created_at DESC);
CREATE INDEX ix_audit_logs_time ON audit_logs (created_at DESC);

CREATE TABLE system_settings (
    key             varchar(100) PRIMARY KEY,
    value           jsonb NOT NULL,
    description     text,
    updated_by      bigint REFERENCES users(id) ON DELETE SET NULL,
    updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 10. Tabel transisi status (divalidasi trigger)
-- ---------------------------------------------------------------------

CREATE TABLE leave_status_transitions (
    from_status     varchar(30) NOT NULL,
    to_status       varchar(30) NOT NULL,
    actor_role_code varchar(30) REFERENCES roles(code) ON DELETE RESTRICT,
    description     text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (from_status, to_status)
);

-- ---------------------------------------------------------------------
-- 11. Trigger integritas
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_validate_leave_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, cuti, pg_temp
AS $$
BEGIN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
        IF NOT EXISTS (
            SELECT 1
            FROM leave_status_transitions t
            WHERE t.from_status = OLD.status
              AND t.to_status = NEW.status
        ) THEN
            RAISE EXCEPTION 'Transisi status % -> % tidak diizinkan.',
                OLD.status, NEW.status
                USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_leave_requests_status_transition
    BEFORE UPDATE OF status ON leave_requests
    FOR EACH ROW
    EXECUTE FUNCTION fn_validate_leave_status_transition();

CREATE OR REPLACE FUNCTION fn_apply_balance_transaction()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, cuti, pg_temp
AS $$
BEGIN
    UPDATE leave_balances
    SET allocated_days = allocated_days + NEW.allocated_delta,
        carry_over_days = carry_over_days + NEW.carry_over_delta,
        adjustment_days = adjustment_days + NEW.adjustment_delta,
        used_days = used_days + NEW.used_delta,
        reserved_days = reserved_days + NEW.reserved_delta,
        version = version + 1,
        updated_at = now()
    WHERE id = NEW.balance_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Saldo % tidak ditemukan untuk transaksi %.',
            NEW.balance_id, NEW.id
            USING ERRCODE = '23503';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_leave_balance_transactions_apply
    AFTER INSERT ON leave_balance_transactions
    FOR EACH ROW
    EXECUTE FUNCTION fn_apply_balance_transaction();

CREATE TRIGGER trg_audit_logs_immutable
    BEFORE UPDATE OR DELETE ON audit_logs
    FOR EACH ROW
    EXECUTE FUNCTION fn_block_mutation();

CREATE TRIGGER trg_leave_balance_transactions_immutable
    BEFORE UPDATE OR DELETE ON leave_balance_transactions
    FOR EACH ROW
    EXECUTE FUNCTION fn_block_mutation();

CREATE TRIGGER trg_document_signatures_immutable
    BEFORE UPDATE OR DELETE ON document_signatures
    FOR EACH ROW
    EXECUTE FUNCTION fn_block_mutation();

CREATE TRIGGER trg_leave_approvals_immutable
    BEFORE UPDATE OR DELETE ON leave_approvals
    FOR EACH ROW
    EXECUTE FUNCTION fn_block_mutation();

CREATE TRIGGER trg_leave_request_events_immutable
    BEFORE UPDATE OR DELETE ON leave_request_events
    FOR EACH ROW
    EXECUTE FUNCTION fn_block_mutation();

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_organizational_units_updated_at
    BEFORE UPDATE ON organizational_units
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_positions_updated_at
    BEFORE UPDATE ON positions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_employees_updated_at
    BEFORE UPDATE ON employees
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_leave_types_updated_at
    BEFORE UPDATE ON leave_types
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_leave_policies_updated_at
    BEFORE UPDATE ON leave_policies
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_approval_routes_updated_at
    BEFORE UPDATE ON approval_routes
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_approval_route_categories_updated_at
    BEFORE UPDATE ON approval_route_categories
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_work_calendar_versions_updated_at
    BEFORE UPDATE ON work_calendar_versions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_work_calendar_dates_updated_at
    BEFORE UPDATE ON work_calendar_dates
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_leave_balances_updated_at
    BEFORE UPDATE ON leave_balances
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_leave_requests_updated_at
    BEFORE UPDATE ON leave_requests
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_leave_request_stages_updated_at
    BEFORE UPDATE ON leave_request_stages
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_notification_templates_updated_at
    BEFORE UPDATE ON notification_templates
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_system_settings_updated_at
    BEFORE UPDATE ON system_settings
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- 12. Fungsi penomoran dan alokasi saldo
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_next_document_number(
    p_unit_id         bigint,
    p_unit_code       varchar,
    p_year            smallint,
    p_sequence_type   varchar,
    p_format_pattern  varchar
)
RETURNS varchar
LANGUAGE plpgsql
SET search_path = pg_catalog, cuti, pg_temp
AS $$
DECLARE
    v_key       varchar(80);
    v_next      integer;
    v_pattern   varchar(100);
    v_result    varchar(80);
BEGIN
    IF p_sequence_type NOT IN ('REQUEST_NUMBER', 'LETTER_NUMBER') THEN
        RAISE EXCEPTION 'Jenis urutan % tidak dikenal.', p_sequence_type
            USING ERRCODE = '22023';
    END IF;

    v_key := p_sequence_type || ':' || COALESCE(p_unit_id::text, 'GLOBAL') || ':' || p_year::text;

    INSERT INTO document_sequences AS ds (
        sequence_key, unit_id, year, sequence_type, last_number, format_pattern
    )
    VALUES (
        v_key, p_unit_id, p_year, p_sequence_type, 1, p_format_pattern
    )
    ON CONFLICT (sequence_key) DO UPDATE
        SET last_number = ds.last_number + 1,
            updated_at = now()
    RETURNING ds.last_number, ds.format_pattern
    INTO v_next, v_pattern;

    v_result := replace(
        replace(
            replace(v_pattern, '{YYYY}', p_year::text),
            '{UNIT}', COALESCE(p_unit_code, '')
        ),
        '{SEQ}', lpad(v_next::text, 4, '0')
    );

    RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION fn_allocate_leave_balance(
    p_employee_id     bigint,
    p_leave_type_id   bigint,
    p_period_year     smallint,
    p_days            integer,
    p_created_by      bigint DEFAULT NULL,
    p_reason          text DEFAULT 'Alokasi kuota cuti tahunan'
)
RETURNS bigint
LANGUAGE plpgsql
SET search_path = pg_catalog, cuti, pg_temp
AS $$
DECLARE
    v_balance_id    bigint;
    v_key           varchar(120);
BEGIN
    IF p_days <= 0 THEN
        RAISE EXCEPTION 'Alokasi saldo harus lebih dari nol.'
            USING ERRCODE = '22023';
    END IF;

    INSERT INTO leave_balances (employee_id, leave_type_id, period_year)
    VALUES (p_employee_id, p_leave_type_id, p_period_year)
    ON CONFLICT (employee_id, leave_type_id, period_year) DO NOTHING;

    SELECT id INTO v_balance_id
    FROM leave_balances
    WHERE employee_id = p_employee_id
      AND leave_type_id = p_leave_type_id
      AND period_year = p_period_year
    FOR UPDATE;

    v_key := 'ALLOC:' || p_employee_id::text || ':' || p_leave_type_id::text || ':' || p_period_year::text;

    INSERT INTO leave_balance_transactions (
        balance_id, transaction_type, allocated_delta, reason, created_by_user_id, idempotency_key
    )
    VALUES (
        v_balance_id, 'ALLOCATION', p_days, p_reason, p_created_by, v_key
    )
    ON CONFLICT (idempotency_key) DO NOTHING;

    RETURN v_balance_id;
END;
$$;

-- ---------------------------------------------------------------------
-- 13. View operasional
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW v_employee_current_assignment AS
SELECT DISTINCT ON (e.id)
    e.id                    AS employee_id,
    e.full_name,
    e.employment_category,
    e.employment_status,
    a.organizational_unit_id,
    ou.name                 AS unit_name,
    a.position_id,
    p.name                  AS position_name,
    a.profession,
    a.effective_from
FROM employees e
LEFT JOIN employee_assignments a
    ON a.employee_id = e.id
   AND a.effective_to IS NULL
LEFT JOIN organizational_units ou ON ou.id = a.organizational_unit_id
LEFT JOIN positions p ON p.id = a.position_id
WHERE e.deleted_at IS NULL
ORDER BY e.id, a.effective_from DESC NULLS LAST;

CREATE OR REPLACE VIEW v_leave_balance_summary AS
SELECT
    b.id                    AS balance_id,
    b.employee_id,
    e.full_name,
    e.employment_category,
    b.leave_type_id,
    lt.code                 AS leave_type_code,
    lt.name                 AS leave_type_name,
    lt.deducts_annual_balance,
    b.period_year,
    b.allocated_days,
    b.adjustment_days,
    b.carry_over_days,
    b.used_days,
    b.reserved_days,
    b.available_days,
    b.carry_over_expires_on
FROM leave_balances b
JOIN employees e ON e.id = b.employee_id
JOIN leave_types lt ON lt.id = b.leave_type_id;

CREATE OR REPLACE VIEW v_pending_approval_queue AS
SELECT
    s.id                    AS stage_id,
    s.leave_request_id,
    s.attempt_no,
    s.step_no,
    s.stage_code,
    s.role_code,
    s.unit_scope,
    s.assignee_user_id,
    s.due_at,
    (s.due_at IS NOT NULL AND s.due_at < now()) AS is_overdue,
    r.request_number,
    r.status                AS request_status,
    r.employee_id,
    r.employee_name,
    r.employee_category,
    r.employee_unit_id,
    r.employee_unit_name,
    r.leave_type_id,
    r.start_date,
    r.end_date,
    r.requested_working_days,
    r.submitted_at
FROM leave_request_stages s
JOIN leave_requests r ON r.id = s.leave_request_id
WHERE s.status = 'ACTIVE'
  AND r.status NOT IN ('APPROVED', 'REJECTED', 'WITHDRAWN', 'CANCELLED');

CREATE OR REPLACE VIEW v_sla_breaches AS
SELECT *
FROM v_pending_approval_queue
WHERE is_overdue;

CREATE OR REPLACE VIEW v_leave_ledger AS
SELECT
    t.id,
    t.balance_id,
    t.leave_request_id,
    t.cancellation_id,
    t.transaction_type,
    t.allocated_delta,
    t.carry_over_delta,
    t.adjustment_delta,
    t.used_delta,
    t.reserved_delta,
    t.available_delta,
    t.reason,
    t.created_by_user_id,
    t.occurred_at,
    sum(t.available_delta) OVER (
        PARTITION BY t.balance_id
        ORDER BY t.occurred_at, t.id
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS available_after
FROM leave_balance_transactions t;

CREATE OR REPLACE VIEW v_employee_directory AS
SELECT
    e.id                    AS employee_id,
    e.user_id,
    e.full_name,
    e.nip,
    e.nik,
    e.employment_category,
    e.profession,
    e.employment_status,
    a.organizational_unit_id,
    a.unit_name,
    a.position_name,
    b.period_year,
    b.allocated_days,
    b.adjustment_days,
    b.carry_over_days,
    b.used_days,
    b.reserved_days,
    b.available_days
FROM employees e
LEFT JOIN v_employee_current_assignment a ON a.employee_id = e.id
LEFT JOIN LATERAL (
    SELECT lb.*
    FROM leave_balances lb
    JOIN leave_types lt ON lt.id = lb.leave_type_id
    WHERE lb.employee_id = e.id
      AND lt.deducts_annual_balance
      AND lb.period_year = EXTRACT(YEAR FROM current_date)::smallint
    ORDER BY lb.period_year DESC
    LIMIT 1
) b ON true
WHERE e.deleted_at IS NULL;

CREATE OR REPLACE VIEW v_document_verification AS
SELECT
    d.id                    AS document_id,
    d.leave_request_id,
    d.document_type,
    d.version,
    d.sha256,
    d.source_hash,
    d.verification_token,
    d.is_final,
    d.generated_at,
    r.request_number,
    r.letter_number,
    r.status                AS request_status,
    r.employee_name,
    r.employee_identity_number,
    r.employee_category,
    r.start_date,
    r.end_date,
    r.requested_working_days,
    CASE
        WHEN d.is_final THEN (
            SELECT count(*) FROM document_signatures ds
            WHERE ds.leave_request_id = d.leave_request_id
        )
        ELSE (
            SELECT count(*) FROM document_signatures ds
            WHERE ds.document_id = d.id
        )
    END AS signature_count
FROM documents d
JOIN leave_requests r ON r.id = d.leave_request_id
WHERE d.verification_token IS NOT NULL;

CREATE OR REPLACE VIEW v_leave_request_timeline AS
SELECT
    ev.id,
    ev.leave_request_id,
    ev.event_type,
    ev.from_status,
    ev.to_status,
    ev.stage_code,
    ev.description,
    ev.actor_user_id,
    ev.actor_role_code,
    ev.payload,
    ev.created_at
FROM leave_request_events ev;

CREATE OR REPLACE VIEW v_unread_notifications AS
SELECT *
FROM notifications
WHERE NOT is_read
  AND (expires_at IS NULL OR expires_at > now());

COMMIT;
