const SORT_DIRECTIONS = { asc: 'ASC', desc: 'DESC' }

export const REQUEST_STATUS_ORDER = [
  'DRAFT', 'SUBMITTED', 'ADMIN_REVIEW', 'ADMIN_VERIFIED', 'PERTIMBANGAN_REVIEW',
  'KASUBAG_REVIEW', 'KEPSTA_REVIEW', 'PPK_REVIEW', 'RETURNED_FOR_REVISION',
  'APPROVED', 'REJECTED', 'WITHDRAWN', 'CANCELLED',
]

export function sortDirection(value) {
  return SORT_DIRECTIONS[String(value || '').toLowerCase()] || 'DESC'
}

export function statusOrderSql(column) {
  const cases = REQUEST_STATUS_ORDER
    .map((status, index) => `WHEN '${status}' THEN ${index}`)
    .join(' ')
  return `CASE ${column} ${cases} ELSE ${REQUEST_STATUS_ORDER.length} END`
}

// Kunci `sortBy` dari klien hanya dipakai untuk memilih dari daftar kolom yang
// sudah ditentukan server. Nilai SQL tidak pernah disusun dari input mentah.
export function sortExpression(query, fields, fallbackKey, tieColumn) {
  const key = String(query.sortBy || '')
  const column = fields[key] || fields[fallbackKey]
  return `${column} ${sortDirection(query.sortDir)}, ${tieColumn}`
}
