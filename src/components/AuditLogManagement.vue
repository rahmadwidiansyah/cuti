<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { ChevronLeft, ChevronRight, Lock, Search } from 'lucide-vue-next'

const emptyFilters = { actorUserId: '', action: '', role: '', entityType: '', from: '', to: '', q: '' }
const applied = reactive({ ...emptyFilters })
const draft = reactive({ ...emptyFilters })
const page = ref(0)
const pageSize = 8
const loading = ref(false)
const error = ref('')
const data = ref(null)

const items = computed(() => data.value?.items || [])
const total = computed(() => Number(data.value?.summary?.total || 0))
const facets = computed(() => data.value?.filters || { actions: [], entityTypes: [], actors: [], roles: [] })
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)))
const firstShown = computed(() => total.value ? page.value * pageSize + 1 : 0)
const lastShown = computed(() => Math.min((page.value + 1) * pageSize, total.value))

const queryString = computed(() => {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(applied)) {
    if (value) params.set(key, value)
  }
  params.set('limit', String(pageSize))
  params.set('offset', String(page.value * pageSize))
  return params.toString()
})

function parseJson(value) {
  if (!value) return {}
  try {
    return typeof value === 'string' ? JSON.parse(value) : value
  } catch {
    return {}
  }
}

function displayValue(value) {
  if (value === true) return 'ya'
  if (value === false) return 'tidak'
  if (value === null || value === undefined || value === '') return '-'
  return String(value)
}

function changeSummary(item) {
  const before = parseJson(item.beforeValues)
  const after = parseJson(item.afterValues)
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  const preferred = [
    { key: 'status', label: '' },
    { key: 'is_active', label: 'Aktif' },
    { key: 'isActive', label: 'Aktif' },
  ]
  for (const { key, label } of preferred) {
    if (!keys.has(key) || displayValue(before[key]) === displayValue(after[key])) continue
    const from = displayValue(before[key])
    const to = displayValue(after[key])
    if (from === '-') return label ? `${label}: ${to}` : to
    return label ? `${label}: ${from} → ${to}` : `${from} → ${to}`
  }
  for (const key of keys) {
    if (displayValue(before[key]) !== displayValue(after[key])) {
      return `${key}: ${displayValue(before[key])} → ${displayValue(after[key])}`
    }
  }
  return '-'
}

function entityText(item) {
  return item.entityKey || item.entityLabel || item.entityType || '-'
}

function formatDateTime(value) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return String(value)
  const day = new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short' }).format(date)
  const time = new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit' }).format(date).replace(':', '.')
  return `${day} ${time}`
}

function setSingleDate(value) {
  draft.from = value
  draft.to = value
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const response = await fetch(`/api/admin/audit?${queryString.value}`, { credentials: 'include' })
    const body = await response.json().catch(() => null)
    if (!response.ok) throw new Error(body?.error || `Permintaan gagal (${response.status}).`)
    data.value = body
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Gagal memuat audit log.'
  } finally {
    loading.value = false
  }
}

function applyFilters() {
  Object.assign(applied, draft)
  page.value = 0
  load()
}

function resetFilters() {
  Object.assign(draft, emptyFilters)
  Object.assign(applied, emptyFilters)
  page.value = 0
  load()
}

function changePage(delta) {
  page.value = Math.min(Math.max(page.value + delta, 0), totalPages.value - 1)
  load()
}

function exportCsv() {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(applied)) {
    if (value) params.set(key, value)
  }
  const suffix = params.toString()
  const link = document.createElement('a')
  link.href = `/api/admin/audit/export.csv${suffix ? `?${suffix}` : ''}`
  link.download = 'audit-log.csv'
  document.body.appendChild(link)
  link.click()
  link.remove()
}

onMounted(load)

defineExpose({ exportCsv })
</script>

