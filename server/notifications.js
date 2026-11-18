/**
 * In-App Notification Domain Service.
 * Implements AT-N01, AT-N02, AT-N03, and FR-058/FR-059.
 */

const ALLOWED_SEVERITIES = ['INFO', 'ACTION', 'SUCCESS', 'WARNING', 'DANGER']

/**
 * Creates an in-app notification in cuti.notifications.
 *
 * @param {object} client - pg client
 * @param {object} options
 * @param {number|string} options.userId - Recipient user id
 * @param {number|string} [options.leaveRequestId] - Related leave request id
 * @param {string} options.type - Notification type code (e.g. 'LEAVE_SUBMITTED')
 * @param {string} options.title - Notification title
 * @param {string} options.body - Safe notification body text (no sensitive data)
 * @param {string} [options.actionUrl] - URL to open when clicked
 * @param {string} [options.severity='INFO'] - Notification severity
 * @param {string} [options.dedupeKey] - Deduplication key
 * @returns {Promise<{ success: boolean, id?: number }>}
 */
export async function createNotification(client, options = {}) {
  const {
    userId,
    leaveRequestId = null,
    type,
    title,
    body,
    actionUrl = null,
    severity = 'INFO',
    dedupeKey = null,
  } = options

  if (!userId) {
    throw new Error('userId wajib diisi untuk membuat notifikasi.')
  }
  if (!title || !body) {
    throw new Error('Judul dan pesan notifikasi wajib diisi.')
  }
  if (!ALLOWED_SEVERITIES.includes(severity)) {
    throw new Error(`Severity tidak valid: ${severity}. Gunakan salah satu dari: ${ALLOWED_SEVERITIES.join(', ')}`)
  }

  const result = await client.query(
    `INSERT INTO cuti.notifications (
       user_id, leave_request_id, notification_type, title, body, action_url, severity, dedupe_key
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (dedupe_key) DO NOTHING
     RETURNING id`,
    [
      Number(userId),
      leaveRequestId ? Number(leaveRequestId) : null,
      type || 'SYSTEM',
      String(title).trim(),
      String(body).trim(),
      actionUrl ? String(actionUrl).trim() : null,
      severity,
      dedupeKey ? String(dedupeKey).trim() : null,
    ],
  )

  return {
    success: true,
    id: result.rows[0]?.id || null,
  }
}

/**
 * Sends notification to all active users with a specific role code.
 *
 * @param {object} client - pg client
 * @param {string} roleCode - Target role code (e.g. 'ADMIN', 'HR_ANALYST', 'KASUBAG', 'KEPSTA', 'PPK')
 * @param {object} options
 * @returns {Promise<Array<{ success: boolean, id?: number }>>}
 */
export async function notifyRoleUsers(client, roleCode, options = {}) {
  const usersResult = await client.query(
    `SELECT u.id, u.full_name
     FROM cuti.users u
     JOIN cuti.user_roles ur ON ur.user_id = u.id
     JOIN cuti.roles r ON r.id = ur.role_id
     WHERE r.code = $1 AND u.is_active = true`,
    [roleCode],
  )

  const notifications = []
  for (const user of usersResult.rows) {
    const dedupeKey = options.dedupePrefix
      ? `${options.dedupePrefix}:${user.id}`
      : options.dedupeKey || null

    const res = await createNotification(client, {
      ...options,
      userId: user.id,
      dedupeKey,
    })
    notifications.push(res)
  }

  return notifications
}

/**
 * Automatically dispatches appropriate notifications based on request lifecycle events.
 * Implements AT-N01, AT-N02, AT-N03.
 *
 * @param {object} client - pg client
 * @param {object} params
 * @param {string} params.eventType - Lifecycle event ('SUBMITTED', 'VERIFY', 'PERTIMBANGAN', 'FORWARD', 'DECIDE', 'RETURN', 'WITHDRAW', 'CANCEL')
 * @param {object} params.request - Leave request object
 * @param {object} [params.actor] - Current actor user
 * @param {object} [params.details] - Additional context (decision, nextRoleCode, nextStageCode, notes, restoredDays)
 */
