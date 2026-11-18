<script setup>
import { computed, reactive, ref } from 'vue'
import { CheckCircle2, ChevronLeft, ChevronRight, Clock3, Eye, Inbox, RotateCcw, Search } from 'lucide-vue-next'
import DecisionStatusTabs from './DecisionStatusTabs.vue'

const props = defineProps({
  items: { type: Array, default: () => [] },
  statusCounts: { type: Object, default: () => ({ pending: 0, approved: 0, rejected: 0 }) },
  activeStatus: { type: String, default: 'pending' },
})
const emit = defineEmits(['open', 'status-change'])

const stageOrder = ['ADMIN_REVIEW', 'PERTIMBANGAN_REVIEW', 'KASUBAG_REVIEW', 'KEPSTA_REVIEW', 'PPK_REVIEW']
const stageLabel = {
  ADMIN_REVIEW: 'Verifikasi Admin',
  PERTIMBANGAN_REVIEW: 'Pertimbangan SDM',
  KASUBAG_REVIEW: 'Antrean Kasubag',
  KEPSTA_REVIEW: 'Kepsta',
  PPK_REVIEW: 'PPK',
}
const monthShort = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des']

const draft = reactive({ q: '', unit: '', leaveType: '' })
const applied = reactive({ q: '', unit: '', leaveType: '' })
const activeTab = ref('all')
const page = ref(0)
const pageSize = 6

const units = computed(() => unique(props.items.map(item => item.employee_unit_name).filter(Boolean)).sort())
const leaveTypes = computed(() => unique(props.items.map(item => item.leave_type_name).filter(Boolean)).sort())

const waitingCount = computed(() => Number(props.statusCounts.pending || 0))
const overdueCount = computed(() => Number(props.statusCounts.overdue || 0))
const submittedToday = computed(() => {
  const nowUTC = new Date(Date.now())
  return props.items.filter((item) => {
    if (!item.submitted_at) return false
    const date = new Date(item.submitted_at)
    if (Number.isNaN(date.valueOf())) return false
    return date.getUTCFullYear() === nowUTC.getUTCFullYear()
      && date.getUTCMonth() === nowUTC.getUTCMonth()
      && date.getUTCDate() === nowUTC.getUTCDate()
  }).length
})
const typeCount = computed(() => Number(props.statusCounts.leaveTypes || 0))

const tabs = computed(() => {
  const base = [{ key: 'all', label: 'Semua tahap', count: props.items.length }]
  const byStage = stageOrder
    .filter(code => props.items.some(item => item.stage_code === code))
    .map(code => ({
      key: code,
      label: stageLabel[code] || code,
      count: props.items.filter(item => item.stage_code === code).length,
    }))
  return [...base, ...byStage]
})

const filtered = computed(() => {
  const term = applied.q.trim().toLocaleLowerCase('id')
  return props.items.filter((item) => {
    if (activeTab.value !== 'all' && item.stage_code !== activeTab.value) return false
    if (term && ![item.request_number, item.employee_name, item.employee_unit_name, item.leave_type_name]
      .some(value => String(value || '').toLocaleLowerCase('id').includes(term))) return false
    if (applied.unit && item.employee_unit_name !== applied.unit) return false
    if (applied.leaveType && item.leave_type_name !== applied.leaveType) return false
    return true
  })
})

const totalPages = computed(() => Math.max(1, Math.ceil(filtered.value.length / pageSize)))
const paged = computed(() => filtered.value.slice(page.value * pageSize, (page.value + 1) * pageSize))
const firstShown = computed(() => filtered.value.length ? page.value * pageSize + 1 : 0)
const lastShown = computed(() => Math.min((page.value + 1) * pageSize, filtered.value.length))

function unique(values) {
  return [...new Set(values)]
}

function initials(name) {
  return String(name || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0].toUpperCase())
    .join('') || '?'
}

