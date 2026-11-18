import { HttpError } from './cancellation.js'

/**
 * Materialisasi sebuah stage pada nomor langkah tertentu dari konfigurasi rute.
 * Dipakai bersama oleh advanceToNextStage dan ensureActiveStage.
 */
async function materializeStage(client, request, stepNo, attemptNo) {
  const configResult = await client.query(
    `SELECT id, stage_code, role_code, unit_scope, decision_mode, is_final, sla_hours
     FROM cuti.approval_route_steps
     WHERE route_id = $1 AND step_no = $2`,
    [request.route_id, stepNo],
  )
  if (!configResult.rowCount) return null
  const step = configResult.rows[0]

  // Normal: aktifkan baris stage yang sudah disiapkan saat pengajuan dibuat.
  let activated = await client.query(
    `UPDATE cuti.leave_request_stages
     SET status = 'ACTIVE', activated_at = now(),
         due_at = now() + make_interval(hours => $4::int), updated_at = now()
     WHERE leave_request_id = $1 AND attempt_no = $2 AND step_no = $3
       AND status = 'PENDING'
     RETURNING id, stage_code, role_code`,
    [request.id, attemptNo, stepNo, step.sla_hours],
  )

  // Self-healing: baris belum ada / sudah tidak PENDING → ambil dari konfigurasi.
  if (!activated.rowCount) {
    activated = await client.query(
      `INSERT INTO cuti.leave_request_stages (
         leave_request_id, attempt_no, route_step_id, step_no, stage_code,
         role_code, unit_scope, decision_mode, is_final, sla_hours,
         status, activated_at, due_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'ACTIVE',now(), now() + make_interval(hours => $11::int))
       ON CONFLICT (leave_request_id, attempt_no, step_no) DO UPDATE
       SET status = 'ACTIVE',
           stage_code = EXCLUDED.stage_code,
           role_code = EXCLUDED.role_code,
           unit_scope = EXCLUDED.unit_scope,
           decision_mode = EXCLUDED.decision_mode,
           is_final = EXCLUDED.is_final,
           sla_hours = EXCLUDED.sla_hours,
           route_step_id = EXCLUDED.route_step_id,
           activated_at = now(),
           due_at = now() + make_interval(hours => EXCLUDED.sla_hours::int),
           completed_at = NULL,
           updated_at = now()
       RETURNING id, stage_code, role_code`,
      [
        request.id,
        attemptNo,
        step.id,
        stepNo,
        step.stage_code,
        step.role_code,
        step.unit_scope,
        step.decision_mode,
        step.is_final,
        step.sla_hours,
        step.sla_hours,
      ],
    )
  }

  if (!activated.rowCount) {
    throw new HttpError(409, 'Tahap persetujuan tidak dapat disiapkan.')
  }

  return {
    config: step,
    stage: {
      id: activated.rows[0].id,
      attempt_no: attemptNo,
      step_no: stepNo,
      stage_code: activated.rows[0].stage_code,
      role_code: activated.rows[0].role_code,
      decision_mode: step.decision_mode,
      is_final: !!step.is_final,
      unit_scope: step.unit_scope,
      sla_hours: step.sla_hours,
      status: 'ACTIVE',
    },
  }
}

/**
 * Siapkan tahap berikutnya setelah stage aktif selesai diproses.
 * @returns {Promise<{stepNo:number, stageCode:string, roleCode:string, decisionMode:string, isFinal:boolean, slaHours:number}|null>}
 *   null bila step berikutnya tidak ada (tahap final).
 */
export async function advanceToNextStage(client, request, currentStage) {
  const result = await materializeStage(
    client,
    request,
    Number(currentStage.step_no) + 1,
    Number(currentStage.attempt_no),
  )
  if (!result) return null
  return {
    stepNo: Number(currentStage.step_no) + 1,
    stageCode: result.config.stage_code,
    roleCode: result.config.role_code,
    decisionMode: result.config.decision_mode,
    isFinal: !!result.config.is_final,
    slaHours: result.config.sla_hours,
  }
}

const STATUS_TO_STEP = {
  SUBMITTED: 1,
  ADMIN_REVIEW: 1,
  ADMIN_VERIFIED: 2,
  PERTIMBANGAN_REVIEW: 2,
  KASUBAG_REVIEW: 3,
  KEPSTA_REVIEW: 3,
  PPK_REVIEW: 3,
}

/**
 * Pastikan ada stage ACTIVE yang bisa diproses. Bila belum ada (misalnya data
 * hasil import/dummy yang tidak membuat seluruh baris stage), stage dibuat dari
 * konfigurasi rute berdasarkan status pengajuan saat ini.
 */
export async function ensureActiveStage(client, request) {
  const activeResult = await client.query(
    `SELECT * FROM cuti.leave_request_stages
     WHERE leave_request_id = $1 AND status = 'ACTIVE'
     ORDER BY attempt_no DESC, step_no
     LIMIT 1 FOR UPDATE`,
    [request.id],
  )
  if (activeResult.rowCount) return activeResult.rows[0]

  const stepNo = STATUS_TO_STEP[String(request.status || '').toUpperCase()]
  if (!stepNo) return null
  const result = await materializeStage(client, request, stepNo, 1)
  if (!result) return null

  // Selaraskan status pengajuan dengan stage yang dipulihkan agar transisi
  // status berikutnya (saat aksi dijalankan) tetap valid.
  if (String(request.status) !== String(result.stage.stage_code)) {
    await client.query(
      `UPDATE cuti.leave_requests SET status = $2, updated_at = now() WHERE id = $1`,
      [request.id, result.stage.stage_code],
    )
    request.status = result.stage.stage_code
  }
  return result.stage
}
