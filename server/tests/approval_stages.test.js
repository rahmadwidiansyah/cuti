import test from 'node:test'
import assert from 'node:assert/strict'
import { advanceToNextStage, ensureActiveStage } from '../approval-stages.js'

const configStep = {
  id: 3,
  stage_code: 'PERTIMBANGAN_REVIEW',
  role_code: 'HR_ANALYST',
  unit_scope: 'ALL',
  decision_mode: 'FORWARD',
  is_final: false,
  sla_hours: 16,
}

function createClient({ config = configStep, pendingRowCount = 1, insertRowCount = 1, activeStage = null } = {}) {
  const calls = []
  return {
    calls,
    async query(sql, params = []) {
      const s = sql.trim().toUpperCase()
      calls.push({ sql, params, kind: s })

      if (s.startsWith('SELECT * FROM CUTI.LEAVE_REQUEST_STAGES')) {
        return activeStage
          ? { rowCount: 1, rows: [activeStage] }
          : { rowCount: 0, rows: [] }
      }
      if (s.startsWith('SELECT ID, STAGE_CODE')) {
        return config ? { rowCount: 1, rows: [config] } : { rowCount: 0, rows: [] }
      }
      if (s.startsWith('UPDATE CUTI.LEAVE_REQUESTS')) {
        return { rowCount: 1, rows: [] }
      }
      if (s.startsWith('UPDATE CUTI.LEAVE_REQUEST_STAGES')) {
        return { rowCount: pendingRowCount, rows: pendingRowCount ? [{ id: 9, stage_code: config?.stage_code, role_code: config?.role_code }] : [] }
      }
      if (s.startsWith('INSERT INTO CUTI.LEAVE_REQUEST_STAGES')) {
        return { rowCount: insertRowCount, rows: insertRowCount ? [{ id: 10, stage_code: config?.stage_code, role_code: config?.role_code }] : [] }
      }
      throw new Error(`Query tidak terduga: ${sql.slice(0, 80)}`)
    },
  }
}

const request = { id: 12, route_id: 1, status: 'SUBMITTED' }
const stage = { step_no: 1, attempt_no: 1 }

test('mengaktifkan baris stage PENDING yang sudah ada tanpa insert', async () => {
  const client = createClient({ pendingRowCount: 1 })
  const result = await advanceToNextStage(client, request, stage)

  assert.deepEqual(result, {
    stepNo: 2,
    stageCode: 'PERTIMBANGAN_REVIEW',
    roleCode: 'HR_ANALYST',
    decisionMode: 'FORWARD',
    isFinal: false,
    slaHours: 16,
  })
  assert.equal(client.calls.filter((c) => c.kind.startsWith('INSERT')).length, 0)
  const update = client.calls.find((c) => c.kind.startsWith('UPDATE'))
  assert.deepEqual(update.params, [12, 1, 2, 16])
})

test('self-healing: membuat baris stage dari konfigurasi saat baris PENDING tidak ada', async () => {
  const client = createClient({ pendingRowCount: 0, insertRowCount: 1 })
  const result = await advanceToNextStage(client, request, stage)

  assert.equal(result.stepNo, 2)
  assert.equal(result.stageCode, 'PERTIMBANGAN_REVIEW')
  const insert = client.calls.find((c) => c.kind.startsWith('INSERT'))
  assert.ok(insert, 'INSERT ke leave_request_stages harus dipanggil')
  assert.deepEqual(insert.params, [12, 1, 3, 2, 'PERTIMBANGAN_REVIEW', 'HR_ANALYST', 'ALL', 'FORWARD', false, 16, 16])
  assert.match(insert.sql, /ON CONFLICT \(leave_request_id, attempt_no, step_no\) DO UPDATE/)
})

test('mengembalikan null bila tidak ada konfigurasi step berikutnya (tahap final)', async () => {
  const client = createClient({ config: null })
  const result = await advanceToNextStage(client, request, stage)
  assert.equal(result, null)
  assert.equal(client.calls.filter((c) => c.kind.startsWith('UPDATE') || c.kind.startsWith('INSERT')).length, 0)
})

test('ensureActiveStage memakai stage ACTIVE yang sudah ada', async () => {
  const existing = { id: 7, step_no: 2, role_code: 'HR_ANALYST', status: 'ACTIVE' }
  const client = createClient({ activeStage: existing })
  const result = await ensureActiveStage(client, request)
  assert.deepEqual(result, existing)
  assert.equal(client.calls.filter((c) => c.kind.startsWith('INSERT')).length, 0)
})

test('ensureActiveStage memulihkan stage ACTIVE dari status saat barisnya hilang', async () => {
  const client = createClient({ activeStage: null, pendingRowCount: 0 })
  const result = await ensureActiveStage(client, { ...request, status: 'ADMIN_VERIFIED' })

  assert.equal(result.stage_code, 'PERTIMBANGAN_REVIEW')
  assert.equal(result.role_code, 'HR_ANALYST')
  assert.equal(result.step_no, 2)
  assert.equal(result.status, 'ACTIVE')
  const insert = client.calls.find((c) => c.kind.startsWith('INSERT'))
  assert.deepEqual(insert.params, [12, 1, 3, 2, 'PERTIMBANGAN_REVIEW', 'HR_ANALYST', 'ALL', 'FORWARD', false, 16, 16])
})

test('ensureActiveStage mengembalikan null untuk status final', async () => {
  const client = createClient({ activeStage: null })
  const result = await ensureActiveStage(client, { ...request, status: 'APPROVED' })
  assert.equal(result, null)
  assert.equal(client.calls.length, 1)
})
