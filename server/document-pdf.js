import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import PDFDocument from 'pdfkit'

const __dirname = dirname(fileURLToPath(import.meta.url))

export const DOCUMENT_TEMPLATE_VERSION = '2026-11-form-exact5'
const FONT_PATH = resolve(__dirname, 'assets/fonts/Gotham-Light.otf')
const HAS_FONT = existsSync(FONT_PATH)
const FONT = HAS_FONT ? 'GothamLight' : 'Helvetica'
const FONT_BOLD = HAS_FONT ? 'GothamLight' : 'Helvetica-Bold'
const PAGE_W = 595.28
const MARGIN = 36
const PAGE_MARGIN_Y = 2.85
// Margin atas 1,27 cm (36 pt), sesuai permintaan.
const PAGE_MARGIN_TOP = 36
const TEXT_W = 523.28
const TABLE_X = 27.9
const CONTENT_W = 553.5
const LINE = '#000000'
const PAD = 2
// Jarak antar tabel bagian, seperti paragraf kosong di sampel surat.
// Dibatasi 4 pt agar catatan kaki dan QR tetap muat di halaman yang sama.
const SECTION_GAP = 4
// Blok alamat rata kiri pada indent 326,05 pt (6521 twips) seperti sampel.
const HEADER_X = MARGIN + 326.05
const HEADER_LINE = 10.5
const BOLD_STROKE = 0.25
const LOGO_PATH = resolve(__dirname, 'assets/tvri-logo.png')
const LOGO_W = 66.7
const LOGO_H = 41.2

const LEAVE_TYPES_FULL = [
  { code: 'ANNUAL', label: 'Cuti Tahunan' },
  { code: 'LONG', label: 'Cuti Besar' },
  { code: 'SICK', label: 'Cuti Sakit' },
  { code: 'MATERNITY', label: 'Cuti Melahirkan' },
  { code: 'IMPORTANT_REASON', label: 'Cuti Karena Alasan Penting' },
  { code: 'UNPAID', label: 'Cuti di Luar Tanggungan Negara' },
]
const LEAVE_TYPES_SHORT = LEAVE_TYPES_FULL.filter(type => ['ANNUAL', 'SICK', 'MATERNITY'].includes(type.code))

const CATATAN_RIGHT_FULL = [
  'CUTI BESAR',
  'CUTI SAKIT',
  'CUTI MELAHIRKAN',
  'CUTI KARENA ALASAN PENTING',
  'CUTI DI LUAR TANGGUNGAN NEGARA',
]
const CATATAN_RIGHT_SHORT = ['CUTI MELAHIRKAN', 'CUTI SAKIT']

const OFFICIALS = {
  KASUBAG: {
    imageAfter: 1,
    lines: ['Kepala Sub Bagian Tata Usaha', 'HENDRO RAGIL PRIYANTO, S.Kom.', 'NIP. 196912281991031004'],
  },
  KEPSTA: {
    imageAfter: 1,
    lines: ['Kepala TVRI Stasiun Jawa Tengah,', 'SANNY APRIL LINDA D., S.Pd.,M.IKom.', 'NIP. 196904031998032004'],
  },
  PPK: {
    imageAfter: 2,
    lines: [
      'Analis Pengelolaan Keuangan',
      'APBN Ahli Muda',
      'DWI PURNAMASARI, S.E.',
      'NIP. 197108181998032000',
    ],
  },
  PP_UMUM: {
    imageAfter: 1,
    lines: ['Analis SDM Aparatur Ahli Madya', 'FAJAR PRIYO SUSILO, S.E.', 'NIP. 197009231998031007'],
  },
}

