import test from 'node:test'
import assert from 'node:assert/strict'
import {
  calculateUsedWorkingDays,
  canEmployeeWithdraw,
  canAdminCancel,
  withdrawLeaveRequest,
  cancelLeaveRequest,
} from '../cancellation.js'

function createMockClient({ request, balance, days = [], stages = [], shouldFailAt = null, latestLedgerType = 'RESERVATION' }) {
  const queries = []
  return {
    queries,
    async query(sql, params = []) {
      queries.push({ sql, params })
      const s = sql.trim().toUpperCase()

      if (shouldFailAt && s.includes(shouldFailAt.toUpperCase())) {
        const err = new Error(`Simulated database failure at ${shouldFailAt}`)
        err.code = '23505'
        throw err
      }

      if (s.startsWith('SELECT R.*') || (s.includes('FROM CUTI.LEAVE_REQUESTS R') && s.includes('FOR UPDATE'))) {
        return { rowCount: request ? 1 : 0, rows: request ? [request] : [] }
      }
      if (s.includes('FROM CUTI.LEAVE_REQUEST_DAYS')) {
        return { rowCount: days.length, rows: days }
      }
      if (s.includes('FROM CUTI.LEAVE_REQUEST_STAGES')) {
        return { rowCount: stages.length, rows: stages }
      }
      // Transaksi ledger terakhir untuk request (gate anti double-release K2).
      if (s.includes('FROM CUTI.LEAVE_BALANCE_TRANSACTIONS')) {
        return { rowCount: 1, rows: latestLedgerType ? [{ transaction_type: latestLedgerType }] : [] }
      }
      if (s.includes('FROM CUTI.LEAVE_BALANCES') && s.includes('FOR UPDATE')) {
        return { rowCount: balance ? 1 : 0, rows: balance ? [balance] : [] }
      }
      if (s.startsWith('UPDATE CUTI.LEAVE_REQUESTS')) {
        return { rowCount: 1, rows: [] }
      }
      if (s.startsWith('INSERT INTO CUTI.LEAVE_BALANCE_TRANSACTIONS')) {
        return { rowCount: 1, rows: [{ id: 999 }] }
      }
      if (s.startsWith('INSERT INTO CUTI.LEAVE_CANCELLATIONS')) {
        return { rowCount: 1, rows: [{ id: 888 }] }
      }
      if (s.startsWith('INSERT INTO CUTI.LEAVE_REQUEST_EVENTS')) {
        return { rowCount: 1, rows: [{ id: 777 }] }
      }
      if (s.startsWith('INSERT INTO CUTI.AUDIT_LOGS') || s.startsWith('INSERT INTO CUTI.NOTIFICATIONS')) {
        return { rowCount: 1, rows: [] }
      }
      return { rowCount: 0, rows: [] }
    },
  }
}

const adminUser = { id: 2, fullName: 'Admin TU', roles: [{ code: 'ADMIN' }] }
const employeeUser = { id: 10, fullName: 'Pegawai Test', roles: [{ code: 'EMPLOYEE' }] }

test('AT-048: Pegawai membatalkan pengajuan sebelum verifikasi Admin', async () => {
  const req = {
    id: 100,
    request_number: 'REQ/2026/100',
    status: 'SUBMITTED',
    employee_user_id: 10,
    employee_id: 5,
    leave_type_id: 1,
    is_annual_leave: true,
    deducts_annual_balance: true,
    balance_period_year: 2026,
    requested_working_days: 5,
  }
  const balance = { id: 1, reserved_days: 5, available_days: 7 }
  const client = createMockClient({ request: req, balance })

  const result = await withdrawLeaveRequest(
    client,
    employeeUser,
    100,
    'Ada acara keluarga yang tidak dapat ditinggalkan.',
  )

  assert.equal(result.success, true)
  assert.equal(result.status, 'WITHDRAWN')

  // Verify leave_requests status set to WITHDRAWN
  const updateQuery = client.queries.find((q) => q.sql.includes('UPDATE cuti.leave_requests SET status = $2'))
  assert.equal(updateQuery.params[1], 'WITHDRAWN')

  // Verify RELEASE transaction created
  const releaseTx = client.queries.find((q) =>
    q.sql.includes('INSERT INTO cuti.leave_balance_transactions') && q.sql.includes('RELEASE'),
  )
  assert.ok(releaseTx, 'RELEASE transaction must be created')
  assert.equal(releaseTx.params[2], -5) // -5 reserved_delta

  // Verify event created
  const event = client.queries.find((q) =>
    q.sql.includes('INSERT INTO cuti.leave_request_events') && q.sql.includes('WITHDRAWN'),
  )
  assert.ok(event, 'WITHDRAWN event must be recorded')
})

