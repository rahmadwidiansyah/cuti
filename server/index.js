import crypto from 'node:crypto'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import multer from 'multer'
import { fileTypeFromBuffer } from 'file-type'
import pg from 'pg'
import {
  withdrawLeaveRequest,
  cancelLeaveRequest,
  canEmployeeWithdraw,
  canAdminCancel,
  calculateUsedWorkingDays,
} from './cancellation.js'
import { notifyRequestLifecycle } from './notifications.js'
import { advanceToNextStage, ensureActiveStage } from './approval-stages.js'
import { generateLeavePdf, DOCUMENT_TEMPLATE_VERSION } from './document-pdf.js'
import { generateReportPdf } from './report-pdf.js'
import { runMigrations } from './migrate.js'
import { validateUpload, LIMITS, UploadValidationError, sanitizeFilename } from './file-validation.js'

const { Pool } = pg
const app = express()
const port = Number(process.env.PORT || 3001)
const host = process.env.HOST || '127.0.0.1'

// Di belakang nginx, IP asli pengguna datang dari X-Forwarded-For.
if (process.env.TRUST_PROXY) {
  const trustProxy = Number(process.env.TRUST_PROXY)
  app.set('trust proxy', Number.isFinite(trustProxy) && trustProxy > 0 ? trustProxy : process.env.TRUST_PROXY)
}
const cookieName = 'cuti_session'
const sessionHours = 12
const maxAttachmentBytes = 10 * 1024 * 1024
const employmentCategories = ['PNS_TU', 'PNS', 'PPPK_PPNPN_TU', 'PPPK_PPNPN', 'KONTRAK']
const contractProfessions = ['PENGEMUDI', 'PETUGAS_KEBERSIHAN', 'PETUGAS_KEAMANAN']
const validRoleCodes = ['ADMIN', 'EMPLOYEE', 'HR_ANALYST', 'KASUBAG', 'KEPSTA', 'PPK']
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxAttachmentBytes, files: 5 },
})
const root = path.dirname(fileURLToPath(import.meta.url))
const storageRoot = path.resolve(process.env.STORAGE_DIR || path.join(root, 'storage'))

// Pastikan storage_key tidak bisa keluar dari storageRoot (path traversal).
function safeStoragePath(storageKey) {
  const resolved = path.resolve(storageRoot, String(storageKey || ''))
  if (resolved !== storageRoot && !resolved.startsWith(storageRoot + path.sep)) {
    throw new HttpError(400, 'Lokasi berkas tidak valid.')
  }
  return resolved
}

const driver = String(process.env.DB_CONNECTION || '').toLowerCase()
if (driver && !['pgsql', 'postgres', 'postgresql'].includes(driver)) {
  throw new Error('DB_CONNECTION harus menggunakan PostgreSQL (pgsql).')
}

const databaseConfig = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : {
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT || 5432),
      database: process.env.DB_DATABASE,
      user: process.env.DB_USERNAME,
      password: process.env.DB_PASSWORD,
    }

if (!databaseConfig.connectionString &&
    (!databaseConfig.host || !databaseConfig.database || !databaseConfig.user)) {
  throw new Error('Atur DATABASE_URL atau DB_HOST, DB_DATABASE, dan DB_USERNAME di file .env.')
}

const pool = new Pool(databaseConfig)
app.use(express.json({ limit: '1mb' }))

class HttpError extends Error {
  constructor(status, message, details = null) {
    super(message)
    this.status = status
    this.details = details
  }
}

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function parseCookies(header = '') {
  return Object.fromEntries(
    header
      .split(';')
      .map((part) => part.trim().split(/=(.*)/s).slice(0, 2))
      .filter(([name, value]) => name && value !== undefined)
      .map(([name, value]) => [name, decodeURIComponent(value)]),
  )
}

function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  res.setHeader(
    'Set-Cookie',
    `${cookieName}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${sessionHours * 3600}${secure}`,
  )
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`)
}

async function transaction(callback) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await callback(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)
}

function roleCodes(user) {
  return user.roles.map((role) => role.code)
}

function hasRole(user, role) {
  return roleCodes(user).includes(role)
}

function hasStaffRole(user) {
  return ['ADMIN', 'HR_ANALYST', 'KASUBAG', 'KEPSTA', 'PPK'].some((role) => hasRole(user, role))
}

function requireAdmin(user) {
  if (!hasRole(user, 'ADMIN')) throw new HttpError(403, 'Aksi ini hanya tersedia untuk Admin.')
}

function requireCalendarAdmin(user) {
  if (!hasRole(user, 'ADMIN') && !hasRole(user, 'HR_ANALYST')) throw new HttpError(403, 'Hanya Admin atau SDM yang dapat mengelola kalender kerja.')
}

function positiveId(value, label) {
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(400, `${label} tidak valid.`)
  return id
}

function optionalId(value, label) {
  if (value === '' || value === null || value === undefined) return null
  return positiveId(value, label)
}

async function writeAudit(client, req, action, entityType, entityId, beforeValues, afterValues) {
  const staffRole = ['ADMIN', 'HR_ANALYST', 'KASUBAG', 'KEPSTA', 'PPK']
    .find((code) => hasRole(req.user, code)) || 'EMPLOYEE'
  const reason = afterValues?.reason || beforeValues?.reason || null
  await client.query(
    `INSERT INTO cuti.audit_logs (
       actor_user_id, actor_name, actor_role_code, action, entity_type, entity_id,
       before_values, after_values, reason, ip_address, user_agent
     ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10::inet,$11)`,
    [
      req.user.id,
      req.user.fullName,
      staffRole,
      action,
      entityType,
      entityId,
      beforeValues ? JSON.stringify(beforeValues) : null,
      afterValues ? JSON.stringify(afterValues) : null,
      reason,
      req.ip || null,
      req.get('user-agent') || null,
    ],
  )
}

function normalizeRoleCodes(value, employeeId) {
  if (!Array.isArray(value)) throw new HttpError(400, 'Pilih minimal satu role untuk akun.')
  const roles = [...new Set(value.map((role) => String(role || '').trim()).filter(Boolean))]
  if (roles.some((role) => !validRoleCodes.includes(role))) {
    throw new HttpError(400, 'Role akun tidak valid.')
  }
  if (employeeId && !roles.includes('EMPLOYEE')) roles.push('EMPLOYEE')
  if (!employeeId && roles.includes('EMPLOYEE')) {
    throw new HttpError(400, 'Role Pegawai/PIC memerlukan data pegawai yang terhubung.')
  }
  if (!roles.length) throw new HttpError(400, 'Pilih minimal satu role untuk akun.')
  return roles
}

async function replaceUserRoles(client, userId, roles, unitId, grantedBy) {
  await client.query(
    `UPDATE cuti.user_roles SET revoked_at = now()
     WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId],
  )
  for (const [index, code] of roles.entries()) {
    await client.query(
      `INSERT INTO cuti.user_roles (
         user_id, role_id, organizational_unit_id, is_primary, granted_by
       )
       SELECT $1, r.id, $3, $4, $5
       FROM cuti.roles r
       WHERE r.code = $2`,
      [userId, code, code === 'KASUBAG' ? unitId : null, index === 0, grantedBy],
    )
  }
}

async function syncEmployeeAssignment(client, employee) {
  const currentResult = await client.query(
    `SELECT id, organizational_unit_id, position_id, profession, effective_from::text
     FROM cuti.employee_assignments
     WHERE employee_id = $1 AND effective_to IS NULL
     FOR UPDATE`,
    [employee.id],
  )
  const current = currentResult.rows[0]
  if (current &&
      String(current.organizational_unit_id) === String(employee.unitId) &&
      String(current.position_id || '') === String(employee.positionId || '') &&
      String(current.profession || '') === String(employee.profession || '')) return

  const todayResult = await client.query(`SELECT current_date::text AS today`)
  const today = todayResult.rows[0].today
  if (current && current.effective_from >= today) {
    await client.query(
      `UPDATE cuti.employee_assignments
       SET organizational_unit_id = $2, position_id = $3, profession = $4
       WHERE id = $1`,
      [current.id, employee.unitId, employee.positionId, employee.profession],
    )
    return
  }
  if (current) {
    await client.query(
      `UPDATE cuti.employee_assignments
       SET effective_to = current_date - 1
       WHERE id = $1`,
      [current.id],
    )
  }
  await client.query(
    `INSERT INTO cuti.employee_assignments (
       employee_id, organizational_unit_id, position_id, profession,
       effective_from, created_by
     ) VALUES ($1,$2,$3,$4,GREATEST($5::date,current_date),$6)`,
    [
      employee.id,
      employee.unitId,
      employee.positionId,
      employee.profession,
      employee.joinDate,
      employee.actorId,
    ],
  )
}

async function parseEmployeeInput(client, body) {
  const fullName = String(body?.fullName || '').trim()
  const category = String(body?.category || '')
  const nip = String(body?.nip || '').trim()
  const nik = String(body?.nik || '').trim()
  const profession = category === 'KONTRAK' ? String(body?.profession || '') : null
  const joinDate = String(body?.joinDate || '')
  const status = String(body?.status || 'ACTIVE')
  const email = String(body?.email || '').trim() || null
  const phone = String(body?.phone || '').trim() || null
  const address = String(body?.address || '').trim() || null
  if (fullName.length < 3 || fullName.length > 150) {
    throw new HttpError(400, 'Nama lengkap harus berisi 3 sampai 150 karakter.')
  }
  if (!employmentCategories.includes(category)) throw new HttpError(400, 'Kategori pegawai tidak valid.')
  if (category === 'KONTRAK') {
    if (!/^[0-9]{16}$/.test(nik)) throw new HttpError(400, 'NIK Kontrak harus berisi 16 angka.')
    if (!contractProfessions.includes(profession)) throw new HttpError(400, 'Pilih profesi pegawai Kontrak.')
  } else if (!/^[0-9]{8,18}$/.test(nip)) {
    throw new HttpError(400, 'NIP harus berisi 8 sampai 18 angka.')
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(joinDate)) throw new HttpError(400, 'Tanggal mulai kerja wajib diisi.')
  parseDate(joinDate)
  if (!['ACTIVE', 'INACTIVE'].includes(status)) throw new HttpError(400, 'Status pegawai tidak valid.')
  if (email && (email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))) {
    throw new HttpError(400, 'Format atau panjang email tidak valid.')
  }
  if (phone && !/^[0-9+]{8,20}$/.test(phone)) throw new HttpError(400, 'Nomor telepon harus berisi 8 sampai 20 angka atau tanda +.')

  let unitId
  if (category === 'KONTRAK') {
    const unit = await client.query(
      `SELECT id FROM cuti.organizational_units
       WHERE code = 'UMUM' AND is_active AND deleted_at IS NULL`,
    )
    if (!unit.rowCount) throw new HttpError(409, 'Unit Umum belum tersedia untuk pegawai Kontrak.')
    unitId = unit.rows[0].id
  } else {
    unitId = positiveId(body?.unitId, 'Unit kerja')
  }
  const unitResult = await client.query(
    `SELECT id FROM cuti.organizational_units
     WHERE id = $1 AND is_active AND deleted_at IS NULL`,
    [unitId],
  )
  if (!unitResult.rowCount) throw new HttpError(400, 'Pilih unit kerja yang aktif.')

  const positionId = optionalId(body?.positionId, 'Jabatan')
  if (positionId) {
    const positionResult = await client.query(
      `SELECT id FROM cuti.positions
       WHERE id = $1 AND is_active AND deleted_at IS NULL`,
      [positionId],
    )
    if (!positionResult.rowCount) throw new HttpError(400, 'Pilih jabatan yang aktif.')
  }

  return {
    fullName,
    category,
    nip: category === 'KONTRAK' ? null : nip,
    nik: category === 'KONTRAK' ? nik : null,
    profession,
    unitId,
    positionId,
    joinDate,
    status,
    email,
    phone,
    address,
  }
}

function maskIdentity(value = '') {
  if (value.length < 5) return '••••'
  return `${value.slice(0, 3)}${'•'.repeat(Math.max(4, value.length - 5))}${value.slice(-2)}`
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    roles: user.roles,
    employee: user.employee
      ? {
          id: user.employee.id,
          category: user.employee.employment_category,
          unitName: user.employee.unit_name,
          positionName: user.employee.position_name,
        }
      : null,
    hasSignature: user.hasSignature,
  }
}

async function loadUser(userId) {
  const [userResult, rolesResult, employeeResult, signatureResult] = await Promise.all([
    pool.query(
      `SELECT id, username, full_name
       FROM cuti.users
       WHERE id = $1 AND is_active AND deactivated_at IS NULL`,
      [userId],
    ),
    pool.query(
      `SELECT r.code, ur.organizational_unit_id AS "unitId"
       FROM cuti.user_roles ur
       JOIN cuti.roles r ON r.id = ur.role_id
       WHERE ur.user_id = $1 AND ur.revoked_at IS NULL
       ORDER BY ur.is_primary DESC, r.code`,
      [userId],
    ),
    pool.query(
      `SELECT e.id, e.employment_category, e.employment_status,
              e.nip, e.nik, e.full_name, e.organizational_unit_id,
              a.unit_name, a.position_name
       FROM cuti.employees e
       LEFT JOIN cuti.v_employee_current_assignment a ON a.employee_id = e.id
       WHERE e.user_id = $1 AND e.deleted_at IS NULL`,
      [userId],
    ),
    pool.query(
      `SELECT EXISTS (
         SELECT 1 FROM cuti.user_signatures
         WHERE user_id = $1 AND is_active
       ) AS active`,
      [userId],
    ),
  ])
  const row = userResult.rows[0]
  if (!row) return null
  return {
    id: row.id,
    username: row.username,
    fullName: row.full_name,
    roles: rolesResult.rows.map((role) => ({ code: role.code, unitId: role.unitId })),
    employee: employeeResult.rows[0] || null,
    hasSignature: signatureResult.rows[0].active,
  }
}

const requireAuth = asyncRoute(async (req, res, next) => {
  const token = parseCookies(req.headers.cookie)[cookieName]
  if (!token) throw new HttpError(401, 'Sesi berakhir. Silakan masuk kembali.')

  const session = await pool.query(
    `SELECT user_id
     FROM cuti.user_sessions
     WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()`,
    [hash(token)],
  )
  if (!session.rowCount) throw new HttpError(401, 'Sesi berakhir. Silakan masuk kembali.')

  const user = await loadUser(session.rows[0].user_id)
  if (!user) throw new HttpError(401, 'Akun tidak aktif.')
  req.user = user
  req.sessionHash = hash(token)
  await pool.query(
    `UPDATE cuti.user_sessions SET last_seen_at = now()
     WHERE token_hash = $1`,
    [req.sessionHash],
  )
  next()
})

function requireEmployee(user) {
  if (!user.employee || user.employee.employment_status !== 'ACTIVE') {
    throw new HttpError(403, 'Akun ini tidak terhubung dengan pegawai aktif.')
  }
}

function unitScope(user) {
  return user.roles.find((role) => role.code === 'KASUBAG')?.unitId
}

function directoryScope(user, unitColumn = 'd.organizational_unit_id', categoryColumn = 'd.employment_category') {
  if (hasRole(user, 'ADMIN') || hasRole(user, 'HR_ANALYST') || hasRole(user, 'KEPSTA')) {
    return { sql: 'TRUE', values: [] }
  }
  if (hasRole(user, 'PPK')) return { sql: `${categoryColumn} = 'KONTRAK'`, values: [] }
  if (hasRole(user, 'KASUBAG')) {
    const unitId = unitScope(user)
    if (!unitId) throw new HttpError(403, 'Lingkup unit Kasubag belum diatur.')
    return {
      sql: `${unitColumn} IN (
        WITH RECURSIVE unit_tree AS (
          SELECT id FROM cuti.organizational_units WHERE id = $1
          UNION ALL
          SELECT child.id
          FROM cuti.organizational_units child
          JOIN unit_tree parent ON child.parent_id = parent.id
        )
        SELECT id FROM unit_tree
      )`,
      values: [unitId],
    }
  }
  throw new HttpError(403, 'Akses direktori pegawai tidak diizinkan.')
}

function queueScope(user, alias = 'q') {
  const roles = roleCodes(user).filter((role) =>
    ['ADMIN', 'HR_ANALYST', 'KASUBAG', 'KEPSTA', 'PPK'].includes(role),
  )
  if (!roles.length) throw new HttpError(403, 'Akun ini tidak memiliki antrean petugas.')
  const values = [roles]
  const clauses = [`${alias}.role_code = ANY($1::varchar[])`]
  const placeholder = (value) => {
    values.push(value)
    return `$${values.length}`
  }
  if (hasRole(user, 'KASUBAG')) {
    const id = unitScope(user)
    if (!id) throw new HttpError(403, 'Lingkup unit Kasubag belum diatur.')
    const param = placeholder(id)
    clauses.push(
      `${alias}.employee_unit_id IN (
        WITH RECURSIVE unit_tree AS (
          SELECT id FROM cuti.organizational_units WHERE id = ${param}
          UNION ALL
          SELECT child.id
          FROM cuti.organizational_units child
          JOIN unit_tree parent ON child.parent_id = parent.id
        )
        SELECT id FROM unit_tree
      )`,
    )
  }
  if (hasRole(user, 'PPK')) clauses.push(`${alias}.employee_category = 'KONTRAK'`)
  if (hasRole(user, 'KEPSTA')) clauses.push(`${alias}.employee_category <> 'KONTRAK'`)
  clauses.push(`(${alias}.assignee_user_id IS NULL OR ${alias}.assignee_user_id = ${placeholder(user.id)})`)
  return { sql: clauses.join(' AND '), values, roles }
}

function parseDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) {
    throw new HttpError(400, 'Tanggal mulai tidak valid.')
  }
  const date = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) {
    throw new HttpError(400, 'Tanggal mulai tidak valid.')
  }
  return date
}

function dateString(date) {
  return date.toISOString().slice(0, 10)
}

function addDays(date, count) {
  const next = new Date(date)
  next.setUTCDate(next.getUTCDate() + count)
  return next
}

async function getRequestContext(client, user, leaveTypeCode, startDate, workingDays) {
  requireEmployee(user)
  if (!Number.isInteger(workingDays) || workingDays < 1 || workingDays > 365) {
    throw new HttpError(400, 'Jumlah hari kerja harus berupa bilangan bulat positif.')
  }

  const employee = await client.query(
    `SELECT e.*, a.unit_name, a.position_name
     FROM cuti.employees e
     LEFT JOIN cuti.v_employee_current_assignment a ON a.employee_id = e.id
     WHERE e.id = $1 AND e.employment_status = 'ACTIVE' AND e.deleted_at IS NULL`,
    [user.employee.id],
  )
  const person = employee.rows[0]
  const start = parseDate(startDate)
  const date = dateString(start)
  const typeResult = await client.query(
    `SELECT lt.id, lt.code, lt.name, lt.deducts_annual_balance,
            lp.id AS policy_id, lp.min_days, lp.max_days, lp.requires_attachment,
            lp.attachment_min_count, lp.advance_notice_days, lp.is_allowed
     FROM cuti.leave_types lt
     JOIN cuti.leave_policies lp ON lp.leave_type_id = lt.id
     WHERE lt.code = $1 AND lt.is_active
       AND lp.employee_category = $2 AND lp.is_allowed
       AND lp.effective_from <= $3
       AND (lp.effective_to IS NULL OR lp.effective_to >= $3)
     ORDER BY lp.effective_from DESC
     LIMIT 1`,
    [leaveTypeCode, person.employment_category, date],
  )
  const type = typeResult.rows[0]
  if (!type) throw new HttpError(400, 'Jenis cuti tidak tersedia untuk kategori pegawai ini.')
  if (workingDays < type.min_days || (type.max_days && workingDays > type.max_days)) {
    throw new HttpError(400, `Durasi harus antara ${type.min_days} dan ${type.max_days} hari kerja.`)
  }

  const routeResult = await client.query(
    `SELECT ar.id, ar.code
     FROM cuti.approval_route_categories arc
     JOIN cuti.approval_routes ar ON ar.id = arc.route_id AND ar.is_active
     WHERE arc.employee_category = $1`,
    [person.employment_category],
  )
  const route = routeResult.rows[0]
  if (!route) throw new HttpError(409, 'Rute persetujuan untuk kategori pegawai belum diatur.')

  const calendarResult = await client.query(
    `SELECT id, effective_from, effective_to
     FROM cuti.work_calendar_versions
     WHERE status = 'ACTIVE' AND effective_from <= $1
       AND (effective_to IS NULL OR effective_to >= $1)
     ORDER BY effective_from DESC
     LIMIT 1`,
    [date],
  )
  const calendar = calendarResult.rows[0]
  if (!calendar) throw new HttpError(409, 'Kalender kerja aktif tidak mencakup tanggal tersebut.')

  const calendarDates = await client.query(
    `SELECT d.id, d.calendar_date::text, d.date_type, d.title, c.behavior, c.name AS category_name
     FROM cuti.work_calendar_dates d
     JOIN cuti.calendar_date_categories c ON c.code = d.date_type
     WHERE d.calendar_version_id = $1 AND d.is_active
       AND d.calendar_date BETWEEN $2::date AND ($2::date + 365)
       AND (d.scope_type = 'ALL' OR d.organizational_unit_id = $3)
     ORDER BY d.calendar_date,
              (c.behavior = 'BLOCK'),
              (d.scope_type = 'UNIT')`,
    [calendar.id, date, person.organizational_unit_id],
  )
  const specialDates = new Map(calendarDates.rows.map((row) => [row.calendar_date, row]))
  const days = []
  let counted = 0
  let cursor = start
  for (let index = 1; counted < workingDays && index <= 366; index += 1) {
    const current = dateString(cursor)
    if (calendar.effective_to && current > dateString(new Date(calendar.effective_to))) {
      throw new HttpError(409, 'Tanggal cuti melewati batas kalender aktif.')
    }
    const weekday = cursor.getUTCDay()
    const special = specialDates.get(current)
    const behavior = special?.behavior || 'WORKING'
    // INFO hanya penanda: tidak memblokir dan tidak dilewati.
    const blocking = behavior === 'BLOCK'
    const skipped = behavior === 'SKIP'
    if (index === 1 && (weekday === 0 || weekday === 6 || blocking || skipped)) {
      const label = blocking
        ? `Tanggal ${current} termasuk tanggal larangan: ${special.title}.`
        : 'Tanggal mulai harus merupakan hari kerja.'
      throw new HttpError(409, label, blocking ? {
        type: 'LEAVE_BLACKOUT',
        date: current,
        title: special.title,
        dayIndex: index,
        workingDays,
      } : null)
    }
    if (weekday === 0 || weekday === 6) {
      days.push({ date: current, dayIndex: index, dayClass: 'WEEKEND', counted: false, calendarDateId: null, note: null })
    } else if (blocking) {
      throw new HttpError(409, `Tanggal ${current} termasuk tanggal larangan: ${special.title}.`, {
        type: 'LEAVE_BLACKOUT',
        date: current,
        title: special.title,
        dayIndex: index,
        workingDays,
      })
    } else if (skipped) {
      days.push({ date: current, dayIndex: index, dayClass: 'HOLIDAY', counted: false, calendarDateId: special.id, note: special.title })
    } else if (behavior === 'INFO') {
      // Snapshot perilaku ke pengajuan: INFO tetap dihitung sebagai hari kerja,
      // tetapi menyimpan penanda (note + calendarDateId) untuk keperluan audit.
      days.push({ date: current, dayIndex: index, dayClass: 'WORKING', counted: true, calendarDateId: special.id, note: special.title })
      counted += 1
    } else {
      counted += 1
      days.push({ date: current, dayIndex: index, dayClass: 'WORKING', counted: true, calendarDateId: null, note: null })
    }
    cursor = addDays(cursor, 1)
  }
  if (counted !== workingDays) throw new HttpError(409, 'Tanggal selesai tidak dapat dihitung pada kalender aktif.')

  const endDate = days.at(-1).date
  const balanceYear = Number(date.slice(0, 4))
  let balance = null
  if (type.deducts_annual_balance) {
    const balanceResult = await client.query(
      `SELECT id, allocated_days, adjustment_days, carry_over_days,
              used_days, reserved_days, available_days
       FROM cuti.leave_balances
       WHERE employee_id = $1 AND leave_type_id = $2 AND period_year = $3`,
      [person.id, type.id, balanceYear],
    )
    balance = balanceResult.rows[0] || null
  }

  return {
    employee: person,
    type,
    route,
    calendar,
    startDate: date,
    endDate,
    workingDays,
    days,
    balanceYear: type.deducts_annual_balance ? balanceYear : null,
    balance,
  }
}

async function requestPattern(client) {
  const result = await client.query(
    `SELECT value #>> '{}' AS pattern
     FROM cuti.system_settings
     WHERE key = 'document.request_number_pattern'`,
  )
  return result.rows[0]?.pattern || 'CUTI-{YYYY}-{SEQ}'
}

async function visibleEmployeeWhere(user, requestAlias = 'r') {
  if (hasRole(user, 'ADMIN') || hasRole(user, 'HR_ANALYST')) return 'TRUE'
  if (hasRole(user, 'KEPSTA')) return `${requestAlias}.employee_category <> 'KONTRAK'`
  if (hasRole(user, 'PPK')) return `${requestAlias}.employee_category = 'KONTRAK'`
  if (hasRole(user, 'KASUBAG')) {
    const id = unitScope(user)
    if (!id) throw new HttpError(403, 'Lingkup unit Kasubag belum diatur.')
    return `${requestAlias}.employee_unit_id IN (
      WITH RECURSIVE unit_tree AS (
        SELECT id FROM cuti.organizational_units WHERE id = ${Number(id)}
        UNION ALL
        SELECT child.id FROM cuti.organizational_units child
        JOIN unit_tree parent ON child.parent_id = parent.id
      )
      SELECT id FROM unit_tree
    )`
  }
  throw new HttpError(403, 'Akses pengajuan tidak diizinkan.')
}

async function canReadRequest(user, request) {
  if (user.employee && String(user.employee.id) === String(request.employee_id)) return true
  if (!(hasRole(user, 'ADMIN') || hasRole(user, 'HR_ANALYST') || hasRole(user, 'KASUBAG') ||
        hasRole(user, 'KEPSTA') || hasRole(user, 'PPK'))) return false
  const scope = await visibleEmployeeWhere(user, 'r')
  const result = await pool.query(
    `SELECT ${scope} AS allowed FROM cuti.leave_requests r WHERE r.id = $1`,
    [request.id],
  )
  return result.rows[0]?.allowed === true
}

app.get('/api/health', asyncRoute(async (_req, res) => {
  await pool.query('SELECT 1')
  res.json({ ok: true })
}))

app.post('/api/auth/login', asyncRoute(async (req, res) => {
  const username = String(req.body?.username || '').trim()
  const password = String(req.body?.password || '')
  if (!username || !password) throw new HttpError(400, 'Isi nama pengguna dan kata sandi.')

  const result = await pool.query(
    `SELECT id, password_hash,
            (password_hash = crypt($1, password_hash)) AS password_ok,
            is_active, failed_login_count, locked_until,
            NOT EXISTS (
              SELECT 1 FROM cuti.employees e
              WHERE e.user_id = u.id AND e.deleted_at IS NULL
                AND e.employment_status <> 'ACTIVE'
            ) AS employee_active
     FROM cuti.users u
     WHERE lower(u.username) = lower($2)`,
    [password, username],
  )
  const account = result.rows[0]
  if (!account || !account.is_active) throw new HttpError(401, 'Nama pengguna atau kata sandi tidak cocok.')
  if (!account.employee_active) throw new HttpError(403, 'Akun pegawai nonaktif. Hubungi Admin.')
  if (account.locked_until && new Date(account.locked_until) > new Date()) {
    throw new HttpError(423, 'Akun terkunci sementara. Coba lagi setelah 15 menit.')
  }
  if (!account.password_ok) {
    const failures = Number(account.failed_login_count) + 1
    const lockedUntil = failures >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null
    await pool.query(
      `UPDATE cuti.users
       SET failed_login_count = $2, locked_until = $3, updated_at = now()
       WHERE id = $1`,
      [account.id, failures, lockedUntil],
    )
    throw new HttpError(401, 'Nama pengguna atau kata sandi tidak cocok.')
  }

  const token = crypto.randomBytes(32).toString('hex')
  await pool.query(
    `UPDATE cuti.users
     SET failed_login_count = 0, locked_until = NULL, last_login_at = now(), updated_at = now()
     WHERE id = $1`,
    [account.id],
  )
  await pool.query(
    `INSERT INTO cuti.user_sessions (user_id, token_hash, ip_address, user_agent, expires_at)
     VALUES ($1, $2, $3::inet, $4, now() + make_interval(hours => $5))`,
    [account.id, hash(token), req.ip || null, req.get('user-agent') || null, sessionHours],
  )
  setSessionCookie(res, token)
  res.json({ user: publicUser(await loadUser(account.id)) })
}))

app.post('/api/auth/logout', requireAuth, asyncRoute(async (req, res) => {
  await pool.query(
    `UPDATE cuti.user_sessions SET revoked_at = now()
     WHERE token_hash = $1 AND revoked_at IS NULL`,
    [req.sessionHash],
  )
  clearSessionCookie(res)
  res.json({ ok: true })
}))