const FORMS = {
  PNS_TU: {
    titleSize: 12,
    addressee: ['Kepala TVRI Stasiun Jawa Tengah', 'di Semarang'],
    identityLabel: 'NIP',
    roleLabel: 'Jabatan',
    leaveTypes: LEAVE_TYPES_FULL,
    catatanRight: CATATAN_RIGHT_FULL,
    pertimbangan: {
      kind: 'split',
      title: 'PERTIMBANGAN',
      leftLabel: 'PENGELOLA SDM',
      rightLabel: 'ATASAN LANGSUNG',
      rightSigner: 'KASUBAG',
    },
    decisionLabel: 'ATASAN LANGSUNG',
    decisionSigner: 'KEPSTA',
  },
  PNS: {
    titleSize: 14,
    addressee: ['Kepala TVRI Stasiun Jawa Tengah', 'di Semarang'],
    identityLabel: 'NIP',
    roleLabel: 'Jabatan',
    leaveTypes: LEAVE_TYPES_FULL,
    catatanRight: CATATAN_RIGHT_FULL,
    pertimbangan: {
      kind: 'two',
      title: 'PERTIMBANGAN (DISETUJUI/PERUBAHAN/DITANGGUHKAN/TIDAK DISETUJUI)',
      leftLabel: 'TIM UNIT KERJA',
      rightLabel: 'PENGELOLA SDM',
    },
    decisionLabel: 'ATASAN LANGSUNG',
    decisionSigner: 'KEPSTA',
  },
  PPPK_PPNPN_TU: {
    titleSize: 12,
    addressee: ['Kepala TVRI Stasiun Jawa Tengah', 'di Semarang'],
    identityLabel: 'NIP',
    roleLabel: 'Jabatan',
    leaveTypes: LEAVE_TYPES_SHORT,
    catatanRight: CATATAN_RIGHT_SHORT,
    pertimbangan: {
      kind: 'split',
      title: 'PERTIMBANGAN',
      leftLabel: 'PENGELOLA SDM',
      rightLabel: 'ATASAN LANGSUNG',
      rightSigner: 'KASUBAG',
    },
    decisionLabel: 'ATASAN LANGSUNG',
    decisionSigner: 'KEPSTA',
  },
  PPPK_PPNPN: {
    titleSize: 14,
    addressee: ['Kepala TVRI Stasiun Jawa Tengah', 'di Semarang'],
    identityLabel: 'NIP',
    roleLabel: 'Jabatan',
    leaveTypes: LEAVE_TYPES_SHORT,
    catatanRight: CATATAN_RIGHT_SHORT,
    pertimbangan: {
      kind: 'two',
      title: 'PERTIMBANGAN (DISETUJUI/PERUBAHAN/DITANGGUHKAN/TIDAK DISETUJUI)',
      leftLabel: 'TIM UNIT KERJA',
      rightLabel: 'PENGELOLA SDM',
    },
    decisionLabel: 'ATASAN LANGSUNG',
    decisionSigner: 'KEPSTA',
  },
  KONTRAK: {
    titleSize: 14,
    addressee: ['Pejabat Pembuat Komitmen (PPK)', 'di Semarang'],
    identityLabel: 'NIK',
    roleLabel: 'Profesi',
    unitLabelValue: 'Umum',
    leaveTypes: LEAVE_TYPES_SHORT,
    catatanRight: CATATAN_RIGHT_SHORT,
    pertimbangan: {
      kind: 'two',
      title: 'PERTIMBANGAN (DISETUJUI/PERUBAHAN/DITANGGUHKAN/TIDAK DISETUJUI',
      leftLabel: 'PENGELOLA SDM',
      rightLabel: 'KOORDINATOR/KETUA TIM PP UMUM',
      rightSigner: 'PP_UMUM',
    },
    decisionLabel: 'PEJABAT PEMBUAT KOMITMEN',
    decisionSigner: 'PPK',
  },
}

const MONTHS_ID = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII']

function isoDate(value) {
  if (!value) return ''
  const raw = String(value)
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (match) return `${match[1]}-${match[2]}-${match[3]}`
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return ''
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
}

function longDate(value, fallback = '') {
  const iso = isoDate(value) || fallback
  if (!iso) return ''
  const [year, month, day] = iso.split('-').map(Number)
  return `${day} ${MONTHS_ID[month - 1]} ${year}`
}

