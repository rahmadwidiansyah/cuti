<script setup>
import { computed } from 'vue'
import { ChevronLeft, ChevronRight, Download, Paperclip, Search, X } from 'lucide-vue-next'

const props = defineProps({
  items: { type: Array, default: () => [] },
  total: { type: Number, default: 0 },
  page: { type: Number, default: 0 },
  years: { type: Array, default: () => [] },
  leaveTypes: { type: Array, default: () => [] },
  filters: { type: Object, required: true },
  statusCounts: { type: Object, default: () => ({}) },
  loading: { type: Boolean, default: false },
})
const emit = defineEmits(['apply', 'reset', 'page', 'open', 'export'])

const pageSize = 8
const totalPages = computed(() => Math.max(1, Math.ceil(Number(props.total) / pageSize)))
const tabs = computed(() => [
  { key: '', label: 'Semua', count: props.statusCounts.total || 0 },
  { key: 'DRAFT', label: 'Draf', count: props.statusCounts.draft || 0 },
  { key: 'PENDING', label: 'Menunggu', count: props.statusCounts.pending || 0 },
  { key: 'APPROVED', label: 'Disetujui', count: props.statusCounts.approved || 0 },
  { key: 'REJECTED', label: 'Tidak disetujui', count: props.statusCounts.rejected || 0 },
  { key: 'RETURNED_FOR_REVISION', label: 'Dikembalikan', count: props.statusCounts.returned || 0 },
  { key: 'CANCELLED', label: 'Dibatalkan', count: props.statusCounts.cancelled || 0 },
])

