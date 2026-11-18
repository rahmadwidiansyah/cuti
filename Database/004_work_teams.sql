-- ============================================================
-- Entitas tim kerja (terpisah dari unit organisasi)
-- Migration untuk schema cuti.
SET search_path TO cuti;

-- ============================================================
-- Entitas tim kerja (terpisah dari unit organisasi)
-- ============================================================

CREATE TABLE IF NOT EXISTS work_teams (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code                varchar(30) NOT NULL,
    name                varchar(150) NOT NULL,
    unit_id             bigint REFERENCES organizational_units(id) ON DELETE SET NULL,
    description         text,
    is_active           boolean NOT NULL DEFAULT true,
    deleted_at          timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_work_teams_code UNIQUE (code),
    CONSTRAINT ck_work_teams_code CHECK (code ~ '^[A-Z0-9._-]{3,30}$'),
    CONSTRAINT ck_work_teams_name CHECK (length(btrim(name)) >= 3)
);

CREATE TABLE IF NOT EXISTS work_team_members (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    work_team_id        bigint NOT NULL REFERENCES work_teams(id) ON DELETE RESTRICT,
    employee_id         bigint NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
    effective_from      date NOT NULL DEFAULT current_date,
    effective_to        date,
    deleted_at          timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_work_team_members UNIQUE (work_team_id, employee_id),
    CONSTRAINT ck_work_team_members_effective
        CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE INDEX IF NOT EXISTS ix_work_team_members_employee ON work_team_members (employee_id);
CREATE INDEX IF NOT EXISTS ix_work_teams_active ON work_teams (is_active) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_work_teams_updated_at ON work_teams;
CREATE TRIGGER trg_work_teams_updated_at
    BEFORE UPDATE ON work_teams
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Perluas direktori dengan keanggotaan tim kerja aktif.
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
    b.available_days,
    (
        SELECT string_agg(wt.name, ', ' ORDER BY wt.name)
        FROM work_team_members wtm
        JOIN work_teams wt ON wt.id = wtm.work_team_id
        WHERE wtm.employee_id = e.id
          AND wtm.deleted_at IS NULL
          AND wt.deleted_at IS NULL
          AND wt.is_active
          AND wtm.effective_from <= current_date
          AND (wtm.effective_to IS NULL OR wtm.effective_to >= current_date)
    ) AS team_names
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

-- Contoh data untuk lingkungan uji.
INSERT INTO work_teams (code, name, unit_id, description)
VALUES
    ('TIM-LAYANAN', 'Tim Pelayanan', 1, 'Tim layanan administrasi dan kustomer.'),
    ('TIM-OPS', 'Tim Operasional', 1, 'Tim operasional dan dukungan lapangan.')
ON CONFLICT (code) DO NOTHING;

INSERT INTO work_team_members (work_team_id, employee_id, effective_from)
SELECT wt.id, e.id, current_date
FROM work_teams wt
CROSS JOIN employees e
WHERE wt.code IN ('TIM-LAYANAN', 'TIM-OPS')
  AND e.id IN (1, 2, 3)
  AND wt.code = CASE WHEN e.id IN (1, 3) THEN 'TIM-LAYANAN' ELSE 'TIM-OPS' END
  AND NOT EXISTS (
    SELECT 1 FROM work_team_members wtm
    WHERE wtm.work_team_id = wt.id AND wtm.employee_id = e.id
  );
