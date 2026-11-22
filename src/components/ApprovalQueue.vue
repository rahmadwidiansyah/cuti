<script setup>
import { computed, reactive, ref } from 'vue'
import { Eye, Search, Clock, AlertTriangle, CheckCircle2, SlidersHorizontal, XCircle } from 'lucide-vue-next'
import DecisionStatusTabs from './DecisionStatusTabs.vue'
import SortableHeader from './SortableHeader.vue'
import TableSort from './TableSort.vue'
import { APPROVAL_SORT_OPTIONS, defaultDirectionFor } from '../sort.js'
import StatusPill from './StatusPill.vue'
import TablePager from './TablePager.vue'

const props = defineProps({
  roleCode: { type: String, required: true },
  items: { type: Array, default: () => [] },
  statusCounts: { type: Object, default: () => ({ pending: 0, approved: 0, rejected: 0 }) },
  activeStatus: { type: String, default: 'pending' },
  sortBy: { type: String, default: 'submittedAt' },
  sortDir: { type: String, default: 'desc' },
})
const emit = defineEmits(['open', 'status-change', 'sort-change'])

const monthShort = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des']
const categoryLabel = {
  PNS_TU: 'PNS · TU',
  PNS: 'PNS · non-TU',
  PPPK_PPNPN_TU: 'PPPK/PPNPN · TU',
  PPPK_PPNPN: 'PPPK/PPNPN · non-TU',
  KONTRAK: 'Kontrak',
}

const roleInfo = computed(() => ({
  HR_ANALYST: { title: 'Pertimbangan SDM', subtitle: 'Pengajuan yang menunggu pertimbangan Analis SDM.' },
  KASUBAG: { title: 'Antrean Kasubag', subtitle: 'PNS TU diteruskan ke Kepsta. PPPK/PPNPN TU diputus Kasubag.' },
  KEPSTA: { title: 'Keputusan akhir', subtitle: 'Pengajuan yang menunggu keputusan Kepsta.' },
  PPK: { title: 'Keputusan PPK', subtitle: 'Pengajuan rute Kontrak yang menunggu keputusan PPK.' },
})[props.roleCode] || { title: 'Antrean persetujuan', subtitle: 'Pengajuan yang menunggu tindakan Anda.' })

const isHistory = computed(() => props.activeStatus !== 'pending')

const draft = reactive({ q: '', leaveType: '' })
const applied = reactive({ q: '', leaveType: '' })
const page = ref(0)
const pageSize = 20

const leaveTypes = computed(() => [...new Set(props.items.map(i => i.leave_type_name).filter(Boolean))].sort())
const units = computed(() => [...new Set(props.items.map(i => i.employee_unit_name).filter(Boolean))].sort())

const filtered = computed(() => props.items.filter((item) => {
  const term = applied.q.trim().toLocaleLowerCase('id')
  if (term && ![item.request_number, item.employee_name, item.employee_unit_name]
    .some(value => String(value || '').toLocaleLowerCase('id').includes(term))) return false
  if (applied.leaveType && item.leave_type_name !== applied.leaveType) return false
  return true
}))
const paged = computed(() => filtered.value.slice(page.value * pageSize, (page.value + 1) * pageSize))

const pendingCount = computed(() => Number(props.statusCounts.pending || 0))
const approvedCount = computed(() => Number(props.statusCounts.approved || 0))
const rejectedCount = computed(() => Number(props.statusCounts.rejected || 0))
const overdueCount = computed(() => Number(props.statusCounts.overdue || 0))

const metricIcons = {
  'Menunggu keputusan': Clock,
  'Menunggu tindakan': Clock,
  'Melewati SLA': AlertTriangle,
  'Disetujui': CheckCircle2,
  'Ditolak': XCircle,
}

const metrics = computed(() => props.roleCode === 'KASUBAG' ? [
  { label: 'Menunggu tindakan', value: pendingCount.value, suffix: 'pengajuan', tone: 'blue' },
  { label: 'Melewati SLA', value: overdueCount.value, suffix: 'pengajuan', tone: 'amber' },
  { label: 'Disetujui', value: approvedCount.value, suffix: 'pengajuan', tone: 'green' },
  { label: 'Ditolak', value: rejectedCount.value, suffix: 'pengajuan', tone: 'red' },
] : [
  { label: 'Menunggu keputusan', value: pendingCount.value, suffix: 'pengajuan', tone: 'blue' },
  { label: 'Melewati SLA', value: overdueCount.value, suffix: 'pengajuan', tone: 'amber' },
  { label: 'Disetujui', value: approvedCount.value, suffix: 'pengajuan', tone: 'green' },
  { label: 'Ditolak', value: rejectedCount.value, suffix: 'pengajuan', tone: 'red' },
])

