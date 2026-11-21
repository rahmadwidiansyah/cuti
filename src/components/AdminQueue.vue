<script setup>
import { computed, reactive, ref } from 'vue'
import { CheckCircle2, Clock3, Eye, Inbox, RotateCcw, Search, SlidersHorizontal } from 'lucide-vue-next'
import StatusPill from './StatusPill.vue'
import TablePager from './TablePager.vue'
import { formatDateRange } from '../dates.js'

const props = defineProps({
  items: { type: Array, default: () => [] },
  statusCounts: { type: Object, default: () => ({ pending: 0, approved: 0, rejected: 0 }) },
  activeStatus: { type: String, default: 'pending' },
})
const emit = defineEmits(['open'])

const stageOrder = ['ADMIN_REVIEW', 'PERTIMBANGAN_REVIEW', 'KASUBAG_REVIEW', 'KEPSTA_REVIEW', 'PPK_REVIEW']
const stageLabel = {
  ADMIN_REVIEW: 'Verifikasi Admin',
  PERTIMBANGAN_REVIEW: 'Pertimbangan SDM',
  KASUBAG_REVIEW: 'Antrean Kasubag',
  KEPSTA_REVIEW: 'Kepsta',
  PPK_REVIEW: 'PPK',
}
const monthShort = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des']

const draft = reactive({ q: '', unit: '', leaveType: '', status: '' })
const applied = reactive({ q: '', unit: '', leaveType: '', status: '' })
const activeTab = ref('all')
const page = ref(0)
const pageSize = 20

const units = computed(() => unique(props.items.map(item => item.employee_unit_name).filter(Boolean)).sort())
const leaveTypes = computed(() => unique(props.items.map(item => item.leave_type_name).filter(Boolean)).sort())
const statusOptions = computed(() => unique(props.items.map(item => item.request_status).filter(Boolean)).sort())

// "Perlu tindakan" = benar-benar menunggu verifikasi Admin. Tahap setelahnya
// (Analis SDM/Kasubag/Kepsta/PPK) tetap terlihat di tab "Semua" untuk monitoring,
// tapi bukan tindakan Admin — backend pun menolak aksi Admin pada tahap tersebut.
const activeStages = ['SUBMITTED', 'ADMIN_REVIEW']
const finishedStages = ['APPROVED', 'REJECTED', 'CANCELLED', 'WITHDRAWN']

const returnedCount = computed(() => props.items.filter(item => item.request_status === 'RETURNED_FOR_REVISION').length)
const forwardedThisMonth = computed(() => {
  const now = new Date()
  return props.items.filter((item) => {
    if (!item.completed_at) return false
    const date = new Date(item.completed_at)
    return !Number.isNaN(date.valueOf())
      && date.getUTCFullYear() === now.getUTCFullYear()
      && date.getUTCMonth() === now.getUTCMonth()
  }).length
})
const averageVerification = computed(() => {
  const durations = props.items
    .filter(item => item.submitted_at && item.completed_at)
    .map(item => (new Date(item.completed_at).valueOf() - new Date(item.submitted_at).valueOf()) / 3_600_000)
    .filter(value => Number.isFinite(value) && value >= 0)
  if (!durations.length) return 0
  return Math.round((durations.reduce((sum, value) => sum + value, 0) / durations.length) * 10) / 10
})

const metrics = computed(() => [
  { label: 'Menunggu verifikasi', value: Number(props.statusCounts.pending || 0), suffix: 'pengajuan', icon: Inbox, tone: 'blue' },
  { label: 'Dikembalikan', value: returnedCount.value, suffix: 'pengajuan', icon: RotateCcw, tone: 'amber' },
  { label: 'Diteruskan bulan ini', value: forwardedThisMonth.value, suffix: 'pengajuan', icon: CheckCircle2, tone: 'green' },
  { label: 'Rata-rata verifikasi', value: averageVerification.value, suffix: 'jam', icon: Clock3, tone: 'slate' },
])

const tabs = computed(() => [
  { key: 'action', label: 'Perlu tindakan', count: props.items.filter(item => activeStages.includes(item.request_status)).length },
  { key: 'all', label: 'Semua', count: props.items.length },
  { key: 'returned', label: 'Dikembalikan', count: returnedCount.value },
  { key: 'finished', label: 'Selesai', count: props.items.filter(item => finishedStages.includes(item.request_status)).length },
])