test('AT-049: Pegawai tidak dapat membatalkan setelah verifikasi Admin', async () => {
  const req = {
    id: 101,
    status: 'ADMIN_VERIFIED',
    employee_user_id: 10,
    stages: [{ stage_code: 'ADMIN_REVIEW', status: 'COMPLETED' }],
  }
  const client = createMockClient({ request: req })

  await assert.rejects(
    () => withdrawLeaveRequest(client, employeeUser, 101, 'Membatalkan setelah verifikasi admin'),
    (err) => err.status === 403 && err.message.includes('verifikasi Admin'),
  )
})

test('AT-016: Admin membatalkan cuti 5 hari yang belum dimulai', async () => {
  const req = {
    id: 102,
    request_number: 'REQ/2026/102',
    status: 'APPROVED',
    employee_user_id: 10,
    employee_id: 5,
    leave_type_id: 1,
    is_annual_leave: true,
    deducts_annual_balance: true,
    balance_period_year: 2026,
    start_date: '2026-11-20',
    end_date: '2026-11-26',
    requested_working_days: 5,
    approved_working_days: 5,
  }
  const days = [
    { leave_date: '2026-11-20', is_counted: true },
    { leave_date: '2026-11-23', is_counted: true },
    { leave_date: '2026-11-24', is_counted: true },
    { leave_date: '2026-11-25', is_counted: true },
    { leave_date: '2026-11-26', is_counted: true },
  ]
  const balance = { id: 2, available_days: 2, used_days: 5 }
  const client = createMockClient({ request: req, balance, days })

  const result = await cancelLeaveRequest(client, adminUser, 102, {
    source: 'EMPLOYEE_REQUEST',
    reason: 'Pembatalan sebelum tanggal cuti dimulai karena penugasan dinas',
    effectiveDate: '2026-11-19',
    restoredDays: 5,
  })

  assert.equal(result.success, true)
  assert.equal(result.status, 'CANCELLED')
  assert.equal(result.usedDays, 0)
  assert.equal(result.restoredDays, 5)

  // Verify RESTORATION transaction
  const restoreTx = client.queries.find((q) =>
    q.sql.includes('INSERT INTO cuti.leave_balance_transactions') && q.sql.includes('RESTORATION'),
  )
  assert.ok(restoreTx, 'RESTORATION transaction must be created')
  assert.equal(restoreTx.params[2], -5) // -5 used_delta
})

test('AT-017: Admin membatalkan cuti 5 hari setelah 1 hari digunakan', async () => {
  const req = {
    id: 103,
    request_number: 'REQ/2026/103',
    status: 'APPROVED',
    employee_user_id: 10,
    employee_id: 5,
    leave_type_id: 1,
    is_annual_leave: true,
    deducts_annual_balance: true,
    balance_period_year: 2026,
    start_date: '2026-11-16',
    end_date: '2026-11-20',
    requested_working_days: 5,
    approved_working_days: 5,
  }
  const days = [
    { leave_date: '2026-11-16', is_counted: true },
    { leave_date: '2026-11-17', is_counted: true },
    { leave_date: '2026-11-18', is_counted: true },
    { leave_date: '2026-11-19', is_counted: true },
    { leave_date: '2026-11-20', is_counted: true },
  ]
  const balance = { id: 3, available_days: 2, used_days: 5 }
  const client = createMockClient({ request: req, balance, days })

  // Effective date 2026-11-16: 1 day used, max 4 restorable. Admin chooses to restore 3 days.
  const result = await cancelLeaveRequest(client, adminUser, 103, {
    source: 'ADMIN_INITIATED',
    reason: 'Pembatalan sebagian cuti karena instruksi pimpinan',
    effectiveDate: '2026-11-16',
    restoredDays: 3,
  })

  assert.equal(result.success, true)
  assert.equal(result.usedDays, 1)
  assert.equal(result.maxRestorable, 4)
  assert.equal(result.restoredDays, 3)

  const restoreTx = client.queries.find((q) =>
    q.sql.includes('INSERT INTO cuti.leave_balance_transactions') && q.sql.includes('RESTORATION'),
  )
  assert.ok(restoreTx)
  assert.equal(restoreTx.params[2], -3)
})

