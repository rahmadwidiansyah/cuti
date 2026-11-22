<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { CheckCircle2, Clock3, FileText, Info, RotateCcw } from 'lucide-vue-next'
import DatePicker from './DatePicker.vue'
import TableSort from './TableSort.vue'
import { CANCELLATION_SORT_OPTIONS } from '../sort.js'

const filters = reactive({
  startDate: '',
  endDate: '',
  unitId: '',
  categoryId: '',
  routeId: '',
  leaveTypeId: '',
  sortBy: 'submittedAt',
  sortDir: 'desc',
})
const draft = reactive({ ...filters })
const loading = ref(false)
const error = ref('')
const data = ref(null)

const units = computed(() => data.value?.filters?.units || [])
const categories = computed(() => data.value?.filters?.categories || [])
const routes = computed(() => data.value?.filters?.routes || [])
const leaveTypes = computed(() => data.value?.filters?.leaveTypes || [])

const leaveTypeName = (code) => leaveTypes.value.find((type) => type.code === code)?.name || code
const categoryName = (code) => ({
  PNS_TU: 'PNS · TU',
  PNS: 'PNS · non-TU',
  PPPK_PPNPN_TU: 'PPPK/PPNPN · TU',
  PPPK_PPNPN: 'PPPK/PPNPN · non-TU',
  KONTRAK: 'Kontrak',
})[code] || code

const summary = computed(() => data.value?.summary || {})
const metrics = computed(() => [
  { label: 'Total pengajuan', value: summary.value.totalPengajuan ?? 0, suffix: 'pengajuan', icon: FileText, tone: 'blue' },
  { label: 'Hari disetujui', value: summary.value.totalHariDiberikan ?? 0, suffix: 'hari', icon: CheckCircle2, tone: 'green' },
  { label: 'Pembatalan', value: summary.value.totalPembatalan ?? 0, suffix: 'pengajuan', icon: RotateCcw, tone: 'red' },
  { label: 'Rata-rata durasi', value: summary.value.rataRataDurasi ?? 0, suffix: 'hari', icon: Clock3, tone: 'teal' },
])

const periodYear = computed(() => {
  const source = filters.startDate || filters.endDate || new Date().toISOString().slice(0, 10)
  return String(source).slice(0, 4)
})

const recapRows = computed(() => (data.value?.recapPerUnit || []).map((row) => ({
  unitName: row.unitName,
  annual: Number(row.typeCounts?.ANNUAL || 0),
  sick: Number(row.typeCounts?.SICK || 0),
  important: Number(row.typeCounts?.IMPORTANT_REASON || 0),
  total: Number(row.totalCount || 0),
})))

const compositionCodes = ['ANNUAL', 'SICK', 'IMPORTANT_REASON']
const compositionColors = { ANNUAL: '#0d6efd', SICK: '#8a5a00', IMPORTANT_REASON: '#0a6b60' }
const compositionRows = computed(() => {
  const rows = data.value?.composition || []
  return compositionCodes
    .map((code) => {
      const row = rows.find((item) => item.leaveTypeCode === code)
      return {
        code,
        name: row?.leaveTypeName || leaveTypeName(code),
        count: Number(row?.count || 0),
        pct: Number(row?.pct || 0),
        color: compositionColors[code],
      }
    })
    .filter((row) => row.count > 0)
})
const nonAnnualNote = computed(() => {
  const rows = data.value?.composition || []
  return ['SICK', 'IMPORTANT_REASON'].every((code) => {
    const row = rows.find((item) => item.leaveTypeCode === code)
    return !row || !row.deductsAnnual
  })
})

const cancelRows = computed(() => data.value?.cancellations || [])
const restoredTotal = computed(() => cancelRows.value.reduce((sum, row) => sum + Number(row.restoredDays || 0), 0))

