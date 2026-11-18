<script setup>
import { computed, reactive, ref } from 'vue'
import { ChevronLeft, ChevronRight, Eye, Search, Clock, AlertTriangle, CheckCircle2, XCircle } from 'lucide-vue-next'
import DecisionStatusTabs from './DecisionStatusTabs.vue'

const props = defineProps({
  roleCode: { type: String, required: true },
  items: { type: Array, default: () => [] },
  statusCounts: { type: Object, default: () => ({ pending: 0, approved: 0, rejected: 0 }) },
  activeStatus: { type: String, default: 'pending' },
})
const emit = defineEmits(['open', 'status-change'])

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
const pageSize = 6

const leaveTypes = computed(() => [...new Set(props.items.map(i => i.leave_type_name).filter(Boolean))].sort())
const units = computed(() => [...new Set(props.items.map(i => i.employee_unit_name).filter(Boolean))].sort())

const filtered = computed(() => props.items.filter((item) => {
  const term = applied.q.trim().toLocaleLowerCase('id')
  if (term && ![item.request_number, item.employee_name, item.employee_unit_name]
    .some(value => String(value || '').toLocaleLowerCase('id').includes(term))) return false
  if (applied.leaveType && item.leave_type_name !== applied.leaveType) return false
  return true
}))
const totalPages = computed(() => Math.max(1, Math.ceil(filtered.value.length / pageSize)))
const paged = computed(() => filtered.value.slice(page.value * pageSize, (page.value + 1) * pageSize))
const firstShown = computed(() => filtered.value.length ? page.value * pageSize + 1 : 0)
const lastShown = computed(() => Math.min((page.value + 1) * pageSize, filtered.value.length))

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
  { label: 'Melewati SLA', value: overdueCount.value, suffix: 'pengajuan', tone: 'red' },
  { label: 'Disetujui', value: approvedCount.value, suffix: 'pengajuan', tone: 'green' },
  { label: 'Ditolak', value: rejectedCount.value, suffix: 'pengajuan', tone: 'amber' },
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
  if (item.status === 'rejected') return 'Tidak disetujui'
  if (item.decision_mode === 'FORWARD') return 'Menunggu keputusan'
  return 'Menunggu tindakan'
}
function statusTone(item) {
  if (item.status === 'approved') return 'green'
  if (item.status === 'rejected') return 'red'
  return 'amber'
}
function applyFilters() { Object.assign(applied, draft); page.value = 0 }
function resetFilters() {
  Object.assign(draft, { q: '', leaveType: '' })
  Object.assign(applied, { q: '', leaveType: '' })
  page.value = 0
}
function changePage(delta) { page.value = Math.min(Math.max(page.value + delta, 0), totalPages.value - 1) }

