import test from 'node:test'
import assert from 'node:assert/strict'
import {
  calculateUsedWorkingDays,
  canEmployeeWithdraw,
  canAdminCancel,
} from '../cancellation.js'

test('enrichment helper logic produces correct permission flags and cancellation calculation', () => {
  const employeeUser = { id: 10, roles: [{ code: 'EMPLOYEE' }] }
  const adminUser = { id: 2, roles: [{ code: 'ADMIN' }] }

  const reqSubmitted = {
    id: 1,
    employee_user_id: 10,
    status: 'SUBMITTED',
    stages: [{ stage_code: 'ADMIN_REVIEW', status: 'PENDING' }],
  }

  // Employee can withdraw pre-verification
  const withdraw1 = canEmployeeWithdraw(reqSubmitted, employeeUser.id)
  assert.equal(withdraw1.allowed, true)

  // Admin can cancel (not own request)
  const cancel1 = canAdminCancel(reqSubmitted, adminUser)
  assert.equal(cancel1.allowed, false) // because SUBMITTED is prior to ADMIN_VERIFIED

  // Admin verified request: employee cannot withdraw, Admin can cancel
  const reqAdminVerified = {
    id: 2,
    employee_user_id: 10,
    status: 'ADMIN_VERIFIED',
    stages: [{ stage_code: 'ADMIN_REVIEW', status: 'COMPLETED' }],
  }
  assert.equal(canEmployeeWithdraw(reqAdminVerified, employeeUser.id).allowed, false)
  assert.equal(canAdminCancel(reqAdminVerified, adminUser).allowed, true)

  // Approved request calculation
  const days = [
    { leave_date: '2026-11-16', is_counted: true },
    { leave_date: '2026-11-17', is_counted: true },
    { leave_date: '2026-11-18', is_counted: true },
    { leave_date: '2026-11-19', is_counted: true },
    { leave_date: '2026-11-20', is_counted: true },
  ]
  const today = '2026-11-17'
  const usedDays = calculateUsedWorkingDays(days, today)
  const approvedDays = 5
  const maxRestorable = Math.max(0, approvedDays - usedDays)

  assert.equal(usedDays, 2)
  assert.equal(maxRestorable, 3)
})