app.get('/api/me', requireAuth, asyncRoute(async (req, res) => {
  res.json({ user: publicUser(req.user) })
}))

app.get('/api/notifications', requireAuth, asyncRoute(async (req, res) => {
  const [itemsResult, countResult] = await Promise.all([
    pool.query(
      `SELECT id, leave_request_id, notification_type, title, body, action_url,
              severity, is_read, read_at, created_at
       FROM cuti.notifications
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [req.user.id],
    ),
    pool.query(
      `SELECT count(*)::integer AS unread_count
       FROM cuti.notifications
       WHERE user_id = $1 AND NOT is_read`,
      [req.user.id],
    ),
  ])
  res.json({
    items: itemsResult.rows,
    unreadCount: countResult.rows[0]?.unread_count || 0,
  })
}))

app.post('/api/notifications/:id/read', requireAuth, asyncRoute(async (req, res) => {
  const notifId = positiveId(req.params.id, 'ID notifikasi')
  await pool.query(
    `UPDATE cuti.notifications
     SET is_read = true, read_at = now()
     WHERE id = $1 AND user_id = $2`,
    [notifId, req.user.id],
  )
  res.json({ ok: true })
}))

app.post('/api/notifications/read-all', requireAuth, asyncRoute(async (req, res) => {
  await pool.query(
    `UPDATE cuti.notifications
     SET is_read = true, read_at = now()
     WHERE user_id = $1 AND NOT is_read`,
    [req.user.id],
  )
  res.json({ ok: true })
}))

app.delete('/api/notifications/:id', requireAuth, asyncRoute(async (req, res) => {
  const notifId = positiveId(req.params.id, 'ID notifikasi')
  const result = await pool.query(
    `DELETE FROM cuti.notifications WHERE id = $1 AND user_id = $2`,
    [notifId, req.user.id],
  )
  if (!result.rowCount) throw new HttpError(404, 'Notifikasi tidak ditemukan.')
  res.json({ ok: true })
}))

app.delete('/api/notifications', requireAuth, asyncRoute(async (req, res) => {
  const result = await pool.query(
    `DELETE FROM cuti.notifications WHERE user_id = $1`,
    [req.user.id],
  )
  res.json({ ok: true, deleted: result.rowCount })
}))

app.get('/api/leave-types', requireAuth, asyncRoute(async (req, res) => {
  requireEmployee(req.user)
  const result = await pool.query(
    `SELECT lt.code, lt.name, lt.description, lt.deducts_annual_balance,
            lp.requires_attachment, lp.attachment_min_count, lp.min_days, lp.max_days
     FROM cuti.leave_types lt
     JOIN cuti.leave_policies lp ON lp.leave_type_id = lt.id
     WHERE lt.is_active AND lp.is_allowed
       AND lp.employee_category = $1
       AND lp.effective_from <= current_date
       AND (lp.effective_to IS NULL OR lp.effective_to >= current_date)
     ORDER BY lt.sort_order`,
    [req.user.employee.employment_category],
  )
  res.json({ items: result.rows })
}))

app.get('/api/balance-details', requireAuth, asyncRoute(async (req, res) => {
  requireEmployee(req.user)
  const employeeId = req.user.employee.id
  const year = Number(req.query.year) || new Date().getFullYear()
  const summaryResult = await pool.query(
    `SELECT allocated_days, adjustment_days, carry_over_days, used_days,
            reserved_days, available_days, period_year
     FROM cuti.v_leave_balance_summary
     WHERE employee_id = $1 AND deducts_annual_balance AND period_year = $2
     LIMIT 1`,
    [employeeId, year],
  )
  const summary = summaryResult.rows[0] || null
  const typeResult = await pool.query(
    `SELECT lt.code, lt.name, lt.deducts_annual_balance,
            count(r.id)::integer AS total_requests,
            COALESCE(sum(CASE WHEN r.status = 'APPROVED' AND rd.is_counted THEN 1 ELSE 0 END), 0)::integer AS used_days
     FROM cuti.leave_types lt
     LEFT JOIN cuti.leave_requests r
       ON r.leave_type_id = lt.id AND r.employee_id = $1 AND r.status = 'APPROVED'
      AND extract(year FROM r.start_date) = $2
     LEFT JOIN cuti.leave_request_days rd ON rd.leave_request_id = r.id
     WHERE lt.is_active
     GROUP BY lt.id, lt.code, lt.name, lt.deducts_annual_balance
     ORDER BY lt.sort_order`,
    [employeeId, year],
  )
  const ledgerResult = await pool.query(
    `SELECT t.id, t.transaction_type, t.available_delta, t.used_delta, t.reason, t.occurred_at,
            r.request_number
     FROM cuti.leave_balance_transactions t
     JOIN cuti.leave_balances b ON b.id = t.balance_id
     LEFT JOIN cuti.leave_requests r ON r.id = t.leave_request_id
     WHERE b.employee_id = $1 AND b.period_year = $2
     ORDER BY t.occurred_at DESC, t.id DESC
     LIMIT 50`,
    [employeeId, year],
  )
  const running = []
  let balance = 0
  for (const row of [...ledgerResult.rows].reverse()) {
    balance += Number(row.available_delta || 0)
    const isConsumption = String(row.transaction_type).toUpperCase().includes('CONSUM')
    running.push({
      id: row.id,
      date: row.occurred_at,
      requestNumber: row.request_number || '-',
      transactionType: row.transaction_type,
      days: isConsumption ? -Number(row.used_delta || 0) : Number(row.available_delta || 0),
      reason: row.reason || '-',
      balanceAfter: balance,
    })
  }
  res.json({
    summary,
    types: typeResult.rows.map((row) => ({
      code: row.code,
      name: row.name,
      deductsAnnual: row.deducts_annual_balance,
      totalRequests: Number(row.total_requests),
      usedDays: Number(row.used_days),
    })),
    ledger: running.reverse(),
  })
}))

app.post('/api/preview', requireAuth, asyncRoute(async (req, res) => {
  const startDate = String(req.body?.startDate || '')
  const workingDays = Number(req.body?.workingDays)
  const result = await getRequestContext(pool, req.user, req.body?.leaveTypeCode, startDate, workingDays)
  res.json({
    startDate: result.startDate,
    endDate: result.endDate,
    workingDays: result.workingDays,
    days: result.days,
    annualBalance: result.balance
      ? {
          available: Number(result.balance.available_days),
          reservedAfter: Number(result.balance.reserved_days) + workingDays,
          remainingAfter: Number(result.balance.available_days) - workingDays,
        }
      : null,
    requiresAttachment: result.type.requires_attachment,
    attachmentMinCount: result.type.attachment_min_count,
  })
}))

app.get('/api/dashboard', requireAuth, asyncRoute(async (req, res) => {
  if (req.user.employee && !hasStaffRole(req.user)) {
    const employeeId = req.user.employee.id
    const [balanceResult, requestResult, nonAnnualResult, returnedResult] = await Promise.all([
      pool.query(
        `SELECT allocated_days, adjustment_days, carry_over_days, used_days,
                reserved_days, available_days, period_year
         FROM cuti.v_leave_balance_summary
         WHERE employee_id = $1
           AND deducts_annual_balance
           AND period_year = extract(year FROM current_date)::smallint
         LIMIT 1`,
        [employeeId],
      ),
      pool.query(
        `SELECT r.id, r.request_number, lt.name AS leave_type_name,
                r.start_date, r.end_date, r.requested_working_days, r.status,
                r.submitted_at
         FROM cuti.leave_requests r
         JOIN cuti.leave_types lt ON lt.id = r.leave_type_id
         WHERE r.employee_id = $1
         ORDER BY r.created_at DESC
         LIMIT 5`,
        [employeeId],
      ),
      pool.query(
        `SELECT lt.code, lt.name,
                COALESCE(sum(CASE WHEN rd.is_counted THEN 1 ELSE 0 END), 0)::integer AS days
         FROM cuti.leave_types lt
         LEFT JOIN cuti.leave_requests r
           ON r.leave_type_id = lt.id AND r.employee_id = $1
          AND r.status = 'APPROVED'
          AND r.start_date >= date_trunc('year', current_date)::date
         LEFT JOIN cuti.leave_request_days rd
           ON rd.leave_request_id = r.id AND rd.is_counted
         WHERE NOT lt.deducts_annual_balance
         GROUP BY lt.id
         ORDER BY lt.sort_order`,
        [employeeId],
      ),
      pool.query(
        `SELECT count(*)::integer AS total
         FROM cuti.leave_requests
         WHERE employee_id = $1 AND status = 'RETURNED_FOR_REVISION'`,
        [employeeId],
      ),
    ])
    res.json({
      kind: 'employee',
      balance: balanceResult.rows[0] || null,
      requests: requestResult.rows,
      nonAnnual: nonAnnualResult.rows,
      returnedCount: returnedResult.rows[0].total,
    })
    return
  }

  const scope = queueScope(req.user)
  const result = await pool.query(
    `SELECT count(*)::integer AS waiting,
            count(*) FILTER (WHERE is_overdue)::integer AS overdue
     FROM cuti.v_pending_approval_queue q
     WHERE ${scope.sql}`,
    scope.values,
  )
  res.json({
    kind: 'staff',
    waiting: result.rows[0].waiting,
    overdue: result.rows[0].overdue,
    roles: scope.roles,
  })
}))

const requestStatuses = ['DRAFT', 'SUBMITTED', 'ADMIN_REVIEW', 'RETURNED_FOR_REVISION', 'ADMIN_VERIFIED', 'PERTIMBANGAN_REVIEW', 'KASUBAG_REVIEW', 'KEPSTA_REVIEW', 'PPK_REVIEW', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'CANCELLED']

const pendingStatusSql = `r.status IN ('SUBMITTED','ADMIN_REVIEW','ADMIN_VERIFIED','PERTIMBANGAN_REVIEW','KASUBAG_REVIEW','KEPSTA_REVIEW','PPK_REVIEW')`

function buildHistoryQuery(query, employeeId, { ignoreStatus = false, extraWhere = 'TRUE', extraValues = [] } = {}) {
  const values = [...extraValues, employeeId]
  const conditions = [extraWhere, 'r.employee_id = $' + (extraValues.length + 1)]
  const add = (value) => {
    values.push(value)
    return `$${values.length}`
  }
  const year = Number(query.year)
  if (Number.isInteger(year) && year >= 2000 && year <= 2100) {
    conditions.push(`extract(year from r.start_date) = ${add(year)}`)
  }
  const leaveType = String(query.leaveType || '').trim()
  if (/^[A-Z_]{2,30}$/.test(leaveType)) conditions.push(`lt.code = ${add(leaveType)}`)
  const status = String(query.status || '').trim()
  if (!ignoreStatus && requestStatuses.includes(status)) conditions.push(`r.status = ${add(status)}`)
  else if (!ignoreStatus && status === 'PENDING') {
    conditions.push(pendingStatusSql)
  } else if (!ignoreStatus && status === 'CANCELLED') {
    conditions.push(`r.status IN ('WITHDRAWN','CANCELLED')`)
  }
  const validDate = /^\d{4}-\d{2}-\d{2}$/
  const startDate = String(query.startDate || '')
  const endDate = String(query.endDate || '')
  if (validDate.test(startDate)) conditions.push(`r.start_date >= ${add(startDate)}`)
  if (validDate.test(endDate)) conditions.push(`r.end_date <= ${add(endDate)}`)
  const search = String(query.q || '').trim()
  if (search) conditions.push(`r.request_number ILIKE ${add(`%${search}%`)}`)
  return { where: conditions.join(' AND '), values }
}

app.get('/api/requests', requireAuth, asyncRoute(async (req, res) => {
  // Admin/approval roles can query by employee_id; regular users see only their own
  const isApprovalRole = hasRole(req.user, 'ADMIN') || hasRole(req.user, 'HR_ANALYST') ||
                         hasRole(req.user, 'KASUBAG') || hasRole(req.user, 'KEPSTA') || hasRole(req.user, 'PPK')
  let employeeId
  let scopeSql = 'TRUE'
  let scopeValues = []

  if (isApprovalRole && req.query.employee_id) {
    employeeId = Number(req.query.employee_id)
    const scope = await visibleEmployeeWhere(req.user, 'r')
    scopeSql = scope
    scopeValues = []
  } else {
    requireEmployee(req.user)
    employeeId = req.user.employee.id
  }

  const countQuery = buildHistoryQuery(req.query, employeeId, { ignoreStatus: true, extraWhere: scopeSql, extraValues: scopeValues })
  const { where, values } = buildHistoryQuery(req.query, employeeId, { extraWhere: scopeSql, extraValues: scopeValues })
  const [countResult, totalResult] = await Promise.all([
    pool.query(
      `SELECT count(*)::integer AS total,
              count(*) FILTER (WHERE r.status = 'DRAFT')::integer AS draft,
              count(*) FILTER (WHERE ${pendingStatusSql})::integer AS pending,
              count(*) FILTER (WHERE r.status = 'APPROVED')::integer AS approved,
              count(*) FILTER (WHERE r.status = 'REJECTED')::integer AS rejected,
              count(*) FILTER (WHERE r.status = 'RETURNED_FOR_REVISION')::integer AS returned,
              count(*) FILTER (WHERE r.status IN ('WITHDRAWN','CANCELLED'))::integer AS cancelled
       FROM cuti.leave_requests r
       JOIN cuti.leave_types lt ON lt.id = r.leave_type_id
       WHERE ${countQuery.where}`,
      countQuery.values,
    ),
    pool.query(
      `SELECT count(*)::integer AS total
       FROM cuti.leave_requests r
       JOIN cuti.leave_types lt ON lt.id = r.leave_type_id
       WHERE ${where}`,
      values,
    ),
  ])
  const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 100)
  const offset = Math.max(Number(req.query.offset) || 0, 0)
  const result = await pool.query(
    `SELECT r.id, r.request_number, r.leave_type_id, lt.code AS leave_type_code,
            lt.name AS leave_type_name, r.start_date, r.end_date,
            r.requested_working_days, r.status, r.submitted_at, r.created_at
     FROM cuti.leave_requests r
     JOIN cuti.leave_types lt ON lt.id = r.leave_type_id
     WHERE ${where}
     ORDER BY r.created_at DESC, r.id DESC
     LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, limit, offset],
  )
  const yearsResult = await pool.query(
    `SELECT DISTINCT extract(year from start_date)::integer AS year
     FROM cuti.leave_requests WHERE employee_id = $1 ORDER BY year DESC`,
    [employeeId],
  )
  res.json({
    items: result.rows,
    total: totalResult.rows[0].total,
    summary: {
      total: countResult.rows[0].total,
      draft: countResult.rows[0].draft,
      pending: countResult.rows[0].pending,
      approved: countResult.rows[0].approved,
      rejected: countResult.rows[0].rejected,
      returned: countResult.rows[0].returned,
      cancelled: countResult.rows[0].cancelled,
    },
    years: yearsResult.rows.map((row) => row.year),
  })
}))

app.put('/api/requests/:id/draft', requireAuth, upload.array('attachments', 5), asyncRoute(async (req, res) => {
  requireEmployee(req.user)
  const reason = String(req.body?.reason || '').trim()
  const address = String(req.body?.address || '').trim()
  const phone = String(req.body?.phone || '').trim()
  if (reason.length < 10) throw new HttpError(400, 'Alasan cuti wajib diisi, minimal 10 karakter.')
  if (address.length < 10) throw new HttpError(400, 'Alamat selama cuti wajib diisi, minimal 10 karakter.')
  if (!/^[0-9+]{8,20}$/.test(phone)) throw new HttpError(400, 'Nomor telepon harus berisi 8 sampai 20 angka atau tanda +.')

  // Daftar lampiran lama yang dipertahankan (JSON string dari FormData).
  let keepIds = []
  if (req.body?.keepAttachmentIds) {
    try {
      const parsed = JSON.parse(req.body.keepAttachmentIds)
      if (Array.isArray(parsed)) keepIds = parsed.map(id => String(id))
    } catch (_) {
      throw new HttpError(400, 'Daftar lampiran yang dipertahankan tidak valid.')
    }
  }
  const savedFiles = []
  const removedFiles = []
  let result
  try {
    result = await transaction(async (client) => {
    const currentResult = await client.query(
      `SELECT * FROM cuti.leave_requests WHERE id = $1 FOR UPDATE`,
      [req.params.id],
    )
    const current = currentResult.rows[0]
    if (!current) throw new HttpError(404, 'Pengajuan tidak ditemukan.')
    if (String(current.employee_id) !== String(req.user.employee.id)) {
      throw new HttpError(403, 'Anda hanya dapat mengubah draf milik sendiri.')
    }
    if (String(current.status) !== 'DRAFT') {
      throw new HttpError(409, 'Hanya pengajuan berstatus draf yang dapat diubah.')
    }
    const workingDays = Number(req.body?.workingDays)
    const context = await getRequestContext(
      client,
      req.user,
      String(req.body?.leaveTypeCode || ''),
      String(req.body?.startDate || ''),
      workingDays,
    )
    await client.query(
      `UPDATE cuti.leave_requests
       SET leave_type_id = $2, leave_policy_id = $3, route_id = $4, calendar_version_id = $5,
           start_date = $6, end_date = $7, requested_working_days = $8,
           reason = $9, address_during_leave = $10, phone = $11,
           is_annual_leave = $12, balance_period_year = $13,
           balance_snapshot = $14::jsonb, calculation_snapshot = $15::jsonb,
           updated_at = now()
       WHERE id = $1`,
      [
        current.id,
        context.type.id,
        context.type.policy_id,
        context.route.id,
        context.calendar.id,
        context.startDate,
        context.endDate,
        workingDays,
        reason,
        address,
        phone,
        context.type.deducts_annual_balance,
        context.balanceYear,
        JSON.stringify(context.balance || {}),
        JSON.stringify({ days: context.days }),
      ],
    )
    await client.query(`DELETE FROM cuti.leave_request_days WHERE leave_request_id = $1`, [current.id])
    for (const day of context.days) {
      await client.query(
        `INSERT INTO cuti.leave_request_days
           (leave_request_id, leave_date, day_index, day_class, is_counted, calendar_date_id, note)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [current.id, day.date, day.dayIndex, day.dayClass, day.counted, day.calendarDateId, day.note],
      )
    }
    // Lampiran lama yang tidak dipertahankan dihapus (soft delete).
    const existingAttachments = await client.query(
      `SELECT id, storage_key FROM cuti.leave_attachments
       WHERE leave_request_id = $1 AND deleted_at IS NULL`,
      [current.id],
    )
    for (const oldFile of existingAttachments.rows) {
      if (!keepIds.includes(String(oldFile.id))) {
        await client.query(
          `UPDATE cuti.leave_attachments
           SET deleted_at = now(), deleted_by = $2, deletion_reason = $3
           WHERE id = $1`,
          [oldFile.id, req.user.id, 'Dihapus pemilik saat menyunting draf.'],
        )
        removedFiles.push(oldFile.storage_key)
      }
    }

    // Validasi & simpan lampiran baru.
    const files = req.files || []
    for (const file of files) {
      const validated = await validateUpload(file.buffer, 'ATTACHMENT', file.originalname)
      // Dedup berdasarkan sha256 pada request yang sama.
      const duplicate = await client.query(
        `SELECT 1 FROM cuti.leave_attachments
         WHERE leave_request_id = $1 AND deleted_at IS NULL AND sha256 = $2 LIMIT 1`,
        [current.id, validated.sha256],
      )
      if (duplicate.rowCount) {
        throw new HttpError(400, `File duplikat terdeteksi: ${validated.filename}.`)
      }
      const target = safeStoragePath(validated.storageKey)
      await mkdir(path.dirname(target), { recursive: true })
      await writeFile(target, file.buffer, { flag: 'wx' })
      savedFiles.push(target)
      await client.query(
        `INSERT INTO cuti.leave_attachments
           (leave_request_id, uploaded_by, document_type, original_filename,
            storage_key, detected_mime, file_size, sha256)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [current.id, req.user.id, context.type.code, validated.filename,
          validated.storageKey, validated.mime, validated.size, validated.sha256],
      )
    }

    // Pastikan jumlah lampiran minimal terpenuhi (lama yang dipertahankan + baru).
    if (context.type.requires_attachment) {
      const keptCount = keepIds.filter(id => existingAttachments.rows.some(row => String(row.id) === id)).length
      const totalAttachments = keptCount + files.length
      if (totalAttachments < Number(context.type.attachment_min_count || 0)) {
        throw new HttpError(400, `Jenis cuti ini memerlukan minimal ${context.type.attachment_min_count} lampiran.`)
      }
    }

    await client.query(
      `INSERT INTO cuti.leave_request_events
         (leave_request_id, event_type, from_status, to_status, description,
          actor_user_id, actor_role_code, payload)
       VALUES ($1,'STATUS_CHANGED','DRAFT','DRAFT','Draf diperbarui.',$2,'EMPLOYEE',$3::jsonb)`,
      [current.id, req.user.id, JSON.stringify({
        leaveTypeCode: context.type.code,
        startDate: context.startDate,
        endDate: context.endDate,
        workingDays,
        attachmentsAdded: files.length,
        attachmentsRemoved: removedFiles.length,
      })],
    )
    return {
      id: current.id,
      requestNumber: current.request_number,
      status: 'DRAFT',
      endDate: context.endDate,
      workingDays,
    }
    })
  } catch (error) {
    // Rollback DB sudah dilakukan transaction(); bersihkan file baru yang gagal tersimpan.
    await Promise.all(savedFiles.map(key => unlink(key).catch(() => undefined)))
    throw error
  }
  // File lama yang dihapus: hapus dari storage setelah commit berhasil.
  await Promise.all(removedFiles.map(key => unlink(safeStoragePath(key)).catch(() => undefined)))
  res.json({ request: result })
}))

app.post('/api/requests/:id/submit', requireAuth, asyncRoute(async (req, res) => {
  requireEmployee(req.user)
  const result = await transaction(async (client) => {
    const requestResult = await client.query(
      `SELECT r.*, r.start_date::text AS start_date_text, lt.code AS leave_type_code
       FROM cuti.leave_requests r
       JOIN cuti.leave_types lt ON lt.id = r.leave_type_id
       WHERE r.id = $1 FOR UPDATE`,
      [req.params.id],
    )
    const request = requestResult.rows[0]
    if (!request) throw new HttpError(404, 'Pengajuan tidak ditemukan.')
    if (String(request.employee_id) !== String(req.user.employee.id)) {
      throw new HttpError(403, 'Anda hanya dapat mengirim draf milik sendiri.')
    }
    if (String(request.status) !== 'DRAFT') {
      throw new HttpError(409, 'Hanya pengajuan berstatus draf yang dapat dikirim.')
    }
    const startDate = String(request.start_date_text || '').slice(0, 10)
    const workingDays = Number(request.requested_working_days)
    const context = await getRequestContext(
      client, req.user, request.leave_type_code, startDate, workingDays,
    )
    await submitLeaveRequest(client, req, request, context, workingDays)
    return {
      id: request.id,
      requestNumber: request.request_number,
      status: 'SUBMITTED',
      endDate: context.endDate,
      workingDays,
    }
  })
  res.json({ request: result })
}))

app.get('/api/requests/export.csv', requireAuth, asyncRoute(async (req, res) => {
  requireEmployee(req.user)
  const { where, values } = buildHistoryQuery(req.query, req.user.employee.id)
  const result = await pool.query(
    `SELECT r.request_number, lt.name AS leave_type_name,
            r.start_date::text, r.end_date::text, r.requested_working_days,
            r.status, r.submitted_at
     FROM cuti.leave_requests r
     JOIN cuti.leave_types lt ON lt.id = r.leave_type_id
     WHERE ${where}
     ORDER BY r.created_at DESC, r.id DESC`,
    values,
  )
  const columns = ['Nomor Pengajuan', 'Jenis Cuti', 'Tanggal Mulai', 'Tanggal Selesai', 'Hari Kerja', 'Status', 'Dikirim']
  const csvCell = (value) => {
    const text = value === null || value === undefined ? '' : String(value)
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
  }
  const lines = [columns.join(','), ...result.rows.map((row) => [
    row.request_number, row.leave_type_name, row.start_date, row.end_date,
    row.requested_working_days, row.status, row.submitted_at,
  ].map(csvCell).join(','))]
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="Riwayat-Cuti-${req.user.username}-${new Date().toISOString().slice(0, 10)}.csv"`)
  res.send(`\ufeff${lines.join('\r\n')}`)
}))

app.get('/api/queue', requireAuth, asyncRoute(async (req, res) => {
  const scope = queueScope(req.user)
  const result = await pool.query(
    `SELECT q.stage_id, q.leave_request_id AS id, q.stage_code, q.role_code,
            q.due_at, q.is_overdue, q.request_number, q.request_status,
            q.employee_id, q.employee_name, q.employee_category,
            q.employee_unit_id, q.employee_unit_name, q.start_date, q.end_date,
            q.requested_working_days, q.submitted_at, s.decision_mode, lt.name AS leave_type_name
     FROM cuti.v_pending_approval_queue q
     JOIN cuti.leave_request_stages s ON s.id = q.stage_id
     JOIN cuti.leave_types lt ON lt.id = q.leave_type_id
     WHERE ${scope.sql}
     ORDER BY q.is_overdue DESC, q.submitted_at ASC NULLS LAST`,
    scope.values,
  )
  res.json({ items: result.rows })
}))

app.get('/api/approvals', requireAuth, asyncRoute(async (req, res) => {
  const roles = roleCodes(req.user).filter(role =>
    ['ADMIN', 'HR_ANALYST', 'KASUBAG', 'KEPSTA', 'PPK'].includes(role),
  )
  if (!roles.length) throw new HttpError(403, 'Akun ini tidak memiliki antrean persetujuan.')
  const values = [roles]
  const clauses = ['s.role_code = ANY($1::varchar[])']
  const placeholder = (value) => {
    values.push(value)
    return `$${values.length}`
  }
  if (hasRole(req.user, 'KASUBAG')) {
    const unitId = unitScope(req.user)
    if (!unitId) throw new HttpError(403, 'Lingkup unit Kasubag belum diatur.')
    clauses.push(`r.employee_unit_id IN (
      WITH RECURSIVE unit_tree AS (
        SELECT id FROM cuti.organizational_units WHERE id = ${placeholder(unitId)}
        UNION ALL
        SELECT child.id FROM cuti.organizational_units child
        JOIN unit_tree parent ON child.parent_id = parent.id
      ) SELECT id FROM unit_tree
    )`)
  }
  if (hasRole(req.user, 'PPK')) clauses.push(`r.employee_category = 'KONTRAK'`)
  if (hasRole(req.user, 'KEPSTA')) clauses.push(`r.employee_category <> 'KONTRAK'`)
  clauses.push(`(s.assignee_user_id IS NULL OR s.assignee_user_id = ${placeholder(req.user.id)})`)

  const result = await pool.query(
    `WITH latest AS (
       SELECT s.* FROM cuti.leave_request_stages s
       WHERE s.attempt_no = (
         SELECT max(attempt_no) FROM cuti.leave_request_stages x
         WHERE x.leave_request_id = s.leave_request_id
       )
     )
     SELECT s.id AS stage_id, r.id, s.stage_code, s.role_code, s.decision_mode,
            s.status AS stage_status, s.due_at, s.completed_at,
            r.status AS request_status, r.decision, r.request_number,
            r.employee_id, r.employee_name, r.employee_category, r.employee_unit_id, r.employee_unit_name,
            r.start_date, r.end_date, r.requested_working_days, r.submitted_at,
            lt.name AS leave_type_name
     FROM latest s
     JOIN cuti.leave_requests r ON r.id = s.leave_request_id
     JOIN cuti.leave_types lt ON lt.id = r.leave_type_id
     WHERE ${clauses.join(' AND ')} AND s.status IN ('ACTIVE', 'COMPLETED')
     ORDER BY CASE WHEN s.status = 'ACTIVE' THEN 0 ELSE 1 END,
              s.due_at ASC NULLS LAST, r.submitted_at DESC NULLS LAST
     LIMIT 500`,
    values,
  )

  const items = result.rows.map((row) => {
    let status = 'pending'
    if (row.stage_status === 'COMPLETED') {
      status = (row.decision === 'REJECTED' || row.request_status === 'REJECTED') ? 'rejected' : 'approved'
    }
    return {
      stageId: row.stage_id,
      id: row.id,
      stageCode: row.stage_code,
      roleCode: row.role_code,
      decisionMode: row.decision_mode,
      status,
      requestStatus: row.request_status,
      decision: row.decision || null,
      requestNumber: row.request_number,
      employeeId: row.employee_id,
      employeeName: row.employee_name,
      employeeCategory: row.employee_category,
      employeeUnitId: row.employee_unit_id,
      employeeUnitName: row.employee_unit_name,
      startDate: row.start_date,
      endDate: row.end_date,
      requestedWorkingDays: row.requested_working_days,
      submittedAt: row.submitted_at,
      completedAt: row.completed_at,
      dueAt: row.due_at,
      isOverdue: Boolean(row.due_at && row.stage_status === 'ACTIVE' && new Date(row.due_at) < new Date()),
      leaveTypeName: row.leave_type_name,
    }
  })
  const pendingItems = items.filter(item => item.status === 'pending')
  const now = new Date()
  const isToday = (value) => {
    if (!value) return false
    const date = new Date(value)
    if (Number.isNaN(date.valueOf())) return false
    const nowUTC = new Date(Date.now())
    return date.getUTCFullYear() === nowUTC.getUTCFullYear()
      && date.getUTCMonth() === nowUTC.getUTCMonth()
      && date.getUTCDate() === nowUTC.getUTCDate()
  }
  const summary = {
    pending: pendingItems.length,
    approved: items.filter(item => item.status === 'approved').length,
    rejected: items.filter(item => item.status === 'rejected').length,
    forward: pendingItems.filter(item => item.decisionMode === 'FORWARD').length,
    final: pendingItems.filter(item => item.decisionMode === 'FINAL').length,
    overdue: pendingItems.filter(item => item.isOverdue).length,
    today: pendingItems.filter(item => isToday(item.submittedAt)).length,
    leaveTypes: new Set(pendingItems.map(item => item.leaveTypeName).filter(Boolean)).size,
    units: new Set(pendingItems.map(item => item.employeeUnitName).filter(Boolean)).size,
  }
  const filter = String(req.query.status || '')
  let filteredItems
  if (filter === 'approved') filteredItems = items.filter(item => item.status === 'approved')
  else if (filter === 'rejected') filteredItems = items.filter(item => item.status === 'rejected')
  else if (filter === 'all') filteredItems = items
  else filteredItems = pendingItems
  res.json({ items: filteredItems, summary })
}))

async function submitLeaveRequest(client, req, request, context, workingDays) {
  const requestNumber = request.request_number
  await client.query(
    `UPDATE cuti.leave_requests
     SET status = 'SUBMITTED', submitted_at = now(), updated_at = now()
     WHERE id = $1`,
    [request.id],
  )
  const steps = await client.query(
    `SELECT step.id, step.step_no, step.stage_code, step.role_code,
            step.unit_scope, step.decision_mode, step.is_final, step.sla_hours
     FROM cuti.approval_route_steps step
     WHERE step.route_id = $1
     ORDER BY step.step_no`,
    [context.route.id],
  )
  for (const [index, step] of steps.rows.entries()) {
    await client.query(
      `INSERT INTO cuti.leave_request_stages (
         leave_request_id, route_step_id, step_no, stage_code, role_code,
         unit_scope, decision_mode, is_final, status, sla_hours,
         activated_at, due_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
         CASE WHEN $9::varchar = 'ACTIVE' THEN now() END,
         CASE WHEN $9::varchar = 'ACTIVE' THEN now() + make_interval(hours => $11::int) END
       )`,
      [
        request.id,
        step.id,
        step.step_no,
        step.stage_code,
        step.role_code,
        step.unit_scope,
        step.decision_mode,
        step.is_final,
        index === 0 ? 'ACTIVE' : 'PENDING',
        step.sla_hours,
        step.sla_hours,
      ],
    )
  }
  if (context.type.deducts_annual_balance) {
    const balance = await client.query(
      `SELECT id, available_days FROM cuti.leave_balances
       WHERE employee_id = $1 AND leave_type_id = $2 AND period_year = $3
       FOR UPDATE`,
      [context.employee.id, context.type.id, context.balanceYear],
    )
    if (!balance.rowCount) throw new HttpError(409, 'Saldo cuti tahunan belum dialokasikan untuk periode ini.')
    if (Number(balance.rows[0].available_days) < Number(workingDays)) {
      throw new HttpError(409, `Saldo tidak cukup. Tersedia ${balance.rows[0].available_days} hari.`)
    }
    await client.query(
      `INSERT INTO cuti.leave_balance_transactions (
         balance_id, leave_request_id, transaction_type, reserved_delta,
         reason, created_by_user_id, idempotency_key
       ) VALUES ($1,$2,'RESERVATION',$3,'Reservasi saat pengajuan dikirim',$4,$5)`,
      [
        balance.rows[0].id,
        request.id,
        workingDays,
        req.user.id,
        `RESERVE:${request.id}:1`,
      ],
    )
  }
  await client.query(
    `INSERT INTO cuti.leave_request_events (
       leave_request_id, event_type, from_status, to_status, stage_code,
       description, actor_user_id, actor_role_code
     ) VALUES ($1,'SUBMITTED','DRAFT','SUBMITTED','ADMIN_REVIEW',
               'Pengajuan dikirim dan masuk antrean Admin.',$2,'EMPLOYEE')`,
    [request.id, req.user.id],
  )
  await writeAudit(client, req, 'LEAVE_SUBMITTED', 'LEAVE_REQUEST', request.id, null, {
    request_number: requestNumber,
    status: 'SUBMITTED',
    leaveTypeCode: context.type.code,
    startDate: context.startDate,
    endDate: context.endDate,
    workingDays,
  })
  await notifyRequestLifecycle(client, {
    eventType: 'SUBMITTED',
    request: {
      id: request.id,
      request_number: requestNumber,
      employee_name: req.user.fullName,
    },
    actor: req.user,
  })
}

app.post('/api/requests', requireAuth, upload.array('attachments', 5), asyncRoute(async (req, res) => {
  requireEmployee(req.user)
  const startDate = String(req.body.startDate || '')
  const workingDays = Number(req.body.workingDays)
  const submit = req.body.submit === 'true'
  const reason = String(req.body.reason || '').trim()
  const address = String(req.body.address || '').trim()
  const phone = String(req.body.phone || '').trim()
  if (reason.length < 10) throw new HttpError(400, 'Alasan cuti wajib diisi, minimal 10 karakter.')
  if (address.length < 10) throw new HttpError(400, 'Alamat selama cuti wajib diisi, minimal 10 karakter.')
  if (!/^[0-9+]{8,20}$/.test(phone)) throw new HttpError(400, 'Nomor telepon harus berisi 8 sampai 20 angka atau tanda +.')

  const client = await pool.connect()
  const savedFiles = []
  let committed = false
  try {
    await client.query('BEGIN')
    const context = await getRequestContext(
      client,
      req.user,
      String(req.body.leaveTypeCode || ''),
      startDate,
      workingDays,
    )
    const files = req.files || []
    if (context.type.requires_attachment && files.length < context.type.attachment_min_count) {
      throw new HttpError(400, `Jenis cuti ini memerlukan minimal ${context.type.attachment_min_count} lampiran.`)
    }
    const attachments = []
    const seenHashes = new Set()
    for (const file of files) {
      const validated = await validateUpload(file.buffer, 'ATTACHMENT', file.originalname)
      if (seenHashes.has(validated.sha256)) {
        throw new HttpError(400, `File duplikat terdeteksi: ${validated.filename}.`)
      }
      seenHashes.add(validated.sha256)
      const target = safeStoragePath(validated.storageKey)
      await mkdir(path.dirname(target), { recursive: true })
      await writeFile(target, file.buffer, { flag: 'wx' })
      savedFiles.push(target)
      attachments.push({
        key: validated.storageKey,
        filename: validated.filename,
        mime: validated.mime,
        size: validated.size,
        sha: validated.sha256,
      })
    }

    if (submit && context.type.deducts_annual_balance) {
      if (!context.balance) throw new HttpError(409, 'Saldo cuti tahunan belum dialokasikan untuk periode ini.')
      if (Number(context.balance.available_days) < workingDays) {
        throw new HttpError(409, `Saldo tidak cukup. Tersedia ${context.balance.available_days} hari.`)
      }
    }

    const pattern = await requestPattern(client)
    const requestNumber = (
      await client.query(
        `SELECT cuti.fn_next_document_number(NULL, NULL, $1::smallint, 'REQUEST_NUMBER', $2::varchar) AS number`,
        [Number(context.startDate.slice(0, 4)), pattern],
      )
    ).rows[0].number
    const annual = context.type.deducts_annual_balance
    const history = await client.query(
      `SELECT count(*)::integer AS total
       FROM cuti.leave_requests WHERE employee_id = $1`,
      [context.employee.id],
    )
    const requestResult = await client.query(
      `INSERT INTO cuti.leave_requests (
         request_number, employee_id, employee_category, employee_name,
         employee_identity_type, employee_identity_number, employee_unit_id,
         employee_unit_name, employee_position_name, employee_profession,
         employee_join_date, leave_type_id, leave_policy_id, route_id,
         calendar_version_id, start_date, end_date, requested_working_days,
         reason, address_during_leave, phone, is_annual_leave,
         balance_period_year, balance_snapshot, leave_history_snapshot,
         calculation_snapshot, created_by_user_id
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
         $16,$17,$18,$19,$20,$21,$22,$23,$24::jsonb,$25::jsonb,$26::jsonb,$27
       )
       RETURNING id, request_number, status`,
      [
        requestNumber,
        context.employee.id,
        context.employee.employment_category,
        context.employee.full_name,
        context.employee.employment_category === 'KONTRAK' ? 'NIK' : 'NIP',
        context.employee.nik || context.employee.nip,
        context.employee.organizational_unit_id,
        context.employee.unit_name,
        context.employee.position_name,
        context.employee.profession,
        context.employee.join_date,
        context.type.id,
        context.type.policy_id,
        context.route.id,
        context.calendar.id,
        context.startDate,
        context.endDate,
        context.workingDays,
        reason,
        address,
        phone,
        annual,
        context.balanceYear,
        JSON.stringify(context.balance || {}),
        JSON.stringify({ priorRequests: history.rows[0].total }),
        JSON.stringify({ days: context.days }),
        req.user.id,
      ],
    )
    const request = requestResult.rows[0]

    for (const day of context.days) {
      await client.query(
        `INSERT INTO cuti.leave_request_days
           (leave_request_id, leave_date, day_index, day_class, is_counted, calendar_date_id, note)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [request.id, day.date, day.dayIndex, day.dayClass, day.counted, day.calendarDateId, day.note],
      )
    }
    for (const file of attachments) {
      await client.query(
        `INSERT INTO cuti.leave_attachments
           (leave_request_id, uploaded_by, document_type, original_filename,
            storage_key, detected_mime, file_size, sha256)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [request.id, req.user.id, context.type.code, file.filename, file.key, file.mime, file.size, file.sha],
      )
    }
    await client.query(
      `INSERT INTO cuti.leave_request_events
         (leave_request_id, event_type, from_status, to_status, description,
          actor_user_id, actor_role_code)
       VALUES ($1, 'CREATED', NULL, 'DRAFT', 'Pengajuan dibuat sebagai draf.', $2, 'EMPLOYEE')`,
      [request.id, req.user.id],
    )

    if (submit) {
      await submitLeaveRequest(client, req, request, context, workingDays)
    }

    await client.query('COMMIT')
    committed = true
    res.status(201).json({
      request: {
        id: request.id,
        requestNumber,
        status: submit ? 'SUBMITTED' : 'DRAFT',
        endDate: context.endDate,
        workingDays,
      },
    })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
    if (!committed) {
      await Promise.all(savedFiles.map((file) => unlink(file).catch(() => undefined)))
    }
  }
}))

app.get('/api/directory', requireAuth, asyncRoute(async (req, res) => {
  const scope = directoryScope(req.user)
  const year = req.query.year === undefined || req.query.year === ''
    ? new Date().getFullYear()
    : balancePeriodYear(req.query.year)
  const values = [...scope.values]
  const conditions = [scope.sql]
  const add = (value) => {
    values.push(value)
    return `$${values.length}`
  }
  if (req.query.q) {
    const search = `%${String(req.query.q).trim()}%`
    const fullName = add(search)
    const identity = add(search)
    conditions.push(`(d.full_name ILIKE ${fullName} OR COALESCE(d.nip, d.nik, '') ILIKE ${identity})`)
  }
  if (req.query.category) conditions.push(`d.employment_category = ${add(String(req.query.category))}`)
  if (req.query.unitId) conditions.push(`d.organizational_unit_id = ${add(String(req.query.unitId))}`)
  const employmentStatus = String(req.query.employmentStatus || '')
  if (['ACTIVE', 'INACTIVE'].includes(employmentStatus)) {
    conditions.push(`d.employment_status = ${add(employmentStatus)}`)
  }
  const teamId = optionalId(req.query.teamId, 'Tim kerja')
  if (teamId !== null) {
    conditions.push(`EXISTS (
      SELECT 1 FROM cuti.work_team_members wtm
      WHERE wtm.employee_id = d.employee_id AND wtm.work_team_id = ${add(teamId)}
        AND wtm.deleted_at IS NULL AND wtm.effective_from <= current_date
        AND (wtm.effective_to IS NULL OR wtm.effective_to >= current_date)
    )`)
  }
  if (req.query.leaveStatus === 'ON_LEAVE') {
    conditions.push(`EXISTS (
      SELECT 1 FROM cuti.leave_requests r
      WHERE r.employee_id = d.employee_id AND r.status = 'APPROVED'
        AND current_date BETWEEN r.start_date AND r.end_date
    )`)
  } else if (req.query.leaveStatus === 'UPCOMING') {
    conditions.push(`NOT EXISTS (
      SELECT 1 FROM cuti.leave_requests r
      WHERE r.employee_id = d.employee_id AND r.status = 'APPROVED'
        AND current_date BETWEEN r.start_date AND r.end_date
    ) AND EXISTS (
      SELECT 1 FROM cuti.leave_requests r
      WHERE r.employee_id = d.employee_id AND r.status = 'APPROVED'
        AND r.start_date > current_date
    )`)
  } else if (req.query.leaveStatus === 'NONE') {
    conditions.push(`NOT EXISTS (
      SELECT 1 FROM cuti.leave_requests r
      WHERE r.employee_id = d.employee_id AND r.status = 'APPROVED'
        AND r.end_date >= current_date
    )`)
  }
  const yearParam = add(year)
  const base = `
    WITH directory AS (
      SELECT d.*,
        annual_balance.id AS balance_id,
        annual_balance.period_year AS balance_period_year,
        annual_balance.allocated_days AS balance_allocated_days,
        annual_balance.adjustment_days AS balance_adjustment_days,
        annual_balance.carry_over_days AS balance_carry_over_days,
        annual_balance.used_days AS balance_used_days,
        annual_balance.reserved_days AS balance_reserved_days,
        annual_balance.available_days AS balance_available_days,
        current_leave.request_number AS current_leave_request_number,
        current_leave.start_date AS current_leave_start_date,
        current_leave.end_date AS current_leave_end_date,
        CASE
          WHEN EXISTS (
            SELECT 1 FROM cuti.leave_requests r
            WHERE r.employee_id = d.employee_id AND r.status = 'APPROVED'
              AND current_date BETWEEN r.start_date AND r.end_date
          ) THEN 'ON_LEAVE'
          WHEN EXISTS (
            SELECT 1 FROM cuti.leave_requests r
            WHERE r.employee_id = d.employee_id AND r.status = 'APPROVED'
              AND r.start_date > current_date
          ) THEN 'UPCOMING'
          ELSE 'NONE'
        END AS leave_status
      FROM cuti.v_employee_directory d
      LEFT JOIN LATERAL (
        SELECT lb.id, lb.period_year, lb.allocated_days, lb.adjustment_days,
               lb.carry_over_days, lb.used_days, lb.reserved_days, lb.available_days
        FROM cuti.leave_balances lb
        JOIN cuti.leave_types lt ON lt.id = lb.leave_type_id
        WHERE lb.employee_id = d.employee_id
          AND lt.code = 'ANNUAL'
          AND lb.period_year = ${yearParam}
        ORDER BY lb.id DESC
        LIMIT 1
      ) annual_balance ON TRUE
      LEFT JOIN LATERAL (
        SELECT r.request_number, r.start_date::text AS start_date, r.end_date::text AS end_date
        FROM cuti.leave_requests r
        WHERE r.employee_id = d.employee_id AND r.status = 'APPROVED'
          AND r.end_date >= current_date
        ORDER BY (r.start_date <= current_date) DESC, r.start_date
        LIMIT 1
      ) current_leave ON TRUE
      WHERE ${conditions.join(' AND ')}
    )`
  const unitsResult = await pool.query(
    `SELECT DISTINCT d.organizational_unit_id AS id, d.unit_name
     FROM cuti.v_employee_directory d
     WHERE ${scope.sql}
     ORDER BY d.unit_name`,
    scope.values,
  )
  const categoriesResult = await pool.query(
    `SELECT DISTINCT d.employment_category AS code
     FROM cuti.v_employee_directory d
     WHERE ${scope.sql}
     ORDER BY d.employment_category`,
    scope.values,
  )
  const teamsResult = await pool.query(
    `SELECT DISTINCT wt.id, wt.name
     FROM cuti.work_teams wt
     JOIN cuti.work_team_members wtm ON wtm.work_team_id = wt.id AND wtm.deleted_at IS NULL
     JOIN cuti.v_employee_directory d ON d.employee_id = wtm.employee_id
     WHERE wt.is_active AND wt.deleted_at IS NULL
       AND wtm.effective_from <= current_date
       AND (wtm.effective_to IS NULL OR wtm.effective_to >= current_date)
       AND ${scope.sql}
     ORDER BY wt.name`,
    scope.values,
  )
  const countResult = await pool.query(
    `${base}
     SELECT count(*)::integer AS total,
            count(*) FILTER (WHERE leave_status = 'ON_LEAVE')::integer AS on_leave,
            count(*) FILTER (WHERE leave_status = 'UPCOMING')::integer AS upcoming,
            count(DISTINCT organizational_unit_id)::integer AS units,
            COALESCE(sum(balance_available_days), 0)::integer AS available_days
     FROM directory`,
    values,
  )
  const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 50)
  const offset = Math.max(Number(req.query.offset) || 0, 0)
  const limitParam = add(limit)
  const offsetParam = add(offset)
  const rowsResult = await pool.query(
    `${base}
     SELECT employee_id, full_name, nip, nik, employment_category, profession,
            employment_status, organizational_unit_id, unit_name, position_name,
            team_names,
            balance_id, balance_period_year, balance_allocated_days,
            balance_adjustment_days, balance_carry_over_days, balance_used_days,
            balance_reserved_days, balance_available_days,
            leave_status, current_leave_request_number,
            current_leave_start_date, current_leave_end_date,
            (SELECT count(*)::integer FROM cuti.leave_request_days rd
               JOIN cuti.leave_requests r2 ON r2.id = rd.leave_request_id
               JOIN cuti.leave_types lt2 ON lt2.id = r2.leave_type_id
              WHERE r2.employee_id = d.employee_id AND r2.status = 'APPROVED'
                AND rd.is_counted AND lt2.code = 'SICK') AS sick_days_used,
            (SELECT count(*)::integer FROM cuti.leave_request_days rd
               JOIN cuti.leave_requests r2 ON r2.id = rd.leave_request_id
               JOIN cuti.leave_types lt2 ON lt2.id = r2.leave_type_id
              WHERE r2.employee_id = d.employee_id AND r2.status = 'APPROVED'
                AND rd.is_counted AND lt2.code = 'IMPORTANT_REASON') AS important_reason_days_used
     FROM directory d
     ORDER BY full_name
     LIMIT ${limitParam} OFFSET ${offsetParam}`,
    values,
  )
  const yearsResult = await pool.query(
    `SELECT DISTINCT period_year FROM cuti.leave_balances ORDER BY period_year DESC`,
  )
  const items = rowsResult.rows.map((row) => ({
    employeeId: row.employee_id,
    fullName: row.full_name,
    identity: row.nip || row.nik || '',
    category: row.employment_category,
    profession: row.profession,
    employmentStatus: row.employment_status,
    unitId: row.organizational_unit_id,
    unitName: row.unit_name,
    teamNames: row.team_names || '',
    positionName: row.position_name,
    balanceId: row.balance_id,
    allocatedDays: row.balance_allocated_days,
    adjustmentDays: row.balance_adjustment_days,
    carryOverDays: row.balance_carry_over_days,
    usedDays: row.balance_used_days,
    reservedDays: row.balance_reserved_days,
    availableDays: row.balance_available_days,
    periodYear: row.balance_period_year,
    sickDaysUsed: row.sick_days_used,
    importantReasonDaysUsed: row.important_reason_days_used,
    leaveStatus: row.leave_status,
    currentLeave: row.current_leave_request_number
      ? {
          requestNumber: row.current_leave_request_number,
          startDate: row.current_leave_start_date,
          endDate: row.current_leave_end_date,
        }
      : null,
  }))
  const yearSet = new Set(yearsResult.rows.map((row) => Number(row.period_year)))
  yearSet.add(new Date().getFullYear())
  yearSet.add(new Date().getFullYear() + 1)
  yearSet.add(year)
  res.json({
    items,
    summary: countResult.rows[0],
    units: unitsResult.rows,
    categories: categoriesResult.rows,
    teams: teamsResult.rows,
    years: [...yearSet].sort((a, b) => b - a),
    periodYear: year,
  })
}))

app.get('/api/directory/:employeeId', requireAuth, asyncRoute(async (req, res) => {
  const employeeId = positiveId(req.params.employeeId, 'Pegawai')
  const year = req.query.year === undefined || req.query.year === ''
    ? new Date().getFullYear()
    : balancePeriodYear(req.query.year)
  const scope = directoryScope(req.user)
  const values = [...scope.values]
  const add = (value) => {
    values.push(value)
    return `$${values.length}`
  }
  const employeeParam = add(employeeId)
  const employeeResult = await pool.query(
    `SELECT d.employee_id, d.full_name, d.nip, d.nik, d.employment_category,
            d.profession, d.employment_status, d.organizational_unit_id,
            d.unit_name, d.position_name, d.team_names,
            current_leave.request_number AS current_leave_request_number,
            current_leave.start_date AS current_leave_start_date,
            current_leave.end_date AS current_leave_end_date,
            CASE
              WHEN EXISTS (
                SELECT 1 FROM cuti.leave_requests r
                WHERE r.employee_id = d.employee_id AND r.status = 'APPROVED'
                  AND current_date BETWEEN r.start_date AND r.end_date
              ) THEN 'ON_LEAVE'
              WHEN EXISTS (
                SELECT 1 FROM cuti.leave_requests r
                WHERE r.employee_id = d.employee_id AND r.status = 'APPROVED'
                  AND r.start_date > current_date
              ) THEN 'UPCOMING'
              ELSE 'NONE'
            END AS leave_status
     FROM cuti.v_employee_directory d
     LEFT JOIN LATERAL (
       SELECT r.request_number, r.start_date::text AS start_date, r.end_date::text AS end_date
       FROM cuti.leave_requests r
       WHERE r.employee_id = d.employee_id AND r.status = 'APPROVED'
         AND r.end_date >= current_date
       ORDER BY (r.start_date <= current_date) DESC, r.start_date
       LIMIT 1
     ) current_leave ON TRUE
     WHERE d.employee_id = ${employeeParam} AND ${scope.sql}`,
    values,
  )
  if (!employeeResult.rowCount) {
    throw new HttpError(404, 'Pegawai tidak ditemukan atau di luar cakupan akses Anda.')
  }
  const balanceResult = await pool.query(
    `SELECT b.id AS balance_id, b.period_year, b.allocated_days, b.adjustment_days,
            b.carry_over_days, b.used_days, b.reserved_days, b.available_days
     FROM cuti.leave_balances b
     JOIN cuti.leave_types lt ON lt.id = b.leave_type_id
     WHERE b.employee_id = $1 AND lt.code = 'ANNUAL' AND b.period_year = $2`,
    [employeeId, year],
  )
  const balanceRow = balanceResult.rows[0]
  const canAdjust = hasRole(req.user, 'ADMIN')
  const ledger = balanceRow && canAdjust ? await loadBalanceLedger(balanceRow.balance_id) : []
  const employee = employeeResult.rows[0]
  res.json({
    employee: {
      employeeId: employee.employee_id,
      fullName: employee.full_name,
      identity: employee.nip || employee.nik || '',
      category: employee.employment_category,
      profession: employee.profession,
      employmentStatus: employee.employment_status,
      unitId: employee.organizational_unit_id,
      unitName: employee.unit_name,
      positionName: employee.position_name,
      teamNames: employee.team_names || '',
      leaveStatus: employee.leave_status,
      currentLeave: employee.current_leave_request_number
        ? {
            requestNumber: employee.current_leave_request_number,
            startDate: employee.current_leave_start_date,
            endDate: employee.current_leave_end_date,
          }
        : null,
    },
    balance: balanceRow
      ? {
          balanceId: balanceRow.balance_id,
          periodYear: balanceRow.period_year,
          allocatedDays: balanceRow.allocated_days,
          adjustmentDays: balanceRow.adjustment_days,
          carryOverDays: balanceRow.carry_over_days,
          usedDays: balanceRow.used_days,
          reservedDays: balanceRow.reserved_days,
          availableDays: balanceRow.available_days,
        }
      : null,
    ledger,
    periodYear: year,
    canAdjust,
  })
}))

app.get('/api/admin/teams', requireAuth, asyncRoute(async (req, res) => {
  requireAdmin(req.user)
  const [teams, employees, units] = await Promise.all([
    pool.query(
      `SELECT wt.id, wt.code, wt.name, wt.unit_id, ou.name AS unit_name,
              wt.description, wt.is_active, wt.created_at, wt.updated_at,
              (SELECT count(*)::integer FROM cuti.work_team_members wtm
               WHERE wtm.work_team_id = wt.id AND wtm.deleted_at IS NULL) AS member_count,
              (SELECT COALESCE(array_agg(wtm.employee_id ORDER BY wtm.employee_id), '{}'::bigint[])
               FROM cuti.work_team_members wtm
               WHERE wtm.work_team_id = wt.id AND wtm.deleted_at IS NULL) AS member_ids
       FROM cuti.work_teams wt
       LEFT JOIN cuti.organizational_units ou ON ou.id = wt.unit_id
       WHERE wt.deleted_at IS NULL
       ORDER BY wt.name`,
    ),
    pool.query(
      `SELECT e.id, e.full_name, e.employment_category, e.employment_status,
              a.unit_name
       FROM cuti.employees e
       LEFT JOIN cuti.v_employee_current_assignment a ON a.employee_id = e.id
       WHERE e.deleted_at IS NULL AND e.employment_status = 'ACTIVE'
       ORDER BY e.full_name`,
    ),
    pool.query(`SELECT id, name FROM cuti.organizational_units WHERE deleted_at IS NULL ORDER BY name`),
  ])
  res.json({ items: teams.rows, employees: employees.rows, units: units.rows })
}))

app.post('/api/admin/teams', requireAuth, asyncRoute(async (req, res) => {
  requireAdmin(req.user)
  const code = String(req.body?.code || '').trim().toUpperCase()
  const name = String(req.body?.name || '').trim()
  const description = String(req.body?.description || '').trim() || null
  const unitId = optionalId(req.body?.unitId, 'Unit tim')
  if (!/^[A-Z0-9._-]{3,30}$/.test(code)) throw new HttpError(400, 'Kode tim harus 3-30 karakter: huruf, angka, titik, underscore, dash.')
  if (name.length < 3) throw new HttpError(400, 'Nama tim minimal 3 karakter.')
  const result = await transaction(async (client) => {
    const created = await client.query(
      `INSERT INTO cuti.work_teams (code, name, unit_id, description)
       VALUES ($1,$2,$3,$4) RETURNING id, code, name`,
      [code, name, unitId, description],
    )
    await writeAudit(client, req, 'TEAM_CREATED', 'WORK_TEAM', created.rows[0].id, null, { code, name, unitId })
    return created.rows[0]
  })
  res.status(201).json({ team: result })
}))

app.put('/api/admin/teams/:id', requireAuth, asyncRoute(async (req, res) => {
  requireAdmin(req.user)
  const id = positiveId(req.params.id, 'ID tim')
  const name = String(req.body?.name || '').trim()
  const description = String(req.body?.description || '').trim() || null
  const unitId = optionalId(req.body?.unitId, 'Unit tim')
  if (name.length < 3) throw new HttpError(400, 'Nama tim minimal 3 karakter.')
  const result = await transaction(async (client) => {
    const currentResult = await client.query(
      `SELECT * FROM cuti.work_teams WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [id],
    )
    const current = currentResult.rows[0]
    if (!current) throw new HttpError(404, 'Tim kerja tidak ditemukan.')
    await client.query(
      `UPDATE cuti.work_teams
       SET name = $2, unit_id = $3, description = $4, updated_at = now()
       WHERE id = $1`,
      [id, name, unitId, description],
    )
    await writeAudit(client, req, 'TEAM_UPDATED', 'WORK_TEAM', id,
      { name: current.name, unitId: current.unit_id, description: current.description },
      { name, unitId, description })
    return { id: current.id, code: current.code, name, unitId }
  })
  res.json({ team: result })
}))

