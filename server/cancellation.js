import { notifyRequestLifecycle } from './notifications.js'

export class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

/**
 * Domain logic and helpers for leave cancellation and balance restoration.
 */

/**
 * Calculates how many counted working days of the leave request have elapsed
 * on or before the given effective date.
 *
 * @param {Array<{ leave_date?: string, date?: string, is_counted?: boolean, counted?: boolean }>} days
 * @param {string|Date} effectiveDate
 * @returns {number}
 */
export function calculateUsedWorkingDays(days, effectiveDate) {
  if (!Array.isArray(days) || !effectiveDate) return 0
  const effDateStr = typeof effectiveDate === 'string'
    ? effectiveDate.slice(0, 10)
    : effectiveDate.toISOString().slice(0, 10)

  let count = 0
  for (const day of days) {
    const dayDate = (day.leave_date || day.date || '').slice(0, 10)
    const isCounted = day.is_counted ?? day.counted ?? false
    if (isCounted && dayDate && dayDate <= effDateStr) {
      count += 1
    }
  }
  return count
}

/**
 * Validates if an employee can withdraw (cancel) their own leave request.
 * PRD 10.4, AT-048, AT-049:
 * Only permitted before Admin verification has been completed.
 *
 * @param {object} request
 * @param {number} userId
 * @returns {{ allowed: boolean, reason?: string }}
 */
export function canEmployeeWithdraw(request, userId) {
  if (!request) {
    return { allowed: false, reason: 'Pengajuan tidak ditemukan.' }
  }

  const ownerId = request.employee_user_id || request.user_id
  if (Number(ownerId) !== Number(userId)) {
    return { allowed: false, reason: 'Anda hanya dapat membatalkan pengajuan milik sendiri.' }
  }

  // Check current status
  const preVerificationStatuses = ['SUBMITTED', 'ADMIN_REVIEW', 'RETURNED_FOR_REVISION']
  if (!preVerificationStatuses.includes(request.status)) {
    return {
      allowed: false,
      reason: 'Pengajuan sudah melewati verifikasi Admin dan tidak dapat dibatalkan mandiri. Hubungi Admin TU.',
    }
  }

  // Also check history / stages if provided
  if (Array.isArray(request.stages)) {
    const adminStage = request.stages.find((s) => s.stage_code === 'ADMIN_REVIEW')
    if (adminStage && adminStage.status === 'COMPLETED') {
      return {
        allowed: false,
        reason: 'Verifikasi Admin telah selesai. Pembatalan hanya dapat dilakukan Admin.',
      }
    }
  }

  return { allowed: true }
}

/**
 * Validates if an Admin can cancel a leave request.
 * PRD 10.5, AT-016..AT-020, AT-051:
 * - User must have ADMIN role.
 * - Admin cannot cancel their own request (must be handled by another Admin).
 * - Status must be either pre-final review stages or APPROVED.
 *
 * @param {object} request
 * @param {object} user
 * @returns {{ allowed: boolean, reason?: string }}
 */
export function canAdminCancel(request, user) {
  if (!request || !user) {
    return { allowed: false, reason: 'Pengajuan atau pengguna tidak valid.' }
  }

  const isAdmin = Array.isArray(user.roles) && user.roles.some((r) => r.code === 'ADMIN' || r === 'ADMIN')
  if (!isAdmin) {
    return { allowed: false, reason: 'Hanya Admin yang berwenang membatalkan pengajuan pada tahap ini.' }
  }

  const ownerId = request.employee_user_id || request.user_id
  if (Number(ownerId) === Number(user.id)) {
    return {
      allowed: false,
      reason: 'Admin tidak dapat membatalkan pengajuannya sendiri. Harap dialihkan ke Admin lain.',
    }
  }

  const cancellableStatuses = [
    'ADMIN_VERIFIED',
    'PERTIMBANGAN_REVIEW',
    'KASUBAG_REVIEW',
    'KEPSTA_REVIEW',
    'PPK_REVIEW',
    'RETURNED_FOR_REVISION',
    'APPROVED',
  ]

  if (!cancellableStatuses.includes(request.status)) {
    return {
      allowed: false,
      reason: `Pengajuan dengan status ${request.status} tidak dapat dibatalkan oleh Admin.`,
    }
  }

  return { allowed: true }
}

