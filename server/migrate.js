import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Menjalankan file SQL migration secara idempoten.
 * Setiap file dicatat di cuti.schema_migrations agar tidak dijalankan dua kali.
 */
export async function runMigrations(pool) {
  const root = path.dirname(fileURLToPath(import.meta.url))
  const dir = path.join(root, 'migrations')

  await pool.query(`
    CREATE TABLE IF NOT EXISTS cuti.schema_migrations (
      filename varchar(255) PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `)

  const files = (await readdir(dir)).filter(f => f.endsWith('.sql')).sort()
  for (const filename of files) {
    const applied = await pool.query('SELECT 1 FROM cuti.schema_migrations WHERE filename = $1', [filename])
    if (applied.rowCount) continue
    const sql = await readFile(path.join(dir, filename), 'utf8')
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(sql)
      await client.query('INSERT INTO cuti.schema_migrations (filename) VALUES ($1)', [filename])
      await client.query('COMMIT')
      console.log(`[migrate] diterapkan: ${filename}`)
    } catch (error) {
      await client.query('ROLLBACK')
      throw new Error(`Migration ${filename} gagal: ${error.message}`)
    } finally {
      client.release()
    }
  }
}