function formatDate(value) {
  if (!value) return '-'
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00Z`)
  if (Number.isNaN(date.valueOf())) return '-'
  return `${date.getUTCDate()} ${monthShort[date.getUTCMonth()]} ${date.getUTCFullYear()}`
}

function isToday(value) {
  if (!value) return false
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return false
  const nowUTC = new Date(Date.now())
  return date.getUTCFullYear() === nowUTC.getUTCFullYear()
    && date.getUTCMonth() === nowUTC.getUTCMonth()
    && date.getUTCDate() === nowUTC.getUTCDate()
}

function submittedLabel(value) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return '-'
  if (isToday(value)) return new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit' }).format(date).replace(':', '.')
  const now = new Date()
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) return 'Kemarin'
  return `${date.getDate()} ${monthShort[date.getMonth()]}`
}

function statusText(item) {
  if (item.is_overdue) return 'Lewat SLA'
  if (item.request_status === 'RETURNED_FOR_REVISION') return 'Dikembalikan'
  if (item.request_status === 'APPROVED') return 'Disetujui'
  if (item.request_status === 'REJECTED') return 'Ditolak'
  if (item.request_status === 'WITHDRAWN') return 'Dibatalkan pegawai'
  if (item.request_status === 'CANCELLED') return 'Dibatalkan admin'
  return ({
    SUBMITTED: 'Menunggu verifikasi',
    ADMIN_REVIEW: 'Perlu verifikasi',
    ADMIN_VERIFIED: 'Diteruskan',
    PERTIMBANGAN_REVIEW: 'Pertimbangan SDM',
    KASUBAG_REVIEW: 'Antrean Kasubag',
    KEPSTA_REVIEW: 'Antrean Kepsta',
    PPK_REVIEW: 'Antrean PPK',
  })[item.request_status] || item.request_status || '-'
}

function statusTone(item) {
  if (item.is_overdue) return 'danger'
  if (['RETURNED_FOR_REVISION'].includes(item.request_status)) return 'danger'
  if (item.request_status === 'APPROVED') return 'success'
  if (item.request_status === 'REJECTED') return 'danger'
  if (['ADMIN_VERIFIED', 'PERTIMBANGAN_REVIEW'].includes(item.request_status)) return 'info'
  return 'warning'
}

function selectTab(key) {
  activeTab.value = key
  page.value = 0
}

function applyFilters() {
  Object.assign(applied, draft)
  page.value = 0
}

function resetFilters() {
  Object.assign(draft, { q: '', unit: '', leaveType: '' })
  Object.assign(applied, { q: '', unit: '', leaveType: '' })
  activeTab.value = 'all'
  page.value = 0
}

function changePage(delta) {
  page.value = Math.min(Math.max(page.value + delta, 0), totalPages.value - 1)
}

function exportCsv() {
  const rows = [
    ['No pengajuan', 'Pegawai', 'Unit', 'Jenis cuti', 'Tanggal mulai', 'Tanggal selesai', 'Durasi', 'Diajukan', 'Status'],
    ...filtered.value.map(item => [
      item.request_number, item.employee_name, item.employee_unit_name || '', item.leave_type_name,
      item.start_date, item.end_date, item.requested_working_days, item.submitted_at || '', statusText(item),
    ]),
  ]
  const csv = rows.map(row => row.map(value => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'antrean-verifikasi.csv'
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

defineExpose({ exportCsv })
</script>

<template>
  <section class="admin-queue">
    <DecisionStatusTabs
      :counts="statusCounts"
      :active="activeStatus"
      @change="emit('status-change', $event)"
    />

    <div class="q-metrics">
      <article class="q-metric">
        <div>
          <p class="q-metric-label">Menunggu verifikasi</p>
          <p class="q-metric-value">{{ waitingCount }} <span>pengajuan</span></p>
        </div>
        <span class="q-metric-icon tone-amber"><Inbox :size="16" aria-hidden="true" /></span>
      </article>
      <article class="q-metric">
        <div>
          <p class="q-metric-label">Melewati SLA</p>
          <p class="q-metric-value">{{ overdueCount }} <span>pengajuan</span></p>
        </div>
        <span class="q-metric-icon tone-red"><RotateCcw :size="16" aria-hidden="true" /></span>
      </article>
      <article class="q-metric">
        <div>
          <p class="q-metric-label">Diajukan hari ini</p>
          <p class="q-metric-value">{{ submittedToday }} <span>pengajuan</span></p>
        </div>
        <span class="q-metric-icon tone-blue"><CheckCircle2 :size="16" aria-hidden="true" /></span>
      </article>
      <article class="q-metric">
        <div>
          <p class="q-metric-label">Jenis cuti dalam antrean</p>
          <p class="q-metric-value">{{ typeCount }} <span>jenis</span></p>
        </div>
        <span class="q-metric-icon tone-green"><Clock3 :size="16" aria-hidden="true" /></span>
      </article>
    </div>

    <div class="q-tabs" role="tablist" aria-label="Filter tahap antrean">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="q-tab"
        :class="{ active: activeTab === tab.key }"
        type="button"
        role="tab"
        :aria-selected="activeTab === tab.key"
        @click="selectTab(tab.key)"
      >
        {{ tab.label }} <span>{{ tab.count }}</span>
      </button>
    </div>

    <form class="q-filters" @submit.prevent="applyFilters">
      <label class="q-search">
        <Search :size="14" aria-hidden="true" />
        <span class="sr-only">Cari nama atau nomor pengajuan</span>
        <input v-model="draft.q" type="search" placeholder="Cari nama atau nomor pengajuan…" />
      </label>
      <label>
        <span class="sr-only">Unit kerja</span>
        <select v-model="draft.unit">
          <option value="">Semua unit</option>
          <option v-for="unit in units" :key="unit" :value="unit">{{ unit }}</option>
        </select>
      </label>
      <label>
        <span class="sr-only">Jenis cuti</span>
        <select v-model="draft.leaveType">
          <option value="">Semua jenis cuti</option>
          <option v-for="type in leaveTypes" :key="type" :value="type">{{ type }}</option>
        </select>
      </label>
      <button class="button button-primary" type="submit">Terapkan</button>
      <button class="button button-quiet" type="button" @click="resetFilters">Reset</button>
    </form>

    <section class="q-table-panel" aria-label="Daftar pengajuan">
      <table class="q-table">
        <thead>
          <tr>
            <th>No pengajuan</th><th>Pegawai</th><th>Jenis</th><th>Tanggal cuti</th>
            <th>Durasi</th><th>Diajukan</th><th>Status</th><th aria-label="Buka"></th>
          </tr>
        </thead>
        <tbody v-if="paged.length">
          <tr v-for="item in paged" :key="item.id">
            <td><button class="q-link" type="button" @click="emit('open', item.id)">{{ item.request_number }}</button></td>
            <td>
              <div class="q-person">
                <span class="q-avatar" aria-hidden="true">{{ initials(item.employee_name) }}</span>
                <span><strong>{{ item.employee_name }}</strong><small>{{ item.employee_unit_name || 'Unit tidak tersedia' }}</small></span>
              </div>
            </td>
            <td>{{ item.leave_type_name }}</td>
            <td>{{ formatDate(item.start_date) }} s.d. {{ formatDate(item.end_date) }}</td>
            <td>{{ item.requested_working_days }} hari</td>
            <td>{{ submittedLabel(item.submitted_at) }}</td>
            <td><span class="q-badge" :class="`q-badge-${statusTone(item)}`">{{ statusText(item) }}</span></td>
            <td>
              <button class="q-icon-button" type="button" :aria-label="`Buka ${item.request_number}`" @click="emit('open', item.id)">
                <Eye :size="14" aria-hidden="true" />
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="!paged.length" class="q-empty">
        {{ items.length ? 'Tidak ada pengajuan yang cocok dengan filter ini. Ubah filter atau tekan Reset.' : 'Belum ada pengajuan dalam antrean Anda saat ini.' }}
      </p>
      <footer class="q-pagination">
        <span>Menampilkan {{ firstShown }}-{{ lastShown }} dari {{ filtered.length }} pengajuan</span>
        <div>
          <button class="q-page-button" type="button" aria-label="Halaman sebelumnya" :disabled="page === 0" @click="changePage(-1)">
            <ChevronLeft :size="14" aria-hidden="true" />
          </button>
          <button
            v-for="n in totalPages"
            :key="n"
            class="q-page-button"
            :class="{ active: page === n - 1 }"
            type="button"
            :aria-label="`Halaman ${n}`"
            @click="page = n - 1"
          >{{ n }}</button>
          <button class="q-page-button" type="button" aria-label="Halaman berikutnya" :disabled="page >= totalPages - 1" @click="changePage(1)">
            <ChevronRight :size="14" aria-hidden="true" />
          </button>
        </div>
      </footer>
    </section>
  </section>
</template>

<style scoped>
.admin-queue {
  --q-ink: #142f3a;
  --q-text: #3d525c;
  --q-muted: #5a6f78;
  --q-border: #e1e9f1;
  --q-divider: #edf2f7;
  --q-blue: #0d6efd;
  display: grid;
  gap: 20px;
  min-width: 0;
}

.q-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
}
.q-metric {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  min-height: 96px;
  padding: 16px;
  border: 1px solid var(--q-border);
  border-radius: 12px;
  background: #fff;
}
.q-metric-label { margin: 0 0 4px; font-size: 10.5px; font-weight: 500; color: var(--q-muted); }
.q-metric-value { margin: 0; font-size: 26px; font-weight: 700; line-height: 1.15; color: var(--q-ink); }
.q-metric-value span { font-size: 10.5px; font-weight: 500; color: var(--q-muted); }
.q-metric-icon {
  width: 34px; height: 34px; flex: 0 0 auto;
  border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;
}
.tone-amber { background: #fff6de; color: #8a5a00; }
.tone-red { background: #fde9e9; color: #a11d1d; }
.tone-blue { background: #e9f1ff; color: #1b4fbf; }
.tone-green { background: #e4f7ec; color: #0b6b45; }

.q-tabs {
  display: flex;
  align-items: center;
  gap: 24px;
  border-bottom: 1px solid var(--q-border);
  overflow-x: auto;
}
.q-tab {
  height: 40px;
  padding: 0 0 10px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--q-muted);
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
}
.q-tab span { margin-left: 4px; font-size: 11px; font-weight: 600; }
.q-tab.active { border-bottom-color: var(--q-blue); color: var(--q-blue); font-weight: 600; }
.q-tab.active span { color: var(--q-blue); }
.q-tab:hover:not(.active) { color: var(--q-ink); }

.q-filters {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--q-border);
  border-radius: 12px;
  background: #fff;
}
.q-filters > label { min-width: 0; position: relative; }
.q-filters select,
.q-search {
  height: 40px;
  border: 1px solid #8494a1;
  border-radius: 8px;
  background: #fff;
  font-size: 13px;
  color: var(--q-text);
}
.q-filters select { width: 160px; padding: 0 10px; cursor: pointer; }
.q-search { display: flex; align-items: center; gap: 8px; width: 300px; padding: 0 12px; color: #6e8590; }
.q-search input { width: 100%; border: 0; outline: 0; background: transparent; color: var(--q-text); font-size: 13px; }
.q-search:focus-within { border-color: var(--q-blue); box-shadow: 0 0 0 3px rgba(13, 110, 253, 0.12); }
.q-filters .button { min-height: 40px; }

.q-table-panel {
  min-width: 0;
  border: 1px solid var(--q-border);
  border-radius: 12px;
  background: #fff;
  overflow: hidden;
}
.q-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
.q-table th {
  padding: 16px 20px 12px;
  border-bottom: 1px solid var(--q-border);
  color: var(--q-muted);
  font-size: 9.5px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-align: left;
  text-transform: uppercase;
}
.q-table td {
  padding: 12px 20px;
  border-bottom: 1px solid var(--q-divider);
  color: var(--q-text);
  font-size: 10.5px;
  vertical-align: middle;
}
.q-table th:nth-child(1) { width: 140px; }
.q-table th:nth-child(2) { width: 190px; }
.q-table th:nth-child(3) { width: 100px; }
.q-table th:nth-child(4) { width: 150px; }
.q-table th:nth-child(5) { width: 70px; }
.q-table th:nth-child(6) { width: 80px; }
.q-table th:nth-child(7) { width: 130px; }
.q-table th:nth-child(8) { width: 60px; }
.q-link { padding: 0; border: 0; background: transparent; color: var(--q-blue); font-size: 10.5px; font-weight: 600; cursor: pointer; }
.q-link:hover { text-decoration: underline; }
.q-person { display: flex; align-items: center; gap: 10px; }
.q-avatar {
  width: 28px; height: 28px; flex: 0 0 auto; border-radius: 50%;
  background: #e9f1ff; color: #0b5ed7;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 9px; font-weight: 600;
}
.q-person strong { display: block; color: var(--q-ink); font-size: 11px; font-weight: 600; }
.q-person small { display: block; color: var(--q-muted); font-size: 9px; }
.q-badge {
  display: inline-flex; align-items: center; height: 22px; padding: 0 10px;
  border: 1px solid transparent; border-radius: 11px;
  font-size: 9px; font-weight: 600; text-transform: uppercase; white-space: nowrap;
}
.q-badge-warning { background: #fff6de; border-color: #f2d79a; color: #8a5a00; }
.q-badge-danger { background: #fde9e9; border-color: #f4c6c6; color: #a11d1d; }
.q-badge-info { background: #e9f1ff; border-color: #c9dafb; color: #1b4fbf; }
.q-badge-success { background: #e4f7ec; border-color: #b9e6cc; color: #0b6b45; }
.q-icon-button {
  width: 32px; height: 32px; display: inline-flex; align-items: center; justify-content: center;
  border: 0; border-radius: 8px; background: transparent; color: var(--q-text); cursor: pointer;
}
.q-icon-button:hover { background: #f7f9fc; }
.q-empty { margin: 0; padding: 40px 20px; text-align: center; color: var(--q-muted); font-size: 13px; }
.q-pagination {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 12px 20px; color: var(--q-muted); font-size: 11px;
}
.q-pagination > div { display: flex; gap: 4px; }
.q-page-button {
  min-width: 28px; height: 28px; padding: 0 6px;
  border: 0; border-radius: 8px; background: transparent;
  color: var(--q-muted); font-size: 11px; cursor: pointer;
}
.q-page-button.active { background: #e9f1ff; color: #0b5ed7; font-weight: 600; }
.q-page-button:hover:not(:disabled):not(.active) { background: #f7f9fc; }
.q-page-button:disabled { opacity: 0.45; cursor: not-allowed; }

@media (max-width: 1180px) {
  .q-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .q-filters { flex-wrap: wrap; }
  .q-search { flex: 1 1 260px; width: auto; }
  .q-table { min-width: 900px; }
  .q-table-panel { overflow-x: auto; }
}
@media (max-width: 640px) {
  .q-metrics { grid-template-columns: 1fr; }
  .q-filters select { width: 100%; }
  .q-filters > label { flex: 1 1 100%; }
  .q-pagination { flex-direction: column; align-items: flex-start; }
}
</style>
