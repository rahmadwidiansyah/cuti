<script setup>
import { computed } from 'vue'
import { Paperclip, Search, X } from 'lucide-vue-next'
import SortableHeader from './SortableHeader.vue'
import TableSort from './TableSort.vue'
import { REQUEST_SORT_OPTIONS, defaultDirectionFor } from '../sort.js'
import StatusPill from './StatusPill.vue'
import TablePager from './TablePager.vue'
import { statusLabel } from '../status.js'
import { formatDateRange } from '../dates.js'

const props = defineProps({
  items: { type: Array, default: () => [] },
  total: { type: Number, default: 0 },
  page: { type: Number, default: 0 },
  pageSize: { type: Number, default: 20 },
  years: { type: Array, default: () => [] },
  leaveTypes: { type: Array, default: () => [] },
  filters: { type: Object, required: true },
  statusCounts: { type: Object, default: () => ({}) },
  loading: { type: Boolean, default: false },
})
const emit = defineEmits(['apply', 'reset', 'page', 'open'])
const tabs = computed(() => [
  { key: '', label: 'Semua', count: props.statusCounts.total || 0 },
  { key: 'DRAFT', label: 'Draf', count: props.statusCounts.draft || 0 },
  { key: 'PENDING', label: 'Menunggu', count: props.statusCounts.pending || 0 },
  { key: 'APPROVED', label: 'Disetujui', count: props.statusCounts.approved || 0 },
  { key: 'REJECTED', label: 'Tidak Disetujui', count: props.statusCounts.rejected || 0 },
  { key: 'RETURNED_FOR_REVISION', label: 'Dikembalikan', count: props.statusCounts.returned || 0 },
  { key: 'CANCELLED', label: 'Dibatalkan', count: props.statusCounts.cancelled || 0 },
])