/**
 * Handles employee withdrawal of a leave request before Admin verification.
 * PRD 10.4, AT-048, AT-049
 *
 * @param {object} client - pg client inside a transaction
 * @param {object} user - Authenticated user
 * @param {number|string} requestId - Leave request ID
 * @param {string} reason - Withdrawal reason
 * @param {object} [options] - Optional metadata (ip, userAgent)
 */
export async function withdrawLeaveRequest(client, user, requestId, reason, options = {}) {
  const trimmedReason = String(reason || '').trim()
  if (trimmedReason.length < 10) {
    throw new HttpError(400, 'Alasan pembatalan wajib diisi, minimal 10 karakter.')
  }

  // Fetch leave request with employee and leave type details
  const reqResult = await client.query(
    `SELECT r.*,
            t.code AS leave_type_code,
            t.name AS leave_type_name,
            t.deducts_annual_balance,
            u.id AS employee_user_id
     FROM cuti.leave_requests r
     JOIN cuti.employees e ON e.id = r.employee_id
     JOIN cuti.users u ON u.id = e.user_id
     JOIN cuti.leave_types t ON t.id = r.leave_type_id
     WHERE r.id = $1
     FOR UPDATE`,
    [requestId],
  )

  if (!reqResult.rowCount) {
    throw new HttpError(404, 'Pengajuan cuti tidak ditemukan.')
  }

  const request = reqResult.rows[0]

  // Fetch stages to verify history
  const stagesResult = await client.query(
    `SELECT stage_code, role_code, status
     FROM cuti.leave_request_stages
     WHERE leave_request_id = $1`,
    [requestId],
  )
  request.stages = stagesResult.rows

  // Check permission
  const check = canEmployeeWithdraw(request, user.id)
  if (!check.allowed) {
    throw new HttpError(403, check.reason || 'Pengajuan tidak dapat dibatalkan.')
  }

  const previousStatus = request.status

  // 1. Update request status to WITHDRAWN
  await client.query(
    `UPDATE cuti.leave_requests SET status = $2, updated_at = now() WHERE id = $1`,
    [request.id, 'WITHDRAWN'],
  )

  // 2. Cancel active or pending stages
  await client.query(
    `UPDATE cuti.leave_request_stages SET status = 'CANCELLED', updated_at = now()
     WHERE leave_request_id = $1 AND status IN ('PENDING', 'ACTIVE')`,
    [request.id],
  )

  let balanceId = null
  let balanceBefore = null
  let balanceAfter = null

  // 3. Release reserved annual leave days if applicable
  const deductsAnnual = Boolean(request.deducts_annual_balance || request.is_annual_leave)
  if (deductsAnnual && request.balance_period_year) {
    const balResult = await client.query(
      `SELECT id, available_days, reserved_days
       FROM cuti.leave_balances
       WHERE employee_id = $1 AND leave_type_id = $2 AND period_year = $3
       FOR UPDATE`,
      [request.employee_id, request.leave_type_id, request.balance_period_year],
    )

    if (balResult.rowCount) {
      const balance = balResult.rows[0]
      balanceId = balance.id
      balanceBefore = Number(balance.available_days)
      const requestedDays = Number(request.requested_working_days)

      await client.query(
        `INSERT INTO cuti.leave_balance_transactions (
           balance_id, leave_request_id, transaction_type, reserved_delta,
           reason, created_by_user_id, idempotency_key
         ) VALUES ($1,$2,'RELEASE',$3,$4,$5,$6)`,
        [
          balance.id,
          request.id,
          -requestedDays,
          'Pelepasan reservasi saldo karena pengajuan ditarik oleh pegawai',
          user.id,
          `RELEASE:WITHDRAW:${request.id}`,
        ],
      )

      balanceAfter = balanceBefore + requestedDays
    }
  }

  // 4. Record in leave_cancellations
  await client.query(
    `INSERT INTO cuti.leave_cancellations (
       leave_request_id, cancellation_source, reason, effective_date,
       approved_days, used_days, used_days_source, restored_days,
       balance_id, balance_before, balance_after,
       processed_by_user_id, processed_role_code, idempotency_key
     ) VALUES ($1, 'EMPLOYEE_WITHDRAWAL', $2, CURRENT_DATE,
               0, 0, 'WORKING_DAYS_CALCULATION', 0,
               $3, $4, $5,
               $6, 'EMPLOYEE', $7)
     ON CONFLICT (leave_request_id) DO NOTHING`,
    [
      request.id,
      trimmedReason,
      balanceId,
      balanceBefore,
      balanceAfter,
      user.id,
      `WITHDRAW:${request.id}`,
    ],
  )

  // 5. Record event in leave_request_events
  await client.query(
    `INSERT INTO cuti.leave_request_events (
       leave_request_id, event_type, from_status, to_status,
       description, actor_user_id, actor_role_code
     ) VALUES ($1, 'WITHDRAWN', $2, 'WITHDRAWN', $3, $4, 'EMPLOYEE')`,
    [
      request.id,
      previousStatus,
      `Pengajuan ditarik oleh pegawai: ${trimmedReason}`,
      user.id,
    ],
  )

  // 6. Record audit log
  await client.query(
    `INSERT INTO cuti.audit_logs (
       actor_user_id, actor_name, actor_role_code, action, entity_type, entity_id,
       before_values, after_values, ip_address, user_agent
     ) VALUES ($1,$2,'EMPLOYEE','WITHDRAW_LEAVE_REQUEST','leave_requests',$3,$4::jsonb,$5::jsonb,$6::inet,$7)`,
    [
      user.id,
      user.fullName || 'Pegawai',
      request.id,
      JSON.stringify({ status: previousStatus }),
      JSON.stringify({ status: 'WITHDRAWN', reason: trimmedReason }),
      options.ip || null,
      options.userAgent || null,
    ],
  )

  // 7. Notification for Admin queue
  await notifyRequestLifecycle(client, {
    eventType: 'WITHDRAW',
    request,
    actor: user,
  })

  return {
    success: true,
    requestId: request.id,
    requestNumber: request.request_number,
    status: 'WITHDRAWN',
    message: 'Pengajuan cuti berhasil ditarik dan dibatalkan.',
  }
}