app.patch('/api/admin/teams/:id/toggle', requireAuth, asyncRoute(async (req, res) => {
  requireAdmin(req.user)
  const id = positiveId(req.params.id, 'ID tim')
  const isActive = req.body?.isActive
  if (typeof isActive !== 'boolean') throw new HttpError(400, 'Status aktif tidak valid.')
  await transaction(async (client) => {
    const currentResult = await client.query(
      `SELECT id, is_active FROM cuti.work_teams WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [id],
    )
    const current = currentResult.rows[0]
    if (!current) throw new HttpError(404, 'Tim kerja tidak ditemukan.')
    await client.query(`UPDATE cuti.work_teams SET is_active = $2, updated_at = now() WHERE id = $1`, [id, isActive])
    await writeAudit(client, req, isActive ? 'TEAM_ACTIVATED' : 'TEAM_DEACTIVATED', 'WORK_TEAM', id,
      { isActive: current.is_active }, { isActive })
  })
  res.json({ ok: true })
}))

app.put('/api/admin/teams/:id/members', requireAuth, asyncRoute(async (req, res) => {
  requireAdmin(req.user)
  const id = positiveId(req.params.id, 'ID tim')
  const employeeIds = Array.isArray(req.body?.employeeIds) ? req.body.employeeIds : []
  const cleanIds = [...new Set(employeeIds.map((value) => positiveId(value, 'ID anggota tim')))]
  await transaction(async (client) => {
    const teamResult = await client.query(
      `SELECT id, name FROM cuti.work_teams WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [id],
    )
    if (!teamResult.rowCount) throw new HttpError(404, 'Tim kerja tidak ditemukan.')
    if (cleanIds.length) {
      const employees = await client.query(
        `SELECT count(*)::integer AS total FROM cuti.employees
         WHERE deleted_at IS NULL AND id = ANY($1::bigint[])`,
        [cleanIds],
      )
      if (Number(employees.rows[0].total) !== cleanIds.length) {
        throw new HttpError(400, 'Sebagian anggota tim tidak ditemukan atau sudah dihapus.')
      }
    }
    const before = await client.query(
      `SELECT employee_id FROM cuti.work_team_members WHERE work_team_id = $1 AND deleted_at IS NULL ORDER BY employee_id`,
      [id],
    )
    await client.query(`DELETE FROM cuti.work_team_members WHERE work_team_id = $1`, [id])
    for (const employeeId of cleanIds) {
      await client.query(
        `INSERT INTO cuti.work_team_members (work_team_id, employee_id, effective_from)
         VALUES ($1,$2,current_date)`,
        [id, employeeId],
      )
    }
    await writeAudit(client, req, 'TEAM_MEMBERS_UPDATED', 'WORK_TEAM', id,
      { employeeIds: before.rows.map((row) => row.employee_id) },
      { employeeIds: cleanIds })
  })
  res.json({ ok: true, employeeIds: cleanIds })
}))