test('AT-018: Backend menolak pengembalian melebihi batas maksimum', async () => {
  const req = {
    id: 104,
    request_number: 'REQ/2026/104',
    status: 'APPROVED',
    employee_user_id: 10,
    employee_id: 5,
    leave_type_id: 1,
    is_annual_leave: true,
    deducts_annual_balance: true,
    balance_period_year: 2026,
    start_date: '2026-11-16',
    end_date: '2026-11-20',
    requested_working_days: 5,
    approved_working_days: 5,
  }
  const days = [
    { leave_date: '2026-11-16', is_counted: true },
    { leave_date: '2026-11-17', is_counted: true },
    { leave_date: '2026-11-18', is_counted: true },
    { leave_date: '2026-11-19', is_counted: true },
    { leave_date: '2026-11-20', is_counted: true },
  ]
  const client = createMockClient({ request: req, days })

  // Effective date 2026-11-16 (1 used, max 4). Trying to restore 5 days
  await assert.rejects(
    () => cancelLeaveRequest(client, adminUser, 104, {
      source: 'ADMIN_INITIATED',
      reason: 'Percobaan restore di atas batas maksimum yang diizinkan',
      effectiveDate: '2026-11-16',
      restoredDays: 5,
    }),
    (err) => err.status === 400 && err.message.includes('melebihi batas maksimal'),
  )
})

test('AT-019: Double-click tidak menghasilkan dua transaksi pembatalan', async () => {
  const reqAlreadyCancelled = {
    id: 105,
    request_number: 'REQ/2026/105',
    status: 'CANCELLED',
    employee_user_id: 10,
  }
  const client = createMockClient({ request: reqAlreadyCancelled })

  await assert.rejects(
    () => cancelLeaveRequest(client, adminUser, 105, {
      source: 'ADMIN_INITIATED',
      reason: 'Klik kedua setelah transaksi pertama selesai',
      effectiveDate: '2026-11-20',
    }),
    (err) => err.status === 409 && err.message.includes('sudah dibatalkan sebelumnya'),
  )
})

test('AT-020: Rollback atomik jika terjadi kegagalan di tengah proses', async () => {
  const req = {
    id: 106,
    request_number: 'REQ/2026/106',
    status: 'APPROVED',
    employee_user_id: 10,
    employee_id: 5,
    leave_type_id: 1,
    is_annual_leave: true,
    deducts_annual_balance: true,
    balance_period_year: 2026,
    start_date: '2026-11-20',
    end_date: '2026-11-25',
    requested_working_days: 5,
    approved_working_days: 5,
  }
  const balance = { id: 4, available_days: 2, used_days: 5 }
  // Simulate failure when inserting into leave_cancellations
  const client = createMockClient({
    request: req,
    balance,
    shouldFailAt: 'INSERT INTO CUTI.LEAVE_CANCELLATIONS',
  })

  await assert.rejects(
    () => cancelLeaveRequest(client, adminUser, 106, {
      source: 'ADMIN_INITIATED',
      reason: 'Uji kegagalan atomisitas transaksi di tengah proses',
      effectiveDate: '2026-11-20',
      restoredDays: 5,
    }),
    (err) => err.message.includes('Simulated database failure'),
  )
})

