import test from 'node:test'
import assert from 'node:assert/strict'
import { sortDirection, sortExpression, statusOrderSql, REQUEST_STATUS_ORDER } from '../sorting.js'

const fields = {
  requestNumber: 'r.request_number',
  employee: `COALESCE(r.employee_name, '')`,
  submittedAt: 'COALESCE(r.submitted_at, r.created_at)',
  status: statusOrderSql('r.status'),
}

test('sortDirection hanya menerima asc dan desc', () => {
  assert.equal(sortDirection('asc'), 'ASC')
  assert.equal(sortDirection('DESC'), 'DESC')
  assert.equal(sortDirection('drop table'), 'DESC')
  assert.equal(sortDirection(), 'DESC')
})

test('sortExpression memakai kolom dari whitelist', () => {
  assert.equal(
    sortExpression({ sortBy: 'requestNumber', sortDir: 'asc' }, fields, 'submittedAt', 'r.id DESC'),
    'r.request_number ASC, r.id DESC',
  )
  assert.equal(
    sortExpression({ sortBy: 'submittedAt' }, fields, 'submittedAt', 'r.id DESC'),
    'COALESCE(r.submitted_at, r.created_at) DESC, r.id DESC',
  )
})

test('sortBy di luar whitelist jatuh ke kolom bawaan', () => {
  const result = sortExpression(
    { sortBy: "r.id; DROP TABLE cuti.leave_requests; --", sortDir: 'asc' },
    fields,
    'submittedAt',
    'r.id DESC',
  )
  assert.equal(result, 'COALESCE(r.submitted_at, r.created_at) ASC, r.id DESC')
})

test('statusOrderSql mengikuti urutan alur kerja', () => {
  const sql = statusOrderSql('r.status')
  assert.match(sql, /CASE r\.status/)
  assert.ok(sql.indexOf("WHEN 'DRAFT'") < sql.indexOf("WHEN 'APPROVED'"))
  assert.ok(sql.indexOf("WHEN 'APPROVED'") < sql.indexOf("WHEN 'CANCELLED'"))
  assert.equal(REQUEST_STATUS_ORDER[0], 'DRAFT')
})
