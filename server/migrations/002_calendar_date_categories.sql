-- Kategori tanggal kalender (satu sumber kebenaran untuk semua jenis tanggal).
-- Menggantikan daftar hardcoded NATIONAL_HOLIDAY / INSTITUTIONAL_HOLIDAY / LEAVE_BLACKOUT.
CREATE TABLE IF NOT EXISTS cuti.calendar_date_categories (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code         varchar(30) NOT NULL,
  name         varchar(100) NOT NULL,
  behavior     varchar(10) NOT NULL,
  color        varchar(7) NOT NULL,
  icon         varchar(40),
  description  text,
  is_system    boolean NOT NULL DEFAULT false,
  created_by   bigint REFERENCES cuti.users(id) ON DELETE SET NULL,
  updated_by   bigint REFERENCES cuti.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_calendar_date_categories_code UNIQUE (code),
  CONSTRAINT ck_cdc_code CHECK (code ~ '^[A-Z][A-Z0-9_]{2,29}$'),
  CONSTRAINT ck_cdc_name CHECK (length(btrim(name)) BETWEEN 3 AND 100),
  CONSTRAINT ck_cdc_behavior CHECK (behavior IN ('SKIP', 'BLOCK', 'INFO')),
  CONSTRAINT ck_cdc_color CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  CONSTRAINT ck_cdc_system CHECK (NOT is_system OR (behavior IN ('SKIP', 'BLOCK', 'INFO')))
);

-- Seed kategori bawaan dengan kode yang sama seperti data lama (tidak ada migrasi data).
INSERT INTO cuti.calendar_date_categories (code, name, behavior, color, icon, description, is_system) VALUES
  ('NATIONAL_HOLIDAY',     'Libur nasional',     'SKIP',  '#0a6b60', 'Landmark',        'Hari libur yang dilewati otomatis dalam hitungan cuti.', true),
  ('INSTITUTIONAL_HOLIDAY','Libur institusi',    'SKIP',  '#0a6b60', 'Building2',       'Hari libur internal yang dilewati otomatis.', true),
  ('LEAVE_BLACKOUT',       'Larangan cuti',      'BLOCK', '#a11d1d', 'Ban',             'Tanggal yang menghentikan pengajuan cuti.', true)
ON CONFLICT (code) DO NOTHING;

-- work_calendar_dates.date_type sekarang merupakan FK ke kategori.
ALTER TABLE cuti.work_calendar_dates
  DROP CONSTRAINT IF EXISTS ck_work_calendar_dates_type;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'cuti' AND table_name = 'work_calendar_dates'
      AND constraint_name = 'fk_work_calendar_dates_date_type'
  ) THEN
    ALTER TABLE cuti.work_calendar_dates
      ADD CONSTRAINT fk_work_calendar_dates_date_type
      FOREIGN KEY (date_type) REFERENCES cuti.calendar_date_categories(code)
      ON UPDATE CASCADE ON DELETE RESTRICT;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION cuti.set_calendar_category_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_calendar_date_categories_updated_at ON cuti.calendar_date_categories;
CREATE TRIGGER trg_calendar_date_categories_updated_at
  BEFORE UPDATE ON cuti.calendar_date_categories FOR EACH ROW
  EXECUTE FUNCTION cuti.set_calendar_category_updated_at();
