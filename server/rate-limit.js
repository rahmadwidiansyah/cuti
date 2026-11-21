/**
 * Rate limiter fixed-window in-memory untuk endpoint sensitif (login).
 * Audit T1: tanpa throttling, credential stuffing lintas-username bebas dan
 * lockout per-user bisa dijadikan senjata DoS.
 *
 * Sengaja tanpa dependensi eksternal: deploy saat ini satu kontainer (satu
 * proses Node), jadi penyimpanan in-memory memadai. Bila kelak berjalan
 * multi-instance, ganti store-nya dengan penyimpanan bersama (Redis dsb.) —
 * antarmuka fungsi `take(key, now)` sengaja dibuat murni agar mudah diuji.
 */

/**
 * Membuat limiter jendela-waktu tetap.
 *
 * @param {object} options
 * @param {number} options.limit - Maksimum permintaan per jendela per kunci.
 * @param {number} options.windowMs - Panjang jendela dalam milidetik.
 * @param {number} [options.maxKeys=20000] - Batas jumlah kunci terhadap memori;
 *   kunci kedaluwarsa dibuang saat batas terlampaui.
 * @returns {{ take(key: string, now?: number): { allowed: boolean, retryAfterSeconds: number } }}
 */
export function createFixedWindowLimiter({ limit, windowMs, maxKeys = 20000 }) {
  if (!Number.isInteger(limit) || limit < 1) throw new Error('limit harus bilangan bulat >= 1')
  if (!Number.isInteger(windowMs) || windowMs < 1000) throw new Error('windowMs harus >= 1000 ms')
  const buckets = new Map()

  function prune(now) {
    for (const [key, bucket] of buckets) {
      if (now - bucket.windowStart >= windowMs) buckets.delete(key)
    }
  }

  return {
    /** Catat satu permintaan untuk kunci; kembalikan izin + sisa tunggu. */
    take(key, now = Date.now()) {
      if (buckets.size >= maxKeys) prune(now)
      let bucket = buckets.get(key)
      if (!bucket || now - bucket.windowStart >= windowMs) {
        bucket = { count: 0, windowStart: now }
        buckets.set(key, bucket)
      }
      bucket.count += 1
      if (bucket.count <= limit) {
        return { allowed: true, retryAfterSeconds: 0 }
      }
      const remainingMs = bucket.windowStart + windowMs - now
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil(remainingMs / 1000)),
      }
    },
  }
}

/**
 * Pembatas paralelisme: jumlah permintaan yang SEDANG berjalan untuk satu
 * proses. Audit T8 — setiap unggahan multipart dapat menahan sampai ~50 MB
 * buffer di memori (multer memoryStorage); tanpa batas paralel, N permintaan
 * besar serentak bisa menggembungkan heap hingga OOM.
 *
 * @param {object} options
 * @param {number} options.max - Maksimum permintaan aktif bersamaan.
 * @returns {{ enter(res: { on(event: string, cb: () => void): unknown }): boolean }}
 *   `enter` mengembalikan `true` dan memasang pelepasan otomatis pada event
 *   `finish`/`close` respons, atau `false` bila kuota paralel penuh.
 */
export function createConcurrencyLimiter({ max }) {
  if (!Number.isInteger(max) || max < 1) throw new Error('max harus bilangan bulat >= 1')
  let active = 0
  return {
    enter(res) {
      if (active >= max) return false
      active += 1
      let released = false
      const release = () => {
        if (released) return
        released = true
        active -= 1
      }
      res.on('finish', release)
      res.on('close', release)
      return true
    },
  }
}