function formatDate(value) {
  if (!value) return '-'
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00Z`)
  if (Number.isNaN(date.valueOf())) return '-'
  return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date)
}
function selectTab(key) {
  props.filters.status = key
  emit('apply')
}
function changeSort(next) {
  props.filters.sortBy = next.by
  props.filters.sortDir = next.dir
  emit('apply')
}
function changeSortBy(value) {
  changeSort({ by: value, dir: defaultDirectionFor(value) })
}
function changeSortDir(value) {
  changeSort({ by: props.filters.sortBy, dir: value })
}
</script>

<template>
  <section class="hist">
    <div class="hist-tabs" role="tablist" aria-label="Filter status pengajuan">
      <button
        v-for="tab in tabs"
        :key="tab.key || 'all'"
        class="hist-tab"
        :class="{ active: (filters.status || '') === tab.key }"
        type="button"
        role="tab"
        :aria-selected="(filters.status || '') === tab.key"
        @click="selectTab(tab.key)"
      >{{ tab.label }} <span>{{ tab.count }}</span></button>
    </div>

    <form class="hist-filters" @submit.prevent="emit('apply')">
      <label class="hist-search">
        <Search :size="14" aria-hidden="true" />
        <span class="sr-only">Cari nomor pengajuan</span>
        <input v-model="filters.q" type="search" placeholder="Cari nomor pengajuan…" />
      </label>
      <label class="hist-select">
        <span class="sr-only">Jenis cuti</span>
        <select v-model="filters.leaveType">
          <option value="">Semua jenis cuti</option>
          <option v-for="type in leaveTypes" :key="type.code" :value="type.code">{{ type.name }}</option>
        </select>
      </label>
      <label class="hist-select">
        <span class="sr-only">Status</span>
        <select v-model="filters.status">
          <option value="">Semua status</option>
          <option v-for="tab in tabs.filter(item => item.key)" :key="tab.key" :value="tab.key">{{ tab.label }}</option>
        </select>
      </label>
      <label class="hist-select">
        <span class="sr-only">Tahun</span>
        <select v-model="filters.year">
          <option value="">Semua tahun</option>
          <option v-for="year in years" :key="year" :value="String(year)">{{ year }}</option>
        </select>
      </label>
      <label class="hist-select">
        <span class="sr-only">Tanggal cuti mulai</span>
        <input v-model="filters.startDate" type="date" aria-label="Tanggal cuti mulai" />
      </label>
      <label class="hist-select">
        <span class="sr-only">Tanggal cuti akhir</span>
        <input v-model="filters.endDate" type="date" aria-label="Tanggal cuti akhir" />
      </label>
      <button class="button button-primary" type="submit">Terapkan</button>
      <button class="button button-quiet" type="button" @click="emit('reset')">
        <X :size="14" aria-hidden="true" /> Reset
      </button>
    </form>

    <section class="hist-table-panel panel-flex">
      <div class="hist-sort-mobile">
        <span class="hist-sort-mobile-label">Urutkan</span>
        <TableSort
          :sort-by="filters.sortBy"
          :sort-dir="filters.sortDir"
          :options="REQUEST_SORT_OPTIONS"
          @update:sort-by="changeSortBy"
          @update:sort-dir="changeSortDir"
        />
      </div>
      <table class="hist-table">
        <thead>
          <tr>
            <SortableHeader column="requestNumber" label="No pengajuan" :sort-by="filters.sortBy" :sort-dir="filters.sortDir" @sort="changeSort" />
            <SortableHeader column="leaveType" label="Jenis" :sort-by="filters.sortBy" :sort-dir="filters.sortDir" @sort="changeSort" />
            <SortableHeader column="startDate" label="Tanggal cuti" :sort-by="filters.sortBy" :sort-dir="filters.sortDir" @sort="changeSort" />
            <SortableHeader column="workingDays" label="Durasi" :sort-by="filters.sortBy" :sort-dir="filters.sortDir" @sort="changeSort" />
            <SortableHeader column="submittedAt" label="Diajukan" :sort-by="filters.sortBy" :sort-dir="filters.sortDir" @sort="changeSort" />
            <SortableHeader column="status" label="Status" :sort-by="filters.sortBy" :sort-dir="filters.sortDir" @sort="changeSort" />
            <th>Tahap</th><th>Lampiran</th><th></th>
          </tr>
        </thead>
        <tbody v-if="items.length">
          <tr v-for="item in items" :key="item.id">
            <td>
              <button class="hist-link" type="button" @click="emit('open', item.id)">{{ item.request_number }}</button>
            </td>
            <td>{{ item.leave_type_name }}</td>
            <td>{{ formatDateRange(item.start_date, item.end_date) }}</td>
            <td>{{ item.requested_working_days }} hari</td>
            <td>{{ formatDate(item.submitted_at || item.created_at) }}</td>
            <td><StatusPill :status="item.status" /></td>
            <td>{{ statusLabel(item.status) }}</td>
            <td><Paperclip :size="14" aria-hidden="true" /></td>
            <td><button class="hist-icon" type="button" :aria-label="`Buka ${item.request_number}`" @click="emit('open', item.id)"><ChevronRight :size="14" aria-hidden="true" /></button></td>
          </tr>
        </tbody>
      </table>
      <div v-if="items.length" class="hist-cards">
        <article v-for="item in items" :key="`card-${item.id}`" class="hist-card">
          <div class="hist-card-head">
            <button class="hist-link" type="button" @click="emit('open', item.id)">{{ item.request_number }}</button>
            <StatusPill :status="item.status" />
          </div>
          <p class="hist-card-title">{{ item.leave_type_name }}</p>
          <dl class="hist-card-facts">
            <div><dt>Tanggal cuti</dt><dd>{{ formatDateRange(item.start_date, item.end_date) }}</dd></div>
            <div><dt>Durasi</dt><dd>{{ item.requested_working_days }} hari</dd></div>
            <div><dt>Diajukan</dt><dd>{{ formatDate(item.submitted_at || item.created_at) }}</dd></div>
          </dl>
          <button class="button button-secondary button-small" type="button" @click="emit('open', item.id)">Buka pengajuan</button>
        </article>
      </div>
      <p v-if="!items.length && !loading" class="hist-empty">Tidak ada pengajuan yang cocok dengan filter ini. Ubah filter atau tekan Reset.</p>
      <TablePager :page="page" :total="total" :page-size="pageSize" label="pengajuan" @change="p => emit('page', p)" />
    </section>
  </section>
</template>

<style scoped>
.hist { display:grid; gap:20px; min-width:0; }
.hist-tabs { display:flex; gap:24px; border-bottom:1px solid var(--border); overflow-x:auto; }
.hist-tab { height:40px; padding:0 0 10px; border:0; border-bottom:2px solid transparent; background:transparent; color:var(--muted); font-size:13px; font-weight:600; white-space:nowrap; cursor:pointer; }
.hist-tab span { margin-left:4px; font-size:11px; font-weight:600; }
.hist-tab.active { border-bottom-color:var(--primary); color:var(--primary); font-weight:600; }
.hist-filters { display:flex; align-items:center; gap:12px; flex-wrap:wrap; padding:12px 16px; border:1px solid var(--border); border-radius:var(--radius-panel); background:var(--subtle); }
.hist-search { display:flex; align-items:center; gap:8px; width:300px; height:40px; padding:0 12px; border:1px solid var(--control-border); border-radius:var(--radius-control); color:var(--muted); background:var(--card); }
.hist-search input { width:100%; border:0; background:transparent; color:var(--text); font-size:13px; }
.hist-select select, .hist-select input { width:180px; height:40px; padding:0 10px; border:1px solid var(--control-border); border-radius:var(--radius-control); background:var(--card); color:var(--text); font-size:12px; cursor:pointer; }
.hist-filters .button { min-height:40px; }

.hist-table-panel { min-width:0; min-height:260px; border:1px solid var(--border); border-radius:var(--radius-panel); background:var(--card); overflow-x:auto; }
.hist-table { width:100%; border-collapse:collapse; min-width:1080px; }
.hist-sort-mobile { display: none; align-items: center; gap: 8px; padding-bottom: 12px; }
.hist-sort-mobile-label { color: var(--muted); font-size: 11px; font-weight: 600; }
.hist-table th { padding:16px 20px 12px; border-bottom:1px solid var(--border); color:var(--muted); font-size:9.5px; font-weight:700; letter-spacing:.06em; text-align:left; text-transform:uppercase; }
.hist-table td { padding:12px 20px; border-bottom:1px solid var(--divider); color:var(--text); font-size:12px; }
.hist-link { padding:0; border:0; background:transparent; color:var(--primary); font-size:12px; font-weight:650; cursor:pointer; }
.hist-link:hover { text-decoration:underline; }
.hist-cards { display: none; }
.hist-card { display: grid; gap: 10px; padding: 14px; border: 1px solid var(--border); border-radius: var(--radius-panel); background: var(--card); }
.hist-card-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.hist-card-title { margin: 0; color: var(--ink); font-size: 12.5px; font-weight: 600; }
.hist-card-facts { display: grid; gap: 6px; margin: 0; }
.hist-card-facts > div { display: flex; justify-content: space-between; gap: 12px; }
.hist-card-facts dt { color: var(--muted); font-size: 11px; }
.hist-card-facts dd { margin: 0; color: var(--text); font-size: 11px; text-align: right; }
.hist-card > .button { justify-content: center; }
.hist-icon { width:32px; height:32px; display:inline-flex; align-items:center; justify-content:center; border:0; border-radius:var(--radius-control); background:transparent; color:var(--muted); cursor:pointer; }
.hist-icon:hover { background:var(--subtle); }
.hist-empty { margin:0; padding:40px 20px; text-align:center; color:var(--muted); font-size:13px; }

@media (max-width:700px){
  .hist-filters > label { flex:1 1 100%; }
  .hist-search,.hist-select select,.hist-select input { width:100%; }
  .hist-pagination{ flex-direction:column; align-items:flex-start; }
  .hist-table-panel { border:0; background:transparent; overflow:visible; }
  .hist-table { display:none; }
  .hist-sort-mobile { display:flex; }
  .hist-cards { display:grid; gap:10px; }
}
</style>
