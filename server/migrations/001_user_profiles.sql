-- Profil pengguna: foto profil (avatar).
-- Tanda tangan tetap memakai cuti.user_signatures yang sudah ada.
CREATE TABLE IF NOT EXISTS cuti.user_profiles (
  user_id            bigint PRIMARY KEY REFERENCES cuti.users(id) ON DELETE CASCADE,
  avatar_storage_key varchar(255),
  avatar_mime        varchar(30),
  avatar_size        integer,
  avatar_sha256      char(64),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_user_profiles_avatar_complete CHECK (
    (avatar_storage_key IS NULL AND avatar_mime IS NULL AND avatar_size IS NULL AND avatar_sha256 IS NULL)
    OR (avatar_storage_key IS NOT NULL AND avatar_mime IS NOT NULL
        AND avatar_size IS NOT NULL AND avatar_sha256 IS NOT NULL)
  ),
  CONSTRAINT ck_user_profiles_mime CHECK (avatar_mime IS NULL OR avatar_mime IN ('image/png', 'image/jpeg')),
  CONSTRAINT ck_user_profiles_size CHECK (avatar_size IS NULL OR (avatar_size > 0 AND avatar_size <= 2097152)),
  CONSTRAINT ck_user_profiles_sha CHECK (avatar_sha256 IS NULL OR avatar_sha256 ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_profiles_storage
  ON cuti.user_profiles (avatar_storage_key) WHERE avatar_storage_key IS NOT NULL;

CREATE OR REPLACE FUNCTION cuti.set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_user_profiles_updated_at ON cuti.user_profiles;
CREATE TRIGGER trg_user_profiles_updated_at
  BEFORE UPDATE ON cuti.user_profiles FOR EACH ROW EXECUTE FUNCTION cuti.set_updated_at();
