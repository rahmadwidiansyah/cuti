import test from 'node:test'
import assert from 'node:assert/strict'
import { cancelLeaveRequest } from '../cancellation.js'

function createMockClient({ request, balance, days = [], stages = [], latestLedgerType = 'RESERVATION' }) {
  const queries = []
  return {
    queries,
    async query(sql, params = []) {
      queries.push({ sql, params })
      const s = sql.trim().toUpperCase()

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

test('cancelLeaveRequest rejects non-admin users', async () => {
  const client = createMockClient({})
  const nonAdmin = { id: 10, fullName: 'Employee', roles: [{ code: 'EMPLOYEE' }] }

  await assert.rejects(
    () => cancelLeaveRequest(client, nonAdmin, 1, {}),
    (err) => err.status === 403,
  )
})

test('cancelLeaveRequest rejects Admin attempting to cancel their own request (AT-051 negative)', async () => {
  const ownReq = {
    id: 1,
    status: 'APPROVED',
    employee_user_id: 2, // same as adminUser.id
    requested_working_days: 3,
  }
  const client = createMockClient({ request: ownReq })

  await assert.rejects(
    () => cancelLeaveRequest(client, adminUser, 1, {
      source: 'ADMIN_INITIATED',
      reason: 'Alasan pembatalan oleh admin sendiri',
      effectiveDate: '2026-11-20',
    }),
    (err) => err.status === 403 && err.message.includes('pengajuannya sendiri'),
  )
})

test('cancelLeaveRequest rejects if already cancelled (AT-019 negative)', async () => {
  const cancelledReq = {
    id: 1,
    status: 'CANCELLED',
    employee_user_id: 10,
  }
  const client = createMockClient({ request: cancelledReq })

  await assert.rejects(
    () => cancelLeaveRequest(client, adminUser, 1, {
      source: 'ADMIN_INITIATED',
      reason: 'Alasan pembatalan yang cukup panjang',
      effectiveDate: '2026-11-20',
    }),
    (err) => err.status === 409,
  )
})

test('cancelLeaveRequest pre-final releases reservation without RESTORATION (AT-051)', async () => {
  const preFinalReq = {
    id: 10,
    request_number: 'REQ-010',
    status: 'ADMIN_VERIFIED',
    employee_user_id: 10,
    employee_id: 5,
    leave_type_id: 1,
    is_annual_leave: true,
    deducts_annual_balance: true,
    balance_period_year: 2026,
    requested_working_days: 3,
  }
  const mockBalance = { id: 50, available_days: 7, reserved_days: 3 }
  const client = createMockClient({ request: preFinalReq, balance: mockBalance })

  const result = await cancelLeaveRequest(client, adminUser, 10, {
    source: 'ADMIN_INITIATED',
    reason: 'Pembatalan sebelum final karena penugasan dinas mendadak',
    effectiveDate: '2026-11-18',
  })

  assert.equal(result.success, true)
  assert.equal(result.status, 'CANCELLED')
  assert.equal(result.restoredDays, 0)

  // Ensure RELEASE tx was made
  const releaseTx = client.queries.find((q) =>
    q.sql.includes('INSERT INTO cuti.leave_balance_transactions') && q.sql.includes('RELEASE'),
  )
  assert.ok(releaseTx, 'Should create RELEASE transaction for reservation')

  // Ensure NO RESTORATION tx was made
  const restoreTx = client.queries.find((q) =>
    q.sql.includes('INSERT INTO cuti.leave_balance_transactions') && q.sql.includes('RESTORATION'),
  )
  assert.equal(restoreTx, undefined, 'Must not create RESTORATION transaction before final approval')
})

test('cancelLeaveRequest approved cuti before start date restores all days (AT-016)', async () => {
  const approvedReq = {
    id: 15,
    request_number: 'REQ-015',
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
  const mockBalance = { id: 60, available_days: 5, used_days: 5 }
  const client = createMockClient({ request: approvedReq, balance: mockBalance, days })

  const result = await cancelLeaveRequest(client, adminUser, 15, {
    source: 'EMPLOYEE_REQUEST',
    reason: 'Pembatalan cuti 5 hari sebelum dimulai atas permohonan dinas pegawai',
    effectiveDate: '2026-11-19', // before start_date: 0 used days
    restoredDays: 5,
  })

  assert.equal(result.success, true)
  assert.equal(result.usedDays, 0)
  assert.equal(result.restoredDays, 5)

  // Check RESTORATION transaction
  const restoreTx = client.queries.find((q) =>
    q.sql.includes('INSERT INTO cuti.leave_balance_transactions') && q.sql.includes('RESTORATION'),
  )
  assert.ok(restoreTx, 'Should create RESTORATION transaction')
  assert.equal(restoreTx.params[2], -5) // used_delta = -5 (restores 5 days)
})

test('cancelLeaveRequest approved cuti after 1 day used allows partial restoration (AT-017)', async () => {
  const approvedReq = {
    id: 16,
    request_number: 'REQ-016',
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
  const mockBalance = { id: 60, available_days: 2, used_days: 5 }
  const client = createMockClient({ request: approvedReq, balance: mockBalance, days })

  // Effective date is 2026-11-16 (day 1). Used days = 1, maxRestorable = 4. Admin chooses to restore 3 days.
  const result = await cancelLeaveRequest(client, adminUser, 16, {
    source: 'ADMIN_INITIATED',
    reason: 'Pembatalan sisa cuti karena dipanggil kembali bertugas di kantor',
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
  assert.equal(restoreTx.params[2], -3) // used_delta = -3
})

test('cancelLeaveRequest on RETURNED_FOR_REVISION does not release reservation again (audit K2)', async () => {
  const returnedReq = {
    id: 20,
    request_number: 'REQ-020',
    status: 'RETURNED_FOR_REVISION',
    employee_user_id: 10,
    employee_id: 5,
    leave_type_id: 1,
    is_annual_leave: true,
    deducts_annual_balance: true,
    balance_period_year: 2026,
    requested_working_days: 3,
  }
  const mockBalance = { id: 70, available_days: 9, reserved_days: 0 }
  // Reservasi sudah dilepas oleh RETURN: transaksi ledger terakhir = RELEASE.
  const client = createMockClient({ request: returnedReq, balance: mockBalance, latestLedgerType: 'RELEASE' })

  const result = await cancelLeaveRequest(client, adminUser, 20, {
    source: 'ADMIN_INITIATED',
    reason: 'Pembatalan pengajuan yang dikembalikan dan tidak diperbaiki pegawai',
    effectiveDate: '2026-11-20',
  })

  assert.equal(result.success, true)
  assert.equal(result.status, 'CANCELLED')
  // Tidak ada RELEASE baru: saldo tidak berubah.
  assert.equal(result.balanceAfter, result.balanceBefore)

  const releaseTx = client.queries.find((q) =>
    q.sql.includes('INSERT INTO cuti.leave_balance_transactions') && q.sql.includes("'RELEASE'"),
  )
  assert.equal(releaseTx, undefined, 'RETURNED request must not get a second RELEASE')

  const eventTx = client.queries.find((q) => q.sql.includes('INSERT INTO cuti.leave_request_events'))
  assert.ok(eventTx, 'Cancellation event must be recorded')
  assert.ok(eventTx.params[2].includes('sudah dilepas'), 'Event must explain reservation was already released')
})

test('cancelLeaveRequest rejects garbage effectiveDate with 400 (audit T3)', async () => {
  const approvedReq = {
    id: 30,
    request_number: 'REQ-030',
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
  const client = createMockClient({ request: approvedReq, latestLedgerType: 'CONSUMPTION' })

  await assert.rejects(
    () => cancelLeaveRequest(client, adminUser, 30, {
      source: 'ADMIN_INITIATED',
      reason: 'Menguji tanggal efektif yang bukan format tanggal sama sekali',
      effectiveDate: 'tanggal-sampah',
    }),
    (err) => err.status === 400 && err.message.includes('YYYY-MM-DD'),
  )
  await assert.rejects(
    () => cancelLeaveRequest(client, adminUser, 30, {
      source: 'ADMIN_INITIATED',
      reason: 'Menguji tanggal kalender yang tidak ada seperti 30 Februari',
      effectiveDate: '2026-02-30',
    }),
    (err) => err.status === 400 && err.message.includes('tanggal kalender'),
  )
})

test('cancelLeaveRequest rejects future effectiveDate with 400 (audit T3)', async () => {
  const approvedReq = {
    id: 31,
    request_number: 'REQ-031',
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
  const client = createMockClient({ request: approvedReq, latestLedgerType: 'CONSUMPTION' })

  await assert.rejects(
    () => cancelLeaveRequest(client, adminUser, 31, {
      source: 'ADMIN_INITIATED',
      reason: 'Menguji tanggal efektif di masa depan yang mengacaukan hitungan',
      effectiveDate: '2099-01-01',
    }),
    (err) => err.status === 400 && err.message.includes('masa depan'),
  )
})

test('cancelLeaveRequest rejects restoration exceeding max allowed (AT-018)', async () => {
  const approvedReq = {
    id: 17,
    request_number: 'REQ-017',
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
  const client = createMockClient({ request: approvedReq, days })

  // Effective date: 2026-11-16 (1 day used, max 4). Client tries to send restoredDays: 5
  await assert.rejects(
    () => cancelLeaveRequest(client, adminUser, 17, {
      source: 'ADMIN_INITIATED',
      reason: 'Mencoba manipulasi pengembalian saldo melebihi batas',
      effectiveDate: '2026-11-16',
      restoredDays: 5,
    }),
    (err) => err.status === 400 && err.message.includes('melebihi batas maksimal'),
  )
})