function formatDate(value) {
  if (!value) return '-'
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00Z`)
  if (Number.isNaN(date.valueOf())) return '-'
  return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date)
}
function statusLabel(status) {
  return ({
    DRAFT: 'Draf', SUBMITTED: 'Menunggu verifikasi', ADMIN_REVIEW: 'Menunggu verifikasi',
    ADMIN_VERIFIED: 'Diteruskan', PERTIMBANGAN_REVIEW: 'Pertimbangan SDM',
    KASUBAG_REVIEW: 'Antrean Kasubag', KEPSTA_REVIEW: 'Menunggu Kepsta', PPK_REVIEW: 'Menunggu PPK',
    RETURNED_FOR_REVISION: 'Dikembalikan', APPROVED: 'Disetujui', REJECTED: 'Tidak disetujui',
    WITHDRAWN: 'Dibatalkan pegawai', CANCELLED: 'Dibatalkan Admin',
  })[status] || status || '-'
}
function statusTone(status) {
  if (status === 'APPROVED') return 'green'
  if (['REJECTED', 'CANCELLED', 'WITHDRAWN'].includes(status)) return 'red'
  if (['RETURNED_FOR_REVISION'].includes(status)) return 'amber'
  if (['SUBMITTED', 'ADMIN_REVIEW', 'PERTIMBANGAN_REVIEW', 'KASUBAG_REVIEW', 'KEPSTA_REVIEW', 'PPK_REVIEW'].includes(status)) return 'amber'
  return 'neutral'
}
function selectTab(key) {
  props.filters.status = key
  emit('apply')
}
function changePage(delta) {
  emit('page', Math.min(Math.max(props.page + delta, 0), totalPages.value - 1))
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
      <button class="button button-primary" type="submit">Terapkan</button>
      <button class="button button-quiet" type="button" @click="emit('reset')">
        <X :size="14" aria-hidden="true" /> Reset
      </button>
      <button class="button button-secondary hist-export" type="button" @click="emit('export')">
        <Download :size="14" aria-hidden="true" /> Ekspor CSV
      </button>
    </form>

    <section class="hist-table-panel">
      <table class="hist-table">
        <thead>
          <tr>
            <th>No pengajuan</th><th>Jenis</th><th>Tanggal cuti</th><th>Durasi</th>
            <th>Diajukan</th><th>Status</th><th>Tahap</th><th>Lampiran</th><th></th>
          </tr>
        </thead>
        <tbody v-if="items.length">
          <tr v-for="item in items" :key="item.id">
            <td>
              <button class="hist-link" type="button" @click="emit('open', item.id)">{{ item.request_number }}</button>
              <small>Diajukan {{ formatDate(item.submitted_at || item.created_at) }}</small>
            </td>
            <td>{{ item.leave_type_name }}</td>
            <td>{{ formatDate(item.start_date) }} s.d. {{ formatDate(item.end_date) }}</td>
            <td>{{ item.requested_working_days }} hari</td>
            <td>{{ formatDate(item.submitted_at || item.created_at) }}</td>
            <td><span class="hist-badge" :class="`hist-badge-${statusTone(item.status)}`">{{ statusLabel(item.status) }}</span></td>
            <td>{{ statusLabel(item.status) }}</td>
            <td><Paperclip :size="14" aria-hidden="true" /></td>
            <td><button class="hist-icon" type="button" :aria-label="`Buka ${item.request_number}`" @click="emit('open', item.id)">›</button></td>
          </tr>
        </tbody>
      </table>
      <p v-if="!items.length && !loading" class="hist-empty">Tidak ada pengajuan yang cocok dengan filter ini. Ubah filter atau tekan Reset.</p>
      <footer class="hist-pagination">
        <span>Menampilkan {{ total ? page * pageSize + 1 : 0 }}-{{ Math.min((page + 1) * pageSize, total) }} dari {{ total }} pengajuan</span>
        <div>
          <button class="hist-page" type="button" aria-label="Halaman sebelumnya" :disabled="page === 0" @click="changePage(-1)"><ChevronLeft :size="14" aria-hidden="true" /></button>
          <button v-for="n in totalPages" :key="n" class="hist-page" :class="{ active: page === n - 1 }" type="button" @click="emit('page', n - 1)">{{ n }}</button>
          <button class="hist-page" type="button" aria-label="Halaman berikutnya" :disabled="page >= totalPages - 1" @click="changePage(1)"><ChevronRight :size="14" aria-hidden="true" /></button>
        </div>
      </footer>
    </section>
  </section>
</template>

<style scoped>
.hist { --ink:#142f3a; --text:#3d525c; --muted:#5a6f78; --border:#e1e9f1; display:grid; gap:20px; min-width:0; }
.hist-tabs { display:flex; gap:24px; border-bottom:1px solid var(--border); overflow-x:auto; }
.hist-tab { height:40px; padding:0 0 10px; border:0; border-bottom:2px solid transparent; background:transparent; color:var(--muted); font-size:13px; white-space:nowrap; cursor:pointer; }
.hist-tab span { margin-left:4px; font-size:11px; font-weight:600; }
.hist-tab.active { border-bottom-color:#0d6efd; color:#0d6efd; font-weight:600; }
.hist-filters { display:flex; align-items:center; gap:12px; flex-wrap:wrap; padding:12px; border:1px solid var(--border); border-radius:12px; background:#fff; }
.hist-search { display:flex; align-items:center; gap:8px; width:300px; height:40px; padding:0 12px; border:1px solid #8494a1; border-radius:8px; color:#6e8590; }
.hist-search input { width:100%; border:0; outline:0; background:transparent; color:var(--text); font-size:13px; }
.hist-select select { width:180px; height:40px; padding:0 10px; border:1px solid #8494a1; border-radius:8px; background:#fff; color:var(--text); font-size:12px; cursor:pointer; }
.hist-filters .button { min-height:40px; }
.hist-export { margin-left:auto; }
.hist-table-panel { min-width:0; border:1px solid var(--border); border-radius:12px; background:#fff; overflow-x:auto; }
.hist-table { width:100%; border-collapse:collapse; min-width:1080px; }
.hist-table th { padding:16px 20px 12px; border-bottom:1px solid var(--border); color:var(--muted); font-size:9px; font-weight:600; letter-spacing:.04em; text-align:left; text-transform:uppercase; }
.hist-table td { padding:12px 20px; border-bottom:1px solid #edf2f7; color:var(--text); font-size:10.5px; }
.hist-link { padding:0; border:0; background:transparent; color:#0d6efd; font-size:10.5px; font-weight:600; cursor:pointer; }
.hist-link:hover { text-decoration:underline; }
.hist-table td small { display:block; margin-top:2px; color:var(--muted); font-size:9px; }
.hist-badge { display:inline-flex; align-items:center; height:20px; padding:0 8px; border-radius:10px; font-size:9px; font-weight:600; white-space:nowrap; }
.hist-badge-green { background:#e4f7ec; color:#0b6b45; }
.hist-badge-red { background:#fde9e9; color:#a11d1d; }
.hist-badge-amber { background:#fff6de; color:#8a5a00; }
.hist-badge-neutral { background:#edf2f6; color:var(--text); }
.hist-icon { width:28px; height:28px; border:0; border-radius:8px; background:transparent; color:var(--muted); font-size:18px; cursor:pointer; }
.hist-icon:hover { background:#f7f9fc; }
.hist-empty { margin:0; padding:40px 20px; text-align:center; color:var(--muted); font-size:13px; }
.hist-pagination { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:12px 20px; color:var(--muted); font-size:11px; }
.hist-pagination > div { display:flex; gap:4px; }
.hist-page { min-width:28px; height:28px; padding:0 6px; border:0; border-radius:8px; background:transparent; color:var(--muted); font-size:11px; cursor:pointer; }
.hist-page.active { background:#e9f1ff; color:#0b5ed7; font-weight:600; }
.hist-page:hover:not(:disabled):not(.active) { background:#f7f9fc; }
.hist-page:disabled { opacity:.45; cursor:not-allowed; }
@media (max-width:640px){ .hist-filters > label { flex:1 1 100%; } .hist-search,.hist-select select { width:100%; } .hist-pagination{ flex-direction:column; align-items:flex-start; } }
</style>