const filtered = computed(() => {
  const term = applied.q.trim().toLocaleLowerCase('id')
  return props.items.filter((item) => {
    if (activeTab.value === 'action' && !activeStages.includes(item.request_status)) return false
    if (activeTab.value === 'returned' && item.request_status !== 'RETURNED_FOR_REVISION') return false
    if (activeTab.value === 'finished' && !finishedStages.includes(item.request_status)) return false
    if (term && ![item.request_number, item.employee_name, item.employee_unit_name, item.leave_type_name]
      .some(value => String(value || '').toLocaleLowerCase('id').includes(term))) return false
    if (applied.unit && item.employee_unit_name !== applied.unit) return false
    if (applied.leaveType && item.leave_type_name !== applied.leaveType) return false
    if (applied.status && item.request_status !== applied.status) return false
    return true
  })
})

const paged = computed(() => filtered.value.slice(page.value * pageSize, (page.value + 1) * pageSize))

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
  if (item.request_status === 'RETURNED_FOR_REVISION') return 'Dikembalikan untuk perbaikan'
  if (item.request_status === 'APPROVED') return 'Disetujui'
  if (item.request_status === 'REJECTED') return 'Tidak Disetujui'
  if (item.request_status === 'WITHDRAWN') return 'Dibatalkan pegawai'
  if (item.request_status === 'CANCELLED') return 'Dibatalkan Admin'
  return ({
    SUBMITTED: 'Terkirim',
    ADMIN_REVIEW: 'Menunggu verifikasi',
    ADMIN_VERIFIED: 'Diverifikasi Admin',
    PERTIMBANGAN_REVIEW: 'Menunggu pertimbangan SDM',
    KASUBAG_REVIEW: 'Menunggu Kasubag',
    KEPSTA_REVIEW: 'Menunggu Kepsta',
    PPK_REVIEW: 'Menunggu PPK',
  })[item.request_status] || item.request_status || '-'
}

function selectTab(key) {
  activeTab.value = key
  page.value = 0
}

const filtersOpen = ref(false)
const activeFilterCount = computed(() =>
  [draft.q, draft.unit, draft.leaveType, draft.status].filter(value => String(value || '').trim() !== '').length,
)

function applyFilters() {
  Object.assign(applied, draft)
  page.value = 0
  filtersOpen.value = false
}

function resetFilters() {
  Object.assign(draft, { q: '', unit: '', leaveType: '', status: '' })
  Object.assign(applied, { q: '', unit: '', leaveType: '', status: '' })
  activeTab.value = 'all'
  page.value = 0
  filtersOpen.value = false
}

</script>

