// Sumber tunggal pemformatan rentang tanggal cuti (desktop & mobile).
// Satu hari → "23 Nov 2026"; satu bulan → "8–9 Des 2026";
// lintas bulan → "28 Nov – 2 Des 2026"; lintas tahun → "30 Des 2026 – 2 Jan 2027".

function toDate(value) {
  return new Date(`${String(value).slice(0, 10)}T12:00:00Z`)
}

export function formatDate(value) {
  if (!value) return '-'
  const date = toDate(value)
  if (Number.isNaN(date.valueOf())) return '-'
  return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date)
}

export function formatDateRange(start, end) {
  if (!start && !end) return '-'
  if (!end || String(start) === String(end)) return formatDate(start)
  const a = toDate(start)
  const b = toDate(end)
  if (Number.isNaN(a.valueOf()) || Number.isNaN(b.valueOf())) return formatDate(start)
  const sameMonth = a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth()
  if (sameMonth) {
    const day = new Intl.DateTimeFormat('id-ID', { day: 'numeric', timeZone: 'UTC' }).format(a)
    return `${day}–${formatDate(end)}`
  }
  const sameYear = a.getUTCFullYear() === b.getUTCFullYear()
  if (sameYear) {
    const startShort = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(a)
    return `${startShort} – ${formatDate(end)}`
  }
  return `${formatDate(start)} – ${formatDate(end)}`
}