function formatDate(value) {
  if (!value) return '-'
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00Z`)
  if (Number.isNaN(date.valueOf())) return String(value).slice(0, 10)
  return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date)
}

const queryParams = computed(() => {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value)
  }
  return params.toString()
})

async function loadData() {
  loading.value = true
  error.value = ''
  try {
    const url = `/api/admin/reports/leaves${queryParams.value ? `?${queryParams.value}` : ''}`
    const response = await fetch(url, { credentials: 'include' })
    const body = await response.json().catch(() => null)
    if (!response.ok) throw new Error(body?.error || `Permintaan gagal (${response.status}).`)
    data.value = body
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Gagal memuat laporan.'
  } finally {
    loading.value = false
  }
}

function applyFilters() {
  Object.assign(filters, draft)
  loadData()
}

function resetFilters() {
  const defaults = { startDate: '', endDate: '', unitId: '', categoryId: '', routeId: '', leaveTypeId: '', sortBy: 'submittedAt', sortDir: 'desc' }
  Object.assign(draft, defaults)
  Object.assign(filters, defaults)
  loadData()
}

function changeSort(next) {
  Object.assign(filters, next)
  Object.assign(draft, next)
  loadData()
}

onMounted(() => {
  Object.assign(draft, filters)
  loadData()
})
</script>

<template>
  <section class="report-page">
    <p v-if="error" class="rp-error" role="alert">
      {{ error }}
      <button class="text-button" type="button" @click="loadData">Coba lagi</button>
    </p>
    <p v-if="loading && !data" class="rp-loading" role="status">Memuat laporan cuti…</p>

    <form class="rp-filters" @submit.prevent="applyFilters">
      <label class="sr-only" for="report-start">Mulai</label>
      <DatePicker id="report-start" v-model="draft.startDate" class="rp-date" placeholder="Mulai" :show-markers="false" />
      <label class="sr-only" for="report-end">Sampai</label>
      <DatePicker id="report-end" v-model="draft.endDate" class="rp-date" placeholder="Sampai" :show-markers="false" />
      <label class="rp-select">
        <span class="sr-only">Unit kerja</span>
        <select v-model="draft.unitId">
          <option value="">Semua unit</option>
          <option v-for="unit in units" :key="unit.id" :value="unit.id">{{ unit.name }}</option>
        </select>
      </label>
      <label class="rp-select">
        <span class="sr-only">Jenis cuti</span>
        <select v-model="draft.leaveTypeId">
          <option value="">Semua jenis cuti</option>
          <option v-for="type in leaveTypes" :key="type.id" :value="type.id">{{ type.name }}</option>
        </select>
      </label>
      <button class="button button-primary rp-apply" type="submit">Terapkan</button>
      <button class="button button-quiet rp-reset" type="button" @click="resetFilters">Reset</button>
    </form>

    <template v-if="data && !loading">
      <div class="rp-metrics">
        <article v-for="metric in metrics" :key="metric.label" class="rp-metric">
          <div>
            <p>{{ metric.label }}</p>
            <strong>{{ metric.value }} <span>{{ metric.suffix }}</span></strong>
          </div>
          <span class="rp-metric-icon" :class="`tone-${metric.tone}`">
            <component :is="metric.icon" :size="16" aria-hidden="true" />
          </span>
        </article>
      </div>

      <div class="rp-overview">
        <section class="rp-panel rp-unit">
          <div class="rp-panel-heading">
            <div>
              <h2>Rekap per unit</h2>
              <p>Jumlah pengajuan per jenis cuti · tahun {{ periodYear }}.</p>
            </div>
          </div>
          <table class="rp-table">
            <thead>
              <tr><th>Unit</th><th>Tahunan</th><th>Sakit</th><th>Alasan penting</th><th>Total</th></tr>
            </thead>
            <tbody>
              <tr v-for="row in recapRows" :key="row.unitName">
                <td>{{ row.unitName }}</td>
                <td>{{ row.annual }}</td>
                <td>{{ row.sick }}</td>
                <td>{{ row.important }}</td>
                <td class="rp-total">{{ row.total }}</td>
              </tr>
              <tr v-if="!recapRows.length"><td colspan="5" class="rp-empty">Tidak ada rekap pada filter ini.</td></tr>
            </tbody>
          </table>
        </section>

        <section class="rp-panel rp-composition">
          <div class="rp-panel-heading">
            <div>
              <h2>Komposisi jenis cuti</h2>
              <p>{{ summary.totalPengajuan || 0 }} pengajuan · {{ summary.totalHariDiberikan || 0 }} hari disetujui</p>
            </div>
          </div>
          <div v-for="row in compositionRows" :key="row.code" class="rp-compose-row">
            <div class="rp-compose-label"><span>{{ row.name }}</span><strong>{{ row.pct }}%</strong></div>
            <div class="rp-progress"><span :style="{ width: `${row.pct}%`, background: row.color }"></span></div>
            <small>{{ row.count }} pengajuan</small>
          </div>
          <p v-if="!compositionRows.length" class="rp-empty">Tidak ada komposisi pada filter ini.</p>
          <p v-if="nonAnnualNote" class="rp-compose-note">
            <Info :size="13" aria-hidden="true" />
            Cuti sakit dan alasan penting tidak memotong saldo tahunan.
          </p>
        </section>
      </div>

      <section class="rp-panel rp-cancel">
        <div class="rp-panel-heading">
          <div>
            <h2>Rekap pembatalan</h2>
            <p>Maksimal pengembalian adalah hari disetujui dikurangi hari digunakan.</p>
          </div>
          <TableSort
            :sort-by="filters.sortBy"
            :sort-dir="filters.sortDir"
            :options="CANCELLATION_SORT_OPTIONS"
            @update:sort-by="value => changeSort({ sortBy: value })"
            @update:sort-dir="value => changeSort({ sortDir: value })"
          />
        </div>
        <table class="rp-table">
          <thead>
            <tr>
              <th>No pengajuan</th><th>Pegawai</th><th>Tanggal cuti</th><th>Disetujui</th>
              <th>Digunakan</th><th>Dikembalikan</th><th>Alasan</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in cancelRows" :key="row.requestNumber">
              <td class="rp-request">{{ row.requestNumber }}</td>
              <td>{{ row.employeeName }}</td>
              <td>{{ formatDate(row.startDate) }}</td>
              <td>{{ row.approvedDays ?? 0 }}</td>
              <td>{{ row.usedDays ?? 0 }}</td>
              <td class="rp-restored">{{ row.restoredDays ?? 0 }}</td>
              <td>{{ row.cancellationReason || '-' }}</td>
            </tr>
            <tr v-if="!cancelRows.length"><td colspan="7" class="rp-empty">Tidak ada pembatalan pada filter ini.</td></tr>
          </tbody>
          <tfoot v-if="cancelRows.length">
            <tr><td colspan="6">Total hari dikembalikan</td><td class="rp-restored">{{ restoredTotal }} hari</td></tr>
          </tfoot>
        </table>
      </section>
    </template>
  </section>
</template>

<style scoped>
.report-page {
  display: grid; gap: 20px; min-width: 0;
}
.rp-error { margin: 0; padding: 12px 14px; border: 1px solid var(--danger-border); border-radius: var(--radius-control); background: var(--danger-bg); color: var(--danger-text); font-size: 13px; }
.rp-loading { margin: 0; color: var(--muted); font-size: 13px; }

.rp-filters {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 16px; border: 1px solid var(--border); border-radius: var(--radius-panel); background: var(--subtle);
}
.rp-filters > label:not(.sr-only) { position: relative; min-width: 0; }
.rp-date { flex: 0 0 160px; width: 160px; }
.rp-select select {
  width: 160px; height: 40px; padding: 0 10px;
  border: 1px solid var(--control-border); border-radius: var(--radius-control);
  background: var(--card); color: var(--text); font-size: 13px; cursor: pointer;
}
.rp-apply { min-width: 96px; height: 40px; min-height: 40px; }
.rp-reset { min-width: 72px; }

.rp-metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; }
.rp-metric {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;
  min-height: 96px; padding: 16px; border: 1px solid var(--border); border-radius: var(--radius-panel); background: var(--card);
}
.rp-metric p { margin: 0 0 4px; color: var(--muted); font-size: 10.5px; font-weight: 500; }
.rp-metric strong { color: var(--ink); font-size: 26px; font-weight: 700; line-height: 1.15; font-variant-numeric: tabular-nums; }
.rp-metric strong span { color: var(--muted); font-size: 10.5px; font-weight: 500; }
.rp-metric-icon { width: 34px; height: 34px; flex: 0 0 auto; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; }
.tone-blue { background: var(--info-bg); color: var(--info-text); }
.tone-green { background: var(--success-bg); color: var(--success-text); }
.tone-red { background: var(--danger-bg); color: var(--danger-text); }
.tone-teal { background: var(--teal-bg); color: var(--teal-text); }

.rp-overview { display: grid; grid-template-columns: minmax(0, 716fr) minmax(0, 392fr); gap: 20px; align-items: start; }
.rp-panel { min-width: 0; padding: 20px; border: 1px solid var(--border); border-radius: var(--radius-panel); background: var(--card); }
.rp-unit, .rp-composition { min-height: 300px; }
.rp-panel-heading { display: flex; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; gap: 12px; margin-bottom: 16px; }
.rp-panel-heading h2 { margin: 0 0 4px; color: var(--ink); font-size: 16px; font-weight: 600; }
.rp-panel-heading p { margin: 0; color: var(--muted); font-size: 10px; }

.rp-table { width: 100%; border-collapse: collapse; }
.rp-table th {
  padding: 0 10px 10px; border-bottom: 1px solid var(--border);
  color: var(--muted); font-size: 9.5px; font-weight: 700; letter-spacing: 0.06em; text-align: left; text-transform: uppercase;
}
.rp-table td {
  padding: 12px 10px; border-bottom: 1px solid var(--divider);
  color: var(--text); font-size: 12px;
}
.rp-table th:first-child, .rp-table td:first-child { padding-left: 0; }
.rp-table th:last-child, .rp-table td:last-child { padding-right: 0; }
.rp-total { color: var(--ink); font-weight: 600; }
.rp-request { color: var(--primary); font-weight: 650; white-space: nowrap; }
.rp-restored { color: var(--success-text); font-weight: 700; white-space: nowrap; }
.rp-empty { padding: 20px 0; text-align: center; color: var(--muted); }
.rp-table tfoot td { border-bottom: 0; border-top: 1px solid var(--border); color: var(--muted); font-size: 10px; font-weight: 600; }

.rp-compose-row { margin-bottom: 14px; }
.rp-compose-label { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 6px; color: var(--text); font-size: 10.5px; }
.rp-compose-label strong { color: var(--ink); font-weight: 600; }
.rp-progress { height: 7px; border-radius: 4px; background: var(--border); overflow: hidden; }
.rp-progress span { display: block; height: 100%; border-radius: 4px; }
.rp-compose-row small { display: block; margin-top: 4px; color: var(--muted); font-size: 10px; }
.rp-compose-note { display: flex; align-items: flex-start; gap: 6px; margin: 18px 0 0; color: var(--muted); font-size: 11px; line-height: 1.4; }
.rp-compose-note svg { flex: 0 0 auto; }

@media (max-width: 1200px) {
  .rp-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .rp-overview { grid-template-columns: 1fr; }
  .rp-filters { flex-wrap: wrap; }
  .rp-cancel { overflow-x: auto; }
  .rp-cancel .rp-table { min-width: 900px; }
}
@media (max-width: 640px) {
  .rp-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .rp-date, .rp-select, .rp-select select, .rp-apply, .rp-reset { width: 100%; flex: 1 1 100%; }
  .rp-filters { padding: 12px 16px; }
  .rp-date :deep(.dp-input-wrap), .rp-select select, .rp-apply, .rp-reset { height: 44px; min-height: 44px; }
  .rp-panel { padding: 16px; overflow-x: auto; }
  .rp-table { min-width: 480px; }
}
</style>