<template>
  <section class="admin-queue">
    <div class="q-metrics">
      <article v-for="metric in metrics" :key="metric.label" class="q-metric">
        <div>
          <p class="q-metric-label">{{ metric.label }}</p>
          <p class="q-metric-value">{{ metric.value }} <span>{{ metric.suffix }}</span></p>
        </div>
        <span class="q-metric-icon" :class="`tone-${metric.tone}`">
          <component :is="metric.icon" :size="16" aria-hidden="true" />
        </span>
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

    <form class="q-filters" :class="{ 'filters-open': filtersOpen }" @submit.prevent="applyFilters">
      <label class="q-search">
        <Search :size="14" aria-hidden="true" />
        <span class="sr-only">Cari nama atau nomor pengajuan</span>
        <input v-model="draft.q" type="search" placeholder="Cari nama atau nomor pengajuan…" />
      </label>
      <!-- Audit UX mobile: filter lanjutan dilipat di balik tombol ikon. -->
      <button class="q-filter-toggle" type="button" :aria-expanded="filtersOpen" aria-label="Filter pencarian" @click="filtersOpen = !filtersOpen">
        <SlidersHorizontal :size="16" aria-hidden="true" />
        <span v-if="activeFilterCount" class="q-filter-badge">{{ activeFilterCount }}</span>
      </button>
      <div class="q-filters-advanced">
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
        <label>
          <span class="sr-only">Status</span>
          <select v-model="draft.status">
            <option value="">Semua status</option>
            <option v-for="status in statusOptions" :key="status" :value="status">{{ status }}</option>
          </select>
        </label>
        <button class="button button-primary" type="submit">Terapkan</button>
        <button class="button button-quiet" type="button" @click="resetFilters">Reset</button>
      </div>
    </form>

    <section class="q-table-panel panel-flex" aria-label="Daftar pengajuan">
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
            <td>{{ formatDateRange(item.start_date, item.end_date) }}</td>
            <td>{{ item.requested_working_days }} hari</td>
            <td>{{ submittedLabel(item.submitted_at) }}</td>
            <td><StatusPill :status="item.is_overdue ? 'OVERDUE' : item.request_status" /></td>
            <td>
              <button class="q-icon-button" type="button" :aria-label="`Buka ${item.request_number}`" @click="emit('open', item.id)">
                <Eye :size="14" aria-hidden="true" />
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="paged.length" class="q-cards">
        <article v-for="item in paged" :key="`card-${item.id}`" class="q-card">
          <div class="q-card-head">
            <button class="q-link" type="button" @click="emit('open', item.id)">{{ item.request_number }}</button>
            <StatusPill :status="item.is_overdue ? 'OVERDUE' : item.request_status" />
          </div>
          <p class="q-card-person"><strong>{{ item.employee_name }}</strong><small>{{ item.employee_unit_name || 'Unit tidak tersedia' }}</small></p>
          <dl class="q-card-facts">
            <div><dt>Jenis</dt><dd>{{ item.leave_type_name }}</dd></div>
            <div><dt>Tanggal</dt><dd>{{ formatDateRange(item.start_date, item.end_date) }}</dd></div>
            <div><dt>Durasi</dt><dd>{{ item.requested_working_days }} hari</dd></div>
            <div><dt>Diajukan</dt><dd>{{ submittedLabel(item.submitted_at) }}</dd></div>
          </dl>
          <button class="button button-secondary button-small" type="button" @click="emit('open', item.id)">Buka pengajuan</button>
        </article>
      </div>
      <p v-if="!paged.length" class="q-empty">
        {{ items.length ? 'Tidak ada pengajuan yang cocok dengan filter ini. Ubah filter atau tekan Reset.' : 'Belum ada pengajuan dalam antrean Anda saat ini.' }}
      </p>
      <TablePager :page="page" :total="filtered.length" :page-size="pageSize" label="pengajuan" @change="p => page = p" />
    </section>
  </section>
</template>

<style scoped>
.admin-queue {
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
  border: 1px solid var(--border);
  border-radius: var(--radius-panel);
  background: var(--card);
}
.q-metric-label { margin: 0 0 4px; font-size: 10.5px; font-weight: 500; color: var(--muted); }
.q-metric-value { margin: 0; font-size: 26px; font-weight: 700; line-height: 1.15; color: var(--ink); font-variant-numeric: tabular-nums; }
.q-metric-value span { font-size: 10.5px; font-weight: 500; color: var(--muted); }
.q-metric-icon {
  width: 34px; height: 34px; flex: 0 0 auto;
  border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;
}
.tone-amber { background: var(--warning-bg); color: var(--warning-text); }
.tone-red { background: var(--danger-bg); color: var(--danger-text); }
.tone-blue { background: var(--info-bg); color: var(--info-text); }
.tone-green { background: var(--success-bg); color: var(--success-text); }
.tone-slate { background: var(--neutral-bg); color: var(--muted); }

.q-tabs {
  display: flex;
  align-items: center;
  gap: 24px;
  border-bottom: 1px solid var(--border);
  overflow-x: auto;
}
.q-tab {
  height: 40px;
  padding: 0 0 10px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--muted);
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
}
.q-tab span { margin-left: 4px; font-size: 11px; font-weight: 600; }
.q-tab.active { border-bottom-color: var(--primary); color: var(--primary); font-weight: 600; }
.q-tab.active span { color: var(--primary); }
.q-tab:hover:not(.active) { color: var(--ink); }

