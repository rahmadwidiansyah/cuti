// Opsi pengurutan yang dipakai bersama oleh tabel pengajuan.
// Nilai `value` harus cocok dengan kunci whitelist di server.
export const REQUEST_SORT_OPTIONS = [
  { value: 'requestNumber', label: 'No pengajuan' },
  { value: 'employee', label: 'Pegawai' },
  { value: 'leaveType', label: 'Jenis' },
  { value: 'startDate', label: 'Tanggal cuti' },
  { value: 'workingDays', label: 'Durasi' },
  { value: 'submittedAt', label: 'Diajukan' },
  { value: 'status', label: 'Status' },
]

// Antrean persetujuan punya kolom unit kerja tambahan.
export const APPROVAL_SORT_OPTIONS = [
  ...REQUEST_SORT_OPTIONS.slice(0, 2),
  { value: 'unit', label: 'Unit kerja' },
  ...REQUEST_SORT_OPTIONS.slice(2),
]

export const CANCELLATION_SORT_OPTIONS = [
  { value: 'requestNumber', label: 'No pengajuan' },
  { value: 'employee', label: 'Pegawai' },
  { value: 'startDate', label: 'Tanggal cuti' },
  { value: 'submittedAt', label: 'Diajukan' },
]

// Arah pertama kali sebuah kolom diklik. Teks urut A–Z, tanggal/angka terbaru
// atau terbesar dulu. Klik berikutnya membalik arah seperti biasa.
export function defaultDirectionFor(key) {
  return ['employee', 'leaveType', 'status', 'unit'].includes(key) ? 'asc' : 'desc'
}

export function directionLabel(sortBy, sortDir) {
  if (sortBy === 'startDate' || sortBy === 'submittedAt') {
    return sortDir === 'desc' ? 'Terbaru' : 'Terlama'
  }
  if (sortBy === 'workingDays') {
    return sortDir === 'desc' ? 'Terbesar' : 'Terkecil'
  }
  if (sortBy === 'status') {
    return sortDir === 'desc' ? 'Urutan alur' : 'Terbalik'
  }
  return sortDir === 'desc' ? 'Z–A' : 'A–Z'
}
