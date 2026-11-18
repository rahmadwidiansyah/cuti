import test from 'node:test'
import assert from 'node:assert/strict'
import {
  calculateUsedWorkingDays,
  canEmployeeWithdraw,
  canAdminCancel,
} from '../cancellation.js'

test('calculateUsedWorkingDays counts only counted days on or before effective date', () => {
  const days = [
    { leave_date: '2026-11-16', is_counted: true },
    { leave_date: '2026-11-17', is_counted: true },
    { leave_date: '2026-11-18', is_counted: false }, // weekend or holiday
    { leave_date: '2026-11-19', is_counted: true },
    { leave_date: '2026-11-20', is_counted: true },
  ]

  // Before cuti starts: 0 used days
  assert.equal(calculateUsedWorkingDays(days, '2026-11-15'), 0)
  // Day 1: 1 used day
  assert.equal(calculateUsedWorkingDays(days, '2026-11-16'), 1)
  // Day 2: 2 used days
  assert.equal(calculateUsedWorkingDays(days, '2026-11-17'), 2)
  // Day 3 (not counted): still 2 used days
  assert.equal(calculateUsedWorkingDays(days, '2026-11-18'), 2)
  // Day 4: 3 used days
  assert.equal(calculateUsedWorkingDays(days, '2026-11-19'), 3)
  // All 5 calendar days: 4 counted days used
  assert.equal(calculateUsedWorkingDays(days, '2026-11-20'), 4)
  // After cuti ends: 4 counted days used
  assert.equal(calculateUsedWorkingDays(days, '2026-11-25'), 4)
})

test('canEmployeeWithdraw allows withdrawal only for owner and before admin verification', () => {
  const reqPreVerification = {
    employee_user_id: 10,
    status: 'SUBMITTED',
    stages: [{ stage_code: 'ADMIN_REVIEW', status: 'PENDING' }],
  }

  // Owner can withdraw
  assert.deepEqual(canEmployeeWithdraw(reqPreVerification, 10), { allowed: true })

  // Non-owner cannot withdraw
  assert.equal(canEmployeeWithdraw(reqPreVerification, 99).allowed, false)

  // Status after verification cannot be withdrawn by employee (AT-049)
  const reqPostVerification = {
    employee_user_id: 10,
    status: 'ADMIN_VERIFIED',
    stages: [{ stage_code: 'ADMIN_REVIEW', status: 'COMPLETED' }],
  }
  assert.equal(canEmployeeWithdraw(reqPostVerification, 10).allowed, false)

  // Approved cannot be withdrawn by employee
  const reqApproved = {
    employee_user_id: 10,
    status: 'APPROVED',
  }
  assert.equal(canEmployeeWithdraw(reqApproved, 10).allowed, false)
})

test('canAdminCancel allows admin to cancel eligible requests and forbids self-cancellation', () => {
  const adminUser = { id: 2, roles: [{ code: 'ADMIN' }] }
  const regularUser = { id: 10, roles: [{ code: 'EMPLOYEE' }] }

  const approvedReq = {
    id: 101,
    employee_user_id: 5,
    status: 'APPROVED',
  }

  // Admin can cancel approved request
  assert.deepEqual(canAdminCancel(approvedReq, adminUser), { allowed: true })

  // Admin CANNOT cancel own request (AT-051 negative)
  const ownReq = {
    id: 102,
    employee_user_id: 2,
    status: 'APPROVED',
  }
  assert.equal(canAdminCancel(ownReq, adminUser).allowed, false)

  // Non-admin cannot cancel
  assert.equal(canAdminCancel(approvedReq, regularUser).allowed, false)

  // Already cancelled request cannot be cancelled again
  const cancelledReq = {
    id: 103,
    employee_user_id: 5,
    status: 'CANCELLED',
  }
  assert.equal(canAdminCancel(cancelledReq, adminUser).allowed, false)
})