function balancePeriodYear(value) {
  const year = Number(value)
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new HttpError(400, 'Tahun periode tidak valid.')
  }
  return year
}

function mapBalanceRow(row) {
  return {
    employeeId: row.employee_id,
    fullName: row.full_name,
    identity: row.nip || row.nik || '',
    category: row.employment_category,
    employmentStatus: row.employment_status,
    unitId: row.unit_id,
    unitName: row.unit_name,
    positionName: row.position_name,
    balanceId: row.balance_id,
    periodYear: row.period_year,
    allocatedDays: row.allocated_days,
    adjustmentDays: row.adjustment_days,
    carryOverDays: row.carry_over_days,
    usedDays: row.used_days,
    reservedDays: row.reserved_days,
    availableDays: row.available_days,
    lastAdjustmentAt: row.last_adjustment_at,
  }
}

function buildBalanceFilters(query, add) {
  const conditions = ['e.deleted_at IS NULL']
  const search = String(query.q || '').trim()
  if (search) {
    const param = add(`%${search}%`)
    conditions.push(`(
      e.full_name ILIKE ${param}
      OR COALESCE(e.nip, '') ILIKE ${param}
      OR COALESCE(e.nik, '') ILIKE ${param}
    )`)
  }
  const category = String(query.category || '').trim()
  if (employmentCategories.includes(category)) {
    conditions.push(`e.employment_category = ${add(category)}`)
  }
  const unitId = optionalId(query.unitId, 'Unit kerja')
  if (unitId !== null) conditions.push(`a.organizational_unit_id = ${add(unitId)}`)
  const status = String(query.status || '').trim()
  if (['ACTIVE', 'INACTIVE'].includes(status)) {
    conditions.push(`e.employment_status = ${add(status)}`)
  }
  return conditions.join(' AND ')
}

async function loadBalanceLedger(balanceId) {
  const ledgerResult = await pool.query(
    `SELECT t.id, t.transaction_type, t.allocated_delta, t.carry_over_delta,
            t.adjustment_delta, t.used_delta, t.reserved_delta, t.available_delta,
            t.reason, t.occurred_at, t.metadata,
            u.full_name AS actor_name,
            r.request_number
     FROM cuti.leave_balance_transactions t
     LEFT JOIN cuti.users u ON u.id = t.created_by_user_id
     LEFT JOIN cuti.leave_requests r ON r.id = t.leave_request_id
     WHERE t.balance_id = $1
     ORDER BY t.occurred_at ASC, t.id ASC`,
    [balanceId],
  )
  let running = 0
  return ledgerResult.rows.map((row) => {
    running += Number(row.available_delta || 0)
    return {
      id: row.id,
      transactionType: row.transaction_type,
      allocatedDelta: row.allocated_delta,
      carryOverDelta: row.carry_over_delta,
      adjustmentDelta: row.adjustment_delta,
      usedDelta: row.used_delta,
      reservedDelta: row.reserved_delta,
      days: Number(row.available_delta || 0),
      reason: row.reason,
      occurredAt: row.occurred_at,
      actorName: row.actor_name,
      requestNumber: row.request_number,
      reference: row.metadata?.reference || null,
      availableBefore: row.metadata?.availableBefore ?? null,
      availableAfter: row.metadata?.availableAfter ?? null,
      balanceAfter: running,
    }
  }).reverse()
}

app.get('/api/admin/balances', requireAuth, asyncRoute(async (req, res) => {
  requireAdmin(req.user)
  const year = req.query.year === undefined || req.query.year === ''
    ? new Date().getFullYear()
    : balancePeriodYear(req.query.year)
  const values = []
  const add = (value) => {
    values.push(value)
    return `$${values.length}`
  }
  const where = buildBalanceFilters(req.query, add)
  const yearParam = add(year)
  const base = `
    FROM cuti.employees e
    LEFT JOIN cuti.v_employee_current_assignment a ON a.employee_id = e.id
    JOIN cuti.leave_types lt ON lt.code = 'ANNUAL'
    LEFT JOIN cuti.leave_balances b
      ON b.employee_id = e.id AND b.leave_type_id = lt.id AND b.period_year = ${yearParam}
    WHERE ${where}`
  const [summaryResult, rowsResult, unitsResult, yearsResult] = await Promise.all([
    pool.query(
      `SELECT count(*)::integer AS total,
              count(b.id)::integer AS with_balance,
              COALESCE(sum(b.allocated_days), 0)::integer AS allocated_days,
              COALESCE(sum(b.adjustment_days), 0)::integer AS adjustment_days,
              COALESCE(sum(b.carry_over_days), 0)::integer AS carry_over_days,
              COALESCE(sum(b.used_days), 0)::integer AS used_days,
              COALESCE(sum(b.reserved_days), 0)::integer AS reserved_days,
              COALESCE(sum(b.available_days), 0)::integer AS available_days
       ${base}`,
      values,
    ),
    pool.query(
      `SELECT e.id AS employee_id, e.full_name, e.nip, e.nik,
              e.employment_category, e.employment_status,
              a.organizational_unit_id AS unit_id, a.unit_name, a.position_name,
              b.id AS balance_id, b.period_year, b.allocated_days, b.adjustment_days,
              b.carry_over_days, b.used_days, b.reserved_days, b.available_days,
              (SELECT max(t.occurred_at)
                 FROM cuti.leave_balance_transactions t
                WHERE t.balance_id = b.id AND t.transaction_type = 'ADJUSTMENT') AS last_adjustment_at
       ${base}
       ORDER BY e.full_name
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, Math.min(Math.max(Number(req.query.limit) || 25, 1), 100), Math.max(Number(req.query.offset) || 0, 0)],
    ),
    pool.query(
      `SELECT id, name AS unit_name FROM cuti.organizational_units ORDER BY name`,
    ),
    pool.query(
      `SELECT DISTINCT period_year FROM cuti.leave_balances ORDER BY period_year DESC`,
    ),
  ])
  const summary = summaryResult.rows[0]
  const yearSet = new Set(yearsResult.rows.map((row) => Number(row.period_year)))
  yearSet.add(new Date().getFullYear())
  yearSet.add(new Date().getFullYear() + 1)
  yearSet.add(year)
  res.json({
    items: rowsResult.rows.map(mapBalanceRow),
    summary: {
      total: summary.total,
      withBalance: summary.with_balance,
      allocatedDays: summary.allocated_days,
      adjustmentDays: summary.adjustment_days,
      carryOverDays: summary.carry_over_days,
      usedDays: summary.used_days,
      reservedDays: summary.reserved_days,
      availableDays: summary.available_days,
    },
    units: unitsResult.rows,
    categories: employmentCategories,
    years: [...yearSet].sort((a, b) => b - a),
    periodYear: year,
  })
}))

app.get('/api/admin/balances/:employeeId', requireAuth, asyncRoute(async (req, res) => {
  requireAdmin(req.user)
  const employeeId = positiveId(req.params.employeeId, 'Pegawai')
  const year = req.query.year === undefined || req.query.year === ''
    ? new Date().getFullYear()
    : balancePeriodYear(req.query.year)
  const employeeResult = await pool.query(
    `SELECT e.id AS employee_id, e.full_name, e.nip, e.nik,
            e.employment_category, e.employment_status,
            a.organizational_unit_id AS unit_id, a.unit_name, a.position_name
     FROM cuti.employees e
     LEFT JOIN cuti.v_employee_current_assignment a ON a.employee_id = e.id
     WHERE e.id = $1 AND e.deleted_at IS NULL`,
    [employeeId],
  )
  if (!employeeResult.rowCount) throw new HttpError(404, 'Pegawai tidak ditemukan.')
  const balanceResult = await pool.query(
    `SELECT b.id AS balance_id, b.period_year, b.allocated_days, b.adjustment_days,
            b.carry_over_days, b.used_days, b.reserved_days, b.available_days
     FROM cuti.leave_balances b
     JOIN cuti.leave_types lt ON lt.id = b.leave_type_id
     WHERE b.employee_id = $1 AND lt.code = 'ANNUAL' AND b.period_year = $2`,
    [employeeId, year],
  )
  let ledger = []
  if (balanceResult.rowCount) {
    ledger = await loadBalanceLedger(balanceResult.rows[0].balance_id)
  }
  const employee = employeeResult.rows[0]
  const balance = balanceResult.rows[0]
  res.json({
    employee: {
      employeeId: employee.employee_id,
      fullName: employee.full_name,
      identity: employee.nip || employee.nik || '',
      category: employee.employment_category,
      employmentStatus: employee.employment_status,
      unitId: employee.unit_id,
      unitName: employee.unit_name,
      positionName: employee.position_name,
    },
    balance: balance ? mapBalanceRow({ ...balance, ...employee, identity: null, nip: employee.nip, nik: employee.nik }) : null,
    ledger,
    periodYear: year,
  })
}))

app.post('/api/admin/balances/:employeeId/allocation', requireAuth, asyncRoute(async (req, res) => {
  requireAdmin(req.user)
  const employeeId = positiveId(req.params.employeeId, 'Pegawai')
  const year = balancePeriodYear(req.body?.year)
  const days = Number(req.body?.days)
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    throw new HttpError(400, 'Jumlah hari alokasi harus bilangan bulat antara 1 dan 365.')
  }
  const reason = String(req.body?.reason || '').trim() || 'Alokasi awal kuota cuti tahunan'
  if (reason.length > 500) throw new HttpError(400, 'Alasan maksimal 500 karakter.')
  const result = await transaction(async (client) => {
    const employee = await client.query(
      `SELECT id FROM cuti.employees WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [employeeId],
    )
    if (!employee.rowCount) throw new HttpError(404, 'Pegawai tidak ditemukan.')
    const type = await client.query(`SELECT id FROM cuti.leave_types WHERE code = 'ANNUAL' LIMIT 1`)
    if (!type.rowCount) throw new HttpError(409, 'Jenis cuti tahunan belum tersedia.')
    const existing = await client.query(
      `SELECT id FROM cuti.leave_balances
       WHERE employee_id = $1 AND leave_type_id = $2 AND period_year = $3 FOR UPDATE`,
      [employeeId, type.rows[0].id, year],
    )
    if (existing.rowCount) {
      throw new HttpError(409, 'Saldo periode ini sudah dialokasikan. Gunakan penyesuaian untuk mengubahnya.')
    }
    const allocated = await client.query(
      `SELECT cuti.fn_allocate_leave_balance($1, $2, $3, $4, $5, $6) AS balance_id`,
      [employeeId, type.rows[0].id, year, days, req.user.id, reason],
    )
    const balanceId = allocated.rows[0].balance_id
    await writeAudit(client, req, 'BALANCE_ALLOCATED', 'LEAVE_BALANCE', balanceId, null, {
      reason,
      employeeId,
      periodYear: year,
      allocatedDays: days,
    })
    const balance = await client.query(
      `SELECT id AS balance_id, period_year, allocated_days, adjustment_days,
              carry_over_days, used_days, reserved_days, available_days
       FROM cuti.leave_balances WHERE id = $1`,
      [balanceId],
    )
    return balance.rows[0]
  })
  res.status(201).json({
    ok: true,
    message: `Saldo cuti tahunan ${year} berhasil dialokasikan sebanyak ${days} hari.`,
    balance: {
      balanceId: result.balance_id,
      periodYear: result.period_year,
      allocatedDays: result.allocated_days,
      adjustmentDays: result.adjustment_days,
      carryOverDays: result.carry_over_days,
      usedDays: result.used_days,
      reservedDays: result.reserved_days,
      availableDays: result.available_days,
    },
  })
}))

app.post('/api/admin/balances/:employeeId/adjustment', requireAuth, asyncRoute(async (req, res) => {
  requireAdmin(req.user)
  const employeeId = positiveId(req.params.employeeId, 'Pegawai')
  const year = balancePeriodYear(req.body?.year)
  const deltaDays = Number(req.body?.deltaDays)
  if (!Number.isInteger(deltaDays) || deltaDays === 0) {
    throw new HttpError(400, 'Penyesuaian harus berupa bilangan bulat dan tidak boleh nol.')
  }
  if (Math.abs(deltaDays) > 365) {
    throw new HttpError(400, 'Penyesuaian maksimal 365 hari dalam satu transaksi.')
  }
  const reason = String(req.body?.reason || '').trim()
  if (reason.length < 10) throw new HttpError(400, 'Alasan penyesuaian wajib diisi, minimal 10 karakter.')
  if (reason.length > 500) throw new HttpError(400, 'Alasan maksimal 500 karakter.')
  const reference = String(req.body?.reference || '').trim().slice(0, 200) || null
  const requestedKey = String(req.body?.idempotencyKey || '').trim()
  const idempotencyKey = /^[A-Za-z0-9:_-]{8,120}$/.test(requestedKey)
    ? requestedKey
    : `ADJ:${employeeId}:${year}:${crypto.randomUUID()}`
  const result = await transaction(async (client) => {
    const type = await client.query(`SELECT id FROM cuti.leave_types WHERE code = 'ANNUAL' LIMIT 1`)
    if (!type.rowCount) throw new HttpError(409, 'Jenis cuti tahunan belum tersedia.')
    const balanceResult = await client.query(
      `SELECT id AS balance_id, period_year, allocated_days, adjustment_days,
              carry_over_days, used_days, reserved_days, available_days
       FROM cuti.leave_balances
       WHERE employee_id = $1 AND leave_type_id = $2 AND period_year = $3
       FOR UPDATE`,
      [employeeId, type.rows[0].id, year],
    )
    if (!balanceResult.rowCount) {
      throw new HttpError(409, 'Saldo tahunan periode ini belum dialokasikan. Alokasikan saldo terlebih dahulu.')
    }
    const before = balanceResult.rows[0]
    const availableAfter = Number(before.available_days) + deltaDays
    if (availableAfter < 0) {
      throw new HttpError(
        409,
        `Penyesuaian ditolak. Saldo tersedia ${before.available_days} hari tidak cukup untuk pengurangan ${Math.abs(deltaDays)} hari.`,
        { availableDays: Number(before.available_days), deltaDays, availableAfter },
      )
    }
    const inserted = await client.query(
      `INSERT INTO cuti.leave_balance_transactions (
         balance_id, transaction_type, adjustment_delta, reason,
         created_by_user_id, idempotency_key, metadata
       ) VALUES ($1, 'ADJUSTMENT', $2, $3, $4, $5, $6::jsonb)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id, occurred_at`,
      [
        before.balance_id,
        deltaDays,
        reason,
        req.user.id,
        idempotencyKey,
        JSON.stringify({
          reference,
          availableBefore: Number(before.available_days),
          availableAfter,
        }),
      ],
    )
    if (!inserted.rowCount) {
      return { reused: true, balance: before, transactionId: null }
    }
    await writeAudit(client, req, 'BALANCE_ADJUSTED', 'LEAVE_BALANCE', before.balance_id, {
      periodYear: year,
      availableDays: Number(before.available_days),
      adjustmentDays: Number(before.adjustment_days),
    }, {
      reason,
      employeeId,
      periodYear: year,
      deltaDays,
      availableDays: availableAfter,
      adjustmentDays: Number(before.adjustment_days) + deltaDays,
      reference,
    })
    const updated = await client.query(
      `SELECT id AS balance_id, period_year, allocated_days, adjustment_days,
              carry_over_days, used_days, reserved_days, available_days
       FROM cuti.leave_balances WHERE id = $1`,
      [before.balance_id],
    )
    return { reused: false, balance: updated.rows[0], transactionId: inserted.rows[0].id }
  })
  res.status(201).json({
    ok: true,
    reused: result.reused,
    message: result.reused
      ? 'Penyesuaian ini sudah pernah disimpan.'
      : `Penyesuaian ${deltaDays > 0 ? '+' : ''}${deltaDays} hari tersimpan.`,
    balance: {
      balanceId: result.balance.balance_id,
      periodYear: result.balance.period_year,
      allocatedDays: result.balance.allocated_days,
      adjustmentDays: result.balance.adjustment_days,
      carryOverDays: result.balance.carry_over_days,
      usedDays: result.balance.used_days,
      reservedDays: result.balance.reserved_days,
      availableDays: result.balance.available_days,
    },
    transactionId: result.transactionId,
  })
}))

app.get('/api/admin/employees', requireAuth, asyncRoute(async (req, res) => {
  requireAdmin(req.user)
  const values = []
  const conditions = ['e.deleted_at IS NULL']
  const add = (value) => {
    values.push(value)
    return `$${values.length}`
  }
  const query = String(req.query.q || '').trim()
  const status = String(req.query.status || '')
  if (query) {
    const search = add(`%${query}%`)
    conditions.push(`(
      e.full_name ILIKE ${search} OR COALESCE(e.nip, '') ILIKE ${search}
      OR COALESCE(e.nik, '') ILIKE ${search} OR COALESCE(u.username, '') ILIKE ${search}
    )`)
  }
  if (status && ['ACTIVE', 'INACTIVE'].includes(status)) {
    conditions.push(`e.employment_status = ${add(status)}`)
  }
  const where = conditions.join(' AND ')
  const count = await pool.query(
    `SELECT count(*)::integer AS total,
            count(*) FILTER (WHERE e.employment_status = 'ACTIVE')::integer AS active
     FROM cuti.employees e
     LEFT JOIN cuti.users u ON u.id = e.user_id
     WHERE ${where}`,
    values,
  )
  const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 50)
  const offset = Math.max(Number(req.query.offset) || 0, 0)
  const limitParam = add(limit)
  const offsetParam = add(offset)
  const [rows, units, positions] = await Promise.all([
    pool.query(
      `SELECT e.id, e.user_id, u.username, e.nip, e.nik, e.full_name,
              e.employment_category, e.profession, e.organizational_unit_id AS unit_id,
              COALESCE(a.unit_name, ou.name) AS unit_name,
              COALESCE(a.position_id, e.position_id) AS position_id,
              COALESCE(a.position_name, p.name) AS position_name,
              e.join_date, e.employment_status, e.email, e.phone, e.address
       FROM cuti.employees e
       LEFT JOIN cuti.users u ON u.id = e.user_id
       LEFT JOIN cuti.v_employee_current_assignment a ON a.employee_id = e.id
       LEFT JOIN cuti.organizational_units ou ON ou.id = e.organizational_unit_id
       LEFT JOIN cuti.positions p ON p.id = e.position_id
       WHERE ${where}
       ORDER BY e.full_name
       LIMIT ${limitParam} OFFSET ${offsetParam}`,
      values,
    ),
    pool.query(
      `SELECT id, code, name FROM cuti.organizational_units
       WHERE is_active AND deleted_at IS NULL ORDER BY name`,
    ),
    pool.query(
      `SELECT id, code, name FROM cuti.positions
       WHERE is_active AND deleted_at IS NULL ORDER BY name`,
    ),
  ])
  res.json({ items: rows.rows, summary: count.rows[0], units: units.rows, positions: positions.rows })
}))

app.post('/api/admin/employees', requireAuth, asyncRoute(async (req, res) => {
  requireAdmin(req.user)
  const created = await transaction(async (client) => {
    const employee = await parseEmployeeInput(client, req.body)
    const result = await client.query(
      `INSERT INTO cuti.employees (
         nip, nik, full_name, employment_category, profession, organizational_unit_id,
         position_id, join_date, employment_status, email, phone, address
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING id`,
      [
        employee.nip, employee.nik, employee.fullName, employee.category, employee.profession,
        employee.unitId, employee.positionId, employee.joinDate, employee.status,
        employee.email, employee.phone, employee.address,
      ],
    )
    const id = result.rows[0].id
    await syncEmployeeAssignment(client, {
      id,
      ...employee,
      actorId: req.user.id,
    })
    await writeAudit(client, req, 'EMPLOYEE_CREATED', 'EMPLOYEE', id, null, {
      ...employee,
      id,
    })
    return id
  })
  res.status(201).json({ employeeId: created })
}))

app.put('/api/admin/employees/:id', requireAuth, asyncRoute(async (req, res) => {
  requireAdmin(req.user)
  const id = positiveId(req.params.id, 'ID pegawai')
  await transaction(async (client) => {
    const currentResult = await client.query(
      `SELECT * FROM cuti.employees
       WHERE id = $1 AND deleted_at IS NULL
       FOR UPDATE`,
      [id],
    )
    const current = currentResult.rows[0]
    if (!current) throw new HttpError(404, 'Data pegawai tidak ditemukan.')
    const employee = await parseEmployeeInput(client, req.body)
    await client.query(
      `UPDATE cuti.employees
       SET nip = $2, nik = $3, full_name = $4, employment_category = $5,
           profession = $6, organizational_unit_id = $7, position_id = $8,
           join_date = $9, employment_status = $10, email = $11, phone = $12,
           address = $13, deactivated_at = CASE WHEN $10 = 'INACTIVE' THEN COALESCE(deactivated_at, now()) ELSE NULL END,
           updated_at = now()
       WHERE id = $1`,
      [
        id, employee.nip, employee.nik, employee.fullName, employee.category,
        employee.profession, employee.unitId, employee.positionId, employee.joinDate,
        employee.status, employee.email, employee.phone, employee.address,
      ],
    )
    await syncEmployeeAssignment(client, {
      id,
      ...employee,
      actorId: req.user.id,
    })
    if (employee.status === 'INACTIVE' && current.user_id) {
      await client.query(
        `UPDATE cuti.users
         SET is_active = false, deactivated_at = COALESCE(deactivated_at, now()), updated_at = now()
         WHERE id = $1`,
        [current.user_id],
      )
      await client.query(
        `UPDATE cuti.user_sessions SET revoked_at = now()
         WHERE user_id = $1 AND revoked_at IS NULL`,
        [current.user_id],
      )
    }
    await writeAudit(client, req, 'EMPLOYEE_UPDATED', 'EMPLOYEE', id, current, {
      ...employee,
      id,
      user_id: current.user_id,
    })
  })
  res.json({ ok: true })
}))

app.get('/api/admin/accounts', requireAuth, asyncRoute(async (req, res) => {
  requireAdmin(req.user)
  const values = []
  let where = ''
  const query = String(req.query.q || '').trim()
  if (query) {
    values.push(`%${query}%`)
    where = `WHERE (
      u.username ILIKE $1 OR u.email ILIKE $1 OR u.full_name ILIKE $1
      OR COALESCE(e.full_name, '') ILIKE $1
    )`
  }
  const count = await pool.query(
    `SELECT count(*)::integer AS total FROM cuti.users u
     LEFT JOIN cuti.employees e ON e.user_id = u.id AND e.deleted_at IS NULL
     ${where}`,
    values,
  )
  const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 50)
  const offset = Math.max(Number(req.query.offset) || 0, 0)
  values.push(limit, offset)
  const limitParam = `$${values.length - 1}`
  const offsetParam = `$${values.length}`
  const [rows, roles, employees, units] = await Promise.all([
    pool.query(
      `SELECT u.id, u.username, u.email, u.full_name, u.is_active,
              u.created_at, u.last_login_at, e.id AS employee_id,
              e.full_name AS employee_name, e.employment_category,
              e.employment_status,
              COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                  'code', r.code, 'name', r.name,
                  'unitId', ur.organizational_unit_id, 'unitName', ou.name
                ) ORDER BY ur.is_primary DESC, r.code)
                FROM cuti.user_roles ur
                JOIN cuti.roles r ON r.id = ur.role_id
                LEFT JOIN cuti.organizational_units ou ON ou.id = ur.organizational_unit_id
                WHERE ur.user_id = u.id AND ur.revoked_at IS NULL
              ), '[]'::jsonb) AS roles
       FROM cuti.users u
       LEFT JOIN cuti.employees e ON e.user_id = u.id AND e.deleted_at IS NULL
       ${where}
       ORDER BY u.full_name
       LIMIT ${limitParam} OFFSET ${offsetParam}`,
      values,
    ),
    pool.query(`SELECT code, name FROM cuti.roles ORDER BY name`),
    pool.query(
      `SELECT id, full_name, employment_category, employment_status, user_id
       FROM cuti.employees WHERE deleted_at IS NULL ORDER BY full_name`,
    ),
    pool.query(
      `SELECT id, code, name FROM cuti.organizational_units
       WHERE is_active AND deleted_at IS NULL ORDER BY name`,
    ),
  ])
  res.json({
    items: rows.rows,
    summary: count.rows[0],
    roles: roles.rows,
    employees: employees.rows,
    units: units.rows,
  })
}))

