import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createNotification,
  notifyRoleUsers,
  notifyRequestLifecycle,
} from '../notifications.js'

function createMockClient({ users = [] }) {
  const queries = []
  return {
    queries,
    async query(sql, params = []) {
      queries.push({ sql, params })
      const s = sql.trim().toUpperCase()

      if (s.includes('FROM CUTI.USERS') && s.includes('JOIN CUTI.USER_ROLES')) {
        return { rowCount: users.length, rows: users }
      }
      if (s.startsWith('INSERT INTO CUTI.NOTIFICATIONS')) {
        return { rowCount: 1, rows: [{ id: 101 }] }
      }
      return { rowCount: 0, rows: [] }
    },
  }
}

test('createNotification validates severity and inserts notification into database', async () => {
  const client = createMockClient({})

  // Invalid severity
  await assert.rejects(
    () => createNotification(client, {
      userId: 5,
      type: 'TEST',
      title: 'Judul',
      body: 'Pesan',
      severity: 'INVALID_SEVERITY',
    }),
    (err) => err.message.includes('Severity tidak valid'),
  )

  // Valid notification
  const result = await createNotification(client, {
    userId: 5,
    leaveRequestId: 42,
    type: 'LEAVE_SUBMITTED',
    title: 'Pengajuan Baru',
    body: 'Pesan notifikasi pengajuan baru',
    actionUrl: '/requests/42',
    severity: 'ACTION',
    dedupeKey: 'SUBMIT:42:5',
  })

  assert.equal(result.success, true)
  const insert = client.queries.find((q) => q.sql.includes('INSERT INTO cuti.notifications'))
  assert.ok(insert, 'Must execute insert notification')
  assert.equal(insert.params[0], 5) // user_id
  assert.equal(insert.params[1], 42) // leave_request_id
  assert.equal(insert.params[6], 'ACTION') // severity
})

test('notifyRoleUsers sends notification to all active users with the given role', async () => {
  const mockAdmins = [
    { id: 2, full_name: 'Admin 1' },
    { id: 3, full_name: 'Admin 2' },
  ]
  const client = createMockClient({ users: mockAdmins })

  const results = await notifyRoleUsers(client, 'ADMIN', {
    leaveRequestId: 10,
    type: 'LEAVE_SUBMITTED',
    title: 'Pengajuan Cuti Baru',
    body: 'Ada pengajuan cuti baru yang perlu diperiksa.',
    actionUrl: '/requests/10',
    severity: 'ACTION',
    dedupePrefix: 'SUBMIT:10',
  })

  assert.equal(results.length, 2)
  const inserts = client.queries.filter((q) => q.sql.includes('INSERT INTO cuti.notifications'))
  assert.equal(inserts.length, 2)
  assert.equal(inserts[0].params[0], 2)
  assert.equal(inserts[1].params[0], 3)
})

test('notifyRequestLifecycle creates appropriate notifications for SUBMITTED, DECIDED, and RETURNED (AT-N01, AT-N03)', async () => {
  const mockAdmins = [{ id: 2, full_name: 'Admin TU' }]
  const client = createMockClient({ users: mockAdmins })

  const req = {
    id: 99,
    request_number: 'REQ-099',
    employee_name: 'Budi Santoso',
    employee_user_id: 15,
  }

  // 1. SUBMITTED: notifies Admin role
  await notifyRequestLifecycle(client, {
    eventType: 'SUBMITTED',
    request: req,
  })
  let insert = client.queries.find((q) => q.params.includes('SUBMIT:99:2'))
  assert.ok(insert, 'Must notify Admin on submission')

  // 2. DECIDED APPROVED: notifies employee with explicit DISETUJUI
  await notifyRequestLifecycle(client, {
    eventType: 'DECIDED',
    request: req,
    actor: { fullName: 'Kepala Stasiun' },
    details: { decision: 'APPROVED' },
  })
  insert = client.queries.find((q) =>
    q.sql.includes('INSERT INTO cuti.notifications') &&
    q.params[0] === 15 &&
    q.params[3].includes('DISETUJUI'),
  )
  assert.ok(insert, 'Must notify employee of DISETUJUI decision')

  // 3. DECIDED REJECTED: notifies employee with explicit TIDAK DISETUJUI
  await notifyRequestLifecycle(client, {
    eventType: 'DECIDED',
    request: req,
    actor: { fullName: 'Kepala Stasiun' },
    details: { decision: 'REJECTED' },
  })
  insert = client.queries.find((q) =>
    q.sql.includes('INSERT INTO cuti.notifications') &&
    q.params[0] === 15 &&
    q.params[3].includes('TIDAK DISETUJUI'),
  )
  assert.ok(insert, 'Must notify employee of TIDAK DISETUJUI decision')
})

test('notifyRequestLifecycle does not include sensitive medical/attachment info (AT-N02)', async () => {
  const client = createMockClient({})
  const req = {
    id: 105,
    request_number: 'REQ-105',
    employee_name: 'Budi Santoso',
    employee_user_id: 20,
    leave_type_code: 'SAKIT',
  }

  // Medical leave decided
  await notifyRequestLifecycle(client, {
    eventType: 'DECIDED',
    request: req,
    actor: { fullName: 'Kepala Stasiun' },
    details: { decision: 'APPROVED' },
  })

  const insert = client.queries.find((q) => q.params[0] === 20)
  assert.ok(insert)
  const bodyText = insert.params[4]
  assert.ok(!bodyText.includes('.pdf'), 'Must not contain file names')
  assert.ok(!bodyText.includes('surat_dokter'), 'Must not contain attachment names')
  assert.ok(!bodyText.includes('diagnosis'), 'Must not contain medical diagnosis details')
})
