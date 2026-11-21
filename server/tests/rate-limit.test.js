import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createFixedWindowLimiter, createConcurrencyLimiter } from '../rate-limit.js'

test('mengizinkan permintaan sampai batas, lalu menolak dengan retryAfter', () => {
  const limiter = createFixedWindowLimiter({ limit: 3, windowMs: 60_000 })
  const t0 = 1_000_000

  assert.deepEqual(limiter.take('ip:1', t0), { allowed: true, retryAfterSeconds: 0 })
  assert.deepEqual(limiter.take('ip:1', t0 + 1), { allowed: true, retryAfterSeconds: 0 })
  assert.deepEqual(limiter.take('ip:1', t0 + 2), { allowed: true, retryAfterSeconds: 0 })

  const blocked = limiter.take('ip:1', t0 + 3)
  assert.equal(blocked.allowed, false)
  assert.ok(blocked.retryAfterSeconds >= 55 && blocked.retryAfterSeconds <= 60)
})

test('jendela baru mengizinkan lagi setelah windowMs berlalu', () => {
  const limiter = createFixedWindowLimiter({ limit: 2, windowMs: 60_000 })
  const t0 = 1_000_000
  limiter.take('ip:2', t0)
  limiter.take('ip:2', t0)
  assert.equal(limiter.take('ip:2', t0 + 1).allowed, false)

  const afterWindow = limiter.take('ip:2', t0 + 61_000)
  assert.equal(afterWindow.allowed, true)
})

test('kunci berbeda memiliki hitungan terpisah', () => {
  const limiter = createFixedWindowLimiter({ limit: 1, windowMs: 60_000 })
  const t0 = 1_000_000
  assert.equal(limiter.take('ip:3', t0).allowed, true)
  assert.equal(limiter.take('ip:3', t0).allowed, false)
  assert.equal(limiter.take('ip:4', t0).allowed, true, 'Kunci lain tidak terpengaruh')
})

test('parameter invalid ditolak saat pembuatan', () => {
  assert.throws(() => createFixedWindowLimiter({ limit: 0, windowMs: 1000 }))
  assert.throws(() => createFixedWindowLimiter({ limit: 2, windowMs: 100 }))
})

test('prune membuang kunci kedaluwarsa saat menyentuh maxKeys', () => {
  const limiter = createFixedWindowLimiter({ limit: 1, windowMs: 1000, maxKeys: 3 })
  const t0 = 1_000_000
  limiter.take('a', t0)
  limiter.take('b', t0)
  limiter.take('c', t0)
  // Menyentuh maxKeys dengan kunci kedaluwarsa: prune berjalan, kunci baru diterima.
  const result = limiter.take('d', t0 + 2000)
  assert.equal(result.allowed, true)
})

function createFakeResponse() {
  const res = new EventEmitter()
  res.status = () => res
  res.json = () => res
  res.setHeader = () => res
  return res
}

test('concurrency limiter mengizinkan sampai max, menolak sisanya, lalu melepas', () => {
  const limiter = createConcurrencyLimiter({ max: 2 })
  const responses = [createFakeResponse(), createFakeResponse(), createFakeResponse()]

  assert.equal(limiter.enter(responses[0]), true)
  assert.equal(limiter.enter(responses[1]), true)
  assert.equal(limiter.enter(responses[2]), false, 'Kuota paralel penuh')

  responses[0].emit('finish')
  assert.equal(limiter.enter(responses[2]), true, 'Slot bebas setelah respons selesai')
})

test('close event juga melepaskan slot (koneksi putus di tengah)', () => {
  const limiter = createConcurrencyLimiter({ max: 1 })
  const res = createFakeResponse()
  assert.equal(limiter.enter(res), true)
  assert.equal(limiter.enter(createFakeResponse()), false)
  res.emit('close')
  assert.equal(limiter.enter(createFakeResponse()), true)
})

test('double release tidak mengurangi penghitung dua kali', () => {
  const limiter = createConcurrencyLimiter({ max: 1 })
  const res = createFakeResponse()
  assert.equal(limiter.enter(res), true)
  res.emit('finish')
  res.emit('finish')
  res.emit('close')
  // Slot hanya boleh bebas sekali; masuk lagi boleh, tapi tidak negatif.
  assert.equal(limiter.enter(createFakeResponse()), true)
  assert.equal(limiter.enter(createFakeResponse()), false)
})

test('parameter invalid ditolak saat pembuatan', () => {
  assert.throws(() => createConcurrencyLimiter({ max: 0 }))
  assert.throws(() => createConcurrencyLimiter({ max: 1.5 }))
})