app.post('/api/admin/accounts', requireAuth, asyncRoute(async (req, res) => {
  requireAdmin(req.user)
  const username = String(req.body?.username || '').trim()
  const email = String(req.body?.email || '').trim()
  const fullName = String(req.body?.fullName || '').trim()
  const password = String(req.body?.password || '')
  const employeeId = optionalId(req.body?.employeeId, 'Data pegawai')
  const roles = normalizeRoleCodes(req.body?.roles, employeeId)
  const unitId = roles.includes('KASUBAG') ? positiveId(req.body?.unitId, 'Unit Kasubag') : null
  if (username.length < 3 || username.length > 60) throw new HttpError(400, 'Username harus berisi 3 sampai 60 karakter.')
  if (email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new HttpError(400, 'Format atau panjang email tidak valid.')
  }
  if (fullName.length < 3 || fullName.length > 150) throw new HttpError(400, 'Nama akun harus berisi 3 sampai 150 karakter.')
  if (password.length < 8) throw new HttpError(400, 'Kata sandi awal minimal 8 karakter.')
  const created = await transaction(async (client) => {
    const roleCheck = await client.query(
      `SELECT code FROM cuti.roles WHERE code = ANY($1::varchar[])`,
      [roles],
    )
    if (roleCheck.rowCount !== roles.length) throw new HttpError(400, 'Satu atau lebih role tidak tersedia.')
    if (unitId) {
      const unit = await client.query(
        `SELECT id FROM cuti.organizational_units
         WHERE id = $1 AND is_active AND deleted_at IS NULL`,
        [unitId],
      )
      if (!unit.rowCount) throw new HttpError(400, 'Pilih unit Kasubag yang aktif.')
    }
    if (employeeId) {
      const employee = await client.query(
        `SELECT id, employment_status, user_id FROM cuti.employees
         WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [employeeId],
      )
      if (!employee.rowCount) throw new HttpError(404, 'Data pegawai tidak ditemukan.')
      if (employee.rows[0].user_id) throw new HttpError(409, 'Pegawai sudah terhubung ke akun lain.')
      if (employee.rows[0].employment_status !== 'ACTIVE') throw new HttpError(409, 'Akun tidak dapat dihubungkan ke pegawai nonaktif.')
    }
    const result = await client.query(
      `INSERT INTO cuti.users (username, email, password_hash, full_name)
       VALUES ($1,$2,crypt($3, gen_salt('bf', 12)),$4)
       RETURNING id`,
      [username, email, password, fullName],
    )
    const userId = result.rows[0].id
    if (employeeId) {
      await client.query(`UPDATE cuti.employees SET user_id = $2, updated_at = now() WHERE id = $1`, [employeeId, userId])
    }
    await replaceUserRoles(client, userId, roles, unitId, req.user.id)
    await writeAudit(client, req, 'ACCOUNT_CREATED', 'USER', userId, null, {
      username,
      email,
      fullName,
      roles,
      employeeId,
    })
    return userId
  })
  res.status(201).json({ accountId: created })
}))

app.put('/api/admin/accounts/:id', requireAuth, asyncRoute(async (req, res) => {
  requireAdmin(req.user)
  const id = positiveId(req.params.id, 'ID akun')
  const username = String(req.body?.username || '').trim()
  const email = String(req.body?.email || '').trim()
  const fullName = String(req.body?.fullName || '').trim()
  const password = String(req.body?.password || '')
  const isActive = req.body?.isActive
  if (typeof isActive !== 'boolean') throw new HttpError(400, 'Status aktif akun tidak valid.')
  const employeeIdInput = req.body?.employeeId
  if (username.length < 3 || username.length > 60) throw new HttpError(400, 'Username harus berisi 3 sampai 60 karakter.')
  if (email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new HttpError(400, 'Format atau panjang email tidak valid.')
  }
  if (fullName.length < 3 || fullName.length > 150) throw new HttpError(400, 'Nama akun harus berisi 3 sampai 150 karakter.')
  if (password && password.length < 8) throw new HttpError(400, 'Kata sandi baru minimal 8 karakter.')

  await transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(41002, 1)')
    const currentResult = await client.query(
      `SELECT * FROM cuti.users WHERE id = $1 FOR UPDATE`,
      [id],
    )
    const current = currentResult.rows[0]
    if (!current) throw new HttpError(404, 'Akun tidak ditemukan.')
    const currentRolesResult = await client.query(
      `SELECT r.code, ur.organizational_unit_id
       FROM cuti.user_roles ur JOIN cuti.roles r ON r.id = ur.role_id
       WHERE ur.user_id = $1 AND ur.revoked_at IS NULL
       ORDER BY ur.is_primary DESC, r.code`,
      [id],
    )
    const existingEmployeeResult = await client.query(
      `SELECT id FROM cuti.employees
       WHERE user_id = $1 AND deleted_at IS NULL`,
      [id],
    )
    const existingEmployeeId = existingEmployeeResult.rows[0]?.id || null
    const employeeId = employeeIdInput === undefined
      ? existingEmployeeId
      : optionalId(employeeIdInput, 'Data pegawai')
    const roles = normalizeRoleCodes(req.body?.roles, employeeId)
    const unitId = roles.includes('KASUBAG') ? positiveId(req.body?.unitId, 'Unit Kasubag') : null
    const roleCheck = await client.query(
      `SELECT code FROM cuti.roles WHERE code = ANY($1::varchar[])`,
      [roles],
    )
    if (roleCheck.rowCount !== roles.length) throw new HttpError(400, 'Satu atau lebih role tidak tersedia.')
    const currentRoleCodes = currentRolesResult.rows.map((role) => role.code)
    const isCurrentAdmin = current.is_active && currentRoleCodes.includes('ADMIN')
    const remainsAdmin = isActive && roles.includes('ADMIN')
    if (String(id) === String(req.user.id) && (!isActive || !remainsAdmin)) {
      throw new HttpError(409, 'Akun Admin yang sedang digunakan tidak dapat dinonaktifkan atau kehilangan role Admin.')
    }
    if (isCurrentAdmin && !remainsAdmin) {
      const otherAdmins = await client.query(
        `SELECT count(*)::integer AS total
         FROM cuti.users u
         WHERE u.id <> $1 AND u.is_active
           AND EXISTS (
             SELECT 1 FROM cuti.user_roles ur JOIN cuti.roles r ON r.id = ur.role_id
             WHERE ur.user_id = u.id AND ur.revoked_at IS NULL AND r.code = 'ADMIN'
           )`,
        [id],
      )
      if (!otherAdmins.rows[0].total) throw new HttpError(409, 'Simpan minimal satu akun Admin aktif.')
    }
    if (unitId) {
      const unit = await client.query(
        `SELECT id FROM cuti.organizational_units
         WHERE id = $1 AND is_active AND deleted_at IS NULL`,
        [unitId],
      )
      if (!unit.rowCount) throw new HttpError(400, 'Pilih unit Kasubag yang aktif.')
    }
    if (employeeId) {
      const employee = await client.query(
        `SELECT id, employment_status, user_id FROM cuti.employees
         WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [employeeId],
      )
      if (!employee.rowCount) throw new HttpError(404, 'Data pegawai tidak ditemukan.')
      if (employee.rows[0].user_id && String(employee.rows[0].user_id) !== String(id)) {
        throw new HttpError(409, 'Pegawai sudah terhubung ke akun lain.')
      }
      if (isActive && employee.rows[0].employment_status !== 'ACTIVE') {
        throw new HttpError(409, 'Akun pegawai nonaktif tidak dapat diaktifkan.')
      }
    }

    const currentRoles = new Map(currentRolesResult.rows.map((role) => [role.code, role.organizational_unit_id]))
    const roleChanged = roles.length !== currentRoles.size
      || roles.some((code) =>
        !currentRoles.has(code)
        || String(code === 'KASUBAG' ? unitId : '') !== String(currentRoles.get(code) || ''),
      )
    const employeeChanged = String(employeeId || '') !== String(existingEmployeeId || '')
    const passwordChanged = Boolean(password)
    await client.query(
      `UPDATE cuti.users
       SET username = $2, email = $3, full_name = $4,
           password_hash = CASE WHEN $5::text = '' THEN password_hash ELSE crypt($5, gen_salt('bf', 12)) END,
           is_active = $6,
           deactivated_at = CASE WHEN $6 THEN NULL ELSE COALESCE(deactivated_at, now()) END,
           updated_at = now()
       WHERE id = $1`,
      [id, username, email, fullName, password, isActive],
    )
    if (employeeChanged) {
      if (existingEmployeeId) {
        await client.query(`UPDATE cuti.employees SET user_id = NULL, updated_at = now() WHERE id = $1`, [existingEmployeeId])
      }
      if (employeeId) {
        await client.query(`UPDATE cuti.employees SET user_id = $2, updated_at = now() WHERE id = $1`, [employeeId, id])
      }
    }
    if (roleChanged || employeeChanged) await replaceUserRoles(client, id, roles, unitId, req.user.id)
    if (!isActive || roleChanged || employeeChanged || passwordChanged) {
      await client.query(
        `UPDATE cuti.user_sessions SET revoked_at = now()
         WHERE user_id = $1 AND revoked_at IS NULL`,
        [id],
      )
    }
    await writeAudit(client, req, isActive ? 'ACCOUNT_UPDATED' : 'ACCOUNT_DEACTIVATED', 'USER', id, {
      username: current.username,
      email: current.email,
      fullName: current.full_name,
      isActive: current.is_active,
      roles: currentRoleCodes,
      employeeId: existingEmployeeId,
      roleUnits: currentRolesResult.rows.map((role) => ({
        code: role.code,
        unitId: role.organizational_unit_id,
      })),
    }, {
      username,
      email,
      fullName,
      isActive,
      roles,
      employeeId,
      passwordChanged,
    })
  })
  res.json({ ok: true })
}))

app.get('/api/requests/:id', requireAuth, asyncRoute(async (req, res) => {
  const requestResult = await pool.query(
    `SELECT r.*, lt.name AS leave_type_name, lt.code AS leave_type_code, e.user_id AS employee_user_id,
            a.unit_name AS current_unit_name
     FROM cuti.leave_requests r
     JOIN cuti.leave_types lt ON lt.id = r.leave_type_id
     JOIN cuti.employees e ON e.id = r.employee_id
     LEFT JOIN cuti.v_employee_current_assignment a ON a.employee_id = e.id
     WHERE r.id = $1`,
    [req.params.id],
  )
  const request = requestResult.rows[0]
  if (!request || !(await canReadRequest(req.user, request))) {
    throw new HttpError(404, 'Pengajuan tidak ditemukan dalam lingkup akses Anda.')
  }
  const [days, events, stages, attachments, activeStage, cancellation] = await Promise.all([
    pool.query(
      `SELECT leave_date::text, day_index, day_class, is_counted, note
       FROM cuti.leave_request_days
       WHERE leave_request_id = $1 ORDER BY leave_date`,
      [request.id],
    ),
    pool.query(
      `SELECT ev.event_type, ev.from_status, ev.to_status, ev.stage_code,
              ev.description, ev.created_at, u.full_name AS actor_name
       FROM cuti.leave_request_events ev
       LEFT JOIN cuti.users u ON u.id = ev.actor_user_id
       WHERE ev.leave_request_id = $1
       ORDER BY ev.created_at, ev.id`,
      [request.id],
    ),
    pool.query(
      `SELECT stage_code, role_code, status, due_at, activated_at, completed_at
       FROM cuti.leave_request_stages
       WHERE leave_request_id = $1 AND attempt_no = (
         SELECT max(attempt_no) FROM cuti.leave_request_stages WHERE leave_request_id = $1
       )
       ORDER BY step_no`,
      [request.id],
    ),
    pool.query(
      `SELECT id, document_type, original_filename, detected_mime, file_size,
              status, scan_status, uploaded_at
       FROM cuti.leave_attachments
       WHERE leave_request_id = $1 AND deleted_at IS NULL
       ORDER BY uploaded_at`,
      [request.id],
    ),
    pool.query(
      `SELECT id, role_code, stage_code, unit_scope, decision_mode, assignee_user_id
       FROM cuti.leave_request_stages
       WHERE leave_request_id = $1 AND status = 'ACTIVE'
       LIMIT 1`,
      [request.id],
    ),
    pool.query(
      `SELECT lc.id, lc.cancellation_source, lc.reason, lc.effective_date,
              lc.approved_days, lc.used_days, lc.used_days_source, lc.restored_days,
              lc.balance_before, lc.balance_after, lc.notes, lc.cancelled_at,
              u.full_name AS processed_by_name
       FROM cuti.leave_cancellations lc
       LEFT JOIN cuti.users u ON u.id = lc.processed_by_user_id
       WHERE lc.leave_request_id = $1
       LIMIT 1`,
      [request.id],
    ),
  ])

  const requestWithStages = { ...request, stages: stages.rows }
  const withdrawCheck = canEmployeeWithdraw(requestWithStages, req.user.id)
  const cancelCheck = canAdminCancel(requestWithStages, req.user)

  const todayStr = new Date().toISOString().slice(0, 10)
  const usedDaysNow = calculateUsedWorkingDays(days.rows, todayStr)
  const approvedWorkingDays = Number(request.approved_working_days || request.requested_working_days)
  const maxRestorableDaysNow = Math.max(0, approvedWorkingDays - usedDaysNow)

  const canAct = activeStage.rows[0]
    && hasRole(req.user, activeStage.rows[0].role_code)
    && (!activeStage.rows[0].assignee_user_id
      || String(activeStage.rows[0].assignee_user_id) === String(req.user.id))
    && String(request.employee_id) !== String(req.user.employee?.id || '')
  // Semua peran persetujuan (ADMIN, HR_ANALYST, KASUBAG, KEPSTA, PPK) boleh lihat identitas lengkap
  const isApprovalRole = hasRole(req.user, 'ADMIN') || hasRole(req.user, 'HR_ANALYST') || hasRole(req.user, 'KASUBAG') || hasRole(req.user, 'KEPSTA') || hasRole(req.user, 'PPK')
  const isOwner = String(request.employee_id) === String(req.user.employee?.id || '')
  const revealContact = isApprovalRole || isOwner
  // NIK/NIP tidak disensor di manapun per kebijakan
  const revealIdentity = true
  const balanceResult = await pool.query(
    `SELECT available_days FROM cuti.v_leave_balance_summary
     WHERE employee_id = $1 AND deducts_annual_balance
       AND period_year = extract(year FROM current_date)::smallint
     LIMIT 1`,
    [request.employee_id],
  )
  const signaturesResult = await pool.query(
    `SELECT signer_role_code, signer_name, signer_position_name,
            signature_image_hash, signed_at
     FROM cuti.document_signatures
     WHERE leave_request_id = $1
     ORDER BY signed_at`,
    [request.id],
  )
  const normalizedDecision = request.status === 'APPROVED' ? 'APPROVED'
    : request.status === 'REJECTED' ? 'REJECTED'
    : request.decision || null
  res.json({
    request: {
      id: request.id,
      requestNumber: request.request_number,
      status: request.status,
      decision: normalizedDecision,
      employeeName: request.employee_name,
      employeeCategory: request.employee_category,
      // NIK/NIP tidak disensor di manapun
      identity: request.employee_identity_number,
      employeeUnitName: request.employee_unit_name || request.current_unit_name,
      employeePositionName: request.employee_position_name,
      leaveTypeName: request.leave_type_name,
      leaveTypeCode: request.leave_type_code,
      startDate: request.start_date,
      endDate: request.end_date,
      workingDays: request.requested_working_days,
      approvedDays: request.approved_working_days || request.requested_working_days,
      availableDays: balanceResult.rows[0]?.available_days ?? null,
      reason: request.reason,
      // Telepon & alamat: terlihat untuk peran persetujuan dan pemilik
      address: revealContact ? request.address_during_leave : null,
      phone: revealContact ? request.phone : null,
      submittedAt: request.submitted_at,
      days: days.rows,
      events: events.rows,
      stages: stages.rows,
      attachments: attachments.rows,
      activeStage: activeStage.rows[0] || null,
      canAct: Boolean(canAct),
      hasSignature: req.user.hasSignature,
      canEditDraft: request.status === 'DRAFT'
        && !!req.user.employee
        && String(request.employee_id) === String(req.user.employee.id),
      canWithdraw: withdrawCheck.allowed,
      withdrawReason: withdrawCheck.reason || null,
      canCancel: cancelCheck.allowed,
      cancelReason: cancelCheck.reason || null,
      cancellation: cancellation.rows[0] || null,
      cancellationCalculation: (cancelCheck.allowed && request.status === 'APPROVED') ? {
        approvedDays: approvedWorkingDays,
        usedDays: usedDaysNow,
        maxRestorableDays: maxRestorableDaysNow,
      } : null,
      signatures: signaturesResult.rows.map((row) => ({
        roleCode: row.signer_role_code,
        name: row.signer_name,
        position: row.signer_position_name,
        hash: row.signature_image_hash,
        signedAt: row.signed_at,
      })),
    },
  })
}))

app.get('/api/attachments/:id', requireAuth, asyncRoute(async (req, res) => {
  const result = await pool.query(
    `SELECT a.storage_key, a.original_filename, a.detected_mime, r.id AS request_id,
            r.employee_id, r.employee_category, r.employee_unit_id
     FROM cuti.leave_attachments a
     JOIN cuti.leave_requests r ON r.id = a.leave_request_id
     WHERE a.id = $1 AND a.deleted_at IS NULL`,
    [req.params.id],
  )
  const attachment = result.rows[0]
  if (!attachment || !(await canReadRequest(req.user, attachment))) {
    throw new HttpError(404, 'Lampiran tidak ditemukan.')
  }
  const inline = req.query.mode === 'inline'
  // Nama file disanitasi sekali lagi saat dipakai di header (pertahanan berlapis).
  const safeName = sanitizeFilename(attachment.original_filename).replaceAll('"', '')
  res.type(attachment.detected_mime)
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${safeName}"`)
  res.sendFile(safeStoragePath(attachment.storage_key))
}))