function initials(name) {
  return name?.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?'
}
function formatDate(value) {
  if (!value) return '-'
  const d = new Date(`${String(value).slice(0, 10)}T12:00:00Z`)
  if (Number.isNaN(d.valueOf())) return '-'
  return `${d.getUTCDate()} ${monthShort[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}
function statusText(item) {
  if (item.status === 'approved') return 'Disetujui'
  if (item.status === 'rejected') return 'Tidak Disetujui'
  if (item.decision_mode === 'FORWARD') return 'Menunggu keputusan'
  return 'Menunggu tindakan'
}
function statusKey(item) {
  if (item.status === 'approved') return 'APPROVED'
  if (item.status === 'rejected') return 'REJECTED'
  return 'SUBMITTED'
}
const filtersOpen = ref(false)
const activeFilterCount = computed(() =>
  [draft.q, draft.leaveType].filter(value => String(value || '').trim() !== '').length,
)

function applyFilters() {
  Object.assign(applied, draft)
  page.value = 0
  filtersOpen.value = false
}
function resetFilters() {
  Object.assign(draft, { q: '', leaveType: '' })
  Object.assign(applied, { q: '', leaveType: '' })
  page.value = 0
  filtersOpen.value = false
}

function changeSort(next) {
  emit('sort-change', next)
}
function changeSortBy(value) {
  changeSort({ by: value, dir: defaultDirectionFor(value) })
}
function changeSortDir(value) {
  changeSort({ by: props.sortBy, dir: value })
}

</script>

<template>
  <section class="approval-page">
    <div class="ap-metrics">
      <article v-for="metric in metrics" :key="metric.label" class="ap-metric">
        <div>
          <p>{{ metric.label }}</p>
          <strong>{{ metric.value }} <span>{{ metric.suffix }}</span></strong>
        </div>
        <span class="ap-metric-icon" :class="`tone-${metric.tone}`">
          <component :is="metricIcons[metric.label]" :size="16" aria-hidden="true" />
        </span>
      </article>
    </div>

    <DecisionStatusTabs
      :counts="statusCounts"
      :active="activeStatus"
      @change="emit('status-change', $event)"
    />

    <form class="ap-filters" :class="{ 'filters-open': filtersOpen }" @submit.prevent="applyFilters">
      <label class="ap-search">
        <Search :size="14" aria-hidden="true" />
        <span class="sr-only">Cari nama atau nomor pengajuan</span>
        <input v-model="draft.q" type="search" placeholder="Cari nama atau nomor pengajuan…" />
      </label>
      <!-- Audit UX mobile: filter lanjutan dilipat di balik tombol ikon. -->
      <button class="ap-filter-toggle" type="button" :aria-expanded="filtersOpen" aria-label="Filter pencarian" @click="filtersOpen = !filtersOpen">
        <SlidersHorizontal :size="16" aria-hidden="true" />
        <span v-if="activeFilterCount" class="ap-filter-badge">{{ activeFilterCount }}</span>
      </button>
      <div class="ap-filters-advanced">
        <label class="ap-select">
          <span class="sr-only">Jenis cuti</span>
          <select v-model="draft.leaveType">
            <option value="">Semua jenis cuti</option>
            <option v-for="type in leaveTypes" :key="type" :value="type">{{ type }}</option>
          </select>
        </label>
        <button class="button button-primary" type="submit">Terapkan</button>
        <button class="button button-quiet" type="button" @click="resetFilters">Reset</button>
      </div>
    </form>

    <section class="ap-table-panel panel-flex" :aria-label="roleInfo.title">
      <div class="ap-sort-mobile">
        <span class="ap-sort-mobile-label">Urutkan</span>
        <TableSort
          :sort-by="sortBy"
          :sort-dir="sortDir"
          :options="APPROVAL_SORT_OPTIONS"
          @update:sort-by="changeSortBy"
          @update:sort-dir="changeSortDir"
        />
      </div>
      <table class="ap-table">
        <thead>
          <tr>
            <SortableHeader column="requestNumber" label="No pengajuan" :sort-by="sortBy" :sort-dir="sortDir" @sort="changeSort" />
            <SortableHeader column="employee" label="Pegawai" :sort-by="sortBy" :sort-dir="sortDir" @sort="changeSort" />
            <SortableHeader column="unit" label="Unit kerja" :sort-by="sortBy" :sort-dir="sortDir" @sort="changeSort" />
            <SortableHeader column="leaveType" label="Jenis cuti" :sort-by="sortBy" :sort-dir="sortDir" @sort="changeSort" />
            <SortableHeader column="startDate" label="Tanggal cuti" :sort-by="sortBy" :sort-dir="sortDir" @sort="changeSort" />
            <SortableHeader column="workingDays" label="Durasi" :sort-by="sortBy" :sort-dir="sortDir" @sort="changeSort" />
            <SortableHeader column="submittedAt" label="Diajukan" :sort-by="sortBy" :sort-dir="sortDir" @sort="changeSort" />
            <SortableHeader column="status" label="Status" :sort-by="sortBy" :sort-dir="sortDir" @sort="changeSort" />
            <th aria-label="Lihat"></th>
          </tr>
        </thead>
        <tbody v-if="paged.length">
          <tr v-for="item in paged" :key="item.id">
            <td>
              <button class="ap-link" type="button" @click="emit('open', item.id)">{{ item.request_number }}</button>
            </td>
            <td>
              <div class="ap-person">
                <span class="ap-avatar" aria-hidden="true">{{ initials(item.employee_name) }}</span>
                <span>
                  <strong>{{ item.employee_name }}</strong>
                  <small>{{ categoryLabel[item.employee_category] || item.employee_category }}</small>
                </span>
              </div>
            </td>
            <td>{{ item.employee_unit_name || '-' }}</td>
            <td>{{ item.leave_type_name }}</td>
            <td class="ap-nowrap">{{ formatDate(item.start_date) }}</td>
            <td>{{ item.requested_working_days }} hari</td>
            <td class="ap-nowrap">{{ formatDate(item.submitted_at) }}</td>
            <td>
              <StatusPill :status="statusKey(item)" :label="statusText(item)" />
            </td>
            <td>
              <button class="ap-eye" type="button" :aria-label="`Lihat ${item.request_number}`" @click="emit('open', item.id)">
                <Eye :size="15" aria-hidden="true" />
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="paged.length" class="ap-cards">
        <article v-for="item in paged" :key="`card-${item.id}`" class="ap-card">
          <div class="ap-card-head">
            <button class="ap-link" type="button" @click="emit('open', item.id)">{{ item.request_number }}</button>
            <StatusPill :status="statusKey(item)" :label="statusText(item)" />
          </div>
          <p class="ap-card-person"><strong>{{ item.employee_name }}</strong><small>{{ categoryLabel[item.employee_category] || item.employee_category }} · {{ item.employee_unit_name || '-' }}</small></p>
          <dl class="ap-card-facts">
            <div><dt>Jenis cuti</dt><dd>{{ item.leave_type_name }}</dd></div>
            <div><dt>Tanggal</dt><dd>{{ formatDate(item.start_date) }}</dd></div>
            <div><dt>Durasi</dt><dd>{{ item.requested_working_days }} hari</dd></div>
          </dl>
          <button class="button button-secondary button-small" type="button" @click="emit('open', item.id)">Buka pengajuan</button>
        </article>
      </div>

      <p v-if="!paged.length && !isHistory" class="ap-empty">Belum ada pengajuan dalam antrean Anda.</p>
      <p v-if="!paged.length && isHistory" class="ap-empty">Tidak ada keputusan sebelumnya untuk role Anda.</p>

      <TablePager v-if="paged.length" :page="page" :total="filtered.length" :page-size="pageSize" label="pengajuan" @change="p => page = p" />
    </section>
  </section>
</template>

<style scoped>
.approval-page {
  display: grid; gap: 20px; min-width: 0;
}
.ap-metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; }
.ap-metric {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;
  min-height: 96px; padding: 16px; border: 1px solid var(--border); border-radius: var(--radius-panel); background: var(--card);
}
.ap-metric p { margin: 0 0 4px; color: var(--muted); font-size: 10.5px; font-weight: 500; }
.ap-metric strong { color: var(--ink); font-size: 26px; font-weight: 700; line-height: 1.15; font-variant-numeric: tabular-nums; }
.ap-metric strong span { color: var(--muted); font-size: 10.5px; font-weight: 500; }
.ap-metric-icon { width: 34px; height: 34px; flex: 0 0 auto; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; }
.tone-blue { background: var(--info-bg); color: var(--info-text); }
.tone-green { background: var(--success-bg); color: var(--success-text); }
.tone-amber { background: var(--warning-bg); color: var(--warning-text); }
.tone-red { background: var(--danger-bg); color: var(--danger-text); }

.ap-filters {
  display: flex; align-items: center; flex-wrap: wrap; gap: 12px;
  padding: 12px 16px; border: 1px solid var(--border); border-radius: var(--radius-panel); background: var(--subtle);
}
.ap-filter-toggle { display: none; }
.ap-filters-advanced { display: contents; }
.ap-filter-badge {
  position: absolute; top: -6px; right: -6px; min-width: 18px; height: 18px; padding: 0 4px;
  border-radius: 999px; background: var(--primary); color: var(--on-dark);
  font-size: 10px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center;
}
.ap-search {
  display: flex; align-items: center; gap: 8px; width: 300px; height: 40px; padding: 0 12px;
  border: 1px solid var(--control-border); border-radius: var(--radius-control); color: var(--muted); background: var(--card);
}
.ap-search input { width: 100%; border: 0; background: transparent; color: var(--text); font-size: 13px; }
.ap-select select { height: 40px; padding: 0 32px 0 12px; border: 1px solid var(--control-border); border-radius: var(--radius-control); background: var(--card); color: var(--text); font-size: 13px; min-width: 180px; }
.ap-filters .button { min-height: 40px; }

.ap-table-panel { min-width: 0; border: 1px solid var(--border); border-radius: var(--radius-panel); background: var(--card); overflow: hidden; }
.ap-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
.ap-sort-mobile { display: none; align-items: center; gap: 8px; padding-bottom: 12px; }
.ap-sort-mobile-label { color: var(--muted); font-size: 11px; font-weight: 600; }
.ap-table th {
  padding: 16px; border-bottom: 1px solid var(--border);
  color: var(--muted); font-size: 9.5px; font-weight: 700; letter-spacing: 0.06em; text-align: left; text-transform: uppercase;
}
.ap-table th:nth-child(1) { width: 140px; }
.ap-table th:nth-child(2) { width: 170px; }
.ap-table th:nth-child(3) { width: 110px; }
.ap-table th:nth-child(4) { width: 120px; }
.ap-table th:nth-child(5) { width: 120px; }
.ap-table th:nth-child(6) { width: 70px; }
.ap-table th:nth-child(7) { width: 105px; }
.ap-table th:nth-child(8) { width: 120px; }
.ap-table th:nth-child(9) { width: 50px; }
.ap-table td { padding: 12px 16px; border-bottom: 1px solid var(--divider); color: var(--text); font-size: 12px; vertical-align: middle; }
.ap-link { padding: 0; border: 0; background: transparent; color: var(--primary); font-size: 12px; font-weight: 650; cursor: pointer; }
.ap-link:hover { text-decoration: underline; }
.ap-person { display: flex; align-items: center; gap: 10px; }
.ap-avatar { width: 28px; height: 28px; flex: 0 0 auto; border-radius: 50%; background: var(--info-bg); color: var(--primary-dark); display: inline-flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 600; }
.ap-person strong { display: block; color: var(--ink); font-size: 11px; font-weight: 600; }
.ap-person small { display: block; margin-top: 2px; color: var(--muted); font-size: 10px; }
.ap-nowrap { white-space: nowrap; }
.ap-cards { display: none; }
.ap-card { display: grid; gap: 10px; padding: 14px; border: 1px solid var(--border); border-radius: var(--radius-panel); background: var(--card); }
.ap-card-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.ap-card-person { margin: 0; }
.ap-card-person strong { display: block; color: var(--ink); font-size: 12.5px; font-weight: 600; }
.ap-card-person small { display: block; margin-top: 2px; color: var(--muted); font-size: 10px; }
.ap-card-facts { display: grid; gap: 6px; margin: 0; }
.ap-card-facts > div { display: flex; justify-content: space-between; gap: 12px; }
.ap-card-facts dt { color: var(--muted); font-size: 11px; }
.ap-card-facts dd { margin: 0; color: var(--text); font-size: 11px; text-align: right; }
.ap-card > .button { justify-content: center; }
.ap-eye { width: 32px; height: 32px; display: inline-flex; align-items: center; justify-content: center; border: 0; border-radius: var(--radius-control); background: transparent; color: var(--text); cursor: pointer; }
.ap-eye:hover { background: var(--subtle); }
.ap-empty { margin: 0; padding: 40px 20px; text-align: center; color: var(--muted); font-size: 13px; }

@media (max-width: 1200px) {
  .ap-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .ap-table { min-width: 1005px; }
  .ap-table-panel { overflow-x: auto; }
}
@media (max-width: 700px) {
  .ap-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .ap-search { flex: 1 1 auto; width: auto; }
  /* Audit UX mobile: filter lanjutan dilipat di balik tombol ikon. */
  .ap-filter-toggle {
    display: inline-flex; align-items: center; justify-content: center;
    width: 40px; height: 40px; flex: 0 0 auto; position: relative;
    border: 1px solid var(--control-border); border-radius: var(--radius-control);
    background: var(--card); color: var(--text); cursor: pointer;
  }
  .ap-filters-advanced { display: none; }
  .ap-filters.filters-open .ap-filters-advanced {
    display: grid; grid-template-columns: 1fr; gap: 8px; flex: 1 1 100%;
  }
  .ap-filters.filters-open .ap-select select { width: 100%; }
  .ap-table-panel { border: 0; background: transparent; overflow: visible; }
  .ap-table { display: none; }
  .ap-sort-mobile { display: flex; }
  .ap-cards { display: grid; gap: 10px; }
}
</style>