function formatNomor(letterNumber, startDate) {
  const raw = String(letterNumber || '').trim()
  if (/KP\.09\.02/.test(raw)) return raw
  const iso = isoDate(startDate)
  const year = iso ? iso.slice(0, 4) : String(new Date().getFullYear())
  const month = iso ? Number(iso.slice(5, 7)) : new Date().getMonth() + 1
  const sequence = (raw.match(/^(\d+)/) || [, ''])[1]
  return `${sequence}/KP.09.02/II.3/${ROMAN[month - 1]}/${year}`
}

function drawCheckbox(doc, x, y, checked) {
  const size = 8
  doc.rect(x, y, size, size).strokeColor(LINE).lineWidth(0.7).stroke()
  if (!checked) return
  doc.save()
  doc.lineWidth(1)
  doc.moveTo(x + 1.6, y + 4).lineTo(x + 3.2, y + 6).lineTo(x + 6.4, y + 2).strokeColor(LINE).stroke()
  doc.restore()
}

function measureText(doc, value, width, { bold = false, size = 9, align = 'left' } = {}) {
  return doc.font(bold ? FONT_BOLD : FONT).fontSize(size)
    .heightOfString(String(value), { width, align })
}

function drawText(doc, value, x, y, { bold = false, size = 9, width, align = 'left', color = LINE } = {}) {
  const options = { align }
  if (width !== undefined) options.width = width
  if (bold && HAS_FONT) {
    doc.save()
    doc.lineWidth(BOLD_STROKE).fillColor(color).strokeColor(color)
      .font(FONT).fontSize(size).text(String(value), x, y, { ...options, fill: true, stroke: true })
    doc.restore()
  } else {
    doc.fillColor(color).font(bold ? FONT_BOLD : FONT).fontSize(size)
      .text(String(value), x, y, options)
  }
}