.q-filters {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius-panel);
  background: var(--subtle);
}
.q-filter-toggle { display: none; }
.q-filters-advanced { display: contents; }
.q-filter-badge {
  position: absolute; top: -6px; right: -6px; min-width: 18px; height: 18px; padding: 0 4px;
  border-radius: 999px; background: var(--primary); color: var(--on-dark);
  font-size: 10px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center;
}
.q-filters > label { min-width: 0; position: relative; }
.q-filters select,
.q-search {
  height: 40px;
  border: 1px solid var(--control-border);
  border-radius: var(--radius-control);
  background: var(--card);
  font-size: 13px;
  color: var(--text);
}
.q-filters select { width: 160px; padding: 0 10px; cursor: pointer; }
.q-search { display: flex; align-items: center; gap: 8px; width: 300px; padding: 0 12px; color: var(--muted); }
.q-search input { width: 100%; border: 0; background: transparent; color: var(--text); font-size: 13px; }
.q-filters .button { min-height: 40px; }

.q-table-panel {
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius-panel);
  background: var(--card);
  overflow: hidden;
}
.q-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
.q-table th {
  padding: 16px 20px 12px;
  border-bottom: 1px solid var(--border);
  color: var(--muted);
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-align: left;
  text-transform: uppercase;
}
.q-table td {
  padding: 12px 20px;
  border-bottom: 1px solid var(--divider);
  color: var(--text);
  font-size: 12px;
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
.q-link { padding: 0; border: 0; background: transparent; color: var(--primary); font-size: 12px; font-weight: 650; cursor: pointer; }
.q-link:hover { text-decoration: underline; }
.q-person { display: flex; align-items: center; gap: 10px; }
.q-avatar {
  width: 28px; height: 28px; flex: 0 0 auto; border-radius: 50%;
  background: var(--info-bg); color: var(--primary-dark);
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 10px; font-weight: 600;
}
.q-person strong { display: block; color: var(--ink); font-size: 11px; font-weight: 600; }
.q-person small { display: block; color: var(--muted); font-size: 10px; }
.q-cards { display: none; }
.q-card { display: grid; gap: 10px; padding: 14px; border: 1px solid var(--border); border-radius: var(--radius-panel); background: var(--card); }
.q-card-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.q-card-person { margin: 0; }
.q-card-person strong { display: block; color: var(--ink); font-size: 12.5px; font-weight: 600; }
.q-card-person small { display: block; margin-top: 2px; color: var(--muted); font-size: 10px; }
.q-card-facts { display: grid; gap: 6px; margin: 0; }
.q-card-facts > div { display: flex; justify-content: space-between; gap: 12px; }
.q-card-facts dt { color: var(--muted); font-size: 11px; }
.q-card-facts dd { margin: 0; color: var(--text); font-size: 11px; text-align: right; }
.q-card > .button { justify-content: center; }
.q-icon-button {
  width: 32px; height: 32px; display: inline-flex; align-items: center; justify-content: center;
  border: 0; border-radius: var(--radius-control); background: transparent; color: var(--text); cursor: pointer;
}
.q-icon-button:hover { background: var(--subtle); }
.q-empty { margin: 0; padding: 40px 20px; text-align: center; color: var(--muted); font-size: 13px; }

@media (max-width: 1200px) {
  .q-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .q-filters { flex-wrap: wrap; }
  .q-search { flex: 1 1 260px; width: auto; }
  .q-table { min-width: 900px; }
  .q-table-panel { overflow-x: auto; }
}
@media (max-width: 700px) {
  .q-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  /* Audit UX mobile: filter lanjutan dilipat di balik tombol ikon. */
  .q-filter-toggle {
    display: inline-flex; align-items: center; justify-content: center;
    width: 40px; height: 40px; flex: 0 0 auto; position: relative;
    border: 1px solid var(--control-border); border-radius: var(--radius-control);
    background: var(--card); color: var(--text); cursor: pointer;
  }
  .q-filters-advanced { display: none; }
  .q-filters.filters-open .q-filters-advanced {
    display: grid; grid-template-columns: 1fr; gap: 8px; flex: 1 1 100%;
  }
  .q-filters.filters-open select { width: 100%; }
  .q-table-panel { border: 0; background: transparent; overflow: visible; }
  .q-table { display: none; }
  .q-cards { display: grid; gap: 10px; }
}
</style>