<template>
  <section class="audit-page">
    <p v-if="error" class="au-error" role="alert">
      {{ error }}
      <button class="text-button" type="button" @click="load">Coba lagi</button>
    </p>

    <form class="au-filters" @submit.prevent="applyFilters">
      <label class="au-search">
        <Search :size="14" aria-hidden="true" />
        <span class="sr-only">Cari pelaku, entitas, atau alasan</span>
        <input v-model="draft.q" type="search" placeholder="Cari pelaku, entitas, atau alasan…" />
      </label>
      <label class="au-select">
        <span class="sr-only">Tindakan</span>
        <select v-model="draft.action">
          <option value="">Semua tindakan</option>
          <option v-for="option in facets.actions" :key="option.action" :value="option.action">{{ option.action }}</option>
        </select>
      </label>
      <label class="au-select">
        <span class="sr-only">Role</span>
        <select v-model="draft.role">
          <option value="">Semua role</option>
          <option v-for="option in facets.roles" :key="option.code" :value="option.code">{{ option.code }}</option>
        </select>
      </label>
      <label class="au-date">
        <span class="sr-only">Tanggal</span>
        <input type="date" :value="draft.from" @input="setSingleDate($event.target.value)" />
      </label>
      <button class="button button-primary" type="submit">Terapkan</button>
      <button class="button button-quiet" type="button" @click="resetFilters">Reset</button>
    </form>

    <section class="au-panel" aria-label="Riwayat tindakan">
      <div class="au-panel-heading">
        <h2>Riwayat tindakan</h2>
        <span class="au-immutable"><Lock :size="11" aria-hidden="true" /> Immutable</span>
      </div>
      <table class="au-table">
        <thead>
          <tr>
            <th>Waktu</th><th>Pelaku</th><th>Role</th><th>Tindakan</th>
            <th>Entitas</th><th>Alasan</th><th>Perubahan status</th>
          </tr>
        </thead>
        <tbody v-if="items.length">
          <tr v-for="item in items" :key="item.id">
            <td class="au-time">{{ formatDateTime(item.createdAt) }}</td>
            <td class="au-actor">{{ item.actorName || 'Sistem' }}</td>
            <td><span class="au-role">{{ item.actorRoleCode || 'SISTEM' }}</span></td>
            <td>{{ item.action }}</td>
            <td class="au-entity">{{ entityText(item) }}</td>
            <td class="au-reason">{{ item.reason || '-' }}</td>
            <td class="au-change">{{ changeSummary(item) }}</td>
          </tr>
        </tbody>
      </table>
      <p v-if="!items.length && !loading" class="au-empty">
        {{ total ? 'Tidak ada entri pada halaman ini.' : 'Tidak ada entri audit yang cocok dengan filter ini.' }}
      </p>
      <p v-if="loading" class="au-loading" role="status">Memuat audit log…</p>
      <footer class="au-pagination">
        <span>Menampilkan {{ firstShown }}-{{ lastShown }} dari {{ total }} entri audit</span>
        <div>
          <button class="au-page-button" type="button" aria-label="Halaman sebelumnya" :disabled="page === 0" @click="changePage(-1)">
            <ChevronLeft :size="14" aria-hidden="true" />
          </button>
          <button
            v-for="n in totalPages"
            :key="n"
            class="au-page-button"
            :class="{ active: page === n - 1 }"
            type="button"
            :aria-label="`Halaman ${n}`"
            @click="page = n - 1; load()"
          >{{ n }}</button>
          <button class="au-page-button" type="button" aria-label="Halaman berikutnya" :disabled="page >= totalPages - 1" @click="changePage(1)">
            <ChevronRight :size="14" aria-hidden="true" />
          </button>
        </div>
      </footer>
    </section>
  </section>
</template>

