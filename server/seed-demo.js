import pg from 'pg'

const { Pool } = pg
const config = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : {
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT || 5432),
      database: process.env.DB_DATABASE,
      user: process.env.DB_USERNAME,
      password: process.env.DB_PASSWORD,
    }

if (!config.connectionString && (!config.host || !config.database || !config.user)) {
  throw new Error('Atur DATABASE_URL atau DB_HOST, DB_DATABASE, dan DB_USERNAME sebelum seed demo.')
}

const PASSWORD = process.env.DEMO_PASSWORD || 'Cuti123!'
const pool = new Pool(config)

const accounts = [
  { username: 'admin', fullName: 'Admin Cuti', email: 'admin@example.local', roles: ['ADMIN'] },
  { username: 'analis', fullName: 'Analis SDM Demo', email: 'analis@example.local', roles: ['HR_ANALYST'] },
  { username: 'kasubag', fullName: 'Kasubag TU Demo', email: 'kasubag@example.local', roles: ['KASUBAG'] },
  { username: 'kepsta', fullName: 'Kepsta Demo', email: 'kepsta@example.local', roles: ['KEPSTA'] },
  { username: 'ppk', fullName: 'PPK Demo', email: 'ppk@example.local', roles: ['PPK'] },
  {
    username: 'pns_tu', fullName: 'Budi Santoso', email: 'pns.tu@example.local', roles: ['EMPLOYEE'],
    employee: { category: 'PNS_TU', nip: '198501012010011001', unit: 'TU', position: 'Staf' },
  },
  {
    username: 'pns', fullName: 'Siti Aminah', email: 'pns@example.local', roles: ['EMPLOYEE'],
    employee: { category: 'PNS', nip: '198702022011012002', unit: 'NON_TU', position: 'Staf' },
  },
  {
    username: 'pppk_tu', fullName: 'Andi Pratama', email: 'pppk.tu@example.local', roles: ['EMPLOYEE'],
    employee: { category: 'PPPK_PPNPN_TU', nip: '199003032020121003', unit: 'TU', position: 'Staf' },
  },
  {
    username: 'pppk', fullName: 'Rina Wulandari', email: 'pppk@example.local', roles: ['EMPLOYEE'],
    employee: { category: 'PPPK_PPNPN', nip: '199204042021122004', unit: 'NON_TU', position: 'Staf' },
  },
  {
    username: 'kontrak', fullName: 'Joko Susilo', email: 'kontrak@example.local', roles: ['EMPLOYEE'],
    employee: { category: 'KONTRAK', nik: '3273010101900001', unit: 'UMUM', position: 'Pengemudi' },
  },
]

async function seedAccount(client, account) {
  const existing = await client.query('SELECT id FROM cuti.users WHERE lower(username) = lower($1)', [account.username])
  let userId
  if (existing.rowCount) {
    userId = existing.rows[0].id
  } else {
    const inserted = await client.query(
      `INSERT INTO cuti.users (username, email, password_hash, full_name)
       VALUES ($1, $2, crypt($3, gen_salt('bf', 12)), $4)
       RETURNING id`,
      [account.username, account.email, PASSWORD, account.fullName],
    )
    userId = inserted.rows[0].id
  }

  for (const [index, code] of account.roles.entries()) {
    await client.query(
      `INSERT INTO cuti.user_roles (user_id, role_id, is_primary)
       SELECT $1, r.id, $3 FROM cuti.roles r
       WHERE r.code = $2
         AND NOT EXISTS (
           SELECT 1 FROM cuti.user_roles ur
           WHERE ur.user_id = $1 AND ur.role_id = r.id AND ur.revoked_at IS NULL
         )`,
      [userId, code, index === 0],
    )
  }

  if (!account.employee) return
  const e = account.employee
  const unit = await client.query('SELECT id FROM cuti.organizational_units WHERE code = $1', [e.unit])
  const position = await client.query('SELECT id FROM cuti.positions WHERE name = $1', [e.position])
  if (!unit.rowCount) throw new Error(`Unit ${e.unit} tidak ditemukan.`)
  if (!position.rowCount) throw new Error(`Jabatan ${e.position} tidak ditemukan.`)

  let employeeId
  const currentEmployee = await client.query(
    'SELECT id FROM cuti.employees WHERE user_id = $1 AND deleted_at IS NULL',
    [userId],
  )
  if (currentEmployee.rowCount) {
    employeeId = currentEmployee.rows[0].id
  } else {
    const inserted = await client.query(
      `INSERT INTO cuti.employees (
         user_id, nip, nik, full_name, employment_category, profession,
         organizational_unit_id, position_id, join_date, employment_status, email
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,CURRENT_DATE,'ACTIVE',$9)
       RETURNING id`,
      [
        userId, e.nip || null, e.nik || null, account.fullName, e.category,
        e.position, unit.rows[0].id, position.rows[0].id, account.email,
      ],
    )
    employeeId = inserted.rows[0].id
  }

  await client.query(
    `INSERT INTO cuti.employee_assignments (
       employee_id, organizational_unit_id, position_id, profession, effective_from
     ) SELECT $1, $2, $3, $4, CURRENT_DATE
     WHERE NOT EXISTS (
       SELECT 1 FROM cuti.employee_assignments
       WHERE employee_id = $1 AND effective_to IS NULL
     )`,
    [employeeId, unit.rows[0].id, position.rows[0].id, e.position],
  )
}

const client = await pool.connect()
try {
  await client.query('BEGIN')
  for (const account of accounts) {
    await seedAccount(client, account)
    console.log(`[seed-demo] akun siap: ${account.username}`)
  }
  await client.query('COMMIT')
  console.log(`[seed-demo] selesai. Kata sandi demo: ${PASSWORD}`)
} catch (error) {
  await client.query('ROLLBACK')
  console.error('[seed-demo] gagal:', error.message)
  process.exitCode = 1
} finally {
  client.release()
  await pool.end()
}