// Hapus lampiran (soft delete). Hanya pemilik pengajuan yang masih berstatus DRAFT.
app.delete('/api/attachments/:id', requireAuth, asyncRoute(async (req, res) => {
  requireEmployee(req.user)
  const attachmentId = positiveId(req.params.id, 'Lampiran')
  const reason = String(req.body?.reason || '').trim() || 'Dihapus pemilik saat menyunting draf.'
  const client = await pool.connect()
  let storageKey = null
  try {
    await client.query('BEGIN')
    const result = await client.query(
      `SELECT a.id, a.storage_key, a.leave_request_id, r.employee_id, r.status
       FROM cuti.leave_attachments a
       JOIN cuti.leave_requests r ON r.id = a.leave_request_id
       WHERE a.id = $1 AND a.deleted_at IS NULL FOR UPDATE OF a`,
      [attachmentId],
    )
    const attachment = result.rows[0]
    if (!attachment) throw new HttpError(404, 'Lampiran tidak ditemukan.')
    if (String(attachment.employee_id) !== String(req.user.employee.id)) {
      throw new HttpError(403, 'Anda hanya dapat menghapus lampiran pengajuan Anda sendiri.')
    }
    if (String(attachment.status) !== 'DRAFT') {
      throw new HttpError(409, 'Lampiran hanya dapat dihapus saat pengajuan masih berstatus draf.')
    }
    await client.query(
      `UPDATE cuti.leave_attachments
       SET deleted_at = now(), deleted_by = $2, deletion_reason = $3
       WHERE id = $1`,
      [attachmentId, req.user.id, reason],
    )
    await client.query(
      `INSERT INTO cuti.leave_request_events
         (leave_request_id, event_type, from_status, to_status, description, actor_user_id, actor_role_code)
       VALUES ($1, 'ATTACHMENT_REMOVED', 'DRAFT', 'DRAFT', $2, $3, 'EMPLOYEE')`,
      [attachment.leave_request_id, `Lampiran dihapus: ${reason}`, req.user.id],
    )
    await client.query('COMMIT')
    storageKey = attachment.storage_key
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
  if (storageKey) await unlink(safeStoragePath(storageKey)).catch(() => undefined)
  res.json({ ok: true })
}))

app.post('/api/signature', requireAuth, express.raw({ type: ['image/png', 'image/jpeg'], limit: '2mb' }), asyncRoute(async (req, res) => {
  // Validasi terpusat: magic bytes, ukuran, dimensi/piksel, polyglot.
  const validated = await validateUpload(req.body, 'SIGNATURE', 'tanda-tangan')
  const key = validated.storageKey.replace(/^signatures\//, `signatures/${req.user.id}/`)
  const target = safeStoragePath(key)
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, req.body, { flag: 'wx' })
  try {
    const signature = await transaction(async (client) => {
      await client.query(
        `UPDATE cuti.user_signatures
         SET is_active = false, revoked_at = now()
         WHERE user_id = $1 AND is_active`,
        [req.user.id],
      )
      const result = await client.query(
        `INSERT INTO cuti.user_signatures
           (user_id, storage_key, mime_type, file_size, sha256)
         VALUES ($1,$2,$3,$4,$5)
         RETURNING id`,
        [req.user.id, key, validated.mime, validated.size, validated.sha256],
      )
      return result.rows[0]
    })
    res.status(201).json({ id: signature.id, saved: true })
  } catch (error) {
    await unlink(target).catch(() => undefined)
    throw error
  }
}))

app.post('/api/requests/:id/withdraw', requireAuth, asyncRoute(async (req, res) => {
  const result = await transaction(async (client) => {
    return await withdrawLeaveRequest(client, req.user, req.params.id, req.body?.reason, {
      ip: req.ip,
      userAgent: req.get('user-agent'),
    })
  })
  res.json(result)
}))

app.post('/api/requests/:id/cancel', requireAuth, asyncRoute(async (req, res) => {
  const result = await transaction(async (client) => {
    return await cancelLeaveRequest(client, req.user, req.params.id, req.body || {}, {
      ip: req.ip,
      userAgent: req.get('user-agent'),
    })
  })
  res.json(result)
}))

app.post('/api/requests/:id/action', requireAuth, asyncRoute(async (req, res) => {
  const action = String(req.body?.action || '')
  const decision = req.body?.decision ? String(req.body.decision) : null
  const notes = String(req.body?.notes || '').trim()
  const allowedActions = ['VERIFY', 'PERTIMBANGAN', 'FORWARD', 'DECIDE', 'RETURN']
  if (!allowedActions.includes(action)) throw new HttpError(400, 'Aksi tidak dikenali.')
  if ((action === 'RETURN' || decision === 'REJECTED') && notes.length < 10) {
    throw new HttpError(400, 'Catatan wajib diisi, minimal 10 karakter.')
  }

  const result = await transaction(async (client) => {
    const requestResult = await client.query(
      `SELECT * FROM cuti.leave_requests WHERE id = $1 FOR UPDATE`,
      [req.params.id],
    )
    const request = requestResult.rows[0]
    if (!request || !(await canReadRequest(req.user, request))) {
      throw new HttpError(404, 'Pengajuan tidak ditemukan dalam lingkup akses Anda.')
    }
    if (String(request.employee_id) === String(req.user.employee?.id || '')) {
      throw new HttpError(403, 'Pengajuan milik sendiri tidak dapat diproses.')
    }
    const stage = await ensureActiveStage(client, request)
    if (!stage || !hasRole(req.user, stage.role_code)) {
      throw new HttpError(409, 'Tahap ini sudah berubah atau bukan kewenangan role Anda.')
    }
    if (stage.assignee_user_id && String(stage.assignee_user_id) !== String(req.user.id)) {
      throw new HttpError(403, 'Tahap ini ditugaskan kepada petugas lain.')
    }

    let targetStatus
    let signatureId = null
    let nextStageInfo = null
    const signedActions = ['PERTIMBANGAN', 'FORWARD', 'DECIDE']
    if (signedActions.includes(action)) {
      if (!req.user.hasSignature) throw new HttpError(400, 'Simpan tanda tangan internal sebelum memproses.')
      const userSignatureResult = await client.query(
        `SELECT id, sha256 FROM cuti.user_signatures
         WHERE user_id = $1 AND is_active FOR UPDATE`,
        [req.user.id],
      )
      const userSignature = userSignatureResult.rows[0]
      if (!userSignature) throw new HttpError(400, 'Simpan tanda tangan internal sebelum memproses.')
      if (action === 'PERTIMBANGAN' && stage.role_code !== 'HR_ANALYST') {
        throw new HttpError(403, 'Aksi pertimbangan hanya tersedia untuk Analis SDM.')
      }
      if (action === 'FORWARD' && !(stage.role_code === 'KASUBAG' && stage.decision_mode === 'FORWARD')) {
        throw new HttpError(403, 'Aksi penerusan tidak tersedia pada tahap ini.')
      }
      if (action === 'DECIDE' && stage.decision_mode !== 'FINAL') {
        throw new HttpError(403, 'Tahap ini bukan tahap keputusan akhir.')
      }
      if (action === 'DECIDE' && !['APPROVED', 'REJECTED'].includes(decision)) {
        throw new HttpError(400, 'Pilih setuju atau tidak setuju.')
      }
      const payload = {
        requestNumber: request.request_number,
        stageCode: stage.stage_code,
        action,
        decision,
        actorUserId: req.user.id,
        signedAt: new Date().toISOString(),
      }
      const documentHash = hash(JSON.stringify({
        requestNumber: request.request_number,
        startDate: request.start_date,
        endDate: request.end_date,
        reason: request.reason,
      }))
      const signatureHash = hash(`${documentHash}:${userSignature.sha256}:${JSON.stringify(payload)}`)
      const signed = await client.query(
        `INSERT INTO cuti.document_signatures (
           leave_request_id, leave_request_stage_id, signer_user_id,
           signer_role_code, signer_name, signer_identity_number,
           signer_position_name, user_signature_id, signature_image_hash,
           document_hash, signature_hash, signed_payload
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
         RETURNING id`,
        [
          request.id,
          stage.id,
          req.user.id,
          stage.role_code,
          req.user.fullName,
          req.user.employee?.nip || req.user.employee?.nik || null,
          req.user.employee?.position_name || null,
          userSignature.id,
          userSignature.sha256,
          documentHash,
          signatureHash,
          JSON.stringify(payload),
        ],
      )
      signatureId = signed.rows[0].id
    }

    if (action === 'VERIFY') {
      if (stage.role_code !== 'ADMIN') throw new HttpError(403, 'Verifikasi hanya tersedia untuk Admin.')
      if (request.status === 'SUBMITTED') {
        await client.query(`UPDATE cuti.leave_requests SET status = 'ADMIN_REVIEW', updated_at = now() WHERE id = $1`, [request.id])
      }
      await client.query(`UPDATE cuti.leave_requests SET status = 'ADMIN_VERIFIED', updated_at = now() WHERE id = $1`, [request.id])
      const next = await advanceToNextStage(client, request, stage)
      if (!next) throw new HttpError(409, 'Tahap berikutnya belum diatur.')
      nextStageInfo = next
      targetStatus = next.stageCode
      await client.query(`UPDATE cuti.leave_requests SET status = $2, updated_at = now() WHERE id = $1`, [request.id, targetStatus])
      await client.query(
        `UPDATE cuti.leave_request_stages
         SET status = 'COMPLETED', completed_at = now(), updated_at = now()
         WHERE id = $1`,
        [stage.id],
      )
    } else if (action === 'RETURN') {
      if (!hasRole(req.user, stage.role_code)) throw new HttpError(403, 'Aksi pengembalian tidak diizinkan.')
      if (stage.role_code === 'ADMIN' && request.status === 'SUBMITTED') {
        await client.query(`UPDATE cuti.leave_requests SET status = 'ADMIN_REVIEW', updated_at = now() WHERE id = $1`, [request.id])
      }
      targetStatus = 'RETURNED_FOR_REVISION'
      await client.query(
        `UPDATE cuti.leave_requests SET status = $2, updated_at = now() WHERE id = $1`,
        [request.id, targetStatus],
      )
      if (request.is_annual_leave) {
        const balance = await client.query(
          `SELECT id FROM cuti.leave_balances
           WHERE employee_id = $1 AND leave_type_id = $2 AND period_year = $3
           FOR UPDATE`,
          [request.employee_id, request.leave_type_id, request.balance_period_year],
        )
        await client.query(
          `INSERT INTO cuti.leave_balance_transactions (
             balance_id, leave_request_id, transaction_type, reserved_delta,
             reason, created_by_user_id, idempotency_key
           ) VALUES ($1,$2,'RELEASE',$3,'Reservasi dilepas saat pengajuan dikembalikan',$4,$5)`,
          [balance.rows[0].id, request.id, -Number(request.requested_working_days), req.user.id, `RELEASE:${request.id}:${stage.attempt_no}`],
        )
      }
      await client.query(
        `UPDATE cuti.leave_request_stages SET status = 'RETURNED', completed_at = now(), updated_at = now()
         WHERE id = $1`,
        [stage.id],
      )
      await client.query(
        `UPDATE cuti.leave_request_stages SET status = 'CANCELLED', updated_at = now()
         WHERE leave_request_id = $1 AND attempt_no = $2 AND status = 'PENDING'`,
        [request.id, stage.attempt_no],
      )
    } else {
      if (action === 'PERTIMBANGAN' && stage.role_code !== 'HR_ANALYST') {
        throw new HttpError(403, 'Pertimbangan hanya tersedia untuk Analis SDM.')
      }
      const next = await advanceToNextStage(client, request, stage)
      if (action === 'FORWARD' && !next) {
        throw new HttpError(409, 'Tahap penerusan berikutnya belum diatur.')
      }
      if (action === 'PERTIMBANGAN' || action === 'FORWARD') {
        if (!next) throw new HttpError(409, 'Tahap berikutnya belum diatur.')
        nextStageInfo = next
        targetStatus = next.stageCode
        await client.query(
          `UPDATE cuti.leave_requests SET status = $2, updated_at = now() WHERE id = $1`,
          [request.id, targetStatus],
        )
        await client.query(
          `UPDATE cuti.leave_request_stages
           SET status = 'COMPLETED', completed_at = now(), updated_at = now()
           WHERE id = $1`,
          [stage.id],
        )
      } else if (action === 'DECIDE') {
        targetStatus = decision
        await client.query(
          `UPDATE cuti.leave_requests
           SET status = $2, decision = $3, decided_at = now(),
               approved_working_days = CASE WHEN $3::varchar = 'APPROVED' THEN requested_working_days END,
               updated_at = now()
           WHERE id = $1`,
          [request.id, decision, decision],
        )
        if (request.is_annual_leave) {
          const balance = await client.query(
            `SELECT id FROM cuti.leave_balances
             WHERE employee_id = $1 AND leave_type_id = $2 AND period_year = $3
             FOR UPDATE`,
            [request.employee_id, request.leave_type_id, request.balance_period_year],
          )
          const approved = decision === 'APPROVED'
          await client.query(
            `INSERT INTO cuti.leave_balance_transactions (
               balance_id, leave_request_id, transaction_type, used_delta, reserved_delta,
               reason, created_by_user_id, idempotency_key
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [
              balance.rows[0].id,
              request.id,
              approved ? 'CONSUMPTION' : 'RELEASE',
              approved ? Number(request.requested_working_days) : 0,
              -Number(request.requested_working_days),
              approved ? 'Pemakaian cuti disetujui' : 'Reservasi dilepas setelah penolakan',
              req.user.id,
              `${approved ? 'CONSUME' : 'RELEASE'}:${request.id}:${stage.attempt_no}`,
            ],
          )
        }
        await client.query(
          `UPDATE cuti.leave_request_stages
           SET status = 'COMPLETED', completed_at = now(), updated_at = now()
           WHERE id = $1`,
          [stage.id],
        )
      } else {
        throw new HttpError(400, 'Aksi tidak sesuai dengan tahap aktif.')
      }
    }

    await client.query(
      `INSERT INTO cuti.leave_approvals (
         leave_request_id, stage_id, attempt_no, step_no, stage_code,
         action, actor_user_id, actor_role_code, actor_name,
         actor_identity_number, actor_position_name, decision, notes,
         status_before, status_after, signature_id, idempotency_key
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [
        request.id, stage.id, stage.attempt_no, stage.step_no, stage.stage_code,
        action, req.user.id, stage.role_code, req.user.fullName,
        req.user.employee?.nip || req.user.employee?.nik || null,
        req.user.employee?.position_name || null,
        action === 'DECIDE' ? decision : null, notes || null,
        request.status, targetStatus, signatureId, crypto.randomUUID(),
      ],
    )
    await client.query(
      `INSERT INTO cuti.leave_request_events (
         leave_request_id, event_type, from_status, to_status, stage_code,
         description, actor_user_id, actor_role_code
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        request.id,
        action === 'VERIFY' ? 'VERIFIED'
          : action === 'RETURN' ? 'RETURNED'
            : action === 'PERTIMBANGAN' ? 'PERTIMBANGAN'
              : action === 'FORWARD' ? 'FORWARDED' : 'DECIDED',
        request.status,
        targetStatus,
        stage.stage_code,
        notes || `Aksi ${action} oleh ${req.user.fullName}.`,
        req.user.id,
        stage.role_code,
      ],
    )

    await writeAudit(client, req, `LEAVE_${action}_REQUEST`, 'LEAVE_REQUEST', request.id, { status: request.status }, { status: targetStatus, action, notes })

    const empUserRes = await client.query(
      `SELECT u.id AS employee_user_id FROM cuti.employees e JOIN cuti.users u ON u.id = e.user_id WHERE e.id = $1`,
      [request.employee_id],
    )
    const fullReq = {
      ...request,
      employee_user_id: empUserRes.rows[0]?.employee_user_id,
    }

    await notifyRequestLifecycle(client, {
      eventType: action,
      request: fullReq,
      actor: req.user,
      details: {
        decision,
        notes,
        nextRoleCode: nextStageInfo?.roleCode,
        nextStageCode: nextStageInfo?.stageCode,
      },
    })

    return { status: targetStatus }
  })
  res.json({ ok: true, status: result.status })
}))

app.get('/api/admin/calendar/versions', requireAuth, asyncRoute(async (req, res) => {
  const result = await pool.query(
    `SELECT id, code, name, status, effective_from::text, effective_to::text
     FROM cuti.work_calendar_versions
     ORDER BY effective_from DESC, created_at DESC`,
  )
  res.json({ items: result.rows })
}))

// ------------------------------------------------------------
// KATEGORI TANGGAL KALENDER (Admin & HR_ANALYST)
// ------------------------------------------------------------

const CALENDAR_CATEGORY_BEHAVIORS = ['SKIP', 'BLOCK', 'INFO']
const CALENDAR_CATEGORY_CODE = /^[A-Z][A-Z0-9_]{2,29}$/
const CALENDAR_CATEGORY_COLOR = /^#[0-9A-Fa-f]{6}$/

async function requireCalendarCategory(client, code) {
  const normalized = String(code || '').toUpperCase()
  const result = await client.query(
    `SELECT code FROM cuti.calendar_date_categories WHERE code = $1`,
    [normalized],
  )
  if (!result.rowCount) throw new HttpError(400, 'Jenis tanggal tidak valid.')
  return normalized
}

function validateCategoryInput(body, partial = false) {
  const out = {}
  if (!partial || body.code !== undefined) {
    const code = String(body?.code || '').trim().toUpperCase()
    if (!CALENDAR_CATEGORY_CODE.test(code)) {
      throw new HttpError(400, 'Kode kategori harus 3–30 huruf kapital, angka, atau garis bawah.')
    }
    out.code = code
  }
  if (!partial || body.name !== undefined) {
    const name = String(body?.name || '').trim()
    if (name.length < 3 || name.length > 100) throw new HttpError(400, 'Nama kategori harus 3–100 karakter.')
    out.name = name
  }
  if (!partial || body.behavior !== undefined) {
    const behavior = String(body?.behavior || '').toUpperCase()
    if (!CALENDAR_CATEGORY_BEHAVIORS.includes(behavior)) {
      throw new HttpError(400, 'Perilaku harus salah satu dari SKIP, BLOCK, atau INFO.')
    }
    out.behavior = behavior
  }
  if (!partial || body.color !== undefined) {
    const color = String(body?.color || '').trim()
    if (!CALENDAR_CATEGORY_COLOR.test(color)) throw new HttpError(400, 'Warna harus berupa kode hex #RRGGBB.')
    out.color = color
  }
  if (body.icon !== undefined) out.icon = String(body.icon || '').trim() || null
  if (body.description !== undefined) out.description = String(body.description || '').trim() || null
  return out
}

app.get('/api/admin/calendar/categories', requireAuth, asyncRoute(async (req, res) => {
  requireCalendarAdmin(req.user)
  const result = await pool.query(
    `SELECT c.id, c.code, c.name, c.behavior, c.color, c.icon, c.description,
            c.is_system, c.created_at::text, c.updated_at::text,
            (SELECT count(*) FROM cuti.work_calendar_dates d WHERE d.date_type = c.code) AS usage_count
     FROM cuti.calendar_date_categories c
     ORDER BY c.is_system DESC, c.name`,
  )
  res.json({ items: result.rows, behaviors: CALENDAR_CATEGORY_BEHAVIORS })
}))

app.post('/api/admin/calendar/categories', requireAuth, asyncRoute(async (req, res) => {
  requireCalendarAdmin(req.user)
  const input = validateCategoryInput(req.body)
  try {
    const result = await pool.query(
      `INSERT INTO cuti.calendar_date_categories
         (code, name, behavior, color, icon, description, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$7)
       RETURNING id, code, name, behavior, color, icon, description, is_system`,
      [input.code, input.name, input.behavior, input.color, input.icon, input.description, req.user.id],
    )
    res.status(201).json({ item: result.rows[0] })
  } catch (error) {
    if (error?.code === '23505') throw new HttpError(409, 'Kode kategori sudah digunakan.')
    throw error
  }
}))

app.put('/api/admin/calendar/categories/:id', requireAuth, asyncRoute(async (req, res) => {
  requireCalendarAdmin(req.user)
  const id = positiveId(req.params.id, 'Kategori')
  const current = await pool.query(
    `SELECT id, is_system FROM cuti.calendar_date_categories WHERE id = $1`,
    [id],
  )
  if (!current.rowCount) throw new HttpError(404, 'Kategori tidak ditemukan.')
  if (current.rows[0].is_system) throw new HttpError(403, 'Kategori bawaan tidak dapat diubah.')
  const input = validateCategoryInput(req.body)
  try {
    const result = await pool.query(
      `UPDATE cuti.calendar_date_categories
       SET code = $2, name = $3, behavior = $4, color = $5, icon = $6,
           description = $7, updated_by = $8
       WHERE id = $1
       RETURNING id, code, name, behavior, color, icon, description, is_system`,
      [id, input.code, input.name, input.behavior, input.color, input.icon, input.description, req.user.id],
    )
    res.json({ item: result.rows[0] })
  } catch (error) {
    if (error?.code === '23505') throw new HttpError(409, 'Kode kategori sudah digunakan.')
    throw error
  }
}))

app.delete('/api/admin/calendar/categories/:id', requireAuth, asyncRoute(async (req, res) => {
  requireCalendarAdmin(req.user)
  const id = positiveId(req.params.id, 'Kategori')
  const current = await pool.query(
    `SELECT id, code, is_system FROM cuti.calendar_date_categories WHERE id = $1`,
    [id],
  )
  if (!current.rowCount) throw new HttpError(404, 'Kategori tidak ditemukan.')
  if (current.rows[0].is_system) throw new HttpError(403, 'Kategori bawaan tidak dapat dihapus.')
  const used = await pool.query(
    `SELECT 1 FROM cuti.work_calendar_dates WHERE date_type = $1 LIMIT 1`,
    [current.rows[0].code],
  )
  if (used.rowCount) throw new HttpError(409, 'Kategori masih digunakan oleh tanggal kalender dan tidak dapat dihapus.')
  await pool.query(`DELETE FROM cuti.calendar_date_categories WHERE id = $1`, [id])
  res.json({ ok: true })
}))

app.get('/api/admin/calendar', requireAuth, asyncRoute(async (req, res) => {
  const values = []
  const conditions = []
  const add = (value) => {
    values.push(value)
    return `$${values.length}`
  }

  const versionId = optionalId(req.query.versionId, 'Versi kalender')
  if (versionId) conditions.push(`d.calendar_version_id = ${add(versionId)}`)

  const month = Number(req.query.month)
  if (month >= 1 && month <= 12) {
    conditions.push(`extract(month FROM d.calendar_date) = ${add(month)}`)
  }

  const year = Number(req.query.year)
  if (year >= 2000 && year <= 2100) {
    conditions.push(`extract(year FROM d.calendar_date) = ${add(year)}`)
  }

  const dateType = String(req.query.dateType || '').toUpperCase()
  if (CALENDAR_CATEGORY_CODE.test(dateType)) {
    conditions.push(`d.date_type = ${add(dateType)}`)
  }

  const status = String(req.query.status || '')
  if (status === 'active') conditions.push(`d.is_active = true`)
  else if (status === 'inactive') conditions.push(`d.is_active = false`)

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  const countResult = await pool.query(
    `SELECT count(*)::integer AS total FROM cuti.work_calendar_dates d ${where}`,
    values,
  )

  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200)
  const offset = Math.max(Number(req.query.offset) || 0, 0)
  values.push(limit, offset)

  const rows = await pool.query(
    `SELECT d.id, d.calendar_version_id, v.name AS version_name, v.status AS version_status,
            d.calendar_date::text, d.date_type, d.title, d.description,
            d.scope_type, d.organizational_unit_id,
            ou.name AS unit_name, d.is_active,
            d.created_at, d.updated_at,
            u.full_name AS created_by_name
     FROM cuti.work_calendar_dates d
     JOIN cuti.work_calendar_versions v ON v.id = d.calendar_version_id
     LEFT JOIN cuti.organizational_units ou ON ou.id = d.organizational_unit_id
     LEFT JOIN cuti.users u ON u.id = d.created_by
     ${where}
     ORDER BY d.calendar_date, d.date_type
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  )

  res.json({ items: rows.rows, total: countResult.rows[0].total })
}))

app.post('/api/admin/calendar', requireAuth, asyncRoute(async (req, res) => {
  requireCalendarAdmin(req.user)
  const calendarVersionId = positiveId(req.body?.calendarVersionId, 'Versi kalender')
  const calendarDate = String(req.body?.calendarDate || '')
  const dateType = String(req.body?.dateType || '')
  const title = String(req.body?.title || '').trim()
  const description = String(req.body?.description || '').trim() || null
  const scopeType = String(req.body?.scopeType || 'ALL')
  const unitId = scopeType === 'UNIT' ? positiveId(req.body?.unitId, 'Unit kerja') : null
  const isActive = req.body?.isActive
  if (typeof isActive !== 'boolean') throw new HttpError(400, 'Status aktif tidak valid.')

  if (!/^\d{4}-\d{2}-\d{2}$/.test(calendarDate)) throw new HttpError(400, 'Tanggal tidak valid.')
  parseDate(calendarDate)

  await requireCalendarCategory(pool, dateType)

  if (title.length < 3 || title.length > 150) throw new HttpError(400, 'Judul harus berisi 3 sampai 150 karakter.')
  if (!['ALL', 'UNIT'].includes(scopeType)) throw new HttpError(400, 'Cakupan tidak valid.')

  const created = await transaction(async (client) => {
    const versionResult = await client.query(
      `SELECT id, status, effective_from::text, effective_to::text
       FROM cuti.work_calendar_versions WHERE id = $1 FOR SHARE`,
      [calendarVersionId],
    )
    if (!versionResult.rowCount) throw new HttpError(404, 'Versi kalender tidak ditemukan.')
    const version = versionResult.rows[0]
    if (version.status === 'ARCHIVED') throw new HttpError(409, 'Versi kalender yang diarsipkan tidak dapat diubah.')
    if (calendarDate < version.effective_from ||
        (version.effective_to && calendarDate > version.effective_to)) {
      throw new HttpError(400, 'Tanggal harus berada dalam periode efektif versi kalender.')
    }

    if (unitId) {
      const unitResult = await client.query(
        `SELECT id FROM cuti.organizational_units WHERE id = $1 AND is_active AND deleted_at IS NULL`,
        [unitId],
      )
      if (!unitResult.rowCount) throw new HttpError(400, 'Pilih unit kerja yang aktif.')
    }

    // Check duplicate: same date + type + scope + unit on same version.
    const dupCheck = await client.query(
      `SELECT id FROM cuti.work_calendar_dates
       WHERE calendar_version_id = $1
         AND calendar_date = $2::date
         AND date_type = $3
         AND COALESCE(organizational_unit_id, 0) = COALESCE($4, 0)
         AND is_active`,
      [calendarVersionId, calendarDate, dateType, unitId],
    )
    if (dupCheck.rowCount) {
      throw new HttpError(409, 'Tanggal dengan jenis dan cakupan yang sama sudah ada pada versi kalender ini.')
    }

    const result = await client.query(
      `INSERT INTO cuti.work_calendar_dates (
         calendar_version_id, calendar_date, date_type, title, description,
         scope_type, organizational_unit_id, is_active, created_by, updated_by
       ) VALUES ($1,$2::date,$3,$4,$5,$6,$7,$8,$9,$9)
       RETURNING id`,
      [calendarVersionId, calendarDate, dateType, title, description,
       scopeType, unitId, isActive, req.user.id],
    )
    const id = result.rows[0].id

    await writeAudit(client, req, 'CALENDAR_DATE_CREATED', 'CALENDAR_DATE', id, null, {
      calendarVersionId, calendarDate, dateType, title, description, scopeType, unitId, isActive,
    })
    return id
  })

  res.status(201).json({ id: created })
}))

app.put('/api/admin/calendar/:id', requireAuth, asyncRoute(async (req, res) => {
  requireCalendarAdmin(req.user)
  const id = positiveId(req.params.id, 'ID tanggal kalender')
  const titleInput = req.body?.title
  const descriptionInput = req.body?.description
  const calendarDateInput = req.body?.calendarDate
  const dateTypeInput = req.body?.dateType
  const scopeTypeInput = req.body?.scopeType
  const isActive = req.body?.isActive

  if (typeof isActive !== 'boolean') throw new HttpError(400, 'Status aktif tidak valid.')

  await transaction(async (client) => {
    const currentResult = await client.query(
      `SELECT id, title, description, is_active, calendar_version_id,
              calendar_date::text, date_type, scope_type, organizational_unit_id
       FROM cuti.work_calendar_dates WHERE id = $1 FOR UPDATE`,
      [id],
    )
    const current = currentResult.rows[0]
    if (!current) throw new HttpError(404, 'Tanggal kalender tidak ditemukan.')
    const title = titleInput === undefined ? current.title : String(titleInput || '').trim()
    const description = descriptionInput === undefined
      ? current.description
      : String(descriptionInput || '').trim() || null
    const calendarDate = calendarDateInput === undefined
      ? current.calendar_date
      : String(calendarDateInput || '')
    const dateType = dateTypeInput === undefined ? current.date_type : String(dateTypeInput || '')
    const scopeType = scopeTypeInput === undefined ? current.scope_type : String(scopeTypeInput || '')
    const unitId = scopeType === 'UNIT'
      ? (req.body?.unitId === undefined
          ? current.organizational_unit_id
          : positiveId(req.body.unitId, 'Unit kerja'))
      : null

    if (title.length < 3 || title.length > 150) {
      throw new HttpError(400, 'Judul harus berisi 3 sampai 150 karakter.')
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(calendarDate)) throw new HttpError(400, 'Tanggal tidak valid.')
    parseDate(calendarDate)
    await requireCalendarCategory(client, dateType)
    if (!['ALL', 'UNIT'].includes(scopeType) || (scopeType === 'UNIT' && !unitId)) {
      throw new HttpError(400, 'Cakupan tanggal tidak valid.')
    }
    const versionResult = await client.query(
      `SELECT status, effective_from::text, effective_to::text
       FROM cuti.work_calendar_versions
       WHERE id = $1 FOR SHARE`,
      [current.calendar_version_id],
    )
    const version = versionResult.rows[0]
    if (!version || version.status === 'ARCHIVED') {
      throw new HttpError(409, 'Versi kalender yang diarsipkan tidak dapat diubah.')
    }
    if (calendarDate < version.effective_from ||
        (version.effective_to && calendarDate > version.effective_to)) {
      throw new HttpError(400, 'Tanggal harus berada dalam periode efektif versi kalender.')
    }
    if (unitId) {
      const unitResult = await client.query(
        `SELECT id FROM cuti.organizational_units
         WHERE id = $1 AND is_active AND deleted_at IS NULL`,
        [unitId],
      )
      if (!unitResult.rowCount) throw new HttpError(400, 'Pilih unit kerja yang aktif.')
    }
    if (isActive) {
      const duplicate = await client.query(
        `SELECT id FROM cuti.work_calendar_dates
         WHERE calendar_version_id = $1
           AND calendar_date = $2::date
           AND date_type = $3
           AND COALESCE(organizational_unit_id, 0) = COALESCE($4, 0)
           AND is_active AND id <> $5`,
        [current.calendar_version_id, calendarDate, dateType, unitId, id],
      )
      if (duplicate.rowCount) {
        throw new HttpError(409, 'Tanggal dengan jenis dan cakupan yang sama sudah ada pada versi kalender ini.')
      }
    }

    await client.query(
      `UPDATE cuti.work_calendar_dates
       SET calendar_date = $2::date, date_type = $3, title = $4, description = $5,
           scope_type = $6, organizational_unit_id = $7, is_active = $8,
           updated_by = $9, updated_at = now()
       WHERE id = $1`,
      [id, calendarDate, dateType, title, description, scopeType, unitId, isActive, req.user.id],
    )

    await writeAudit(client, req, 'CALENDAR_DATE_UPDATED', 'CALENDAR_DATE', id, {
      calendarDate: current.calendar_date,
      dateType: current.date_type,
      title: current.title,
      description: current.description,
      scopeType: current.scope_type,
      unitId: current.organizational_unit_id,
      isActive: current.is_active,
    }, {
      calendarDate,
      dateType,
      title,
      description,
      scopeType,
      unitId,
      isActive,
    })
  })

  res.json({ ok: true })
}))

app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError) {
    const message = error.code === 'LIMIT_FILE_SIZE'
      ? 'Ukuran lampiran maksimal 10 MB per file.'
      : 'Lampiran melebihi batas jumlah file.'
    res.status(400).json({ error: message })
    return
  }
  if (error instanceof UploadValidationError) {
    res.status(error.status).json({ error: error.message })
    return
  }
  if (error?.type === 'entity.too.large') {
    res.status(413).json({ error: 'Ukuran permintaan terlalu besar.' })
    return
  }
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message, ...(error.details ? { details: error.details } : {}) })
    return
  }
  if (error?.code === '23505') {
    const messages = {
      uq_users_username_lower: 'Username sudah digunakan.',
      uq_users_email_lower: 'Email akun sudah digunakan.',
      uq_employees_nip: 'NIP sudah terdaftar.',
      uq_employees_nik: 'NIK sudah terdaftar.',
      uq_employees_user: 'Pegawai sudah terhubung ke akun lain.',
      uq_work_calendar_dates_active: 'Tanggal dengan jenis dan cakupan yang sama sudah aktif.',
    }
    res.status(409).json({
      error: messages[error.constraint] || 'Data akun atau pegawai sudah terdaftar.',
    })
    return
  }
  if (error?.code === '23P01') {
    res.status(409).json({ error: 'Data bertabrakan dengan pengajuan atau transaksi lain.' })
    return
  }
  if (error?.code === '23514' || error?.code === '23503') {
    res.status(400).json({ error: 'Data tidak memenuhi aturan pengajuan cuti.' })
    return
  }
  console.error('API error:', error)
  res.status(500).json({ error: 'Terjadi kesalahan saat memproses permintaan.' })
})

app.get('/api/admin/audit', requireAuth, asyncRoute(async (req, res) => {
  requireAdmin(req.user)
  const values = []
  const conditions = []
  const add = (value) => {
    values.push(value)
    return `$${values.length}`
  }
  const actorId = optionalId(req.query.actorUserId, 'Actor audit')
  if (actorId !== null) conditions.push(`a.actor_user_id = ${add(actorId)}`)
  const action = String(req.query.action || '').trim()
  if (/^[A-Z0-9_]{3,80}$/i.test(action)) conditions.push(`a.action = ${add(action)}`)
  const role = String(req.query.role || '').trim()
  if (/^[A-Z0-9_]{2,40}$/i.test(role)) conditions.push(`a.actor_role_code = ${add(role)}`)
  const entityType = String(req.query.entityType || '').trim()
  if (/^[A-Z0-9_]{2,80}$/i.test(entityType)) conditions.push(`a.entity_type = ${add(entityType)}`)
  const entityId = optionalId(req.query.entityId, 'Entitas audit')
  if (entityId !== null) conditions.push(`a.entity_id = ${add(entityId)}`)
  const validDate = /^\d{4}-\d{2}-\d{2}$/
  const from = String(req.query.from || '')
  const to = String(req.query.to || '')
  if (validDate.test(from)) conditions.push(`a.created_at >= ${add(from)}::date`)
  if (validDate.test(to)) conditions.push(`a.created_at < (${add(to)}::date + 1)`)
  const search = String(req.query.q || '').trim()
  if (search) {
    const param = add(`%${search}%`)
    conditions.push(`(a.actor_name ILIKE ${param} OR a.entity_label ILIKE ${param} OR a.entity_key ILIKE ${param} OR a.action ILIKE ${param})`)
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const countResult = await pool.query(`SELECT count(*)::integer AS total FROM cuti.audit_logs a ${where}`, values)
  const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 100)
  const offset = Math.max(Number(req.query.offset) || 0, 0)
  const result = await pool.query(
    `SELECT a.id, a.actor_user_id, a.actor_name, a.actor_role_code, a.action,
            a.entity_type, a.entity_id, a.entity_key, a.entity_label,
            a.before_values, a.after_values, a.reason, a.ip_address::text, a.created_at
     FROM cuti.audit_logs a
     ${where}
     ORDER BY a.created_at DESC, a.id DESC
     LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, limit, offset],
  )
  const facets = await Promise.all([
    pool.query(`SELECT DISTINCT action FROM cuti.audit_logs ORDER BY action`),
    pool.query(`SELECT DISTINCT entity_type FROM cuti.audit_logs ORDER BY entity_type`),
    pool.query(`SELECT DISTINCT actor_user_id AS id, actor_name AS name FROM cuti.audit_logs WHERE actor_user_id IS NOT NULL ORDER BY actor_name`),
    pool.query(`SELECT DISTINCT actor_role_code AS code FROM cuti.audit_logs WHERE actor_role_code IS NOT NULL ORDER BY actor_role_code`),
  ])
  res.json({
    items: result.rows.map((row) => ({
      id: row.id,
      actorUserId: row.actor_user_id,
      actorName: row.actor_name,
      actorRoleCode: row.actor_role_code,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      entityKey: row.entity_key,
      entityLabel: row.entity_label,
      beforeValues: row.before_values,
      afterValues: row.after_values,
      reason: row.reason,
      ipAddress: row.ip_address,
      createdAt: row.created_at,
    })),
    summary: { total: countResult.rows[0].total },
    filters: { actions: facets[0].rows, entityTypes: facets[1].rows, actors: facets[2].rows, roles: facets[3].rows },
  })
}))

app.get('/api/admin/audit/export.csv', requireAuth, asyncRoute(async (req, res) => {
  requireAdmin(req.user)
  const values = []
  const conditions = []
  const add = (value) => {
    values.push(value)
    return `$${values.length}`
  }
  const actorId = optionalId(req.query.actorUserId, 'Actor audit')
  if (actorId !== null) conditions.push(`a.actor_user_id = ${add(actorId)}`)
  const action = String(req.query.action || '').trim()
  if (/^[A-Z0-9_]{3,80}$/i.test(action)) conditions.push(`a.action = ${add(action)}`)
  const role = String(req.query.role || '').trim()
  if (/^[A-Z0-9_]{2,40}$/i.test(role)) conditions.push(`a.actor_role_code = ${add(role)}`)
  const entityType = String(req.query.entityType || '').trim()
  if (/^[A-Z0-9_]{2,80}$/i.test(entityType)) conditions.push(`a.entity_type = ${add(entityType)}`)
  const validDate = /^\d{4}-\d{2}-\d{2}$/
  const from = String(req.query.from || '')
  const to = String(req.query.to || '')
  if (validDate.test(from)) conditions.push(`a.created_at >= ${add(from)}::date`)
  if (validDate.test(to)) conditions.push(`a.created_at < (${add(to)}::date + 1)`)
  const search = String(req.query.q || '').trim()
  if (search) {
    const param = add(`%${search}%`)
    conditions.push(`(a.actor_name ILIKE ${param} OR a.entity_label ILIKE ${param} OR a.entity_key ILIKE ${param} OR a.action ILIKE ${param})`)
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const result = await pool.query(
    `SELECT a.created_at, a.actor_name, a.actor_role_code, a.action, a.entity_type,
            a.entity_key, a.entity_label, a.reason, a.before_values, a.after_values
     FROM cuti.audit_logs a
     ${where}
     ORDER BY a.created_at DESC, a.id DESC
     LIMIT 10000`,
    values,
  )
  const cell = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`
  const lines = [['Waktu', 'Pelaku', 'Role', 'Tindakan', 'Entitas', 'Alasan', 'Sebelum', 'Sesudah'].map(cell).join(',')]
  for (const row of result.rows) {
    const entity = [row.entity_type, row.entity_key || row.entity_label].filter(Boolean).join(': ')
    lines.push([
      row.created_at, row.actor_name || 'Sistem', row.actor_role_code || '', row.action, entity, row.reason || '',
      row.before_values ? JSON.stringify(row.before_values) : '',
      row.after_values ? JSON.stringify(row.after_values) : '',
    ].map(cell).join(','))
  }
  res.setHeader('Content-Disposition', 'attachment; filename="audit-log.csv"')
  res.type('text/csv').send(`\uFEFF${lines.join('\r\n')}`)
}))

async function settingValue(client, key, fallback = '') {
  const result = await client.query(
    `SELECT value #>> '{}' AS value FROM cuti.system_settings WHERE key = $1`,
    [key],
  )
  return result.rows[0]?.value || fallback
}

async function loadDocumentData(client, requestId) {
  const requestResult = await client.query(
    `SELECT r.*, r.start_date::text AS start_date_text, r.end_date::text AS end_date_text,
            lt.code AS leave_type_code, lt.name AS leave_type_name
     FROM cuti.leave_requests r
     JOIN cuti.leave_types lt ON lt.id = r.leave_type_id
     WHERE r.id = $1`,
    [requestId],
  )
  const request = requestResult.rows[0]
  if (!request) throw new HttpError(404, 'Pengajuan tidak ditemukan.')
  const [approvalsResult, signaturesResult, balancesResult, employeeSignatureResult] = await Promise.all([
    client.query(
      `SELECT action, decision, notes, actor_role_code, actor_name, created_at
       FROM cuti.leave_approvals WHERE leave_request_id = $1 ORDER BY created_at, id`,
      [requestId],
    ),
    client.query(
      `SELECT ds.signer_role_code, ds.signer_name, ds.signer_identity_number,
              ds.document_hash, ds.signature_hash, ds.signed_at, us.storage_key
       FROM cuti.document_signatures ds
       LEFT JOIN cuti.user_signatures us ON us.id = ds.user_signature_id
       WHERE ds.leave_request_id = $1
       ORDER BY ds.signed_at, ds.id`,
      [requestId],
    ),
    client.query(
      `SELECT period_year, allocated_days, used_days, reserved_days, available_days
       FROM cuti.leave_balances
       WHERE employee_id = $1 AND leave_type_id = $2 AND period_year BETWEEN $3 AND $4
       ORDER BY period_year`,
      [request.employee_id, request.leave_type_id, Number(request.balance_period_year || 0) - 2, Number(request.balance_period_year || 0)],
    ),
    client.query(
      `SELECT us.storage_key FROM cuti.user_signatures us
       WHERE us.user_id = (SELECT user_id FROM cuti.employees WHERE id = $1)
         AND us.is_active
       ORDER BY us.created_at DESC LIMIT 1`,
      [request.employee_id],
    ),
  ])
  return {
    request,
    approvals: approvalsResult.rows,
    signatures: signaturesResult.rows,
    balances: balancesResult.rows,
    employeeSignature: employeeSignatureResult.rows[0] || null,
    sourceHash: hash(JSON.stringify({
      requestNumber: request.request_number,
      startDate: request.start_date,
      endDate: request.end_date,
      reason: request.reason,
      templateVersion: DOCUMENT_TEMPLATE_VERSION,
    })),
  }
}

function signatureImageLoader(signature) {
  if (!signature?.storage_key) return null
  return readFile(safeStoragePath(signature.storage_key))
    .then(buf => {
      // Skip placeholder/tiny images (likely 1x1 pixel placeholders)
      if (buf.length < 200) return null
      return buf
    })
    .catch(() => null)
}

app.get('/api/me/signature', requireAuth, asyncRoute(async (req, res) => {
  const result = await pool.query(
    `SELECT storage_key, mime_type FROM cuti.user_signatures
     WHERE user_id = $1 AND is_active ORDER BY created_at DESC LIMIT 1`,
    [req.user.id],
  )
  const signature = result.rows[0]
  if (!signature) throw new HttpError(404, 'Tanda tangan belum tersedia.')
  const file = await readFile(safeStoragePath(signature.storage_key)).catch(() => null)
  if (!file) throw new HttpError(404, 'Berkas tanda tangan tidak ditemukan.')
  res.type(signature.mime_type)
  res.send(file)
}))

// ------------------------------------------------------------
// PROFIL PENGGUNA (foto profil). Tanda tangan tetap di /api/signature.
// ------------------------------------------------------------

// Data profil milik sendiri + status tanda tangan.
app.get('/api/profile', requireAuth, asyncRoute(async (req, res) => {
  const [result, sig, userRow] = await Promise.all([
    pool.query(
      `SELECT p.avatar_mime, p.avatar_size, p.avatar_sha256, p.updated_at,
              (p.avatar_storage_key IS NOT NULL) AS has_avatar
       FROM cuti.user_profiles p WHERE p.user_id = $1`,
      [req.user.id],
    ),
    pool.query(
      `SELECT id, mime_type, file_size, created_at FROM cuti.user_signatures
       WHERE user_id = $1 AND is_active LIMIT 1`,
      [req.user.id],
    ),
    pool.query(`SELECT username, email, full_name FROM cuti.users WHERE id = $1`, [req.user.id]),
  ])
  const profile = result.rows[0] || { has_avatar: false }
  const u = userRow.rows[0] || {}
  res.json({
    user: {
      id: req.user.id,
      username: u.username || req.user.username,
      fullName: u.full_name || req.user.fullName,
      email: u.email || null,
      roles: (req.user.roles || []).map(r => r.code),
    },
    avatar: profile.has_avatar ? {
      mime: profile.avatar_mime,
      size: profile.avatar_size,
      sha256: profile.avatar_sha256,
      updatedAt: profile.updated_at,
    } : null,
    signature: sig.rows[0] || null,
    limits: {
      avatar: { maxBytes: LIMITS.AVATAR.maxBytes, maxEdge: LIMITS.AVATAR.maxEdge, mime: LIMITS.AVATAR.mime },
      signature: { maxBytes: LIMITS.SIGNATURE.maxBytes, maxEdge: LIMITS.SIGNATURE.maxEdge, mime: LIMITS.SIGNATURE.mime },
    },
  })
}))

// Ambil gambar avatar (publik untuk user terautentikasi, tapi hanya milik sendiri lewat /me).
app.get('/api/profile/avatar', requireAuth, asyncRoute(async (req, res) => {
  const result = await pool.query(
    `SELECT avatar_storage_key, avatar_mime FROM cuti.user_profiles WHERE user_id = $1`,
    [req.user.id],
  )
  const row = result.rows[0]
  if (!row?.avatar_storage_key) {
    res.status(204).end()
    return
  }
  const file = await readFile(safeStoragePath(row.avatar_storage_key)).catch(() => null)
  if (!file) {
    res.status(204).end()
    return
  }
  res.type(row.avatar_mime)
  res.setHeader('Cache-Control', 'private, max-age=300')
  res.send(file)
}))

// Upload / ganti foto profil (multipart, tepat 1 file).
app.post('/api/profile/avatar', requireAuth, upload.single('avatar'), asyncRoute(async (req, res) => {
  if (!req.file) throw new HttpError(400, 'Pilih file foto profil.')
  const validated = await validateUpload(req.file.buffer, 'AVATAR', req.file.originalname)
  const target = safeStoragePath(validated.storageKey)
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, req.file.buffer, { flag: 'wx' })

  const client = await pool.connect()
  const old = []
  try {
    await client.query('BEGIN')
    const prev = await client.query(
      `SELECT avatar_storage_key FROM cuti.user_profiles WHERE user_id = $1 FOR UPDATE`,
      [req.user.id],
    )
    if (prev.rows[0]?.avatar_storage_key) old.push(prev.rows[0].avatar_storage_key)
    await client.query(
      `INSERT INTO cuti.user_profiles
         (user_id, avatar_storage_key, avatar_mime, avatar_size, avatar_sha256, updated_at)
       VALUES ($1,$2,$3,$4,$5, now())
       ON CONFLICT (user_id) DO UPDATE SET
         avatar_storage_key = EXCLUDED.avatar_storage_key,
         avatar_mime = EXCLUDED.avatar_mime,
         avatar_size = EXCLUDED.avatar_size,
         avatar_sha256 = EXCLUDED.avatar_sha256,
         updated_at = now()`,
      [req.user.id, validated.storageKey, validated.mime, validated.size, validated.sha256],
    )
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    await unlink(target).catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
  for (const key of old) await unlink(safeStoragePath(key)).catch(() => undefined)
  res.status(201).json({ ok: true, avatar: { mime: validated.mime, size: validated.size } })
}))

// Hapus foto profil.
app.delete('/api/profile/avatar', requireAuth, asyncRoute(async (req, res) => {
  const client = await pool.connect()
  let oldKey = null
  try {
    await client.query('BEGIN')
    const prev = await client.query(
      `SELECT avatar_storage_key FROM cuti.user_profiles WHERE user_id = $1 FOR UPDATE`,
      [req.user.id],
    )
    oldKey = prev.rows[0]?.avatar_storage_key || null
    await client.query(
      `UPDATE cuti.user_profiles
       SET avatar_storage_key = NULL, avatar_mime = NULL, avatar_size = NULL,
           avatar_sha256 = NULL, updated_at = now()
       WHERE user_id = $1`,
      [req.user.id],
    )
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
  if (oldKey) await unlink(safeStoragePath(oldKey)).catch(() => undefined)
  res.json({ ok: true })
}))

app.get('/api/requests/:id/preview-document', requireAuth, asyncRoute(async (req, res) => {
  const result = await transaction(async (client) => {
    const document = await loadDocumentData(client, req.params.id)
    if (!(await canReadRequest(req.user, document.request))) {
      throw new HttpError(404, 'Pengajuan tidak ditemukan dalam lingkup akses Anda.')
    }
    const pdf = await generateLeavePdf({
      request: document.request,
      approvals: document.approvals,
      signatures: document.signatures,
      balances: document.balances,
      employeeSignature: document.employeeSignature,
      letterNumber: document.request.letter_number || '',
      previewMode: true,
      signatureImageLoader,
    })
    return { pdf, request: document.request }
  })
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `inline; filename="Pratinjau-${result.request.request_number}.pdf"`)
  // Pratinjau selalu dibuat ulang; jangan biarkan browser memakai PDF lama.
  res.setHeader('Cache-Control', 'no-store, max-age=0')
  res.send(result.pdf)
}))

app.get('/api/requests/:id/pdf', requireAuth, asyncRoute(async (req, res) => {
  const result = await transaction(async (client) => {
    const document = await loadDocumentData(client, req.params.id)
    if (!(await canReadRequest(req.user, document.request))) {
      throw new HttpError(404, 'Pengajuan tidak ditemukan dalam lingkup akses Anda.')
    }
    const request = document.request
    if (String(request.status) !== 'APPROVED') {
      throw new HttpError(409, 'PDF final hanya tersedia untuk pengajuan yang disetujui.')
    }
    const required = [request.employee_identity_number, request.reason, request.address_during_leave, request.phone, request.leave_type_name]
    if (required.some((value) => !value || !String(value).trim())) {
      throw new HttpError(400, 'Data wajib belum lengkap. PDF final tidak dapat dibuat.')
    }

    const existing = await client.query(
      `SELECT id, storage_key, mime_type, source_hash FROM cuti.documents
       WHERE leave_request_id = $1 AND document_type = 'FORM_FINAL' AND is_final`,
      [request.id],
    )
    if (existing.rowCount && existing.rows[0].source_hash === document.sourceHash) {
      return {
        pdf: await readFile(safeStoragePath(existing.rows[0].storage_key)),
        request,
        reused: true,
      }
    }
    if (existing.rowCount) {
      const stale = existing.rows[0]
      await client.query(`DELETE FROM cuti.documents WHERE id = $1`, [stale.id])
      await unlink(safeStoragePath(stale.storage_key)).catch(() => {})
      await client.query(
        `INSERT INTO cuti.leave_request_events
           (leave_request_id, event_type, from_status, to_status, description, actor_user_id, actor_role_code, payload)
         VALUES ($1,'DOCUMENT_GENERATED','APPROVED','APPROVED',$2,$3,'ADMIN',$4::jsonb)`,
        [request.id, 'Template formulir diperbarui; PDF final dibuat ulang.', req.user.id,
          JSON.stringify({ previousDocumentId: stale.id, templateVersion: DOCUMENT_TEMPLATE_VERSION })],
      )
    }

    let letterNumber = request.letter_number
    if (!letterNumber) {
      const pattern = await settingValue(client, 'document.letter_number_pattern', '{SEQ}/{UNIT}/{YYYY}')
      const unitCodeResult = await client.query(
        `SELECT code FROM cuti.organizational_units WHERE id = $1`,
        [request.employee_unit_id],
      )
      letterNumber = (
        await client.query(
          `SELECT cuti.fn_next_document_number($1::bigint, $2::varchar, $3::smallint, 'LETTER_NUMBER', $4::varchar) AS number`,
          [request.employee_unit_id, unitCodeResult.rows[0]?.code || null, Number(String(request.start_date_text).slice(0, 4)), pattern],
        )
      ).rows[0].number
      await client.query(
        `UPDATE cuti.leave_requests
         SET letter_number = $2, letter_number_year = $3, letter_unit_id = $4, updated_at = now()
         WHERE id = $1`,
        [request.id, letterNumber, Number(String(request.start_date_text).slice(0, 4)), request.employee_unit_id],
      )
      await client.query(
        `INSERT INTO cuti.leave_request_events
           (leave_request_id, event_type, from_status, to_status, description, actor_user_id, actor_role_code, payload)
         VALUES ($1,'LETTER_NUMBER_CHANGED','APPROVED','APPROVED',$2,$3,'ADMIN',$4::jsonb)`,
        [request.id, `Nomor surat dibuat: ${letterNumber}`, req.user.id, JSON.stringify({ letterNumber })],
      )
    }

    const token = crypto.randomBytes(24).toString('hex')
    const pdf = await generateLeavePdf({
      request: { ...request, letter_number: letterNumber },
      approvals: document.approvals,
      signatures: document.signatures,
      balances: document.balances,
      employeeSignature: document.employeeSignature,
      letterNumber,
      previewMode: false,
      signatureImageLoader,
    })
    const storageKey = `documents/${token}.pdf`
    const target = path.join(storageRoot, storageKey)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(safeStoragePath(storageKey), pdf, { flag: 'wx' })
    const pdfHash = hash(pdf)
    const inserted = await client.query(
      `INSERT INTO cuti.documents (
         leave_request_id, document_type, version, storage_key, original_filename,
         mime_type, file_size, sha256, source_hash, verification_token,
         is_final, generated_by
       ) VALUES ($1,'FORM_FINAL',1,$2,$3,'application/pdf',$4,$5,$6,$7,true,$8)
       RETURNING id`,
      [
        request.id,
        storageKey,
        `Formulir-Cuti-${request.request_number}.pdf`,
        pdf.length,
        pdfHash,
        document.sourceHash,
        token,
        req.user.id,
      ],
    )
    await client.query(
      `INSERT INTO cuti.leave_request_events
         (leave_request_id, event_type, from_status, to_status, description, actor_user_id, actor_role_code, payload)
       VALUES ($1,'DOCUMENT_GENERATED','APPROVED','APPROVED','PDF final dan QR verifikasi dibuat.',$2,'ADMIN',$3::jsonb)`,
      [request.id, req.user.id, JSON.stringify({ documentId: inserted.rows[0].id, sha256: pdfHash, sourceHash: document.sourceHash })],
    )
    await writeAudit(client, req, 'DOCUMENT_GENERATED', 'DOCUMENT', inserted.rows[0].id, null, {
      requestNumber: request.request_number,
      letterNumber,
      sha256: pdfHash,
      sourceHash: document.sourceHash,
    })
    return { pdf, request: { ...request, letter_number: letterNumber }, reused: false }
  })
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `attachment; filename="Formulir-Cuti-${result.request.request_number}.pdf"`)
  res.send(result.pdf)
}))

app.get('/api/verify/:token', requireAuth, asyncRoute(async (req, res) => {
  const result = await pool.query(
    `SELECT * FROM cuti.v_document_verification WHERE verification_token = $1`,
    [req.params.token],
  )
  const document = result.rows[0]
  if (!document) throw new HttpError(404, 'Dokumen verifikasi tidak ditemukan.')
  const signatures = await pool.query(
    `SELECT signer_role_code, signer_name, signer_identity_number,
            signed_payload ->> 'decision' AS decision, signed_at
     FROM cuti.document_signatures
     WHERE leave_request_id = $1
     ORDER BY signed_at`,
    [document.leave_request_id],
  )
  res.json({
    document: {
      requestNumber: document.request_number,
      letterNumber: document.letter_number,
      requestStatus: document.request_status,
      employeeName: document.employee_name,
      employeeIdentityNumber: document.employee_identity_number,
      employeeCategory: document.employee_category,
      startDate: document.start_date,
      endDate: document.end_date,
      workingDays: document.requested_working_days,
      sha256: document.sha256,
      sourceHash: document.source_hash,
      isFinal: document.is_final,
      generatedAt: document.generated_at,
    },
    signatures: signatures.rows,
  })
}))

// ============================================================
// REPORTS & EXPORTS
// ============================================================

app.get('/api/admin/reports/leaves', requireAuth, asyncRoute(async (req, res) => {
  requireAdmin(req.user)
  const validDateRe = /^\d{4}-\d{2}-\d{2}$/
  const startDate = String(req.query.startDate || '')
  const endDate = String(req.query.endDate || '')
  if (startDate && !validDateRe.test(startDate)) throw new HttpError(400, 'Format startDate harus YYYY-MM-DD.')
  if (endDate && !validDateRe.test(endDate)) throw new HttpError(400, 'Format endDate harus YYYY-MM-DD.')
  const unitId = optionalId(req.query.unitId, 'Unit laporan')
  const routeId = optionalId(req.query.routeId, 'Rute laporan')
  const leaveTypeId = optionalId(req.query.leaveTypeId, 'Jenis cuti laporan')

  // Categories pulled from employee table distinct set within filter range
  const categoriesResult = await pool.query(
    `SELECT DISTINCT e.employment_category
     FROM cuti.employees e
     WHERE e.deleted_at IS NULL`,
  )
  const unitsResult = await pool.query(
    `SELECT id, name FROM cuti.organizational_units WHERE deleted_at IS NULL ORDER BY name`,
  )
  const routesResult = await pool.query(
    `SELECT id, code, name FROM cuti.approval_routes WHERE is_active ORDER BY id`,
  )
  const leaveTypesResult = await pool.query(
    `SELECT id, code, name, deducts_annual_balance FROM cuti.leave_types WHERE is_active ORDER BY sort_order`,
  )
  const categoryCodes = ['PNS_TU', 'PNS', 'PPPK_PPNPN_TU', 'PPPK_PPNPN', 'KONTRAK']
  const categoryId = String(req.query.categoryId || '').trim()
  const categoryIdClean = categoryCodes.includes(categoryId) ? categoryId : null

  const params = { startDate: startDate || null, endDate: endDate || null, unitId, routeId, leaveTypeId, categoryId: categoryIdClean }
  const qbase = buildReportBaseQuery(params)

  // Summary metrics
  const summaryRows = await pool.query(qbase.summarySql, qbase.values)
  const summary = summaryRows.rows[0] || { total_submissions: 0, approved_count: 0, rejected_count: 0, cancelled_count: 0, total_requested_days: 0, total_approved_days: 0, avg_duration: 0 }

  // Per-unit pivot
  const pivotRows = await pool.query(qbase.pivotSql, qbase.values)
  const pivotMap = {}
  for (const row of pivotRows.rows) {
    const uname = row.unit_name
    if (!pivotMap[uname]) pivotMap[uname] = { unitName: uname, unitId: row.unit_id, typeCounts: {}, approvedCount: 0, totalCount: 0 }
    const bucket = pivotMap[uname]
    bucket.typeCounts[row.leave_type_code] = Number(row.cnt)
    bucket.totalCount += Number(row.cnt)
    if (row.status === 'APPROVED') bucket.approvedCount += Number(row.cnt)
  }
  const recapRows = Object.values(pivotMap).sort((a, b) => (a.unitId ?? 0) - (b.unitId ?? 0))

  // Composition
  const compRows = await pool.query(qbase.compSql, qbase.values)
  const totalSubs = Number(summary.total_submissions) || 1
  const composition = compRows.rows.map((r) => ({
    leaveTypeCode: r.leave_type_code,
    leaveTypeName: r.leave_type_name,
    deductsAnnual: !!r.deducts_annual_balance,
    count: Number(r.cnt),
    pct: totalSubs > 0 ? Math.round(Number(r.cnt) / totalSubs * 10000) / 100 : 0,
  }))

  // Cancellations detail
  const cancelRows = await pool.query(qbase.cancelSql, qbase.values)

  res.json({
    summary: {
      totalPengajuan: Number(summary.total_submissions) || 0,
      totalDisetujui: Number(summary.approved_count) || 0,
      totalDitolak: Number(summary.rejected_count) || 0,
      totalPembatalan: Number(summary.cancelled_count) || 0,
      totalHariDiberikan: Number(summary.total_approved_days) || 0,
      rataRataDurasi: Number(summary.avg_duration) || 0,
    },
    recapPerUnit: recapRows,
    composition,
    cancellations: cancelRows.rows.map((r) => ({
      requestNumber: r.request_number,
      employeeName: r.employee_name,
      employeeCategory: r.employee_category,
      employeeUnitName: r.employee_unit_name,
      leaveTypeName: r.leave_type_name,
      startDate: r.start_date,
      endDate: r.end_date,
      approvedDays: r.approved_working_days,
      usedDays: r.used_days,
      restoredDays: r.restored_days,
      cancellationReason: r.cancellation_reason,
      cancelledAt: r.cancelled_at,
      processedByName: r.processed_by_name,
    })),
    filters: { units: unitsResult.rows, categories: categoryCodes, routes: routesResult.rows, leaveTypes: leaveTypesResult.rows },
  })
}))

async function loadReportForExport(query) {
  const validDateRe = /^\d{4}-\d{2}-\d{2}$/
  const startDate = String(query.startDate || '')
  const endDate = String(query.endDate || '')
  if (startDate && !validDateRe.test(startDate)) throw new HttpError(400, 'Format startDate harus YYYY-MM-DD.')
  if (endDate && !validDateRe.test(endDate)) throw new HttpError(400, 'Format endDate harus YYYY-MM-DD.')
  const unitId = optionalId(query.unitId, 'Unit laporan')
  const routeId = optionalId(query.routeId, 'Rute laporan')
  const leaveTypeId = optionalId(query.leaveTypeId, 'Jenis cuti laporan')
  const categoryCodes = ['PNS_TU', 'PNS', 'PPPK_PPNPN_TU', 'PPPK_PPNPN', 'KONTRAK']
  const categoryId = String(query.categoryId || '').trim()
  const categoryIdClean = categoryCodes.includes(categoryId) ? categoryId : null

  const params = {
    startDate: startDate || null,
    endDate: endDate || null,
    unitId,
    routeId,
    leaveTypeId,
    categoryId: categoryIdClean,
  }
  const qbase = buildReportBaseQuery(params)
  const [summaryRows, pivotRows, compRows, cancelRows, leaveTypesResult, unitsResult, routesResult] = await Promise.all([
    pool.query(qbase.summarySql, qbase.values),
    pool.query(qbase.pivotSql, qbase.values),
    pool.query(qbase.compSql, qbase.values),
    pool.query(qbase.cancelSql, qbase.values),
    pool.query(`SELECT id, code, name, deducts_annual_balance FROM cuti.leave_types WHERE is_active ORDER BY sort_order`),
    pool.query(`SELECT id, name FROM cuti.organizational_units WHERE deleted_at IS NULL ORDER BY name`),
    pool.query(`SELECT id, code, name FROM cuti.approval_routes WHERE is_active ORDER BY id`),
  ])
  const summary = summaryRows.rows[0] || {}
  const pivotMap = {}
  for (const row of pivotRows.rows) {
    if (!pivotMap[row.unit_name]) {
      pivotMap[row.unit_name] = { unitName: row.unit_name, unitId: row.unit_id, typeCounts: {}, approvedCount: 0, totalCount: 0 }
    }
    const bucket = pivotMap[row.unit_name]
    bucket.typeCounts[row.leave_type_code] = Number(row.cnt)
    bucket.totalCount += Number(row.cnt)
    if (row.status === 'APPROVED') bucket.approvedCount += Number(row.cnt)
  }
  const recapPerUnit = Object.values(pivotMap).sort((a, b) => (a.unitId ?? 0) - (b.unitId ?? 0))
  const totalSubs = Number(summary.total_submissions) || 1
  const composition = compRows.rows.map((r) => ({
    leaveTypeCode: r.leave_type_code,
    leaveTypeName: r.leave_type_name,
    deductsAnnual: !!r.deducts_annual_balance,
    count: Number(r.cnt),
    pct: Math.round(Number(r.cnt) / totalSubs * 10000) / 100,
  }))
  const cancellations = cancelRows.rows.map((r) => ({
    requestNumber: r.request_number,
    employeeName: r.employee_name,
    employeeCategory: r.employee_category,
    employeeUnitName: r.employee_unit_name,
    leaveTypeName: r.leave_type_name,
    startDate: r.start_date,
    endDate: r.end_date,
    approvedDays: r.approved_working_days,
    usedDays: r.used_days,
    restoredDays: r.restored_days,
    cancellationReason: r.cancellation_reason,
    cancelledAt: r.cancelled_at,
    processedByName: r.processed_by_name,
  }))
  const label = (list, id, field = 'name') => list.find((item) => String(item.id) === String(id))?.[field] || '—'
  const filtersText = [
    `Periode: ${startDate || 'semua'} s.d. ${endDate || 'semua'}`,
    `Unit: ${unitId !== null ? label(unitsResult.rows, unitId) : 'Semua'}`,
    `Kategori: ${categoryIdClean || 'Semua'}`,
    `Rute: ${routeId !== null ? label(routesResult.rows, routeId) : 'Semua'}`,
    `Jenis cuti: ${leaveTypeId !== null ? label(leaveTypesResult.rows, leaveTypeId) : 'Semua'}`,
  ].join('  |  ')

  return {
    summary: {
      totalPengajuan: Number(summary.total_submissions) || 0,
      totalDisetujui: Number(summary.approved_count) || 0,
      totalDitolak: Number(summary.rejected_count) || 0,
      totalPembatalan: Number(summary.cancelled_count) || 0,
      totalHariDiberikan: Number(summary.total_approved_days) || 0,
      rataRataDurasi: Number(summary.avg_duration) || 0,
    },
    recapPerUnit,
    composition,
    cancellations,
    leaveTypes: leaveTypesResult.rows,
    filtersText,
  }
}

app.get('/api/admin/reports/leaves.pdf', requireAuth, asyncRoute(async (req, res) => {
  requireAdmin(req.user)
  const report = await loadReportForExport(req.query)
  const pdf = await generateReportPdf(report)
  const today = new Date().toISOString().slice(0, 10)
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `attachment; filename="Laporan-Cuti-${today}.pdf"`)
  res.send(pdf)
}))