function drawRow(doc, y, cells, { height = 14, size = 9, x = TABLE_X } = {}) {
  const widths = cells.reduce((sum, cell) => sum + cell.w, 0)
  const scale = Math.abs(widths - CONTENT_W) < 0.5 ? 1 : CONTENT_W / widths
  let rowHeight = height
  let bottomPad = 0
  for (const cell of cells) {
    const w = cell.w * scale
    const padX = cell.padX ?? PAD
    if (cell.text) {
      // Lebar ukur harus sama dengan lebar gambar, termasuk ruang kotak centang.
      const textWidth = w - 2 * padX - (cell.cb !== undefined ? 12 : 0)
      rowHeight = Math.max(rowHeight, measureText(doc, cell.text, textWidth, {
        bold: cell.bold, size: cell.size ?? size, align: cell.align ?? (cell.center ? 'center' : 'left'),
      }) + 2 * PAD)
    }
    if (cell.minH) rowHeight = Math.max(rowHeight, cell.minH)
    const lineSize = cell.lineSize ?? 9
    if (cell.lines) rowHeight = Math.max(rowHeight, cell.lines.length * lineSize + 2 * PAD + 2)
    if (cell.imageAfter !== undefined) {
      // Area tanda tangan disisihkan setelah baris jabatan, walau gambar belum ada.
      rowHeight = Math.max(rowHeight, (cell.lines?.length ?? 0) * lineSize + (cell.imageHeight ?? 34) + 2 * PAD)
    } else if (cell.image && (cell.lines || cell.text)) {
      rowHeight = Math.max(rowHeight, (cell.imageHeight ?? 20) + (cell.lines?.length ?? 1) * lineSize + 2 * PAD)
    }
    if (cell.bottomPad) bottomPad = Math.max(bottomPad, cell.bottomPad)
  }
  rowHeight += bottomPad

  let cursor = x
  for (const cell of cells) {
    const w = cell.w * scale
    const padX = cell.padX ?? PAD
    const imageH = cell.imageAfter === undefined && cell.image && (cell.lines || cell.text) ? (cell.imageHeight ?? 20) : 0
    const textBaseY = y + imageH + PAD
    if (cell.border !== false) {
      doc.rect(cursor, y, w, rowHeight).strokeColor(LINE).lineWidth(0.7).stroke()
    }
    doc.fillColor(LINE)

    if (cell.cb !== undefined) {
      drawCheckbox(doc, cursor + w - 12, y + (rowHeight - 8) / 2, Boolean(cell.cb))
    }
    if (cell.text) {
      const textWidth = w - 2 * padX - (cell.cb !== undefined ? 12 : 0)
      const textHeight = measureText(doc, cell.text, textWidth, {
        bold: cell.bold, size: cell.size ?? size, align: cell.align ?? (cell.center ? 'center' : 'left'),
      })
      const textY = cell.alignBottom
        ? y + rowHeight - PAD - textHeight
        : imageH
          ? textBaseY
          : y + (cell.center ? (rowHeight - textHeight) / 2 : PAD)
      drawText(doc, cell.text, cursor + padX, textY, {
        bold: cell.bold, size: cell.size ?? size, width: textWidth, align: cell.align ?? (cell.center ? 'center' : 'left'),
      })
    }
    if (cell.lines) {
      const lineSize = cell.lineSize ?? 9
      if (cell.imageAfter !== undefined) {
        let lineY = y + PAD
        cell.lines.forEach((line, index) => {
          if (index === cell.imageAfter) lineY += cell.imageHeight ?? 34
          if (line) {
            drawText(doc, line, cursor + padX, lineY, {
              size: lineSize, width: w - 2 * padX, align: cell.align ?? 'center',
            })
          }
          lineY += lineSize
        })
      } else {
        let lineY = textBaseY
        for (const line of cell.lines) {
          if (line) {
            drawText(doc, line, cursor + padX, lineY, {
              size: lineSize, width: w - 2 * padX, align: cell.align ?? 'center',
            })
          }
          lineY += lineSize
        }
      }
    }
    if (cell.image) {
      try {
        const imageY = cell.imageAfter !== undefined
          ? y + PAD + cell.imageAfter * (cell.lineSize ?? 9)
          : y + PAD
        const fitH = cell.imageAfter !== undefined
          ? (cell.imageHeight ?? 34)
          : (imageH || Math.max(12, rowHeight - 6))
        doc.image(cell.image, cursor + padX, imageY, {
          fit: [w - 2 * padX, fitH],
          align: 'center', valign: cell.imageAfter !== undefined ? 'center' : 'top',
        })
      } catch {
        // Tanda tangan tidak boleh menggagalkan dokumen.
      }
    }
    cursor += w
  }
  return y + rowHeight
}

// Judul bagian pada contoh: bold 9 pt, rata kiri dengan indent, tinggi sesuai trHeight.
function drawSectionTitle(doc, y, title, height, indent) {
  return drawRow(doc, y, [
    { w: CONTENT_W, text: title, bold: true, size: 9, align: 'left', padX: indent },
  ], { height })
}

function drawHeader(doc, { form, addressee, letterNumber, dateText, previewMode }) {
  const headerTop = PAGE_MARGIN_TOP
  if (existsSync(LOGO_PATH)) {
    try {
      doc.image(LOGO_PATH, MARGIN, headerTop, { width: LOGO_W, height: LOGO_H })
    } catch {
      // Logo opsional.
    }
  }
  // Blok alamat mulai sejajar dengan bagian atas logo, seperti sampel.
  let y = headerTop

  // Blok alamat rata kiri seperti sampel: tanggal, baris kosong, lalu tujuan surat.
  const block = [`Semarang, ${dateText}`, '', 'Kepada Yth. :', ...addressee]
  const headerWidth = TEXT_W - (HEADER_X - MARGIN)
  for (const line of block) {
    if (line) {
      drawText(doc, line, HEADER_X, y, { size: 9, width: headerWidth, align: 'left' })
    }
    y += HEADER_LINE
  }
  if (previewMode) {
    drawText(doc, 'PRATINJAU', HEADER_X, y, { size: 7, width: headerWidth, align: 'left', color: '#666666' })
    y += 10
  }

  y += 4
  const titleSize = form.titleSize || 12
  drawText(doc, 'FORMULIR PERMINTAAN DAN PEMBERIAN CUTI', MARGIN, y, {
    size: titleSize, width: TEXT_W, align: 'center',
  })
  y += titleSize + 4
  drawText(doc, `Nomor : ${letterNumber}`, MARGIN, y, {
    size: titleSize, width: TEXT_W, align: 'center',
  })
  return y + titleSize + 10
}

