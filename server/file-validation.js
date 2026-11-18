/**
 * Validasi upload file terpusat untuk semua kategori (avatar, signature, attachment).
 * Tujuan: menolak file berbahaya sebelum pernah ditulis ke storage.
 *
 * Prinsip:
 * - Tipe ditentukan dari MAGIC BYTES (file-type), bukan Content-Type dari klien.
 * - Ukuran, dimensi, dan total piksel dibatasi (cegah decompression bomb).
 * - Nama file disanitasi; path selalu dihasilkan server (UUID), bukan dari klien.
 * - Polyglot / double-extension ditolak.
 */
import crypto from 'node:crypto'
import { fileTypeFromBuffer } from 'file-type'

export const LIMITS = {
  AVATAR: { maxBytes: 2 * 1024 * 1024, maxEdge: 4096, maxPixels: 16_000_000, mime: ['image/png', 'image/jpeg'] },
  SIGNATURE: { maxBytes: 2 * 1024 * 1024, maxEdge: 4096, maxPixels: 16_000_000, mime: ['image/png', 'image/jpeg'] },
  ATTACHMENT: { maxBytes: 10 * 1024 * 1024, maxEdge: 8192, maxPixels: 40_000_000, mime: ['application/pdf', 'image/png', 'image/jpeg'] },
}

const EXT_BY_MIME = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'application/pdf': 'pdf',
}

class UploadValidationError extends Error {
  constructor(message) {
    super(message)
    this.name = 'UploadValidationError'
    this.status = 400
  }
}

/** Baca dimensi PNG dari header (IHDR). */
function pngDimensions(buf) {
  // PNG signature 8 byte, lalu panjang(4)+"IHDR"(4)+width(4)+height(4)
  if (buf.length < 24 || buf.toString('ascii', 12, 16) !== 'IHDR') return null
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

/** Baca dimensi JPEG dari marker SOF (C0-C3, C5-C7, C9-CB, CD-CF). */
function jpegDimensions(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null
  let offset = 2
  while (offset + 9 < buf.length) {
    if (buf[offset] !== 0xff) { offset += 1; continue }
    const marker = buf[offset + 1]
    // Marker tanpa panjang
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      offset += 2
      continue
    }
    const segLen = buf.readUInt16BE(offset + 2)
    if (segLen < 2) return null
    const isSof = (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    if (isSof) {
      return { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) }
    }
    offset += 2 + segLen
  }
  return null
}

/** Deteksi awalan dan akhiran file; tolak polyglot (data asing setelah EOF). */
function checkPolyglot(buf, mime) {
  const tail = buf.subarray(-1024).toString('latin1').toUpperCase()
  if (mime === 'application/pdf') {
    const eof = buf.lastIndexOf(Buffer.from('%%EOF'))
    if (eof === -1 || buf.length - eof > 1024) {
      throw new UploadValidationError('File PDF tidak lengkap atau mengandung data tambahan.')
    }
  }
  // Tanda HTML/ skrip di dalam file gambar = indikasi polyglot
  if (mime.startsWith('image/')) {
    if (tail.includes('<SCRIPT') || tail.includes('<!DOCTYPE') || tail.includes('<?PHP')) {
      throw new UploadValidationError('File gambar mengandung konten yang tidak diizinkan.')
    }
  }
}

/** Sanitasi nama file asli: buang path, karakter kontrol, dan karakter berbahaya. */
export function sanitizeFilename(original) {
  let name = String(original || 'file')
  name = name.split(/[\\/]/).pop() // buang path
  name = name.replace(/[\u0000-\u001f\u007f]/g, '') // karakter kontrol
  name = name.replace(/[<>:"/\\|?*\x27]/g, '_') // karakter khusus
  name = name.replace(/\s+/g, ' ')
  name = name.replace(/\.{2,}/g, '.') // titik ganda
  name = name.trim().replace(/^\.+/, '') // titik di awal
  if (!name || name === '.' || name === '..') name = 'file'
  return name.slice(0, 180)
}

/**
 * Validasi satu buffer upload. Melempar UploadValidationError bila tidak valid.
 * @returns {Promise<{mime, extension, size, sha256, width, height, filename, storageKey}>}
 */
export async function validateUpload(buffer, category, originalFilename = '') {
  const cfg = LIMITS[category]
  if (!cfg) throw new Error(`Kategori upload tidak dikenali: ${category}`)
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new UploadValidationError('File kosong atau tidak terbaca.')
  }
  if (buffer.length > cfg.maxBytes) {
    throw new UploadValidationError(`Ukuran file melebihi batas ${Math.round(cfg.maxBytes / 1024 / 1024)} MB.`)
  }

  const detected = await fileTypeFromBuffer(buffer)
  if (!detected || !cfg.mime.includes(detected.mime)) {
    throw new UploadValidationError('Jenis file tidak diizinkan. Gunakan format yang ditentukan.')
  }
  const mime = detected.mime
  const extension = EXT_BY_MIME[mime]
  if (!extension) throw new UploadValidationError('Ekstensi file tidak dikenali.')

  // Tolak double-extension: ekstensi terakhir HARUS sesuai MIME yang terdeteksi.
  // Nama sah dengan banyak titik (mis. "ktp.2024.pdf") tetap diterima.
  const sanitized = sanitizeFilename(originalFilename)
  const lastDot = sanitized.lastIndexOf('.')
  if (lastDot === -1) {
    throw new UploadValidationError('Nama file harus memiliki ekstensi.')
  }
  const lastExtension = sanitized.slice(lastDot + 1).toLowerCase()
  if (lastExtension !== extension) {
    throw new UploadValidationError(
      `Ekstensi file (.${lastExtension}) tidak sesuai dengan isi file. Gunakan .${extension}.`,
    )
  }

  checkPolyglot(buffer, mime)

  let width = null
  let height = null
  if (mime === 'image/png') {
    const d = pngDimensions(buffer)
    if (d) ({ width, height } = d)
  } else if (mime === 'image/jpeg') {
    const d = jpegDimensions(buffer)
    if (d) ({ width, height } = d)
  }
  if (width !== null && height !== null) {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      throw new UploadValidationError('Dimensi gambar tidak valid.')
    }
    if (width > cfg.maxEdge || height > cfg.maxEdge) {
      throw new UploadValidationError(`Dimensi gambar maksimal ${cfg.maxEdge}×${cfg.maxEdge} piksel.`)
    }
    if (width * height > cfg.maxPixels) {
      throw new UploadValidationError('Total piksel gambar terlalu besar.')
    }
  }

  return {
    mime,
    extension,
    size: buffer.length,
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
    width,
    height,
    filename: sanitized,
    storageKey: `${category.toLowerCase()}s/${crypto.randomUUID()}.${extension}`,
  }
}

export { UploadValidationError }
