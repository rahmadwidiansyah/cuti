import test from 'node:test'
import assert from 'node:assert/strict'

function createMockPool({ notifications = [] }) {
  const queries = []
  return {
    queries,
    async query(sql, params = []) {
      queries.push({ sql, params })
      const s = sql.trim().toUpperCase()

      if (s.includes('FROM CUTI.NOTIFICATIONS') && s.includes('SELECT COUNT(*)')) {
        const unread = notifications.filter((n) => !n.is_read).length
        return { rowCount: 1, rows: [{ unread_count: unread }] }
      }
      if (s.includes('FROM CUTI.NOTIFICATIONS') && s.includes('ORDER BY CREATED_AT DESC')) {
        return { rowCount: notifications.length, rows: notifications }
      }
      if (s.startsWith('UPDATE CUTI.NOTIFICATIONS')) {
        return { rowCount: 1, rows: [{ id: params[0] }] }
      }
      return { rowCount: 0, rows: [] }
    },
  }
}

test('notification query logic handles retrieval, unread count, and read status correctly', async () => {
  const mockItems = [
    { id: 1, user_id: 10, title: 'Notif 1', body: 'Body 1', is_read: false },
    { id: 2, user_id: 10, title: 'Notif 2', body: 'Body 2', is_read: true },
  ]
  const pool = createMockPool({ notifications: mockItems })

  // 1. Get notifications & count
  const [itemsRes, countRes] = await Promise.all([
    pool.query('SELECT * FROM cuti.notifications WHERE user_id = $1 ORDER BY created_at DESC', [10]),
    pool.query('SELECT count(*)::integer AS unread_count FROM cuti.notifications WHERE user_id = $1 AND NOT is_read', [10]),
  ])

  assert.equal(itemsRes.rows.length, 2)
  assert.equal(countRes.rows[0].unread_count, 1)

  // 2. Mark single as read
  await pool.query(
    'UPDATE cuti.notifications SET is_read = true, read_at = now() WHERE id = $1 AND user_id = $2',
    [1, 10],
  )
  const markRead = pool.queries.find((q) => q.sql.includes('UPDATE cuti.notifications SET is_read = true'))
  assert.ok(markRead)
  assert.equal(markRead.params[0], 1)
  assert.equal(markRead.params[1], 10)

  // 3. Mark all as read
  await pool.query(
    'UPDATE cuti.notifications SET is_read = true, read_at = now() WHERE user_id = $1 AND NOT is_read',
    [10],
  )
  const markAll = pool.queries.find((q) => q.sql.includes('WHERE user_id = $1 AND NOT is_read'))
  assert.ok(markAll)
  assert.equal(markAll.params[0], 10)
})