function dataPegawai(doc, y, { form, request }) {
  const cols = [87, 257, 70, 139.5]
  const role = form.roleLabel === 'Profesi'
    ? (request.employee_profession || request.employee_position_name)
    : request.employee_position_name
  const unit = form.unitLabelValue || request.employee_unit_name

  y = drawSectionTitle(doc, y, 'I. DATA  PEGAWAI', 14.75, PAD)
  y = drawRow(doc, y, [
    { w: cols[0], text: 'Nama', size: 9 },
    { w: cols[1], text: request.employee_name || '', size: 9 },
    { w: cols[2], text: form.identityLabel, size: 9 },
    { w: cols[3], text: request.employee_identity_number || '', size: 9 },
  ], { height: 13.85 })
  y = drawRow(doc, y, [
    { w: cols[0], text: form.roleLabel, size: 9 },
    { w: cols[1], text: role || '', size: 9 },
    { w: cols[2], text: '', size: 9 },
    { w: cols[3], text: '', size: 9 },
  ], { height: 14.75 })
  y = drawRow(doc, y, [
    { w: cols[0], text: 'Unit Kerja', size: 9 },
    { w: CONTENT_W - cols[0], text: unit || '', size: 9 },
  ], { height: 13.85 })
  return y
}

function jenisCuti(doc, y, { form, leaveTypeCode }) {
  y = drawSectionTitle(doc, y, 'II. JENIS CUTI YANG DIAMBIL', 16.55, PAD)
  const cols = [214, 52, 235, 52.5]
  const types = form.leaveTypes
  for (let index = 0; index < types.length; index += 2) {
    const left = types[index]
    const right = types[index + 1]
    y = drawRow(doc, y, [
      { w: cols[0], text: left ? `${index + 1}. ${left.label}` : '', size: 9 },
      { w: cols[1], cb: left ? left.code === leaveTypeCode : false },
      { w: cols[2], text: right ? `${index + 2}. ${right.label}` : '', size: 9 },
      { w: cols[3], cb: right ? right.code === leaveTypeCode : false },
    ], { height: index % 4 === 0 ? 15.55 : 16.55 })
  }
  return y
}

function alasanCuti(doc, y, reason) {
  y = drawSectionTitle(doc, y, 'III. ALASAN CUTI', 15.4, PAD)
  return drawRow(doc, y, [{ w: CONTENT_W, text: reason || '', size: 9 }], { height: 17.2 })
}

function lamanyaCuti(doc, y, request) {
  const start = longDate(request.start_date_text || request.start_date)
  const end = longDate(request.end_date_text || request.end_date)
  y = drawSectionTitle(doc, y, 'IV. LAMANYA CUTI', 16.95, PAD)
  return drawRow(doc, y, [
    { w: 48, text: 'Selama', size: 9 },
    { w: 149, text: `${request.approved_working_days ?? request.requested_working_days ?? 0} hari`, size: 9 },
    { w: 83, text: 'Mulai Tanggal', size: 9, align: 'center' },
    { w: 122, text: start, size: 9 },
    { w: 35, text: 's.d.', size: 9, align: 'center' },
    { w: 116.5, text: end, size: 9 },
  ], { height: 12.95 })
}