/**
 * Handles Admin cancellation of a leave request (pre-final or approved).
 * PRD 10.5, AT-016..AT-020, AT-051
 *
 * @param {object} client - pg client inside a transaction
 * @param {object} user - Authenticated admin user
 * @param {number|string} requestId - Leave request ID
 * @param {object} payload - { source, reason, effectiveDate, restoredDays, idempotencyKey }
 * @param {object} [options] - Optional metadata (ip, userAgent)
 */
export async function cancelLeaveRequest(client, user, requestId, payload = {}, options = {}) {
  // Validate Admin role
  const isAdmin = Array.isArray(user?.roles) && user.roles.some((r) => r.code === 'ADMIN' || r === 'ADMIN')
  if (!isAdmin) {
    throw new HttpError(403, 'Hanya Admin yang berwenang membatalkan pengajuan pada tahap ini.')
  }

  const source = String(payload.source || '').trim()
  if (!['EMPLOYEE_REQUEST', 'ADMIN_INITIATED'].includes(source)) {
    throw new HttpError(400, 'Pilih sumber pembatalan yang valid (Permintaan pegawai atau Inisiatif Admin).')
  }

  const trimmedReason = String(payload.reason || '').trim()
  if (trimmedReason.length < 10) {
    throw new HttpError(400, 'Alasan pembatalan wajib diisi, minimal 10 karakter.')
  }

  // Fetch leave request FOR UPDATE to lock and prevent concurrency issues
  const reqResult = await client.query(
    `SELECT r.*,
            t.code AS leave_type_code,
            t.name AS leave_type_name,
            t.deducts_annual_balance,
            u.id AS employee_user_id
     FROM cuti.leave_requests r
     JOIN cuti.employees e ON e.id = r.employee_id
     JOIN cuti.users u ON u.id = e.user_id
     JOIN cuti.leave_types t ON t.id = r.leave_type_id
     WHERE r.id = $1
     FOR UPDATE`,
    [requestId],
  )

  if (!reqResult.rowCount) {
    throw new HttpError(404, 'Pengajuan cuti tidak ditemukan.')
  }

  const request = reqResult.rows[0]

  // Double-click / idempotency check (AT-019)
  if (request.status === 'CANCELLED') {
    throw new HttpError(409, 'Pengajuan cuti ini sudah dibatalkan sebelumnya.')
  }

  // Check canAdminCancel (includes self-action check AT-051 negative)
  const check = canAdminCancel(request, user)
  if (!check.allowed) {
    const status = check.reason?.includes('pengajuannya sendiri') ? 403 : 400
    throw new HttpError(status, check.reason || 'Pengajuan tidak dapat dibatalkan.')
  }

  const previousStatus = request.status
  const isApproved = previousStatus === 'APPROVED'
  const deductsAnnual = Boolean(request.deducts_annual_balance || request.is_annual_leave)

  let effectiveDate = payload.effectiveDate ? String(payload.effectiveDate).slice(0, 10) : new Date().toISOString().slice(0, 10)
  let approvedDays = 0
  let usedDays = 0
  let maxRestorable = 0
  let restoredDays = 0
  let balanceId = null
  let balanceBefore = null
  let balanceAfter = null

  if (isApproved) {
    approvedDays = Number(request.approved_working_days || request.requested_working_days)

    // Fetch snapshot days
    const daysResult = await client.query(
      `SELECT leave_date::text, day_index, is_counted
       FROM cuti.leave_request_days
       WHERE leave_request_id = $1
       ORDER BY leave_date`,
      [request.id],
    )
    const days = daysResult.rows

    usedDays = calculateUsedWorkingDays(days, effectiveDate)
    maxRestorable = Math.max(0, approvedDays - usedDays)

    if (payload.restoredDays !== undefined && payload.restoredDays !== null && payload.restoredDays !== '') {
      restoredDays = Number(payload.restoredDays)
    } else {
      restoredDays = maxRestorable
    }

    // Backend independent validation (AT-018)
    if (isNaN(restoredDays) || restoredDays < 0 || restoredDays > maxRestorable) {
      throw new HttpError(
        400,
        `Jumlah pengembalian hari (${restoredDays}) melebihi batas maksimal yang diizinkan (${maxRestorable} hari).`,
      )
    }

    if (deductsAnnual && request.balance_period_year) {
      const balResult = await client.query(
        `SELECT id, available_days, used_days, reserved_days
         FROM cuti.leave_balances
         WHERE employee_id = $1 AND leave_type_id = $2 AND period_year = $3
         FOR UPDATE`,
        [request.employee_id, request.leave_type_id, request.balance_period_year],
      )

      if (balResult.rowCount) {
        const balance = balResult.rows[0]
        balanceId = balance.id
        balanceBefore = Number(balance.available_days)

        if (restoredDays > 0) {
          await client.query(
            `INSERT INTO cuti.leave_balance_transactions (
               balance_id, leave_request_id, transaction_type, used_delta,
               reason, created_by_user_id, idempotency_key
             ) VALUES ($1,$2,'RESTORATION',$3,$4,$5,$6)`,
            [
              balance.id,
              request.id,
              -restoredDays,
              `Pengembalian ${restoredDays} hari saldo atas pembatalan cuti ${request.request_number}`,
              user.id,
              `RESTORE:${request.id}:${restoredDays}`,
            ],
          )
        }

        balanceAfter = balanceBefore + restoredDays
      }
    }
  } else {
    // Pre-final cancellation (AT-051): release reservation if exists
    if (deductsAnnual && request.balance_period_year) {
      const balResult = await client.query(
        `SELECT id, available_days, reserved_days
         FROM cuti.leave_balances
         WHERE employee_id = $1 AND leave_type_id = $2 AND period_year = $3
         FOR UPDATE`,
        [request.employee_id, request.leave_type_id, request.balance_period_year],
      )

      if (balResult.rowCount) {
        const balance = balResult.rows[0]
        balanceId = balance.id
        balanceBefore = Number(balance.available_days)
        const requestedDays = Number(request.requested_working_days)

        await client.query(
          `INSERT INTO cuti.leave_balance_transactions (
             balance_id, leave_request_id, transaction_type, reserved_delta,
             reason, created_by_user_id, idempotency_key
           ) VALUES ($1,$2,'RELEASE',$3,$4,$5,$6)`,
          [
            balance.id,
            request.id,
            -requestedDays,
            'Pelepasan reservasi saldo atas pembatalan pengajuan sebelum final oleh Admin',
            user.id,
            `RELEASE:ADMIN_CANCEL:${request.id}`,
          ],
        )

        balanceAfter = balanceBefore + requestedDays
      }
    }
  }

  // 1. Insert into leave_cancellations
  const idempotencyKey = payload.idempotencyKey || `CANCEL:${request.id}:${Date.now()}`
  await client.query(
    `INSERT INTO cuti.leave_cancellations (
       leave_request_id, cancellation_source, reason, effective_date,
       approved_days, used_days, used_days_source, restored_days,
       balance_id, balance_before, balance_after,
       processed_by_user_id, processed_role_code, idempotency_key
     ) VALUES ($1, $2, $3, $4,
               $5, $6, 'WORKING_DAYS_CALCULATION', $7,
               $8, $9, $10,
               $11, 'ADMIN', $12)`,
    [
      request.id,
      source,
      trimmedReason,
      effectiveDate,
      approvedDays,
      usedDays,
      restoredDays,
      balanceId,
      balanceBefore,
      balanceAfter,
      user.id,
      idempotencyKey,
    ],
  )

  // 2. Update leave_requests status to CANCELLED
  await client.query(
    `UPDATE cuti.leave_requests SET status = 'CANCELLED', updated_at = now() WHERE id = $1`,
    [request.id],
  )

  // 3. Cancel any pending or active stages
  await client.query(
    `UPDATE cuti.leave_request_stages SET status = 'CANCELLED', updated_at = now()
     WHERE leave_request_id = $1 AND status IN ('PENDING', 'ACTIVE')`,
    [request.id],
  )

  // 4. Record event
  const desc = isApproved
    ? `Cuti disetujui dibatalkan Admin (${source === 'EMPLOYEE_REQUEST' ? 'Permintaan Pegawai' : 'Inisiatif Admin'}): ${trimmedReason}. Hari digunakan: ${usedDays}, dikembalikan: ${restoredDays} hari.`
    : `Pengajuan dibatalkan Admin sebelum final: ${trimmedReason}. Reservasi saldo dilepas.`

  await client.query(
    `INSERT INTO cuti.leave_request_events (
       leave_request_id, event_type, from_status, to_status,
       description, actor_user_id, actor_role_code
     ) VALUES ($1, 'CANCELLED', $2, 'CANCELLED', $3, $4, 'ADMIN')`,
    [request.id, previousStatus, desc, user.id],
  )

  // 5. Audit log
  await client.query(
    `INSERT INTO cuti.audit_logs (
       actor_user_id, actor_name, actor_role_code, action, entity_type, entity_id,
       before_values, after_values, ip_address, user_agent
     ) VALUES ($1,$2,'ADMIN','CANCEL_LEAVE_REQUEST','leave_requests',$3,$4::jsonb,$5::jsonb,$6::inet,$7)`,
    [
      user.id,
      user.fullName || 'Admin TU',
      request.id,
      JSON.stringify({ status: previousStatus }),
      JSON.stringify({
        status: 'CANCELLED',
        source,
        reason: trimmedReason,
        effectiveDate,
        approvedDays,
        usedDays,
        restoredDays,
      }),
      options.ip || null,
      options.userAgent || null,
    ],
  )

  // 6. Notification to employee
  await notifyRequestLifecycle(client, {
    eventType: 'CANCEL',
    request,
    actor: user,
    details: { restoredDays },
  })

  return {
    success: true,
    requestId: request.id,
    requestNumber: request.request_number,
    status: 'CANCELLED',
    usedDays,
    maxRestorable,
    restoredDays,
    balanceBefore,
    balanceAfter,
    message: isApproved
      ? `Cuti berhasil dibatalkan. Saldo bertambah ${restoredDays} hari.`
      : 'Pengajuan cuti berhasil dibatalkan oleh Admin.',
  }
}