function exportCsv() {
  const rows = [
    ['No pengajuan', 'Pegawai', 'Unit', 'Kategori', 'Jenis cuti', 'Tanggal mulai', 'Tanggal selesai', 'Durasi'],
    ...props.items.map(item => [
      item.request_number, item.employee_name, item.employee_unit_name || '',
      categoryLabel[item.employee_category] || item.employee_category, item.leave_type_name,
      item.start_date, item.end_date, item.requested_working_days,
    ]),
  ]
  const csv = rows.map(row => row.map(value => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `antrean-${props.roleCode}.csv`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

defineExpose({ exportCsv })
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

    <form class="ap-filters" @submit.prevent="applyFilters">
      <label class="ap-search">
        <Search :size="14" aria-hidden="true" />
        <span class="sr-only">Cari nama atau nomor pengajuan</span>
        <input v-model="draft.q" type="search" placeholder="Cari nama atau nomor pengajuan…" />
      </label>
      <label class="ap-select">
        <span class="sr-only">Jenis cuti</span>
        <select v-model="draft.leaveType">
          <option value="">Semua jenis cuti</option>
          <option v-for="type in leaveTypes" :key="type" :value="type">{{ type }}</option>
        </select>
      </label>
      <button class="button button-primary" type="submit">Terapkan</button>
      <button class="button button-quiet" type="button" @click="resetFilters">Reset</button>
    </form>

    <section class="ap-table-panel" :aria-label="roleInfo.title">
      <table class="ap-table">
        <thead>
          <tr>
            <th>No pengajuan</th>
            <th>Pegawai</th>
            <th>Unit kerja</th>
            <th>Jenis cuti</th>
            <th>Tanggal cuti</th>
            <th>Durasi</th>
            <th>Status</th>
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
            <td>
              <span class="ap-status" :class="`ap-status-${statusTone(item)}`">{{ statusText(item) }}</span>
            </td>
            <td>
              <button class="ap-eye" type="button" :aria-label="`Lihat ${item.request_number}`" @click="emit('open', item.id)">
                <Eye :size="15" aria-hidden="true" />
              </button>
            </td>
          </tr>
        </tbody>
      </table>

      <p v-if="!paged.length && !isHistory" class="ap-empty">Belum ada pengajuan dalam antrean Anda.</p>
      <p v-if="!paged.length && isHistory" class="ap-empty">Tidak ada keputusan sebelumnya untuk role Anda.</p>

      <footer v-if="paged.length" class="ap-pagination">
        <span>Menampilkan {{ firstShown }}-{{ lastShown }} dari {{ filtered.length }} pengajuan</span>
        <div>
          <button class="ap-page-button" type="button" aria-label="Halaman sebelumnya" :disabled="page === 0" @click="changePage(-1)">
            <ChevronLeft :size="14" aria-hidden="true" />
          </button>
          <button
            v-for="n in totalPages" :key="n" class="ap-page-button"
            :class="{ active: page === n - 1 }" type="button" :aria-label="`Halaman ${n}`" @click="page = n - 1"
          >{{ n }}</button>
          <button class="ap-page-button" type="button" aria-label="Halaman berikutnya" :disabled="page >= totalPages - 1" @click="changePage(1)">
            <ChevronRight :size="14" aria-hidden="true" />
          </button>
        </div>
      </footer>
    </section>
  </section>
</template>

<style scoped>
.approval-page {
  --ink: #142f3a; --text: #3d525c; --muted: #5a6f78;
  --border: #e1e9f1; --divider: #edf2f7; --blue: #0d6efd;
  display: grid; gap: 20px; min-width: 0;
}
.ap-metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; }
.ap-metric {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;
  min-height: 92px; padding: 16px; border: 1px solid var(--border); border-radius: 12px; background: #fff;
}
.ap-metric p { margin: 0 0 4px; color: var(--muted); font-size: 10.5px; font-weight: 500; }
.ap-metric strong { color: var(--ink); font-size: 26px; font-weight: 700; line-height: 1.15; }
.ap-metric strong span { color: var(--muted); font-size: 10.5px; font-weight: 500; }
.ap-metric-icon { width: 32px; height: 32px; flex: 0 0 auto; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; }
.tone-blue { background: #e9f1ff; color: #1b4fbf; }
.tone-green { background: #e4f7ec; color: #0b6b45; }
.tone-amber { background: #fff6de; color: #8a5a00; }
.tone-red { background: #fde9e9; color: #a11d1d; }

.ap-filters {
  display: flex; align-items: center; flex-wrap: wrap; gap: 10px;
  padding: 12px; border: 1px solid var(--border); border-radius: 12px; background: #fff;
}
.ap-search {
  display: flex; align-items: center; gap: 8px; width: 300px; height: 40px; padding: 0 12px;
  border: 1px solid #8494a1; border-radius: 8px; color: #6e8590; background: #fff;
}
.ap-search input { width: 100%; border: 0; outline: 0; background: transparent; color: var(--text); font-size: 13px; }
.ap-search:focus-within { border-color: var(--blue); box-shadow: 0 0 0 3px rgba(13, 110, 253, 0.12); }
.ap-select select { height: 40px; padding: 0 32px 0 12px; border: 1px solid #8494a1; border-radius: 8px; background: #fff; color: var(--text); font-size: 13px; min-width: 180px; }
.ap-filters .button { min-height: 40px; }

.ap-table-panel { min-width: 0; border: 1px solid var(--border); border-radius: 12px; background: #fff; overflow: hidden; }
.ap-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
.ap-table th {
  padding: 16px; border-bottom: 1px solid var(--border);
  color: var(--muted); font-size: 9.5px; font-weight: 600; letter-spacing: 0.04em; text-align: left; text-transform: uppercase;
}
.ap-table th:nth-child(1) { width: 150px; }
.ap-table th:nth-child(2) { width: 185px; }
.ap-table th:nth-child(3) { width: 125px; }
.ap-table th:nth-child(4) { width: 130px; }
.ap-table th:nth-child(5) { width: 130px; }
.ap-table th:nth-child(6) { width: 80px; }
.ap-table th:nth-child(7) { width: 130px; }
.ap-table th:nth-child(8) { width: 56px; }
.ap-table td { padding: 12px 16px; border-bottom: 1px solid var(--divider); color: var(--text); font-size: 10.5px; vertical-align: middle; }
.ap-link { padding: 0; border: 0; background: transparent; color: #0b5ed7; font-size: 11px; font-weight: 650; cursor: pointer; }
.ap-link:hover { text-decoration: underline; }
.ap-person { display: flex; align-items: center; gap: 10px; }
.ap-avatar { width: 28px; height: 28px; flex: 0 0 auto; border-radius: 50%; background: #e9f1ff; color: #0b5ed7; display: inline-flex; align-items: center; justify-content: center; font-size: 9px; font-weight: 600; }
.ap-person strong { display: block; color: var(--ink); font-size: 11px; font-weight: 600; }
.ap-person small { display: block; margin-top: 2px; color: var(--muted); font-size: 9px; }
.ap-nowrap { white-space: nowrap; }
.ap-status { display: inline-flex; align-items: center; height: 22px; padding: 0 10px; border-radius: 11px; font-size: 9px; font-weight: 600; white-space: nowrap; }
.ap-status-green { background: #e4f7ec; color: #0b6b45; }
.ap-status-red { background: #fde9e9; color: #a11d1d; }
.ap-status-amber { background: #fff6de; color: #8a5a00; }
.ap-eye { width: 32px; height: 32px; display: inline-flex; align-items: center; justify-content: center; border: 0; border-radius: 8px; background: transparent; color: var(--text); cursor: pointer; }
.ap-eye:hover { background: var(--divider); }
.ap-empty { margin: 0; padding: 40px 20px; text-align: center; color: var(--muted); font-size: 13px; }
.ap-pagination { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 20px; color: var(--muted); font-size: 11px; }
.ap-pagination > div { display: flex; gap: 4px; }
.ap-page-button { min-width: 28px; height: 28px; padding: 0 6px; border: 0; border-radius: 8px; background: transparent; color: var(--muted); font-size: 11px; cursor: pointer; }
.ap-page-button.active { background: #e9f1ff; color: #0b5ed7; font-weight: 600; }
.ap-page-button:hover:not(:disabled):not(.active) { background: var(--divider); }
.ap-page-button:disabled { opacity: 0.45; cursor: not-allowed; }

@media (max-width: 1180px) {
  .ap-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .ap-table { min-width: 1000px; }
  .ap-table-panel { overflow-x: auto; }
}
@media (max-width: 640px) {
  .ap-metrics { grid-template-columns: 1fr; }
  .ap-search { flex: 1 1 240px; width: auto; }
  .ap-select, .ap-select select { flex: 1 1 100%; width: 100%; }
}
</style>