function catatanCuti(doc, y, { form, balances, year }) {
  y = drawSectionTitle(doc, y, 'V. CATATAN  CUTI', 13.7, PAD)
  const widths = [61, 60, 71, 254, 107.5]
  const right = form.catatanRight
  y = drawRow(doc, y, [
    { w: widths[0] + widths[1] + widths[2], text: 'CUTI TAHUNAN', size: 9, align: 'left' },
    { w: widths[3], text: right[0] || '', size: 9, align: 'left' },
    { w: widths[4], text: '', size: 9 },
  ], { height: 12.9 })

  const byYear = new Map((balances || []).map(row => [Number(row.period_year), row]))
  const years = [year - 2, year - 1, year]
  const heights = [13.7, 12.9, 13.7]
  for (let index = 0; index < years.length; index += 1) {
    const value = years[index]
    const balance = byYear.get(value)
    const sisa = balance ? String(balance.available_days ?? '') : ''
    const keterangan = balance ? `Dipakai ${balance.used_days ?? 0} hari` : ''
    y = drawRow(doc, y, [
      { w: widths[0], text: String(value), size: 9 },
      { w: widths[1], text: sisa, size: 9, align: 'center' },
      { w: widths[2], text: keterangan, size: 9 },
      { w: widths[3], text: right[index + 1] || '', size: 9, align: 'left' },
      { w: widths[4], text: '', size: 9 },
    ], { height: heights[index] })
  }
  return y
}

function alamatCuti(doc, y, { request, employeeSignature }) {
  const cols = [196, 100, 257.5]
  y = drawSectionTitle(doc, y, 'VI. ALAMAT SELAMA MENJALANKAN CUTI', 9.65, PAD)
  const headTop = y
  y = drawRow(doc, y, [
    { w: cols[0], text: 'Alamat Lengkap', size: 9, align: 'center' },
    { w: cols[1], text: 'Telepon', size: 9, align: 'center' },
    { w: cols[2], text: 'Hormat Saya,', size: 9, align: 'center', border: false },
  ], { height: 9.1 })
  const nameY = y
  y = drawRow(doc, y, [
    { w: cols[0], text: request.address_during_leave || '', size: 9 },
    { w: cols[1], text: request.phone || '', size: 9 },
    {
      w: cols[2],
      image: employeeSignature,
      imageHeight: 34,
      text: request.employee_name || '',
      size: 9,
      align: 'center',
      minH: 44,
      bottomPad: 4,
      border: false,
    },
  ], { height: 44 })
  // Satu kolom utuh: "Hormat Saya", tanda tangan, dan nama tanpa garis pemisah.
  doc.rect(TABLE_X + cols[0] + cols[1], headTop, cols[2], y - headTop)
    .strokeColor(LINE).lineWidth(0.7).stroke()
  return { y, nameY }
}

function decisionCheck(decision) {
  if (decision === 'APPROVED') return 'DISETUJUI'
  if (decision === 'REJECTED') return 'TIDAK DISETUJUI'
  return ''
}

