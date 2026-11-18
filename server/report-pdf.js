import PDFDocument from 'pdfkit'

const FONT = 'Helvetica'
const FONT_BOLD = 'Helvetica-Bold'

function formatDate(value) {
  if (!value) return '—'
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00Z`)
  if (Number.isNaN(date.valueOf())) return String(value).slice(0, 10)
  return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date)
}

function cellText(value) {
  if (value === null || value === undefined || value === '') return '—'
  return String(value)
}

function drawTable(doc, { title, headers, rows, widths, startY, fontSize = 7 }) {
  let y = startY
  const rowHeight = fontSize + 9
  const pageBottom = 770

  const ensureSpace = () => {
    if (y + rowHeight <= pageBottom) return
    doc.addPage()
    y = 50
  }

  doc.font(FONT_BOLD).fontSize(10).fillColor('#111827').text(title, 50, y, { width: 741 })
  y += 18

  const drawRow = (values, isHeader = false) => {
    ensureSpace()
    let x = 50
    if (isHeader) {
      doc.rect(50, y, widths.reduce((a, b) => a + b, 0), rowHeight).fill('#1f2937')
    }
    values.forEach((value, index) => {
      const width = widths[index] || 60
      doc.font(isHeader ? FONT_BOLD : FONT)
        .fontSize(fontSize)
        .fillColor(isHeader ? '#ffffff' : '#111827')
        .text(cellText(value), x + 3, y + 5, {
          width: width - 6,
          height: rowHeight - 6,
          ellipsis: true,
          lineBreak: false,
        })
      x += width
    })
    if (!isHeader) {
      doc.moveTo(50, y + rowHeight).lineTo(50 + widths.reduce((a, b) => a + b, 0), y + rowHeight)
        .strokeColor('#e5e7eb').lineWidth(0.4).stroke()
    }
    y += rowHeight
  }

  drawRow(headers, true)
  if (!rows.length) drawRow(['Tidak ada data pada filter ini.', ...headers.slice(1).map(() => '')])
  else rows.forEach((row) => drawRow(row))
  return y + 16
}

/**
 * Buat PDF laporan rekap cuti. Data yang digambar persis sama dengan yang
 * ditampilkan pada halaman laporan (metrik, rekap unit, komposisi, pembatalan).
 */
export async function generateReportPdf({
  summary,
  recapPerUnit,
  composition,
  cancellations,
  leaveTypes,
  filtersText,
}) {
  const doc = new PDFDocument({
    size: 'A4',
    layout: 'landscape',
    margin: 50,
    info: { Title: 'Laporan Rekap Cuti', Author: 'Sistem Pengajuan Cuti' },
  })
  const chunks = []
  doc.on('data', (chunk) => chunks.push(chunk))
  const done = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
  })

  doc.font(FONT_BOLD).fontSize(15).fillColor('#111827').text('LAPORAN REKAP CUTI', 50, 38, { width: 741, align: 'center' })
  doc.font(FONT).fontSize(8).fillColor('#4b5563').text(filtersText || 'Semua data', 50, 60, { width: 741, align: 'center' })

  // Kartu metrik (2 baris x 3 kolom).
  const metrics = [
    ['Total Pengajuan', summary.totalPengajuan],
    ['Disetujui', summary.totalDisetujui],
    ['Ditolak', summary.totalDitolak],
    ['Pembatalan', summary.totalPembatalan],
    ['Hari Bekerja Disetujui', summary.totalHariDiberikan],
    ['Rata-rata Durasi', summary.rataRataDurasi],
  ]
  const boxWidth = 237
  const boxHeight = 42
  metrics.forEach(([label, value], index) => {
    const col = index % 3
    const row = Math.floor(index / 3)
    const x = 50 + col * (boxWidth + 15)
    const y = 82 + row * (boxHeight + 10)
    doc.roundedRect(x, y, boxWidth, boxHeight, 4).fillAndStroke('#f9fafb', '#d1d5db')
    doc.font(FONT).fontSize(8).fillColor('#6b7280').text(label, x + 10, y + 7, { width: boxWidth - 20 })
    doc.font(FONT_BOLD).fontSize(15).fillColor('#111827').text(String(value ?? 0), x + 10, y + 19, { width: boxWidth - 20 })
  })

  let y = 82 + 2 * (boxHeight + 10) + 6
  const typeCodeToName = Object.fromEntries((leaveTypes || []).map((type) => [type.code, type.name]))
  const typeCodes = ['ANNUAL', 'LONG', 'SICK', 'MATERNITY', 'IMPORTANT_REASON', 'UNPAID']

  y = drawTable(doc, {
    title: 'Rekap Satuan Kerja',
    headers: ['Satuan Kerja', ...typeCodes.map((code) => typeCodeToName[code] || code), 'Total'],
    rows: (recapPerUnit || []).map((row) => [
      row.unitName,
      ...typeCodes.map((code) => Number(row.typeCounts?.[code]) || 0),
      Number(row.totalCount) || 0,
    ]),
    widths: [170, 75, 75, 75, 75, 75, 75, 90],
    startY: y,
    fontSize: 7,
  })

  y = drawTable(doc, {
    title: 'Komposisi Jenis Cuti',
    headers: ['Jenis Cuti', 'Potong Saldo Tahunan', 'Jumlah', 'Persentase'],
    rows: (composition || []).map((row) => [
      row.leaveTypeName,
      row.deductsAnnual ? 'Ya' : 'Tidak',
      Number(row.count) || 0,
      `${Number(row.pct) || 0}%`,
    ]),
    widths: [300, 180, 130, 131],
    startY: y,
    fontSize: 8,
  })
  doc.font(FONT).fontSize(7).fillColor('#6b7280')
    .text('Catatan: cuti selain tahunan tidak memotong saldo tahunan.', 50, y - 4, { width: 741 })

  y = drawTable(doc, {
    title: 'Rekap Pembatalan',
    headers: [
      'Nomor', 'Pegawai', 'Kategori', 'Satuan', 'Jenis', 'Mulai', 'Selesai',
      'Disetujui', 'Digunakan', 'Dikembalikan', 'Alasan', 'Waktu', 'Petugas',
    ],
    rows: (cancellations || []).map((row) => [
      row.requestNumber, row.employeeName, row.employeeCategory, row.employeeUnitName,
      row.leaveTypeName, formatDate(row.startDate), formatDate(row.endDate),
      Number(row.approvedDays) || 0, Number(row.usedDays) || 0, Number(row.restoredDays) || 0,
      row.cancellationReason, formatDate(row.cancelledAt), row.processedByName,
    ]),
    widths: [90, 80, 60, 80, 70, 55, 55, 45, 45, 50, 90, 65, 56],
    startY: y + 8,
    fontSize: 6.5,
  })

  doc.end()
  return done
}
