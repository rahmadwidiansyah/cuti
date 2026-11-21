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

test('nama tanpa ekstensi ditolak secara default (lampiran)', async () => {
  await assert.rejects(
    validateUpload(VALID_PNG, 'ATTACHMENT', 'tanda-tangan'),
    (error) => error instanceof UploadValidationError && /ekstensi/.test(error.message),
  )
})

test('unggah tanda tangan raw tanpa nama ber-ekstensi diterima dengan ekstensi dari MIME (audit T2)', async () => {
  const result = await validateUpload(VALID_PNG, 'SIGNATURE', 'tanda-tangan', { allowMissingExtension: true })
  assert.equal(result.mime, 'image/png')
  assert.equal(result.filename, 'tanda-tangan.png', 'Ekstensi disintesis dari MIME terdeteksi')
  assert.match(result.storageKey, /^signatures\/[0-9a-f-]+\.png$/)
})

test('nama tanpa ekstensi dengan isi JPEG memakai ekstensi .jpg (audit T2)', async () => {
  // JPEG 1x1 valid (base64)
  const VALID_JPEG = Buffer.from(
    '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPDIzNP/AABEIAAEAAQMBIgACEQEDEQH/xAAfAAABBQEBAQEBAQAAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/aAAwDAQACEQMRAD8A9/oooooA//9k=',
    'base64',
  )
  const result = await validateUpload(VALID_JPEG, 'SIGNATURE', 'tanda-tangan', { allowMissingExtension: true })
  assert.equal(result.mime, 'image/jpeg')
  assert.equal(result.filename, 'tanda-tangan.jpg')
})

test('ekstensi salah tetap ditolak meski allowMissingExtension aktif', async () => {
  await assert.rejects(
    validateUpload(VALID_PNG, 'SIGNATURE', 'tanda-tangan.exe', { allowMissingExtension: true }),
    (error) => error instanceof UploadValidationError && /Ekstensi file/.test(error.message),
  )
})
