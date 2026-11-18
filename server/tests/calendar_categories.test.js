import test from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'

const connectionString = process.env.DATABASE_URL
  || (process.env.DB_HOST
    ? `postgresql://${process.env.DB_USER || 'root'}:${process.env.DB_PASSWORD || 'secretpassword'}@${process.env.DB_HOST}:${process.env.DB_PORT || 5432}/${process.env.DB_NAME || 'cuti_test'}`
    : 'postgresql://root:secretpassword@localhost:5432/cuti_test')

async function connect() {
  const pool = new pg.Pool({ connectionString, connectionTimeoutMillis: 1500 })
  try {
    await pool.query('SELECT 1')
    return pool
  } catch (error) {
    await pool.end().catch(() => undefined)
    return null
  }
}

test('migrasi kategori kalender: tabel, seed bawaan, dan constraint', async (t) => {
  const pool = await connect()
  if (!pool) return t.skip('Database lokal tidak tersedia.')
  try {
    const table = await pool.query(
      `SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'cuti' AND table_name = 'calendar_date_categories'`,
    )
    assert.equal(table.rowCount, 1, 'tabel cuti.calendar_date_categories harus ada')

    const seeds = await pool.query(
      `SELECT code, behavior, color, is_system FROM cuti.calendar_date_categories ORDER BY code`,
    )
    assert.equal(seeds.rowCount, 3)
    const byCode = Object.fromEntries(seeds.rows.map(row => [row.code, row]))
    assert.equal(byCode.NATIONAL_HOLIDAY.behavior, 'SKIP')
    assert.equal(byCode.INSTITUTIONAL_HOLIDAY.behavior, 'SKIP')
    assert.equal(byCode.LEAVE_BLACKOUT.behavior, 'BLOCK')
    assert.ok(Object.values(byCode).every(row => row.is_system === true))

    const fk = await pool.query(
      `SELECT 1 FROM pg_constraint
       WHERE conrelid = 'cuti.work_calendar_dates'::regclass
         AND conname = 'fk_work_calendar_dates_date_type'`,
    )
    assert.equal(fk.rowCount, 1, 'FK date_type → kategori harus ada')

    await assert.rejects(
      pool.query(
        `INSERT INTO cuti.calendar_date_categories (code, name, behavior, color)
         VALUES ('TEST_CAT', 'Kategori Uji', 'INVALID', '#123456')`,
      ),
      'perilaku di luar SKIP/BLOCK/INFO harus ditolak',
    )
    await assert.rejects(
      pool.query(
        `INSERT INTO cuti.calendar_date_categories (code, name, behavior, color)
         VALUES ('TEST_CAT', 'Kategori Uji', 'INFO', 'merah')`,
      ),
      'warna bukan hex harus ditolak',
    )
  } finally {
    await pool.end()
  }
})

test('kategori yang dipakai tanggal tidak dapat dihapus (delete restrict)', async (t) => {
  const pool = await connect()
  if (!pool) return t.skip('Database lokal tidak tersedia.')
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `INSERT INTO cuti.calendar_date_categories (code, name, behavior, color)
       VALUES ('TEST_DELETE_GUARD', 'Kategori Uji Hapus', 'INFO', '#123456')`,
    )
    const version = await client.query(
      `SELECT id FROM cuti.work_calendar_versions WHERE status = 'ACTIVE' LIMIT 1`,
    )
    if (!version.rowCount) {
      await client.query('ROLLBACK')
      return t.skip('Tidak ada versi kalender aktif.')
    }
    await client.query(
      `INSERT INTO cuti.work_calendar_dates
         (calendar_version_id, calendar_date, date_type, title, scope_type)
       VALUES ($1, '2026-06-15', 'TEST_DELETE_GUARD', 'Uji', 'ALL')`,
      [version.rows[0].id],
    )
    await assert.rejects(
      client.query(`DELETE FROM cuti.calendar_date_categories WHERE code = 'TEST_DELETE_GUARD'`),
      'kategori yang masih dipakai harus ditolak penghapusannya',
    )
    await client.query('ROLLBACK')
  } finally {
    client.release()
    await pool.end()
  }
})
