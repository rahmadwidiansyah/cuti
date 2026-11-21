// Sumber tunggal label dan nada warna status. Dipakai desktop dan mobile.
// Label 13 status mengikuti copy deck Design System 12.4 (satu status satu label);
// status lain di luar siklus pengajuan memakai label operasional yang sama.

const LABELS = {
  DRAFT: 'Draf',
  SUBMITTED: 'Terkirim',
  ADMIN_REVIEW: 'Menunggu verifikasi',
  ADMIN_VERIFIED: 'Diverifikasi Admin',
  PERTIMBANGAN_REVIEW: 'Menunggu pertimbangan SDM',
  KASUBAG_REVIEW: 'Menunggu Kasubag',
  KEPSTA_REVIEW: 'Menunggu Kepsta',
  PPK_REVIEW: 'Menunggu PPK',
  RETURNED_FOR_REVISION: 'Dikembalikan untuk perbaikan',
  APPROVED: 'Disetujui',
  COMPLETED: 'Selesai',
  REJECTED: 'Tidak Disetujui',
  WITHDRAWN: 'Dibatalkan pegawai',
  CANCELLED: 'Dibatalkan Admin',
  ACTIVE: 'Aktif',
  INACTIVE: 'Nonaktif',
  ON_LEAVE: 'Sedang cuti',
  UPCOMING: 'Cuti berikutnya',
  NONE: 'Tidak cuti',
  OVERDUE: 'Lewat SLA',
}

const NEUTRAL = ['DRAFT', 'WITHDRAWN', 'CANCELLED', 'INACTIVE', 'NONE']
const INFO = ['SUBMITTED', 'ADMIN_VERIFIED', 'UPCOMING']
const WARNING = [
  'ADMIN_REVIEW',
  'RETURNED_FOR_REVISION',
  'PERTIMBANGAN_REVIEW',
  'KASUBAG_REVIEW',
  'KEPSTA_REVIEW',
  'PPK_REVIEW',
  'ON_LEAVE',
]
const SUCCESS = ['APPROVED', 'COMPLETED', 'ACTIVE']
const DANGER = ['REJECTED', 'OVERDUE']

export function statusLabel(status) {
  return LABELS[status] || status || '-'
}

export function statusTone(status) {
  if (NEUTRAL.includes(status)) return 'neutral'
  if (INFO.includes(status)) return 'info'
  if (WARNING.includes(status)) return 'warning'
  if (SUCCESS.includes(status)) return 'success'
  if (DANGER.includes(status)) return 'danger'
  return 'neutral'
}