function pertimbangan(doc, y, { form, approvals, signatureImages, notes, decision }) {
  const config = form.pertimbangan
  y = drawSectionTitle(doc, y, `VII. ${config.title}`, 12.45, PAD)

  const kasubag = approvals.find(row => row.actor_role_code === 'KASUBAG')
  // Tahap pertimbangan hanya menyimpan catatan; centang mengikuti keputusan akhir sistem.
  const finalDecision = [...approvals].reverse().find(row => row.action === 'DECIDE' && row.decision)
  const mark = decisionCheck(finalDecision?.decision || decision)
  const options = ['DISETUJUI', 'PERUBAHAN', 'DITANGGUHKAN', 'TIDAK DISETUJUI']
  // Sampel mencantumkan label "CATATAN :" pada kedua sel, dengan satu baris kosong di bawahnya.
  const noteText = kasubag?.notes ? `CATATAN :\n${kasubag.notes}` : 'CATATAN :'

  if (config.kind === 'split') {
    const cols = [223.5, 64, 78, 96, 92]
    y = drawRow(doc, y, [
      { w: cols[0], text: config.leftLabel, size: 9, align: 'center' },
      ...options.map((label, index) => ({
        w: cols[index + 1], text: label, size: 9, align: 'left', cb: label === mark,
      })),
    ], { height: 12.45 })
    y = drawRow(doc, y, [
      { w: cols[0], text: '', size: 9 },
      { w: CONTENT_W - cols[0], text: config.rightLabel, size: 9, align: 'center' },
    ], { height: 12.45 })
    y = drawRow(doc, y, [
      { w: cols[0], text: 'CATATAN :', size: 9 },
      { w: CONTENT_W - cols[0], text: noteText, size: 9 },
    ], { height: 24 })
    const signer = OFFICIALS[config.rightSigner]
    y = drawRow(doc, y, [
      { w: cols[0], text: 'NAMA & TTD :', size: 9 },
      {
        w: CONTENT_W - cols[0],
        lines: signer?.lines,
        size: 9,
        lineSize: 9,
        align: 'center',
        image: signatureImages.get(config.rightSigner),
        imageHeight: 40,
        imageAfter: signer?.imageAfter ?? 1,
        minH: 54,
        bottomPad: 6,
      },
    ], { height: 54 })
    return y
  }

  const leftW = 210
  const rightW = CONTENT_W - leftW
  y = drawRow(doc, y, [
    { w: leftW, text: config.leftLabel, size: 9, align: 'center' },
    { w: rightW, text: config.rightLabel, size: 9, align: 'center' },
  ], { height: 12.45 })
  const optionW = CONTENT_W / options.length
  y = drawRow(doc, y, options.map((label) => ({
    w: optionW, text: label, size: 9, align: 'center', cb: label === mark,
  })), { height: 12.45 })
  y = drawRow(doc, y, [
    { w: leftW, text: 'CATATAN :', size: 9 },
    { w: rightW, text: noteText, size: 9 },
  ], { height: 24 })
  const signer = config.rightSigner ? OFFICIALS[config.rightSigner] : null
  y = drawRow(doc, y, [
    { w: leftW, text: 'NAMA & TTD :', size: 9 },
    {
      w: rightW,
      lines: signer?.lines,
      text: signer ? undefined : 'NAMA & TTD :',
      size: 9,
      lineSize: 9,
      align: 'center',
      image: config.rightSigner ? signatureImages.get(config.rightSigner) : null,
      imageHeight: 40,
      imageAfter: signer?.imageAfter ?? 1,
      minH: 54,
      bottomPad: 6,
    },
  ], { height: 54 })
  return y
}

function keputusan(doc, y, { form, request, approvals, signatureImages }) {
  const options = ['DISETUJUI', 'PERUBAHAN', 'DITANGGUHKAN', 'TIDAK DISETUJUI']
  const cols = [68, 79, 96, 66.5, 244]
  y = drawSectionTitle(doc, y, 'VIII. KEPUTUSAN PEJABAT YANG BERWENANG MEMBERIKAN CUTI', 13.75, PAD)

  const finalDecision = [...approvals].reverse().find(row => row.action === 'DECIDE' && row.decision)
  const chosen = finalDecision?.decision || request.decision
  const mark = decisionCheck(chosen)

  y = drawRow(doc, y, [
    ...options.map((label, index) => ({
      w: cols[index], text: label, size: 9, align: 'center', center: true, cb: label === mark,
    })),
    { w: cols[4], text: form.decisionLabel, size: 9, align: 'center', center: true },
  ], { height: 30 })

  const signer = OFFICIALS[form.decisionSigner]
  y = drawRow(doc, y, [
    { w: cols[0] + cols[1] + cols[2] + cols[3], text: 'CATATAN :', size: 9 },
    {
      w: cols[4],
      lines: signer?.lines || [],
      size: 9,
      lineSize: 9,
      align: 'center',
      image: signatureImages.get(form.decisionSigner),
      imageHeight: 40,
      imageAfter: signer?.imageAfter ?? 1,
      minH: 54,
      bottomPad: 6,
    },
  ], { height: 54 })
  return y
}