<style scoped>
.audit-page {
  --ink: #142f3a; --text: #3d525c; --muted: #5a6f78;
  --border: #e1e9f1; --divider: #edf2f7;
  display: grid; gap: 20px; min-width: 0;
}
.au-error { margin: 0; padding: 12px 16px; border-radius: 10px; background: #fde9e9; color: #a11d1d; font-size: 13px; }
.au-loading { margin: 0; padding: 12px 20px; color: var(--muted); font-size: 12px; }

.au-filters {
  display: flex; align-items: center; gap: 12px;
  padding: 12px; border: 1px solid var(--border); border-radius: 12px; background: #fff;
}
.au-filters > label { position: relative; min-width: 0; }
.au-search {
  display: flex; align-items: center; gap: 8px; width: 300px; height: 40px; padding: 0 12px;
  border: 1px solid #8494a1; border-radius: 8px; color: #6e8590; background: #fff;
}
.au-search input { width: 100%; border: 0; outline: 0; background: transparent; color: var(--text); font-size: 13px; }
.au-search:focus-within { border-color: #0d6efd; box-shadow: 0 0 0 3px rgba(13, 110, 253, 0.12); }
.au-select select, .au-date input {
  width: 180px; height: 40px; padding: 0 10px;
  border: 1px solid #8494a1; border-radius: 8px; background: #fff;
  color: var(--text); font-size: 12px; cursor: pointer;
}
.au-date input { width: 170px; }
.au-filters .button { min-height: 40px; }

.au-panel {
  min-width: 0; padding: 20px;
  border: 1px solid var(--border); border-radius: 12px; background: #fff;
}
.au-panel-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 16px; }
.au-panel-heading h2 { margin: 0; color: var(--ink); font-size: 15px; font-weight: 600; }
.au-immutable { display: flex; align-items: center; gap: 5px; color: var(--muted); font-size: 9.5px; font-weight: 600; }

.au-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
.au-table th {
  padding: 0 10px 12px; border-bottom: 1px solid var(--border);
  color: var(--muted); font-size: 9px; font-weight: 600; letter-spacing: 0.03em; text-align: left; text-transform: uppercase;
}
.au-table td {
  padding: 14px 10px; border-bottom: 1px solid var(--divider);
  color: var(--text); font-size: 10px; vertical-align: middle;
}
.au-table th:first-child, .au-table td:first-child { padding-left: 0; }
.au-table th:last-child, .au-table td:last-child { padding-right: 0; }
.au-table th:nth-child(1) { width: 130px; }
.au-table th:nth-child(2) { width: 140px; }
.au-table th:nth-child(3) { width: 90px; }
.au-table th:nth-child(4) { width: 170px; }
.au-table th:nth-child(5) { width: 140px; }
.au-table th:nth-child(6) { width: 180px; }
.au-table th:nth-child(7) { width: 170px; }
.au-time { color: var(--muted); white-space: nowrap; }
.au-actor { color: var(--ink); font-weight: 600; }
.au-role {
  display: inline-flex; align-items: center; height: 22px; padding: 0 10px;
  border: 1px solid #d8e2ea; border-radius: 11px; background: #edf2f6;
  color: var(--text); font-size: 9px; font-weight: 600;
}
.au-entity { color: #0d6efd; font-weight: 600; overflow-wrap: anywhere; }
.au-change { color: #0d6efd; font-size: 9px; overflow-wrap: anywhere; }
.au-empty { margin: 0; padding: 36px 0; text-align: center; color: var(--muted); font-size: 13px; }

.au-pagination {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding-top: 14px; color: var(--muted); font-size: 11px;
}
.au-pagination > div { display: flex; gap: 4px; }
.au-page-button {
  min-width: 28px; height: 28px; padding: 0 6px; border: 0; border-radius: 8px;
  background: transparent; color: var(--muted); font-size: 11px; cursor: pointer;
}
.au-page-button.active { background: #e9f1ff; color: #0b5ed7; font-weight: 600; }
.au-page-button:hover:not(:disabled):not(.active) { background: var(--divider); }
.au-page-button:disabled { opacity: 0.45; cursor: not-allowed; }

@media (max-width: 1400px) {
  .au-filters { flex-wrap: wrap; }
  .au-search { flex: 1 1 260px; width: auto; }
  .au-table { min-width: 1000px; }
  .au-panel { overflow-x: auto; }
}
@media (max-width: 640px) {
  .au-select select, .au-date input { width: 100%; flex: 1 1 100%; }
  .au-pagination { flex-direction: column; align-items: flex-start; }
}
</style>