test('AT-051: Admin membatalkan pengajuan sebelum final (tanpa RESTORATION)', async () => {
  const req = {
    id: 107,
    request_number: 'REQ/2026/107',
    status: 'KEPSTA_REVIEW',
    employee_user_id: 10,
    employee_id: 5,
    leave_type_id: 1,
    is_annual_leave: true,
    deducts_annual_balance: true,
    balance_period_year: 2026,
    requested_working_days: 3,
  }
  const balance = { id: 5, available_days: 5, reserved_days: 3 }
  const client = createMockClient({ request: req, balance })

  const result = await cancelLeaveRequest(client, adminUser, 107, {
    source: 'ADMIN_INITIATED',
    reason: 'Pembatalan sebelum final oleh Admin karena kendala formasi dinas',
    effectiveDate: '2026-11-18',
  })

  assert.equal(result.success, true)
  assert.equal(result.status, 'CANCELLED')
  assert.equal(result.restoredDays, 0)

  // Verify RELEASE of reserved days
  const releaseTx = client.queries.find((q) =>
    q.sql.includes('INSERT INTO cuti.leave_balance_transactions') && q.sql.includes('RELEASE'),
  )
  assert.ok(releaseTx, 'Must release reservation')

  // Verify NO RESTORATION transaction
  const restoreTx = client.queries.find((q) =>
    q.sql.includes('INSERT INTO cuti.leave_balance_transactions') && q.sql.includes('RESTORATION'),
  )
  assert.equal(restoreTx, undefined, 'Must not create RESTORATION before final')
})

test('Negative: Admin tidak dapat membatalkan pengajuannya sendiri (AT-051 negative)', async () => {
  const ownReq = {
    id: 108,
    request_number: 'REQ/2026/108',
    status: 'APPROVED',
    employee_user_id: 2, // Admin user id
    requested_working_days: 3,
  }
  const client = createMockClient({ request: ownReq })

  await assert.rejects(
    () => cancelLeaveRequest(client, adminUser, 108, {
      source: 'ADMIN_INITIATED',
      reason: 'Admin membatalkan pengajuannya sendiri',
      effectiveDate: '2026-11-20',
    }),
    (err) => err.status === 403 && err.message.includes('pengajuannya sendiri'),
  )
})

test('Audit K2: siklus RETURN -> withdraw tidak melepas reservasi dua kali', async () => {
  // Skenario: pengajuan dikembalikan (reservasi sudah dilepas oleh RETURN,
  // ledger terakhir = RELEASE), lalu pegawai menarik pengajuannya.
  const returnedReq = {
    id: 71,
    request_number: 'REQ/2026/071',
    status: 'RETURNED_FOR_REVISION',
    employee_user_id: 10,
    employee_id: 5,
    leave_type_id: 1,
    is_annual_leave: true,
    deducts_annual_balance: true,
    balance_period_year: 2026,
    requested_working_days: 5,
  }
  const mockBalance = { id: 300, reserved_days: 0, available_days: 12 }
  const client = createMockClient({ request: returnedReq, balance: mockBalance, latestLedgerType: 'RELEASE' })

  const result = await withdrawLeaveRequest(client, employeeUser, 71, 'Tidak jadi memperbaiki pengajuan ini.')

  assert.equal(result.success, true)
  assert.equal(result.status, 'WITHDRAWN')

  const releaseCount = client.queries.filter((q) =>
    q.sql.includes('INSERT INTO cuti.leave_balance_transactions') && q.sql.includes("'RELEASE'"),
  ).length
  assert.equal(releaseCount, 0, 'RETURN already released the reservation; withdraw must not release again')
})

test('Audit K2: setelah dikirim ulang, withdraw tetap melepas reservasi attempt baru', async () => {
  // Skenario kebalikan: RETURNED -> dikirim ulang (RESERVATION attempt 2
  // menjadi ledger terakhir) -> withdraw harus melepas reservasi attempt 2.
  const resubmittedReq = {
    id: 72,
    request_number: 'REQ/2026/072',
    status: 'SUBMITTED',
    employee_user_id: 10,
    employee_id: 5,
    leave_type_id: 1,
    is_annual_leave: true,
    deducts_annual_balance: true,
    balance_period_year: 2026,
    requested_working_days: 5,
  }
  const mockBalance = { id: 310, reserved_days: 5, available_days: 7 }
  const client = createMockClient({ request: resubmittedReq, balance: mockBalance, latestLedgerType: 'RESERVATION' })

  const result = await withdrawLeaveRequest(client, employeeUser, 72, 'Keperluan keluarga mendadak yang tidak bisa ditunda.')

  assert.equal(result.success, true)

  const releaseTx = client.queries.find((q) =>
    q.sql.includes('INSERT INTO cuti.leave_balance_transactions') && q.sql.includes("'RELEASE'"),
  )
  assert.ok(releaseTx, 'Active reservation of the new attempt must be released')
  assert.equal(releaseTx.params[2], -5)
})