app.get('/api/admin/reports/leaves.xls', requireAuth, asyncRoute(async (req, res) => {
  requireAdmin(req.user)
  const report = await loadReportForExport(req.query)
  const summary = {
    total_submissions: report.summary.totalPengajuan,
    approved_count: report.summary.totalDisetujui,
    rejected_count: report.summary.totalDitolak,
    cancelled_count: report.summary.totalPembatalan,
    total_approved_days: report.summary.totalHariDiberikan,
    avg_duration: report.summary.rataRataDurasi,
  }
  const compRows = report.composition.map((row) => ({
    leave_type_name: row.leaveTypeName,
    deducts_annual_balance: row.deductsAnnual,
    cnt: row.count,
    pct: row.pct,
  }))
  const cancelRows = report.cancellations.map((row) => ({
    request_number: row.requestNumber,
    employee_name: row.employeeName,
    employee_category: row.employeeCategory,
    employee_unit_name: row.employeeUnitName,
    leave_type_name: row.leaveTypeName,
    start_date: row.startDate,
    end_date: row.endDate,
    approved_working_days: row.approvedDays,
    used_days: row.usedDays,
    restored_days: row.restoredDays,
    cancellation_reason: row.cancellationReason,
    cancelled_at: row.cancelledAt,
    processed_by_name: row.processedByName,
  }))
  const sheets = [
    buildSummarySheet(summary),
    buildRecapSheet(report.recapPerUnit),
    buildCompositionSheet(compRows),
    buildCancellationSheet(cancelRows),
  ]
  const xml = buildXlsWorkbook(sheets)
  const today = new Date().toISOString().slice(0, 10)
  res.setHeader('Content-Type', 'application/vnd.ms-excel')
  res.setHeader('Content-Disposition', `attachment; filename="Laporan-Cuti-${today}.xls"`)
  res.send(xml)
}))

function buildCompositionSheet(rows) {
  const h = ['Jenis Cuti', 'Potong Saldo Tahunan', 'Jumlah', 'Persentase']
  const mapped = rows.map((r) => [r.leave_type_name, r.deducts_annual_balance ? 'Ya' : 'Tidak', Number(r.cnt) || 0, `${Number(r.pct) || 0}%`])
  return worksheet('Komposisi', 'Komposisi', h, mapped, { 0: 260, 1: 160, 2: 100, 3: 100 })
}

function buildReportBaseQuery(params) {
  const values = []
  const conditions = ['e.deleted_at IS NULL']
  const add = (value) => { values.push(value); return `$${values.length}` }
  if (params.startDate) conditions.push(`lr.start_date >= ${add(params.startDate)}`)
  if (params.endDate) conditions.push(`lr.end_date <= ${add(params.endDate)}`)
  if (params.unitId !== null) conditions.push(`lr.employee_unit_id = ${add(params.unitId)}`)
  if (params.categoryId) conditions.push(`e.employment_category = ${add(params.categoryId)}`)
  if (params.routeId !== null) conditions.push(`lr.route_id = ${add(params.routeId)}`)
  if (params.leaveTypeId !== null) conditions.push(`lr.leave_type_id = ${add(params.leaveTypeId)}`)
  const where = conditions.join(' AND ')
  const baseJoin = `FROM cuti.leave_requests lr JOIN cuti.employees e ON e.id = lr.employee_id`
  const pivotJoin = `${baseJoin} LEFT JOIN cuti.organizational_units ou ON ou.id = lr.employee_unit_id LEFT JOIN cuti.leave_types lt ON lt.id = lr.leave_type_id`
  const cancelJoin = `${baseJoin} LEFT JOIN cuti.leave_cancellations lc ON lc.leave_request_id = lr.id AND lr.status IN ('WITHDRAWN','CANCELLED') LEFT JOIN cuti.users u ON u.id = lc.processed_by_user_id`
  const whereClause = `WHERE ${where}`
  const summarySql = `
    SELECT
      COUNT(*) AS total_submissions,
      SUM(CASE WHEN lr.status = 'APPROVED' THEN 1 ELSE 0 END) AS approved_count,
      SUM(CASE WHEN lr.status = 'REJECTED' THEN 1 ELSE 0 END) AS rejected_count,
      SUM(CASE WHEN lr.status IN ('WITHDRAWN','CANCELLED') THEN 1 ELSE 0 END) AS cancelled_count,
      COALESCE(SUM(lr.requested_working_days), 0) AS total_requested_days,
      COALESCE(SUM(lr.approved_working_days), 0) AS total_approved_days,
      ROUND(COALESCE(AVG(lr.requested_working_days)::numeric, 0), 2) AS avg_duration
    ${baseJoin} ${whereClause}`
  const pivotSql = `
    SELECT ou.name AS unit_name, ou.id AS unit_id, lt.code AS leave_type_code, lr.status, COUNT(*) AS cnt
    ${pivotJoin} ${whereClause}
    GROUP BY ou.name, ou.id, lt.code, lt.sort_order, lr.status
    ORDER BY ou.name, lt.sort_order`
  const compSql = `
    SELECT lt.code AS leave_type_code, lt.name AS leave_type_name, lt.deducts_annual_balance, COUNT(*) AS cnt
    ${baseJoin} JOIN cuti.leave_types lt ON lt.id = lr.leave_type_id
    ${whereClause}
    GROUP BY lt.code, lt.name, lt.deducts_annual_balance, lt.sort_order
    ORDER BY lt.sort_order`
  const cancelSql = `
    SELECT lr.request_number, lr.employee_name, lr.employee_category, lr.employee_unit_name,
           lt.name AS leave_type_name, lr.start_date::text AS start_date, lr.end_date::text AS end_date,
           lr.approved_working_days, lc.used_days, lc.restored_days,
           lc.reason AS cancellation_reason, lc.cancelled_at::text AS cancelled_at,
           u.full_name AS processed_by_name
    ${cancelJoin} JOIN cuti.leave_types lt ON lt.id = lr.leave_type_id
    WHERE ${where} AND lr.status IN ('WITHDRAWN','CANCELLED')
    ORDER BY lr.submitted_at DESC`
  return { summarySql, pivotSql, compSql, cancelSql, values }
}

