import test from 'node:test'
import assert from 'node:assert/strict'
import { generateReportPdf } from '../report-pdf.js'

const baseData = {
  summary: {
    totalPengajuan: 4,
    totalDisetujui: 4,
    totalDitolak: 0,
    totalPembatalan: 0,
    totalHariDiberikan: 9,
    rataRataDurasi: 2.25,
  },
  recapPerUnit: [{
    unitName: 'Tata Usaha',
    typeCounts: { ANNUAL: 2, SICK: 1 },
    approvedCount: 2,
    totalCount: 3,
  }],
  composition: [
    { leaveTypeName: 'Cuti Tahunan', deductsAnnual: true, count: 3, pct: 75 },
    { leaveTypeName: 'Cuti Sakit', deductsAnnual: false, count: 1, pct: 25 },
  ],
  cancellations: [{
    requestNumber: 'CUTI-2026-0009',
    employeeName: 'Siti Aminah',
    employeeCategory: 'PNS',
    employeeUnitName: 'Bidang Non-TU',
    leaveTypeName: 'Cuti Tahunan',
    startDate: '2026-11-23',
    endDate: '2026-11-25',
    approvedDays: 3,
    usedDays: 1,
    restoredDays: 2,
    cancellationReason: 'Keperluan dinas mendadak.',
    cancelledAt: '2026-11-24T08:00:00Z',
    processedByName: 'Admin Cuti',
  }],
  leaveTypes: [
    { code: 'ANNUAL', name: 'Cuti Tahunan' },
    { code: 'SICK', name: 'Cuti Sakit' },
  ],
  filtersText: 'Periode: semua s.d. semua',
}

test('generateReportPdf menghasilkan buffer PDF yang valid', async () => {
  const pdf = await generateReportPdf(baseData)
  assert.ok(Buffer.isBuffer(pdf))
  assert.ok(pdf.length > 1000)
  assert.equal(pdf.slice(0, 5).toString(), '%PDF-')
})

test('generateReportPdf tetap berhasil tanpa data pembatalan', async () => {
  const pdf = await generateReportPdf({ ...baseData, cancellations: [], recapPerUnit: [], composition: [] })
  assert.ok(Buffer.isBuffer(pdf))
  assert.equal(pdf.slice(0, 5).toString(), '%PDF-')
})
