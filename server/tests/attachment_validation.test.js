import test from 'node:test'
import assert from 'node:assert/strict'
import { validateUpload, sanitizeFilename, UploadValidationError } from '../file-validation.js'

// PNG 1x1 valid (base64)
const VALID_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
)

test('sanitizeFilename membuang path & karakter berbahaya', () => {
  assert.equal(sanitizeFilename('../../ktp.png'), 'ktp.png')
  assert.equal(sanitizeFilename('a/b/c.png'), 'c.png')
  assert.equal(sanitizeFilename('my\x00file.png'), 'myfile.png')
})

test('nama file dengan banyak titik diterima bila ekstensi akhir sesuai MIME', async () => {
  const result = await validateUpload(VALID_PNG, 'ATTACHMENT', 'ktp.2024.png')
  assert.equal(result.mime, 'image/png')
  assert.equal(result.filename, 'ktp.2024.png')
  assert.match(result.storageKey, /^attachments\//)
})

test('double-extension ditolak bila ekstensi akhir tidak sesuai isi', async () => {
  await assert.rejects(
    validateUpload(VALID_PNG, 'ATTACHMENT', 'ttd.png.exe'),
    (error) => error instanceof UploadValidationError && /Ekstensi file/.test(error.message),
  )
})

test('file kosong ditolak', async () => {
  await assert.rejects(
    validateUpload(Buffer.alloc(0), 'ATTACHMENT', 'kosong.png'),
    (error) => error instanceof UploadValidationError,
  )
})