export async function notifyRequestLifecycle(client, params = {}) {
  const { eventType, request, actor, details = {} } = params
  if (!request) return

  const reqId = request.id
  const reqNum = request.request_number
  const empName = request.employee_name || 'Pegawai'
  const empUserId = request.employee_user_id || request.user_id
  const actionUrl = `/requests/${reqId}`

  const normEvent = String(eventType || '').toUpperCase()

  switch (normEvent) {
    case 'SUBMIT':
    case 'SUBMITTED': {
      // AT-N03: Pegawai mengirim pengajuan baru -> Notifikasi ke Admin
      await notifyRoleUsers(client, 'ADMIN', {
        leaveRequestId: reqId,
        type: 'LEAVE_SUBMITTED',
        title: 'Pengajuan Cuti Baru',
        body: `Pengajuan cuti nomor ${reqNum} dari ${empName} menunggu pemeriksaan dan verifikasi Admin.`,
        actionUrl,
        severity: 'ACTION',
        dedupePrefix: `SUBMIT:${reqId}`,
      })
      break
    }

    case 'VERIFY':
    case 'VERIFIED': {
      // AT-N03: Admin memverifikasi -> Notifikasi ke Analis SDM untuk pertimbangan
      await notifyRoleUsers(client, 'HR_ANALYST', {
        leaveRequestId: reqId,
        type: 'ADMIN_VERIFIED',
        title: 'Pemeriksaan Administrasi Selesai',
        body: `Pengajuan cuti nomor ${reqNum} (${empName}) telah diverifikasi Admin dan siap diberikan pertimbangan SDM.`,
        actionUrl,
        severity: 'ACTION',
        dedupePrefix: `VERIFY:HR:${reqId}`,
      })

      // Also inform employee
      if (empUserId) {
        await createNotification(client, {
          userId: empUserId,
          leaveRequestId: reqId,
          type: 'ADMIN_VERIFIED',
          title: 'Verifikasi Administrasi Disetujui',
          body: `Pengajuan cuti Anda nomor ${reqNum} telah diverifikasi oleh Admin dan diteruskan untuk pertimbangan SDM.`,
          actionUrl,
          severity: 'INFO',
          dedupeKey: `VERIFY:EMP:${reqId}`,
        })
      }
      break
    }

    case 'PERTIMBANGAN':
    case 'FORWARD':
    case 'FORWARDED': {
      // AT-N03: Analis SDM memberi pertimbangan atau Kasubag meneruskan
      const targetRole = details.nextRoleCode || 'KEPSTA'
      await notifyRoleUsers(client, targetRole, {
        leaveRequestId: reqId,
        type: 'LEAVE_FORWARDED',
        title: 'Antrean Persetujuan Cuti',
        body: `Pengajuan cuti nomor ${reqNum} (${empName}) menunggu tindakan persetujuan Anda.`,
        actionUrl,
        severity: 'ACTION',
        dedupePrefix: `FORWARD:${reqId}:${details.nextStageCode || targetRole}`,
      })
      break
    }

    case 'DECIDE':
    case 'DECIDED': {
      // AT-N01 & AT-N03: Keputusan final disetujui atau tidak disetujui
      if (!empUserId) break
      const isApproved = details.decision === 'APPROVED'
      const decText = isApproved ? 'DISETUJUI' : 'TIDAK DISETUJUI'

      await createNotification(client, {
        userId: empUserId,
        leaveRequestId: reqId,
        type: isApproved ? 'LEAVE_APPROVED' : 'LEAVE_REJECTED',
        title: `Pengajuan Cuti ${decText}`,
        body: `Pengajuan cuti Anda nomor ${reqNum} telah ${decText} oleh ${actor?.fullName || 'pejabat yang berwenang'}.`,
        actionUrl,
        severity: isApproved ? 'SUCCESS' : 'DANGER',
        dedupeKey: `DECIDE:${reqId}:${details.decision}`,
      })
      break
    }

    case 'RETURN':
    case 'RETURNED': {
      // AT-N01 & AT-N03: Reviewer mengembalikan pengajuan untuk perbaikan
      if (!empUserId) break
      const safeNotes = details.notes ? String(details.notes).slice(0, 150) : 'Periksa kembali kelengkapan pengajuan.'
      await createNotification(client, {
        userId: empUserId,
        leaveRequestId: reqId,
        type: 'LEAVE_RETURNED',
        title: 'Pengajuan Cuti Dikembalikan',
        body: `Pengajuan cuti Anda nomor ${reqNum} dikembalikan untuk diperbaiki. Catatan: ${safeNotes}`,
        actionUrl,
        severity: 'WARNING',
        dedupeKey: `RETURN:${reqId}:${Date.now()}`,
      })
      break
    }

    case 'WITHDRAW':
    case 'WITHDRAWN': {
      // AT-N01: Pengajuan ditarik oleh pegawai -> notifikasi ke Admin
      await notifyRoleUsers(client, 'ADMIN', {
        leaveRequestId: reqId,
        type: 'LEAVE_WITHDRAWN',
        title: 'Pengajuan Cuti Ditarik Pegawai',
        body: `Pengajuan cuti nomor ${reqNum} telah ditarik dan dibatalkan oleh pegawai.`,
        actionUrl,
        severity: 'INFO',
        dedupePrefix: `WITHDRAWN:${reqId}`,
      })
      break
    }

    case 'CANCEL':
    case 'CANCELLED': {
      // AT-N01: Cuti dibatalkan oleh Admin -> notifikasi ke pegawai
      if (!empUserId) break
      const restored = Number(details.restoredDays || 0)
      const restoreNote = restored > 0 ? ` Saldo cuti tahunan Anda telah dipulihkan ${restored} hari kerja.` : ''
      await createNotification(client, {
        userId: empUserId,
        leaveRequestId: reqId,
        type: 'LEAVE_CANCELLED',
        title: 'Pengajuan Cuti Dibatalkan Admin',
        body: `Pengajuan cuti Anda nomor ${reqNum} telah dibatalkan oleh Admin.${restoreNote}`,
        actionUrl,
        severity: 'WARNING',
        dedupeKey: `CANCEL:${reqId}`,
      })
      break
    }

    default:
      break
  }
}