function escapeXml(str) {
  if (str === null || str === undefined) return ''
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function cellValue(v, type = 'String') {
  const display = v === null || v === undefined ? '' : (type === 'Number' ? Number(v) : escapeXml(v))
  return `<Cell><Data ss:Type="${type}">${display}</Data></Cell>`
}

function headerRow(cells) {
  return '<Row>' + cells.map((c) => `<Cell><Data ss:Type="String">${escapeXml(c)}</Data></Cell>`).join('') + '</Row>'
}

function dataRow(values, types = []) {
  return '<Row>' + values.map((v, i) => cellValue(v, types[i] || 'String')).join('') + '</Row>'
}

function worksheet(name, title, headers, rows, widthOverrides = {}) {
  const colWidths = Object.entries(widthOverrides).map(([i, w]) => `<Column ss:Width="${w}"/>`).join('')
  return `
    <Worksheet ss:Name="${escapeXml(name)}">
      <Table x:FullColumns="1" x:FullRows="1">
        ${colWidths}
        <Row>${headers.map((h) => `<Cell ss:StyleID="header"><Data ss:Type="String">${escapeXml(h)}</Data></Cell>`).join('')}</Row>
        ${rows.map((r) => dataRow(r)).join('\n')}
      </Table>
      <x:ExcelDocumentContents>
        <x:SheetPosition X="${name === 'Ringkasan' ? 0 : name === 'Rekap Satuan Kerja' ? 1 : 2}"/>
      </x:ExcelDocumentContents>
    </Worksheet>`
}

function buildXlsWorkbook(sheetXmlParts) {
  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:x="urn:schemas-microsoft-com:office:excel">
  <Styles>
    <Style ss:id="header">
      <Font ss:Bold="1" ss:Color="#FFFFFF"/>
      <Interior ss:Color="#4472C4" ss:Pattern="Solid"/>
      <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
      <Borders>
        <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/>
      </Borders>
    </Style>
  </Styles>
  ${sheetXmlParts.join('\n\n  ')}
</Workbook>`
}

function buildSummarySheet(summary) {
  const h = ['Total Pengajuan', 'Disetujui', 'Ditolak', 'Pembatalan', 'Total Hari Diberikan', 'Rata-rata Durasi (hari)']
  const r = [[
    summary.total_submissions ?? 0,
    summary.approved_count ?? 0,
    summary.rejected_count ?? 0,
    summary.cancelled_count ?? 0,
    summary.total_approved_days ?? 0,
    summary.avg_duration ?? 0,
  ]]
  return worksheet('Ringkasan', 'Ringkasan', h, r, { 0: 160, 1: 100, 2: 80, 3: 90, 4: 150, 5: 180 })
}

function buildRecapSheet(rows) {
  const h = ['Nama Satuan Kerja', 'Cuti Tahunan', 'Cuti Besar', 'Cuti Sakit', 'Cuti Melahirkan', 'Cuti Alasan Penting', 'Cuti di Luar TN', 'Total']
  const codes = ['ANNUAL', 'LONG', 'SICK', 'MATERNITY', 'IMPORTANT_REASON', 'UNPAID']
  const mapped = rows.map((r) => {
    const tc = r.typeCounts || {}
    const total = codes.reduce((s, c) => s + (tc[c] || 0), 0)
    return [r.unitName, tc.ANNUAL ?? 0, tc.LONG ?? 0, tc.SICK ?? 0, tc.MATERNITY ?? 0, tc.IMPORTANT_REASON ?? 0, tc.UNPAID ?? 0, total]
  })
  return worksheet('Rekap Satuan Kerja', 'Rekap Satuan Kerja', h, mapped, { 0: 220, 1: 120, 2: 100, 3: 100, 4: 120, 5: 150, 6: 160, 7: 80 })
}

function buildCancellationSheet(rows) {
  const h = ['Nomor Pengajuan', 'Pegawai', 'Kategori', 'Satuan Kerja', 'Jenis Cuti', 'Tanggal Mulai', 'Tanggal Selesai', 'Disetujui', 'Digunakan', 'Dikembalikan', 'Alasan', 'Waktu Pembatalan', 'Petugas']
  const mapped = rows.map((r) => [
    r.request_number, r.employee_name, r.employee_category, r.employee_unit_name,
    r.leave_type_name, r.start_date, r.end_date, r.approved_working_days ?? 0,
    r.used_days ?? 0, r.restored_days ?? 0, r.cancellation_reason ?? '', r.cancelled_at ?? '',
    r.processed_by_name ?? '',
  ])
  return worksheet('Pembatalan', 'Pembatalan', h, mapped, { 0: 140, 1: 140, 2: 90, 3: 160, 4: 110, 5: 110, 6: 110, 7: 70, 8: 70, 9: 80, 10: 260, 11: 140, 12: 140 })
}


// Jalankan migration sebelum menerima request, lalu mulai server.
;(async () => {
  try {
    await runMigrations(pool)
    app.listen(port, host, () => {
      console.log(`Cuti API berjalan di http://${host}:${port}`)
    })
  } catch (error) {
    console.error('Gagal menjalankan migration:', error)
    process.exit(1)
  }
})()

// ============================================================
// CALENDAR VERSION MANAGEMENT
// ============================================================

app.post('/api/admin/calendar/versions', requireAuth, asyncRoute(async (req, res) => {
  requireCalendarAdmin(req.user)
  const code = String(req.body?.code || '').trim()
  const name = String(req.body?.name || '').trim()
  const effectiveFrom = String(req.body?.effectiveFrom || '')
  const effectiveTo = req.body?.effectiveTo ? String(req.body?.effectiveTo) : null
  const status = String(req.body?.status || 'DRAFT')

  if (!/^[A-Za-z0-9._-]{3,30}$/.test(code)) {
    throw new HttpError(400, 'Kode versi harus 3-30 karakter: huruf, angka, titik, underscore, dash.')
  }
  if (name.length < 3 || name.length > 150) throw new HttpError(400, 'Nama versi harus 3-150 karakter.')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) throw new HttpError(400, 'Tanggal mulai efektif tidak valid.')
  if (effectiveTo && !/^\d{4}-\d{2}-\d{2}$/.test(effectiveTo)) throw new HttpError(400, 'Tanggal akhir efektif tidak valid.')
  if (!['DRAFT', 'ACTIVE', 'ARCHIVED'].includes(status)) throw new HttpError(400, 'Status versi tidak valid.')

  parseDate(effectiveFrom)
  if (effectiveTo) parseDate(effectiveTo)
  if (effectiveTo && effectiveTo < effectiveFrom) throw new HttpError(400, 'Tanggal akhir harus setelah tanggal mulai.')

  const created = await transaction(async (client) => {
    if (status === 'ACTIVE') {
      const overlap = await client.query(
        `SELECT id FROM cuti.work_calendar_versions
         WHERE status = 'ACTIVE'
           AND effective_from <= $2::date
           AND (effective_to IS NULL OR effective_to >= $1::date)`,
        [effectiveFrom, effectiveTo || '9999-12-31']
      )
      if (overlap.rowCount) throw new HttpError(409, 'Terdapat versi ACTIVE lain yang periode-nya tumpang tindih.')
    }

    const result = await client.query(
      `INSERT INTO cuti.work_calendar_versions (code, name, effective_from, effective_to, status, created_by, published_at)
       VALUES ($1,$2,$3::date,$4::date,$5::varchar,$6,CASE WHEN $5='ACTIVE' THEN now() END)
       RETURNING id`,
      [code, name, effectiveFrom, effectiveTo, status, req.user.id]
    )
    await writeAudit(client, req, 'CALENDAR_VERSION_CREATED', 'CALENDAR_VERSION', result.rows[0].id, null, {
      code, name, effectiveFrom, effectiveTo, status
    })
    return result.rows[0].id
  })
  res.status(201).json({ id: created })
}))

app.put('/api/admin/calendar/versions/:id', requireAuth, asyncRoute(async (req, res) => {
  requireCalendarAdmin(req.user)
  const id = positiveId(req.params.id, 'ID versi kalender')
  const nameInput = req.body?.name
  const effectiveFromInput = req.body?.effectiveFrom
  const effectiveToInput = req.body?.effectiveTo
  const statusInput = req.body?.status

  await transaction(async (client) => {
    const currentResult = await client.query(
      `SELECT id, code, name, status, effective_from::text, effective_to::text
       FROM cuti.work_calendar_versions WHERE id = $1 FOR UPDATE`,
      [id]
    )
    const current = currentResult.rows[0]
    if (!current) throw new HttpError(404, 'Versi kalender tidak ditemukan.')

    const name = nameInput === undefined ? current.name : String(nameInput || '').trim()
    const effectiveFrom = effectiveFromInput === undefined ? current.effective_from : String(effectiveFromInput || '')
    const effectiveTo = effectiveToInput === undefined ? current.effective_to : (effectiveToInput ? String(effectiveToInput) : null)
    const status = statusInput === undefined ? current.status : String(statusInput || '')

    if (name.length < 3 || name.length > 150) throw new HttpError(400, 'Nama versi harus 3-150 karakter.')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) throw new HttpError(400, 'Tanggal mulai efektif tidak valid.')
    if (effectiveTo && !/^\d{4}-\d{2}-\d{2}$/.test(effectiveTo)) throw new HttpError(400, 'Tanggal akhir efektif tidak valid.')
    if (!['DRAFT', 'ACTIVE', 'ARCHIVED'].includes(status)) throw new HttpError(400, 'Status versi tidak valid.')

    parseDate(effectiveFrom)
    if (effectiveTo) parseDate(effectiveTo)
    if (effectiveTo && effectiveTo < effectiveFrom) throw new HttpError(400, 'Tanggal akhir harus setelah tanggal mulai.')

    if (current.status === 'ARCHIVED' && status !== 'ARCHIVED') {
      throw new HttpError(409, 'Versi ARCHIVED tidak dapat diubah kembali.')
    }
    if (status === 'ACTIVE' && current.status !== 'ACTIVE') {
      const overlap = await client.query(
        `SELECT id FROM cuti.work_calendar_versions
         WHERE id <> $1 AND status = 'ACTIVE'
           AND effective_from <= $3::date
           AND (effective_to IS NULL OR effective_to >= $2::date)`,
        [id, effectiveFrom, effectiveTo || '9999-12-31']
      )
      if (overlap.rowCount) throw new HttpError(409, 'Terdapat versi ACTIVE lain yang periode-nya tumpang tindih.')
    }

    await client.query(
      `UPDATE cuti.work_calendar_versions
       SET name = $2, effective_from = $3::date, effective_to = $4::date,
           status = $5::varchar, published_at = CASE WHEN $5 = 'ACTIVE' AND published_at IS NULL THEN now() ELSE published_at END,
           updated_at = now()
       WHERE id = $1`,
      [id, name, effectiveFrom, effectiveTo, status]
    )

    await writeAudit(client, req, 'CALENDAR_VERSION_UPDATED', 'CALENDAR_VERSION', id, {
      name: current.name,
      effectiveFrom: current.effective_from,
      effectiveTo: current.effective_to,
      status: current.status
    }, {
      name, effectiveFrom, effectiveTo, status
    })
  })
  res.json({ ok: true })
}))

app.delete('/api/admin/calendar/versions/:id', requireAuth, asyncRoute(async (req, res) => {
  requireCalendarAdmin(req.user)
  const id = positiveId(req.params.id, 'ID versi kalender')

  await transaction(async (client) => {
    const currentResult = await client.query(
      `SELECT id, status FROM cuti.work_calendar_versions WHERE id = $1 FOR UPDATE`,
      [id]
    )
    const current = currentResult.rows[0]
    if (!current) throw new HttpError(404, 'Versi kalender tidak ditemukan.')
    if (current.status === 'ACTIVE') throw new HttpError(409, 'Versi ACTIVE tidak dapat dihapus. Arsipkan dahulu.')

    await client.query(`DELETE FROM cuti.work_calendar_dates WHERE calendar_version_id = $1`, [id])
    await client.query(`DELETE FROM cuti.work_calendar_versions WHERE id = $1`, [id])

    await writeAudit(client, req, 'CALENDAR_VERSION_DELETED', 'CALENDAR_VERSION', id, { status: current.status }, null)
  })
  res.json({ ok: true })
}))

// ============================================================
// CALENDAR MARKERS (untuk DatePicker / tampilan pegawai)
// Resolusi versi ACTIVE otomatis & hormati cakupan unit pegawai.
// ============================================================

app.get('/api/calendar/markers', requireAuth, asyncRoute(async (req, res) => {
  const year = Number(req.query.year)
  const month = Number(req.query.month)
  if (!year || year < 2000 || year > 2100) throw new HttpError(400, 'Tahun tidak valid.')
  if (!month || month < 1 || month > 12) throw new HttpError(400, 'Bulan tidak valid.')

  const monthStart = new Date(Date.UTC(year, month - 1, 1))
  const monthEnd = new Date(Date.UTC(year, month, 0))
  const anchor = monthStart.toISOString().slice(0, 10)

  const versionResult = await pool.query(
    `SELECT id, code, name FROM cuti.work_calendar_versions
     WHERE status = 'ACTIVE' AND effective_from <= $1
       AND (effective_to IS NULL OR effective_to >= $1)
     ORDER BY effective_from DESC LIMIT 1`,
    [anchor],
  )
  const version = versionResult.rows[0] || null

  let unitId = null
  if (req.user.employee?.id) {
    const assignment = await pool.query(
      `SELECT organizational_unit_id FROM cuti.v_employee_current_assignment WHERE employee_id = $1`,
      [req.user.employee.id],
    )
    unitId = assignment.rows[0]?.organizational_unit_id || null
  }

  const categoriesResult = await pool.query(
    `SELECT code, name, behavior, color, icon FROM cuti.calendar_date_categories ORDER BY name`,
  )
  const categories = categoriesResult.rows

  let markers = []
  if (version) {
    const datesResult = await pool.query(
      `SELECT d.calendar_date::text AS date, d.date_type AS code, d.title,
              c.name, c.behavior, c.color, c.icon, d.scope_type
       FROM cuti.work_calendar_dates d
       JOIN cuti.calendar_date_categories c ON c.code = d.date_type
       WHERE d.calendar_version_id = $1 AND d.is_active
         AND d.calendar_date BETWEEN $2::date AND $3::date
         AND (d.scope_type = 'ALL' OR d.organizational_unit_id = $4)
       ORDER BY d.calendar_date, (c.behavior = 'BLOCK'), (d.scope_type = 'UNIT')`,
      [version.id, monthStart.toISOString().slice(0, 10), monthEnd.toISOString().slice(0, 10), unitId],
    )
    markers = datesResult.rows.map(row => ({
      date: row.date,
      code: row.code,
      title: row.title,
      name: row.name,
      behavior: row.behavior,
      color: row.color,
      icon: row.icon,
      scopeType: row.scope_type,
    }))
  }

  res.json({ year, month, version, categories, markers })
}))

// ============================================================
// CALENDAR GRID VIEW (6 rows Mon-Sun for UI)
// ============================================================

app.get('/api/admin/calendar/grid', requireAuth, asyncRoute(async (req, res) => {
  const versionId = positiveId(req.query.versionId, 'Versi kalender')
  const year = Number(req.query.year)
  const month = Number(req.query.month)
  if (!year || year < 2000 || year > 2100) throw new HttpError(400, 'Tahun tidak valid.')
  if (!month || month < 1 || month > 12) throw new HttpError(400, 'Bulan tidak valid.')

  const versionResult = await pool.query(
    `SELECT id, status FROM cuti.work_calendar_versions WHERE id = $1`,
    [versionId]
  )
  if (!versionResult.rowCount) throw new HttpError(404, 'Versi kalender tidak ditemukan.')

  const startOfMonth = new Date(Date.UTC(year, month - 1, 1))
  const endOfMonth = new Date(Date.UTC(year, month, 0))
  const startOfGrid = new Date(startOfMonth)
  const firstDayOfWeek = startOfMonth.getUTCDay()
  const offset = firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1
  startOfGrid.setUTCDate(startOfGrid.getUTCDate() - offset)

  const endOfGrid = new Date(endOfMonth)
  const lastDayOfWeek = endOfMonth.getUTCDay()
  const endOffset = lastDayOfWeek === 0 ? 0 : 7 - lastDayOfWeek
  endOfGrid.setUTCDate(endOfGrid.getUTCDate() + endOffset)

  const gridStart = startOfGrid.toISOString().slice(0, 10)
  const gridEnd = endOfGrid.toISOString().slice(0, 10)

  const datesResult = await pool.query(
    `SELECT d.calendar_date::text, d.date_type, d.title, d.is_active, d.scope_type, d.organizational_unit_id,
            c.name AS category_name, c.behavior, c.color, c.icon
     FROM cuti.work_calendar_dates d
     JOIN cuti.calendar_date_categories c ON c.code = d.date_type
     WHERE d.calendar_version_id = $1 AND d.is_active
       AND d.calendar_date BETWEEN $2::date AND $3::date
     ORDER BY d.calendar_date`,
    [versionId, gridStart, gridEnd]
  )

  const specialDates = new Map()
  for (const row of datesResult.rows) {
    specialDates.set(row.calendar_date, row)
  }

  const todayStr = new Date().toISOString().slice(0, 10)
  const grid = []
  let cursor = new Date(startOfGrid)
  while (cursor <= endOfGrid) {
    const week = []
    for (let i = 0; i < 7; i++) {
      const dateStr = cursor.toISOString().slice(0, 10)
      const isCurrentMonth = cursor.getUTCMonth() === month - 1 && cursor.getUTCFullYear() === year
      const isToday = dateStr === todayStr
      const special = specialDates.get(dateStr)
      week.push({
        date: dateStr,
        isCurrentMonth,
        isToday,
        special: special ? {
          type: special.date_type,
          title: special.title,
          isActive: special.is_active,
          scopeType: special.scope_type,
          unitId: special.organizational_unit_id,
          name: special.category_name,
          behavior: special.behavior,
          color: special.color,
          icon: special.icon,
        } : null
      })
      cursor.setUTCDate(cursor.getUTCDate() + 1)
    }
    grid.push(week)
  }

  const categoriesResult = await pool.query(
    `SELECT id, code, name, behavior, color, icon, is_system
     FROM cuti.calendar_date_categories ORDER BY is_system DESC, name`,
  )

  res.json({
    year, month,
    grid,
    version: versionResult.rows[0],
    categories: categoriesResult.rows,
    dateTypes: categoriesResult.rows.map(row => row.code),
  })
}))

// ============================================================
// CALENDAR IMPORT (preview & commit)
// ============================================================

app.post('/api/admin/calendar/import/preview', requireAuth, upload.single('file'), asyncRoute(async (req, res) => {
  requireCalendarAdmin(req.user)
  const versionId = positiveId(req.body?.versionId, 'Versi kalender')
  const file = req.file
  if (!file) throw new HttpError(400, 'File CSV tidak ditemukan.')

  const text = file.buffer.toString('utf-8')
  const lines = text.trim().split(/\r?\n/)
  if (lines.length < 2) throw new HttpError(400, 'File CSV kosong atau tidak memiliki data.')

  const headers = lines[0].split(',').map(h => h.trim().toLowerCase())
  const requiredHeaders = ['date', 'type', 'title']
  for (const reqHeader of requiredHeaders) {
    if (!headers.includes(reqHeader)) {
      throw new HttpError(400, `Header CSV wajib ada: ${requiredHeaders.join(', ')}`)
    }
  }

  const versionResult = await pool.query(
    `SELECT id, status, effective_from::text, effective_to::text
     FROM cuti.work_calendar_versions WHERE id = $1`,
    [versionId]
  )
  if (!versionResult.rowCount) throw new HttpError(404, 'Versi kalender tidak ditemukan.')
  if (versionResult.rows[0].status === 'ARCHIVED') throw new HttpError(409, 'Versi ARCHIVED tidak dapat diubah.')

  const version = versionResult.rows[0]
  const validTypesResult = await pool.query(`SELECT code FROM cuti.calendar_date_categories`)
  const validTypes = new Set(validTypesResult.rows.map(row => row.code))
  const rows = []
  const errors = []
  const seen = new Set()

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    const values = line.split(',').map(v => v.trim())
    if (values.length < headers.length) {
      errors.push({ row: i + 1, error: 'Jumlah kolom tidak sesuai header.' })
      continue
    }
    const obj = {}
    for (let j = 0; j < headers.length; j++) obj[headers[j]] = values[j] || ''

    const date = obj.date
    const type = obj.type?.toUpperCase()
    const title = obj.title
    const description = obj.description || null
    const scopeType = (obj.scopetype || 'ALL').toUpperCase()
    const unitCode = obj.unitcode || null
    const isActive = obj.isactive !== 'false'

    const rowErrors = []
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) rowErrors.push('Format tanggal tidak valid (YYYY-MM-DD).')
    else {
      try { parseDate(date) } catch { rowErrors.push('Tanggal tidak valid.') }
    }
    if (!validTypes.has(type)) rowErrors.push('Jenis tanggal tidak valid.')
    if (!title || title.length < 3 || title.length > 150) rowErrors.push('Judul 3-150 karakter.')

    let unitId = null
    if (scopeType === 'UNIT') {
      if (!unitCode) rowErrors.push('Kode unit wajib untuk cakupan UNIT.')
      else {
        const unitResult = await pool.query(
          `SELECT id FROM cuti.organizational_units WHERE code = $1 AND is_active AND deleted_at IS NULL`,
          [unitCode]
        )
        if (!unitResult.rowCount) rowErrors.push(`Unit dengan kode ${unitCode} tidak ditemukan.`)
        else unitId = unitResult.rows[0].id
      }
    } else if (scopeType !== 'ALL') {
      rowErrors.push('Cakupan harus ALL atau UNIT.')
    }

    if (date < version.effective_from || (version.effective_to && date > version.effective_to)) {
      rowErrors.push('Tanggal di luar periode efektif versi kalender.')
    }

    const key = `${date}|${type}|${scopeType}|${unitId || 'ALL'}`
    if (seen.has(key)) rowErrors.push('Duplikat dalam file yang sama.')
    seen.add(key)

    if (rowErrors.length) {
      errors.push({ row: i + 1, error: rowErrors.join('; '), data: obj })
    } else {
      rows.push({ date, type, title, description, scopeType, unitId, isActive })
    }
  }

  const existingCheck = await pool.query(
    `SELECT calendar_date::text, date_type, COALESCE(organizational_unit_id, 0) AS unit_id
     FROM cuti.work_calendar_dates
     WHERE calendar_version_id = $1 AND is_active`,
    [versionId]
  )
  const existing = new Set(existingCheck.rows.map(r => `${r.calendar_date}|${r.date_type}|${r.unit_id}`))

  for (const row of rows) {
    const key = `${row.date}|${row.type}|${row.unitId || 0}`
    if (existing.has(key)) {
      row.duplicateInDb = true
    }
  }

  res.json({
    version: { id: version.id, status: version.status },
    validRows: rows.length,
    rows,
    errors,
    hasErrors: errors.length > 0
  })
}))

app.post('/api/admin/calendar/import/commit', requireAuth, asyncRoute(async (req, res) => {
  requireCalendarAdmin(req.user)
  const versionId = positiveId(req.body?.versionId, 'Versi kalender')
  const rows = req.body?.rows
  if (!Array.isArray(rows) || rows.length === 0) throw new HttpError(400, 'Tidak ada data untuk diimpor.')

  const versionResult = await pool.query(
    `SELECT id, status FROM cuti.work_calendar_versions WHERE id = $1 FOR SHARE`,
    [versionId]
  )
  if (!versionResult.rowCount) throw new HttpError(404, 'Versi kalender tidak ditemukan.')
  if (versionResult.rows[0].status === 'ARCHIVED') throw new HttpError(409, 'Versi ARCHIVED tidak dapat diubah.')

  const importCategories = await pool.query(`SELECT code FROM cuti.calendar_date_categories`)
  const importTypeSet = new Set(importCategories.rows.map(row => row.code))

  const created = await transaction(async (client) => {
    let count = 0
    for (const row of rows) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date)) continue
      if (!importTypeSet.has(row.type)) continue
      if (!row.title || row.title.length < 3 || row.title.length > 150) continue

      const dupCheck = await client.query(
        `SELECT id FROM cuti.work_calendar_dates
         WHERE calendar_version_id = $1
           AND calendar_date = $2::date
           AND date_type = $3
           AND COALESCE(organizational_unit_id, 0) = COALESCE($4, 0)
           AND is_active`,
        [versionId, row.date, row.type, row.unitId]
      )
      if (dupCheck.rowCount) continue

      await client.query(
        `INSERT INTO cuti.work_calendar_dates (
           calendar_version_id, calendar_date, date_type, title, description,
           scope_type, organizational_unit_id, is_active, created_by, updated_by
         ) VALUES ($1,$2::date,$3,$4,$5,$6,$7,$8,$9,$9)`,
        [versionId, row.date, row.type, row.title, row.description || null,
         row.scopeType || 'ALL', row.unitId, row.isActive !== false, req.user.id]
      )
      count++
    }

    await writeAudit(client, req, 'CALENDAR_IMPORTED', 'CALENDAR_VERSION', versionId, null, {
      importedCount: count,
      requestedCount: rows.length
    })
    return count
  })

  res.json({ imported: created })
}))

// ============================================================
// CALENDAR QUICK TOGGLE (for the recent list toggle in UI)
// ============================================================

app.patch('/api/admin/calendar/:id/toggle', requireAuth, asyncRoute(async (req, res) => {
  requireCalendarAdmin(req.user)
  const id = positiveId(req.params.id, 'ID tanggal kalender')
  const isActive = req.body?.isActive
  if (typeof isActive !== 'boolean') throw new HttpError(400, 'Status aktif tidak valid.')

  await transaction(async (client) => {
    const currentResult = await client.query(
      `SELECT id, is_active, calendar_version_id, calendar_date::text, date_type,
              scope_type, organizational_unit_id
       FROM cuti.work_calendar_dates WHERE id = $1 FOR UPDATE`,
      [id]
    )
    const current = currentResult.rows[0]
    if (!current) throw new HttpError(404, 'Tanggal kalender tidak ditemukan.')

    const versionResult = await client.query(
      `SELECT status, effective_from::text, effective_to::text
       FROM cuti.work_calendar_versions WHERE id = $1 FOR SHARE`,
      [current.calendar_version_id]
    )
    if (!versionResult.rowCount || versionResult.rows[0].status === 'ARCHIVED') {
      throw new HttpError(409, 'Versi kalender tidak valid atau sudah diarsipkan.')
    }

    if (isActive) {
      const dupCheck = await client.query(
        `SELECT id FROM cuti.work_calendar_dates
         WHERE calendar_version_id = $1
           AND calendar_date = $2::date
           AND date_type = $3
           AND COALESCE(organizational_unit_id, 0) = COALESCE($4, 0)
           AND is_active AND id <> $5`,
        [current.calendar_version_id, current.calendar_date, current.date_type, current.organizational_unit_id, id]
      )
      if (dupCheck.rowCount) throw new HttpError(409, 'Tanggal dengan jenis dan cakupan yang sama sudah aktif.')
    }

    await client.query(
      `UPDATE cuti.work_calendar_dates
       SET is_active = $2, updated_by = $3, updated_at = now()
       WHERE id = $1`,
      [id, isActive, req.user.id]
    )

    await writeAudit(client, req, isActive ? 'CALENDAR_DATE_ACTIVATED' : 'CALENDAR_DATE_DEACTIVATED', 'CALENDAR_DATE', id, {
      isActive: current.is_active
    }, { isActive })
  })
  res.json({ ok: true })
}))

// Error handler untuk route yang didaftarkan setelah middleware error pertama.
app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError) {
    const message = error.code === 'LIMIT_FILE_SIZE'
      ? 'Ukuran file melebihi batas yang ditentukan.'
      : 'Jumlah file melebihi batas yang ditentukan.'
    res.status(400).json({ error: message })
    return
  }
  if (error instanceof UploadValidationError) {
    res.status(error.status).json({ error: error.message })
    return
  }
  if (error?.type === 'entity.too.large') {
    res.status(413).json({ error: 'Ukuran permintaan terlalu besar.' })
    return
  }
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message, ...(error.details ? { details: error.details } : {}) })
    return
  }
  if (error?.code === '23505') {
    res.status(409).json({ error: 'Data sudah terdaftar.' })
    return
  }
  if (error?.code === '23514' || error?.code === '23503') {
    res.status(400).json({ error: 'Data tidak memenuhi aturan pengajuan cuti.' })
    return
  }
  console.error('API error:', error)
  res.status(500).json({ error: 'Terjadi kesalahan saat memproses permintaan.' })
})
