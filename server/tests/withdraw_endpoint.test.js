import test from 'node:test'
import assert from 'node:assert/strict'
import { withdrawLeaveRequest } from '../cancellation.js'

function createMockClient({ request, balance, stages = [], latestLedgerType = 'RESERVATION' }) {
  const queries = []
  return {
    queries,
    async query(sql, params = []) {
      queries.push({ sql, params })
      const s = sql.trim().toUpperCase()

      if (s.startsWith('SELECT R.*') || (s.includes('FROM CUTI.LEAVE_REQUESTS R') && s.includes('FOR UPDATE'))) {
        return { rowCount: request ? 1 : 0, rows: request ? [request] : [] }
      }
      if (s.includes('FROM CUTI.LEAVE_REQUEST_STAGES') && s.includes('WHERE LEAVE_REQUEST_ID = $1')) {
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

test('withdrawLeaveRequest rejects empty or short reason (< 10 chars)', async () => {
  const client = createMockClient({})
  const user = { id: 10, fullName: 'Pegawai Test', roles: [{ code: 'EMPLOYEE' }] }

  await assert.rejects(
    () => withdrawLeaveRequest(client, user, 1, 'pendek'),
    (err) => err.status === 400 && err.message.includes('minimal 10 karakter'),
  )
})

test('withdrawLeaveRequest rejects if user is not the owner (AT-048 negative)', async () => {
  const mockReq = {
    id: 1,
    status: 'SUBMITTED',
    employee_user_id: 10,
    requested_working_days: 3,
    is_annual_leave: true,
    leave_type_id: 1,
    employee_id: 5,
    balance_period_year: 2026,
  }
  const client = createMockClient({ request: mockReq })
  const otherUser = { id: 99, fullName: 'Other', roles: [{ code: 'EMPLOYEE' }] }

  await assert.rejects(
    () => withdrawLeaveRequest(client, otherUser, 1, 'Alasan pembatalan yang cukup panjang'),
    (err) => err.status === 403,
  )
})

test('withdrawLeaveRequest rejects if status is already ADMIN_VERIFIED (AT-049)', async () => {
  const mockReq = {
    id: 1,
    status: 'ADMIN_VERIFIED',
    employee_user_id: 10,
    requested_working_days: 3,
  }
  const client = createMockClient({ request: mockReq })
  const user = { id: 10, fullName: 'Pegawai', roles: [{ code: 'EMPLOYEE' }] }

  await assert.rejects(
    () => withdrawLeaveRequest(client, user, 1, 'Alasan pembatalan yang cukup panjang'),
    (err) => err.status === 403 && err.message.includes('verifikasi Admin'),
  )
})

test('withdrawLeaveRequest succeeds pre-verification, releases reservation, and creates event (AT-048)', async () => {
  const mockReq = {
    id: 42,
    request_number: 'REQ/2026/001',
    status: 'SUBMITTED',
    employee_user_id: 10,
    employee_id: 5,
    leave_type_id: 1,
    is_annual_leave: true,
    deducts_annual_balance: true,
    balance_period_year: 2026,
    requested_working_days: 4,
  }
  const mockBalance = {
    id: 200,
    reserved_days: 4,
    available_days: 8,
  }

  const client = createMockClient({ request: mockReq, balance: mockBalance })
  const user = { id: 10, fullName: 'Pegawai Satu', roles: [{ code: 'EMPLOYEE' }] }

  const result = await withdrawLeaveRequest(
    client,
    user,
    42,
    'Ada keperluan mendadak keluarga yang tidak bisa ditinggalkan.',
  )

  assert.equal(result.success, true)
  assert.equal(result.status, 'WITHDRAWN')

  // Check queries
  const updateQuery = client.queries.find((q) => q.sql.includes('UPDATE cuti.leave_requests SET status = $2'))
  assert.ok(updateQuery, 'Should update leave_requests to WITHDRAWN')
  assert.equal(updateQuery.params[1], 'WITHDRAWN')

  const releaseTxQuery = client.queries.find((q) =>
    q.sql.includes('INSERT INTO cuti.leave_balance_transactions') && q.sql.includes('RELEASE'),
  )
  assert.ok(releaseTxQuery, 'Should create RELEASE transaction for reservation')
  assert.equal(releaseTxQuery.params[2], -4) // reserved_delta = -4

  const eventQuery = client.queries.find((q) =>
    q.sql.includes('INSERT INTO cuti.leave_request_events') && q.sql.includes('WITHDRAWN'),
  )
  assert.ok(eventQuery, 'Should create WITHDRAWN event')
})

test('withdrawLeaveRequest on RETURNED_FOR_REVISION withdraws without double release (audit K2)', async () => {
  const mockReq = {
    id: 51,
    request_number: 'REQ/2026/051',
    status: 'RETURNED_FOR_REVISION',
    employee_user_id: 10,
    employee_id: 5,
    leave_type_id: 1,
    is_annual_leave: true,
    deducts_annual_balance: true,
    balance_period_year: 2026,
    requested_working_days: 4,
  }
  const mockBalance = { id: 210, reserved_days: 0, available_days: 12 }
  // RETURN sudah melepas reservasi: transaksi ledger terakhir = RELEASE.
  const client = createMockClient({ request: mockReq, balance: mockBalance, latestLedgerType: 'RELEASE' })
  const user = { id: 10, fullName: 'Pegawai Satu', roles: [{ code: 'EMPLOYEE' }] }

  const result = await withdrawLeaveRequest(
    client,
    user,
    51,
    'Menarik pengajuan yang dikembalikan karena tidak jadi memperbaiki.',
  )

  assert.equal(result.success, true)
  assert.equal(result.status, 'WITHDRAWN')

  const releaseTx = client.queries.find((q) =>
    q.sql.includes('INSERT INTO cuti.leave_balance_transactions') && q.sql.includes("'RELEASE'"),
  )
  assert.equal(releaseTx, undefined, 'Returned request must not release its reservation again')

  const cancelRow = client.queries.find((q) => q.sql.includes('INSERT INTO cuti.leave_cancellations'))
  assert.ok(cancelRow, 'Withdrawal must still be recorded in leave_cancellations')
})
