import test from 'node:test'
import assert from 'node:assert/strict'
import { generateLeavePdf, DOCUMENT_TEMPLATE_VERSION } from '../document-pdf.js'

const request = {
  id: '99',
  request_number: 'CUTI-2026-TEST',
  employee_category: 'PNS_TU',
  employee_identity_number: '198501012010011001',
  employee_name: 'Budi Santoso',
  employee_position_name: 'Staf',
  employee_unit_name: 'Tata Usaha',
  reason: 'Keperluan keluarga yang perlu diurus pada tanggal tersebut.',
  address_during_leave: 'Jl. Mawar No. 12, Jakarta',
  phone: '081234567890',
  leave_type_code: 'ANNUAL',
  start_date: '2026-12-01',
  end_date: '2026-12-03',
  approved_working_days: 3,
  submitted_at: '2026-11-18T00:00:00Z',
  decided_at: '2026-11-18T12:00:00Z',
}

test('generateLeavePdf menghasilkan PDF satu halaman dengan font Gotham', async () => {
  const pdf = await generateLeavePdf({
    request,
    balances: [{ period_year: 2026, available_days: 12, used_days: 3 }],
    approvals: [{ action: 'DECIDE', decision: 'APPROVED' }],
    letterNumber: '0001/KP.09.02/II.3/XII/2026',
    verificationUrl: 'https://cuti.internal/verifikasi/abc123',
    documentHash: 'a'.repeat(64),
  })
  assert.ok(Buffer.isBuffer(pdf))
  assert.equal(pdf.slice(0, 5).toString(), '%PDF-')
  const source = pdf.toString('latin1')
  assert.equal((source.match(/\/Type\s*\/Page\b/g) || []).length, 1, 'PDF harus satu halaman')
  assert.match(source, /Gotham-Light/, 'Font Gotham Light harus tertanam')
})

test('DOCUMENT_TEMPLATE_VERSION diekspor untuk deteksi dokumen basi', () => {
  assert.equal(typeof DOCUMENT_TEMPLATE_VERSION, 'string')
  assert.ok(DOCUMENT_TEMPLATE_VERSION.length > 0)
})