function footer(doc, y) {
  try {
    drawText(doc,
      'Pengajuan/penggunaan cuti tahunan, cuti besar, cuti karena alasan penting, atau cuti bersama dapat '
      + 'ditangguhkan/ditunda apabila terdapat kepentingan dinas yang mendesak sesuai ketentuan PP Nomor 11 Tahun 2017, '
      + 'PP Nomor 17 Tahun 2020 dan Peraturan BKN Nomor 7 Tahun 2022.',
      TABLE_X, y, { size: 9, width: CONTENT_W, align: 'justify' },
    )
  } catch {
    // Catatan kaki opsional.
  }
}

export async function generateLeavePdf({
  request,
  approvals = [],
  signatures = [],
  balances = [],
  letterNumber = '',
  previewMode = false,
  signatureImageLoader = null,
  employeeSignature = null,
}) {
  const form = FORMS[request.employee_category] || FORMS.PNS_TU
  const year = Number(String(isoDate(request.start_date_text || request.start_date)).slice(0, 4))
    || Number(request.balance_period_year)
    || new Date().getFullYear()

  const signatureImages = new Map()
  const roles = new Set([form.pertimbangan.rightSigner, form.decisionSigner].filter(Boolean))
  if (signatureImageLoader) {
    for (const role of roles) {
      const signature = signatures.find(row => row.signer_role_code === role && row.storage_key)
      if (!signature) continue
      const image = await signatureImageLoader(signature).catch(() => null)
      if (image) signatureImages.set(role, image)
    }
  }
  let employeeSignatureImage = null
  if (employeeSignature && signatureImageLoader) {
    employeeSignatureImage = await signatureImageLoader(employeeSignature).catch(() => null)
  }

  const doc = new PDFDocument({
    size: [PAGE_W, 841.89],
    margin: { top: PAGE_MARGIN_TOP, bottom: PAGE_MARGIN_Y, left: MARGIN, right: MARGIN },
    info: { Title: 'Formulir Permintaan dan Pemberian Cuti', Author: 'Sistem Pengajuan Cuti' },
  })
  if (HAS_FONT) {
    doc.registerFont('GothamLight', FONT_PATH)
  }
  const chunks = []
  doc.on('data', (chunk) => chunks.push(chunk))
  const done = new Promise((resolvePromise, reject) => {
    doc.on('end', () => resolvePromise(Buffer.concat(chunks)))
    doc.on('error', reject)
  })

  const dateText = longDate(request.decided_at || request.submitted_at || request.created_at)
  let y = drawHeader(doc, {
    form,
    addressee: form.addressee,
    letterNumber: formatNomor(letterNumber, request.start_date_text || request.start_date),
    dateText: dateText || `${new Date().getDate()} ${MONTHS_ID[new Date().getMonth()]} ${new Date().getFullYear()}`,
    previewMode,
  })

  y = dataPegawai(doc, y, { form, request })
  y += SECTION_GAP
  y = jenisCuti(doc, y, { form, leaveTypeCode: request.leave_type_code })
  y += SECTION_GAP
  y = alasanCuti(doc, y, request.reason)
  y += SECTION_GAP
  y = lamanyaCuti(doc, y, request)
  y += SECTION_GAP
  y = catatanCuti(doc, y, { form, balances, year })
  y += SECTION_GAP
  const alamat = alamatCuti(doc, y, { request, employeeSignature: employeeSignatureImage })
  y = alamat.y
  y += SECTION_GAP
  y = pertimbangan(doc, y, {
    form, approvals, signatureImages, notes: request.reason, decision: request.decision,
  })
  y += SECTION_GAP
  y = keputusan(doc, y, { form, request, approvals, signatureImages })
  // Beri jarak dari garis tabel bawah.
  const bandY = y + 12
  footer(doc, bandY)

  doc.end()
  return done
}
