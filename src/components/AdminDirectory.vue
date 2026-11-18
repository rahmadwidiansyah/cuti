<script setup>
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import {
  AlertCircle,
  ArrowLeft,
  Building2,
  CalendarCheck,
  CalendarClock,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Eye,
  Save,
  Search,
  Users,
  FileText,
  Clock,
  History,
} from 'lucide-vue-next'
const emit = defineEmits(['open-request'])

const loading = ref(false)
const error = ref('')
const notice = ref('')
const items = ref([])
const summary = ref({ total: 0, on_leave: 0, upcoming: 0, units: 0, available_days: 0 })
const units = ref([])
const categories = ref([])
const years = ref([])
const year = ref(new Date().getFullYear())

const draft = reactive({ q: '', unitId: '', category: '', leaveStatus: '' })
const applied = reactive({ q: '', unitId: '', category: '', leaveStatus: '' })
const page = ref(0)
const pageSize = 6

const selectedEmployeeId = ref(null)
const detail = ref(null)
const detailLoading = ref(false)
const detailError = ref('')

const adjustForm = reactive({ deltaDays: '', reason: '', reference: '', submitting: false })
const allocateForm = reactive({ days: 12, reason: 'Alokasi awal kuota cuti tahunan', submitting: false })

// Riwayat pengajuan cuti
const leaveHistory = ref([])
const leaveHistoryLoading = ref(false)

const leaveStatusLabel = { ON_LEAVE: 'Sedang cuti', UPCOMING: 'Cuti berikutnya', NONE: 'Tidak cuti' }
const statusLabel = (status) => ({
  DRAFT: 'Draf', SUBMITTED: 'Menunggu verifikasi', ADMIN_REVIEW: 'Menunggu verifikasi',
  ADMIN_VERIFIED: 'Terverifikasi', PERTIMBANGAN_REVIEW: 'Pertimbangan SDM',
  KASUBAG_REVIEW: 'Antrean Kasubag', KEPSTA_REVIEW: 'Antrean Kepsta',
  PPK_REVIEW: 'Antrean PPK', RETURNED_FOR_REVISION: 'Dikembalikan',
  APPROVED: 'Disetujui', REJECTED: 'Ditolak', WITHDRAWN: 'Dibatalkan pegawai',
  CANCELLED: 'Dibatalkan Admin'
})[status] || status || '—'
const categoryLabel = {
  PNS_TU: 'PNS · TU',
  PNS: 'PNS · non-TU',
  PPPK_PPNPN_TU: 'PPPK/PPNPN · TU',
  PPPK_PPNPN: 'PPPK/PPNPN · non-TU',
  KONTRAK: 'Kontrak',
}
const transactionLabels = {
  ALLOCATION: 'Alokasi kuota',
  CARRY_OVER: 'Carry-over',
  ADJUSTMENT: 'Penyesuaian',
  RESERVATION: 'Reservasi',
  RELEASE: 'Pelepasan reservasi',
  CONSUMPTION: 'Pemakaian cuti',
  RESTORATION: 'Pemulihan saldo',
}
const monthShort = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des']
const nf = new Intl.NumberFormat('id-ID')

const filtered = computed(() => {
  const term = applied.q.trim().toLocaleLowerCase('id')
  return items.value.filter((item) => {
    if (term && ![item.fullName, item.identity, item.unitName, item.positionName]
      .some(value => String(value || '').toLocaleLowerCase('id').includes(term))) return false
    if (applied.unitId && String(item.unitId) !== applied.unitId) return false
    if (applied.category && item.category !== applied.category) return false
    if (applied.leaveStatus && item.leaveStatus !== applied.leaveStatus) return false
    return true
  })
})
const totalPages = computed(() => Math.max(1, Math.ceil(filtered.value.length / pageSize)))
const paged = computed(() => filtered.value.slice(page.value * pageSize, (page.value + 1) * pageSize))
const firstShown = computed(() => filtered.value.length ? page.value * pageSize + 1 : 0)
const lastShown = computed(() => Math.min((page.value + 1) * pageSize, filtered.value.length))

const balance = computed(() => detail.value?.balance || null)
const canAdjust = computed(() => Boolean(detail.value?.canAdjust))
const previewAvailable = computed(() => Number(balance.value?.availableDays || 0) + Number(adjustForm.deltaDays || 0))
const deltaNumber = computed(() => Number(adjustForm.deltaDays || 0))
const adjustmentValid = computed(() =>
  Number.isInteger(deltaNumber.value)
  && deltaNumber.value !== 0
  && adjustForm.reason.trim().length >= 10
  && previewAvailable.value >= 0,
)
const adjustmentHint = computed(() => {
  if (adjustForm.deltaDays === '' || adjustForm.deltaDays === null) return 'Isi jumlah hari. Gunakan angka negatif untuk mengurangi kuota.'
  if (!Number.isInteger(deltaNumber.value) || deltaNumber.value === 0) return 'Perubahan harus bilangan bulat dan tidak boleh nol.'
  if (previewAvailable.value < 0) return `Saldo tersedia hanya ${balance.value?.availableDays ?? 0} hari, pengurangan ini membuat saldo negatif.`
  if (adjustForm.reason.trim().length < 10) return 'Alasan wajib diisi minimal 10 karakter agar perubahan dapat diaudit.'
  return ''
})

function num(value) {
  if (value === null || value === undefined || value === '') return '—'
  return nf.format(Number(value))
}

function signed(value) {
  const number = Number(value || 0)
  return number > 0 ? `+${nf.format(number)}` : nf.format(number)
}

function initials(name) {
  return String(name || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0].toUpperCase())
    .join('') || '?'
}

function formatRange(item) {
  const leave = item.currentLeave
  if (!leave?.startDate) return '-'
  const start = new Date(`${String(leave.startDate).slice(0, 10)}T12:00:00Z`)
  const end = new Date(`${String(leave.endDate).slice(0, 10)}T12:00:00Z`)
  if (Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf())) return '-'
  const part = (date) => `${date.getUTCDate()} ${monthShort[date.getUTCMonth()]}`
  return `${part(start)}-${part(end)} ${end.getUTCFullYear()}`
}

function dateText(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return '—'
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function formatDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return '—'
  return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }).format(date)
}

function formatDateTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return '—'
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(date)
}

function transactionLabel(type) {
  return transactionLabels[type] || type || '—'
}

function transactionTone(days) {
  if (Number(days) > 0) return 'success'
  if (Number(days) < 0) return 'danger'
  return 'neutral'
}

async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    const failure = new Error(data?.error || `Permintaan gagal (${response.status}).`)
    failure.details = data?.details || null
    throw failure
  }
  return data
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const result = await api(`/directory?year=${year.value}&limit=50`)
    items.value = result.items || []
    summary.value = result.summary || summary.value
    units.value = result.units || []
    categories.value = result.categories || []
    years.value = (result.years || []).map(Number)
    if (!years.value.includes(year.value)) {
      years.value = [...years.value, year.value].sort((a, b) => b - a)
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Gagal memuat direktori pegawai.'
  } finally {
    loading.value = false
  }
}

async function loadDetail() {
  if (!selectedEmployeeId.value) return
  detailLoading.value = true
  detailError.value = ''
  try {
    detail.value = await api(`/directory/${selectedEmployeeId.value}?year=${year.value}`)
    if (!detail.value.balance) allocateForm.days = 12
    await loadLeaveHistory()
  } catch (cause) {
    detailError.value = cause instanceof Error ? cause.message : 'Gagal memuat rincian pegawai.'
  } finally {
    detailLoading.value = false
  }
}

async function loadLeaveHistory() {
  if (!selectedEmployeeId.value) return
  leaveHistoryLoading.value = true
  try {
    const result = await api(`/requests?employee_id=${selectedEmployeeId.value}&year=${year.value}&limit=50`)
    // API mengembalikan snake_case; normalisasi ke camelCase untuk template
    leaveHistory.value = (result.items || []).map(item => ({
      id: item.id,
      requestNumber: item.request_number,
      leaveTypeName: item.leave_type_name,
      startDate: item.start_date,
      endDate: item.end_date,
      requestedWorkingDays: item.requested_working_days,
      status: item.status,
      submittedAt: item.submitted_at,
    }))
  } catch (cause) {
    console.warn('Gagal memuat riwayat pengajuan:', cause)
    leaveHistory.value = []
  } finally {
    leaveHistoryLoading.value = false
  }
}

function applyFilters() {
  Object.assign(applied, draft)
  page.value = 0
}

function resetFilters() {
  Object.assign(draft, { q: '', unitId: '', category: '', leaveStatus: '' })
  Object.assign(applied, { q: '', unitId: '', category: '', leaveStatus: '' })
  page.value = 0
}

async function changeYear(event) {
  const next = Number(event.target.value)
  if (!Number.isInteger(next) || next === year.value) return
  year.value = next
  page.value = 0
  notice.value = ''
  detailError.value = ''
  await load()
  if (selectedEmployeeId.value) await loadDetail()
}

function changePage(delta) {
  page.value = Math.min(Math.max(page.value + delta, 0), totalPages.value - 1)
}

async function openDetail(item) {
  selectedEmployeeId.value = item.employeeId
  detail.value = null
  notice.value = ''
  detailError.value = ''
  Object.assign(adjustForm, { deltaDays: '', reason: '', reference: '', submitting: false })
  Object.assign(allocateForm, { days: 12, reason: 'Alokasi awal kuota cuti tahunan', submitting: false })
  await loadDetail()
}

function closeDetail() {
  selectedEmployeeId.value = null
  detail.value = null
  detailLoading.value = false
  detailError.value = ''
  notice.value = ''
  leaveHistory.value = []
  Object.assign(adjustForm, { deltaDays: '', reason: '', reference: '', submitting: false })
}

function selectHistoryRequest(requestId) {
  emit('open-request', requestId)
}

function makeIdempotencyKey(prefix) {
  const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${prefix}:${selectedEmployeeId.value}:${year.value}:${random}`
}

async function submitAdjustment() {
  if (!selectedEmployeeId.value || adjustForm.submitting) return
  detailError.value = ''
  notice.value = ''
  if (!adjustmentValid.value) {
    detailError.value = adjustmentHint.value || 'Periksa kembali isian penyesuaian.'
    return
  }
  adjustForm.submitting = true
  try {
    const result = await api(`/admin/balances/${selectedEmployeeId.value}/adjustment`, {
      method: 'POST',
      body: JSON.stringify({
        year: year.value,
        deltaDays: deltaNumber.value,
        reason: adjustForm.reason.trim(),
        reference: adjustForm.reference.trim() || null,
        idempotencyKey: makeIdempotencyKey('ADJ'),
      }),
    })
    notice.value = result.message || 'Penyesuaian kuota tersimpan.'
    Object.assign(adjustForm, { deltaDays: '', reason: '', reference: '', submitting: false })
    await Promise.all([loadDetail(), load()])
  } catch (cause) {
    detailError.value = cause instanceof Error ? cause.message : 'Gagal menyimpan penyesuaian.'
  } finally {
    adjustForm.submitting = false
  }
}

async function submitAllocation() {
  if (!selectedEmployeeId.value || allocateForm.submitting) return
  detailError.value = ''
  notice.value = ''
  if (!Number.isInteger(Number(allocateForm.days)) || Number(allocateForm.days) < 1 || Number(allocateForm.days) > 365) {
    detailError.value = 'Jumlah hari alokasi harus bilangan bulat antara 1 dan 365.'
    return
  }
  allocateForm.submitting = true
  try {
    const result = await api(`/admin/balances/${selectedEmployeeId.value}/allocation`, {
      method: 'POST',
      body: JSON.stringify({
        year: year.value,
        days: Number(allocateForm.days),
        reason: allocateForm.reason.trim(),
      }),
    })
    notice.value = result.message || 'Saldo berhasil dialokasikan.'
    await Promise.all([loadDetail(), load()])
  } catch (cause) {
    detailError.value = cause instanceof Error ? cause.message : 'Gagal mengalokasikan saldo.'
  } finally {
    allocateForm.submitting = false
  }
}

function exportCsv() {
  const rows = [
    ['ID pegawai', 'Nama pegawai', 'Kategori', 'Unit kerja', 'Periode', 'Kuota awal', 'Penyesuaian', 'Carry-over', 'Terpakai', 'Reservasi', 'Sisa tahunan', 'Pemakaian sakit', 'Pemakaian alasan penting', 'Status cuti', 'Cuti aktif atau berikutnya'],
    ...filtered.value.map(item => [
      item.identity, item.fullName, categoryLabel[item.category] || item.category, item.unitName || '',
      item.balanceId ? (item.periodYear ?? year.value) : year.value,
      item.balanceId ? item.allocatedDays ?? '-' : '-',
      item.balanceId ? item.adjustmentDays ?? '-' : '-',
      item.balanceId ? item.carryOverDays ?? '-' : '-',
      item.balanceId ? item.usedDays ?? '-' : '-',
      item.balanceId ? item.reservedDays ?? '-' : '-',
      item.balanceId ? item.availableDays ?? '-' : '-',
      item.sickDaysUsed ?? '-', item.importantReasonDaysUsed ?? '-',
      leaveStatusLabel[item.leaveStatus] || item.leaveStatus || '', formatRange(item),
    ]),
  ]
  const csv = rows.map(row => row.map(value => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `direktori-pegawai-${year.value}.csv`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function onKeydown(event) {
  if (event.key === 'Escape' && selectedEmployeeId.value) closeDetail()
}

onMounted(() => {
  load()
  window.addEventListener('keydown', onKeydown)
})
onUnmounted(() => window.removeEventListener('keydown', onKeydown))

defineExpose({ exportCsv })
</script>

<template>
  <section class="admin-directory">
    <template v-if="!selectedEmployeeId">
      <p v-if="error" class="ad-error" role="alert">
        {{ error }}
        <button class="text-button" type="button" @click="load">Coba lagi</button>
      </p>
      <p v-if="loading && !items.length" class="ad-loading" role="status">Memuat direktori pegawai…</p>

      <div class="ad-metrics">
        <article class="ad-metric">
          <div>
            <p>Total pegawai</p>
            <strong>{{ summary.total || 0 }} <span>pegawai</span></strong>
            <small>{{ num(summary.available_days) }} hari tersedia</small>
          </div>
          <span class="ad-icon tone-blue"><Users :size="16" aria-hidden="true" /></span>
        </article>
        <article class="ad-metric">
          <div><p>Sedang cuti</p><strong>{{ summary.on_leave || 0 }} <span>pegawai</span></strong></div>
          <span class="ad-icon tone-red"><CalendarCheck :size="16" aria-hidden="true" /></span>
        </article>
        <article class="ad-metric">
          <div><p>Cuti berikutnya</p><strong>{{ summary.upcoming || 0 }} <span>pengajuan</span></strong></div>
          <span class="ad-icon tone-green"><CalendarClock :size="16" aria-hidden="true" /></span>
        </article>
        <article class="ad-metric">
          <div><p>Unit kerja</p><strong>{{ summary.units || 0 }} <span>unit</span></strong></div>
          <span class="ad-icon tone-amber"><Building2 :size="16" aria-hidden="true" /></span>
        </article>
      </div>

      <form class="ad-filters" @submit.prevent="applyFilters">
        <label class="ad-select ad-year">
          <span class="sr-only">Periode tahun</span>
          <select :value="year" @change="changeYear">
            <option v-for="option in years" :key="option" :value="option">Periode {{ option }}</option>
          </select>
          <ChevronDown :size="14" aria-hidden="true" />
        </label>
        <label class="ad-search">
          <Search :size="14" aria-hidden="true" />
          <span class="sr-only">Cari nama pegawai</span>
          <input v-model="draft.q" type="search" placeholder="Cari nama atau NIP…" />
        </label>
        <label class="ad-select">
          <span class="sr-only">Unit kerja</span>
          <select v-model="draft.unitId">
            <option value="">Semua unit kerja</option>
            <option v-for="unit in units" :key="unit.id" :value="String(unit.id)">{{ unit.unit_name }}</option>
          </select>
          <ChevronDown :size="14" aria-hidden="true" />
        </label>
        <label class="ad-select">
          <span class="sr-only">Kategori pegawai</span>
          <select v-model="draft.category">
            <option value="">Semua kategori</option>
            <option v-for="category in categories" :key="category.code" :value="category.code">
              {{ categoryLabel[category.code] || category.code }}
            </option>
          </select>
          <ChevronDown :size="14" aria-hidden="true" />
        </label>
        <label class="ad-select">
          <span class="sr-only">Status cuti</span>
          <select v-model="draft.leaveStatus">
            <option value="">Semua status cuti</option>
            <option value="ON_LEAVE">Sedang cuti</option>
            <option value="UPCOMING">Cuti berikutnya</option>
            <option value="NONE">Tidak cuti</option>
          </select>
          <ChevronDown :size="14" aria-hidden="true" />
        </label>
        <button class="button button-primary" type="submit">Terapkan</button>
        <button class="button button-quiet" type="button" @click="resetFilters">Reset</button>
      </form>

      <section class="ad-table-panel" aria-label="Daftar pegawai dan saldo cuti">
        <table class="ad-table">
          <thead>
            <tr>
              <th>ID peg.</th><th>Pegawai</th><th>Unit kerja</th><th>Kuota tahunan</th>
              <th>Sisa tahunan</th><th>Pemakaian<br />sakit</th><th>Pemakaian<br />alasan penting</th>
              <th>Status cuti</th><th>Cuti aktif / berikutnya</th><th aria-label="Lihat"></th>
            </tr>
          </thead>
          <tbody v-if="paged.length">
            <tr v-for="item in paged" :key="item.employeeId">
              <td class="ad-identity">{{ item.identity || '-' }}</td>
              <td>
                <div class="ad-person">
                  <span class="ad-avatar" aria-hidden="true">{{ initials(item.fullName) }}</span>
                  <span>
                    <strong>{{ item.fullName }}</strong>
                    <small>{{ categoryLabel[item.category] || item.category }} · {{ item.profession || item.positionName || '-' }}</small>
                  </span>
                </div>
              </td>
              <td>{{ item.unitName || '-' }}</td>
              <td>
                <template v-if="item.balanceId">
                  <strong class="ad-days">{{ num(item.allocatedDays) }} hari</strong>
                  <small class="ad-days-note" :class="{ 'ad-positive': Number(item.adjustmentDays) > 0, 'ad-negative': Number(item.adjustmentDays) < 0 }">
                    Penyesuaian {{ signed(item.adjustmentDays) }}
                  </small>
                </template>
                <span v-else class="ad-badge">Belum dialokasikan</span>
              </td>
              <td>
                <span v-if="item.balanceId" class="ad-available" :class="{ 'ad-available-empty': Number(item.availableDays) <= 0 }">
                  {{ num(item.availableDays) }} hari
                </span>
                <span v-else>-</span>
              </td>
              <td>{{ item.sickDaysUsed ?? '-' }} hari</td>
              <td>{{ item.importantReasonDaysUsed ?? '-' }} hari</td>
              <td>
                <span class="ad-status" :class="`ad-status-${String(item.leaveStatus).toLowerCase()}`">
                  {{ leaveStatusLabel[item.leaveStatus] || '-' }}
                </span>
              </td>
              <td><span class="ad-leave-range">{{ formatRange(item) }}</span></td>
              <td>
                <button class="ad-icon-button" type="button" :aria-label="`Lihat detail ${item.fullName}`" @click="openDetail(item)">
                  <Eye :size="14" aria-hidden="true" />
                </button>
              </td>
            </tr>
          </tbody>
        </table>

        <div v-if="paged.length" class="ad-cards">
          <article v-for="item in paged" :key="`card-${item.employeeId}`" class="ad-card">
            <div class="ad-card-head">
              <span class="ad-avatar" aria-hidden="true">{{ initials(item.fullName) }}</span>
              <div class="ad-card-person">
                <strong>{{ item.fullName }}</strong>
                <small>{{ item.identity || 'NIP tidak tersedia' }}</small>
                <small>{{ categoryLabel[item.category] || item.category }} · {{ item.unitName || 'Unit tidak tersedia' }}</small>
              </div>
              <span class="ad-status" :class="`ad-status-${String(item.leaveStatus).toLowerCase()}`">
                {{ leaveStatusLabel[item.leaveStatus] || '-' }}
              </span>
            </div>
            <dl class="ad-card-facts">
              <div><dt>Kuota</dt><dd>{{ item.balanceId ? `${num(item.allocatedDays)} hari` : '—' }}</dd></div>
              <div><dt>Penyesuaian</dt><dd :class="{ 'ad-positive': Number(item.adjustmentDays) > 0, 'ad-negative': Number(item.adjustmentDays) < 0 }">{{ item.balanceId ? signed(item.adjustmentDays) : '—' }}</dd></div>
              <div><dt>Terpakai</dt><dd>{{ item.balanceId ? num(item.usedDays) : '—' }}</dd></div>
              <div><dt>Sisa</dt><dd>{{ item.balanceId ? num(item.availableDays) : '—' }}</dd></div>
            </dl>
            <p class="ad-card-leave">{{ formatRange(item) }}</p>
            <button class="button button-small button-secondary" type="button" @click="openDetail(item)">
              <Eye :size="14" aria-hidden="true" /> Lihat detail
            </button>
          </article>
        </div>

        <p v-if="!paged.length && !loading" class="ad-empty">
          {{ items.length ? 'Tidak ada pegawai yang cocok dengan filter ini. Ubah filter atau tekan Reset.' : 'Belum ada data pegawai dalam lingkup akses Anda.' }}
        </p>
        <footer class="ad-pagination">
          <span>Menampilkan {{ firstShown }}-{{ lastShown }} dari {{ filtered.length }} pegawai</span>
          <div>
            <button class="ad-page-button" type="button" aria-label="Halaman sebelumnya" :disabled="page === 0" @click="changePage(-1)">
              <ChevronLeft :size="14" aria-hidden="true" />
            </button>
            <button
              v-for="n in totalPages"
              :key="n"
              class="ad-page-button"
              :class="{ active: page === n - 1 }"
              type="button"
              :aria-label="`Halaman ${n}`"
              @click="page = n - 1"
            >{{ n }}</button>
            <button class="ad-page-button" type="button" aria-label="Halaman berikutnya" :disabled="page >= totalPages - 1" @click="changePage(1)">
              <ChevronRight :size="14" aria-hidden="true" />
            </button>
          </div>
        </footer>
      </section>
    </template>

    <template v-else>
      <div class="ad-detail-heading">
        <button class="button button-quiet button-small" type="button" @click="closeDetail">
          <ArrowLeft :size="15" aria-hidden="true" /> Kembali ke daftar
        </button>
        <label class="ad-select ad-year ad-year-inline">
          <span class="sr-only">Periode tahun</span>
          <select :value="year" @change="changeYear">
            <option v-for="option in years" :key="option" :value="option">Periode {{ option }}</option>
          </select>
          <ChevronDown :size="14" aria-hidden="true" />
        </label>
      </div>

      <p v-if="notice" class="ad-alert ad-alert-success" role="status">{{ notice }}</p>
      <p v-if="detailError" class="ad-alert ad-alert-danger" role="alert">{{ detailError }}</p>
      <p v-if="detailLoading && !detail" class="ad-loading" role="status">Memuat rincian pegawai…</p>

      <template v-if="detail && !detailLoading">
        <section class="ad-person-card">
          <span class="ad-avatar ad-avatar-lg" aria-hidden="true">{{ initials(detail.employee.fullName) }}</span>
          <div class="ad-person-identity">
            <h2>{{ detail.employee.fullName }}</h2>
            <p>{{ detail.employee.identity || 'NIP tidak tersedia' }} · {{ categoryLabel[detail.employee.category] || detail.employee.category }}</p>
            <p>{{ detail.employee.unitName || 'Unit tidak tersedia' }} · {{ detail.employee.positionName || 'Jabatan tidak tersedia' }}</p>
            <p v-if="detail.employee.teamNames">Tim kerja: {{ detail.employee.teamNames }}</p>
          </div>
          <div class="ad-person-badges">
            <span class="ad-badge" :class="detail.employee.employmentStatus === 'ACTIVE' ? 'ad-badge-success' : 'ad-badge-neutral'">
              {{ detail.employee.employmentStatus === 'ACTIVE' ? 'Aktif' : 'Nonaktif' }}
            </span>
            <span class="ad-status" :class="`ad-status-${String(detail.employee.leaveStatus).toLowerCase()}`">
              {{ leaveStatusLabel[detail.employee.leaveStatus] || '-' }}
            </span>
          </div>
        </section>

        <div class="ad-detail-grid">
          <div class="ad-detail-main">
            <section class="ad-panel ad-balance-panel">
              <header class="ad-panel-heading">
                <div>
                  <h3>Saldo cuti tahunan {{ detail.periodYear }}</h3>
                  <p>Perubahan hanya lewat transaksi ledger agar dapat diaudit.</p>
                </div>
              </header>

              <template v-if="balance">
                <div class="ad-hero">
                  <div class="ad-hero-available">
                    <span>Tersedia</span>
                    <strong>{{ num(balance.availableDays) }}</strong>
                    <small>hari</small>
                  </div>
                  <div class="ad-composition">
                    <div><span>Kuota awal</span><strong>{{ num(balance.allocatedDays) }}</strong></div>
                    <div><span>Penyesuaian</span><strong :class="{ 'ad-positive': Number(balance.adjustmentDays) > 0, 'ad-negative': Number(balance.adjustmentDays) < 0 }">{{ signed(balance.adjustmentDays) }}</strong></div>
                    <div><span>Carry-over</span><strong>{{ num(balance.carryOverDays) }}</strong></div>
                    <div><span>Terpakai</span><strong>{{ num(balance.usedDays) }}</strong></div>
                    <div><span>Reservasi</span><strong>{{ num(balance.reservedDays) }}</strong></div>
                  </div>
                </div>
                <p class="ad-formula">Saldo tersedia = kuota awal + penyesuaian + carry-over − terpakai − reservasi.</p>
              </template>

              <div v-else class="ad-empty-state">
                <span class="ad-icon tone-amber"><AlertCircle :size="18" aria-hidden="true" /></span>
                <div>
                  <strong>Saldo belum dialokasikan</strong>
                  <p>{{ canAdjust ? 'Alokasikan kuota awal terlebih dahulu. Setelah itu penyesuaian dapat dicatat sebagai transaksi ledger.' : 'Pegawai ini belum memiliki saldo cuti tahunan untuk periode tersebut.' }}</p>
                </div>
              </div>
            </section>

            <section v-if="balance && canAdjust" class="ad-panel">
              <header class="ad-panel-heading">
                <div>
                  <h3>Riwayat transaksi</h3>
                  <p>Urut terbaru. Saldo berjalan dihitung dari seluruh transaksi periode ini.</p>
                </div>
              </header>
              <div v-if="detail.ledger.length" class="ad-ledger-wrap">
                <table class="ad-ledger">
                  <thead>
                    <tr>
                      <th>Tanggal</th>
                      <th>Transaksi</th>
                      <th class="ad-number">Perubahan</th>
                      <th class="ad-number">Saldo</th>
                      <th>Alasan</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="entry in detail.ledger" :key="entry.id">
                      <td class="ad-nowrap">{{ dateText(entry.occurredAt) }}</td>
                      <td>
                        <strong>{{ transactionLabel(entry.transactionType) }}</strong>
                        <small v-if="entry.requestNumber">{{ entry.requestNumber }}</small>
                      </td>
                      <td class="ad-number">
                        <span class="ad-delta" :class="`tone-${transactionTone(entry.days)}`">{{ signed(entry.days) }}</span>
                      </td>
                      <td class="ad-number">{{ num(entry.balanceAfter) }}</td>
                      <td>
                        <span class="ad-reason">{{ entry.reason || '—' }}</span>
                        <small v-if="entry.availableBefore !== null">Saldo {{ num(entry.availableBefore) }} → {{ num(entry.availableAfter) }}</small>
                        <small v-if="entry.actorName">oleh {{ entry.actorName }}</small>
                        <small v-if="entry.reference">Referensi: {{ entry.reference }}</small>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p v-else class="ad-empty">Belum ada transaksi pada periode ini.</p>
            </section>

            <!-- Riwayat pengajuan cuti -->
            <section class="ad-panel">
              <header class="ad-panel-heading">
                <div>
                  <h3><History :size="16" /> Riwayat pengajuan cuti</h3>
                  <p>Klik pengajuan untuk melihat detail, alasan, lampiran, dan pratinjau formulir.</p>
                </div>
              </header>
              <div v-if="leaveHistoryLoading" class="ad-history-loading">
                <span class="ad-spinner" aria-hidden="true"></span>
                <span>Memuat riwayat…</span>
              </div>
              <div v-else-if="leaveHistory.length" class="ad-history-list">
                <div
                  v-for="req in leaveHistory"
                  :key="req.id"
                  class="ad-history-item"
                  @click="selectHistoryRequest(req.id)"
                >
                  <div class="ad-history-main">
                    <div class="ad-history-header">
                      <strong>{{ req.requestNumber }}</strong>
                      <span class="ad-history-status" :class="`ad-status-${String(req.status).toLowerCase()}`">
                        {{ statusLabel(req.status) }}
                      </span>
                    </div>
                    <div class="ad-history-meta">
                      <span><FileText :size="12" /> {{ req.leaveTypeName }}</span>
                      <span><Clock :size="12" /> {{ formatDate(req.startDate) }} – {{ formatDate(req.endDate) }}</span>
                      <span>{{ req.requestedWorkingDays }} hari kerja</span>
                      <span v-if="req.submittedAt"><CalendarClock :size="12" /> Diajukan {{ formatDateTime(req.submittedAt) }}</span>
                    </div>
                  </div>
                  <div class="ad-history-actions">
                    <span class="ad-history-go" aria-hidden="true">
                      <ChevronRight :size="14" />
                    </span>
                  </div>
                </div>
              </div>
              <p v-else class="ad-empty">Belum ada pengajuan cuti pada periode ini.</p>
            </section>
          </div>

          <aside class="ad-detail-side">
            <section class="ad-panel">
              <header class="ad-panel-heading">
                <div>
                  <h3>Jadwal cuti</h3>
                  <p>Cuti tahunan yang sedang berjalan atau berikutnya.</p>
                </div>
              </header>
              <div class="ad-leave-summary">
                <span class="ad-status" :class="`ad-status-${String(detail.employee.leaveStatus).toLowerCase()}`">
                  {{ leaveStatusLabel[detail.employee.leaveStatus] || '-' }}
                </span>
                <strong v-if="detail.employee.currentLeave">{{ formatRange(detail.employee) }}</strong>
                <p v-else>Tidak ada cuti aktif atau berikutnya.</p>
                <small v-if="detail.employee.currentLeave">{{ detail.employee.currentLeave.requestNumber }}</small>
              </div>
            </section>

            <section v-if="canAdjust && balance" class="ad-panel ad-form-panel">
              <header class="ad-panel-heading">
                <div>
                  <h3>Penyesuaian kuota</h3>
                  <p>Tambah atau kurangi saldo dengan alasan yang dapat diaudit.</p>
                </div>
              </header>

              <form class="ad-form" @submit.prevent="submitAdjustment">
                <div class="ad-field">
                  <label for="ad-delta">Perubahan (hari)</label>
                  <input
                    id="ad-delta"
                    v-model="adjustForm.deltaDays"
                    type="number"
                    step="1"
                    min="-365"
                    max="365"
                    inputmode="numeric"
                    placeholder="Contoh: 2 atau -1"
                    :disabled="adjustForm.submitting"
                    aria-describedby="ad-delta-hint"
                  />
                  <small id="ad-delta-hint" class="ad-field-hint">Gunakan angka negatif untuk mengurangi kuota.</small>
                </div>

                <div class="ad-field">
                  <label for="ad-reason">Alasan <span aria-hidden="true">*</span></label>
                  <textarea
                    id="ad-reason"
                    v-model="adjustForm.reason"
                    rows="4"
                    maxlength="500"
                    placeholder="Contoh: Koreksi sisa cuti tahun 2025 berdasarkan surat keputusan."
                    :disabled="adjustForm.submitting"
                    required
                  ></textarea>
                  <small class="ad-field-hint">{{ adjustForm.reason.length }}/500 · minimal 10 karakter</small>
                </div>

                <div class="ad-field">
                  <label for="ad-reference">Referensi dokumen <span class="ad-optional">(opsional)</span></label>
                  <input
                    id="ad-reference"
                    v-model="adjustForm.reference"
                    type="text"
                    maxlength="200"
                    placeholder="Nomor surat atau dasar penyesuaian"
                    :disabled="adjustForm.submitting"
                  />
                </div>

                <div class="ad-preview" :class="{ 'ad-preview-danger': previewAvailable < 0 }">
                  <div>
                    <span>Tersedia saat ini</span>
                    <strong>{{ num(balance.availableDays) }} hari</strong>
                  </div>
                  <div>
                    <span>Setelah penyesuaian</span>
                    <strong>{{ num(previewAvailable) }} hari</strong>
                  </div>
                </div>

                <p v-if="adjustmentHint" class="ad-form-hint" :class="{ 'ad-form-hint-danger': previewAvailable < 0 }">
                  <AlertCircle :size="14" aria-hidden="true" /> {{ adjustmentHint }}
                </p>

                <button class="button button-primary ad-submit" type="submit" :disabled="!adjustmentValid || adjustForm.submitting">
                  <Save :size="15" aria-hidden="true" />
                  {{ adjustForm.submitting ? 'Menyimpan…' : 'Simpan penyesuaian' }}
                </button>
              </form>
            </section>

            <section v-else-if="canAdjust" class="ad-panel ad-form-panel">
              <header class="ad-panel-heading">
                <div>
                  <h3>Alokasikan saldo</h3>
                  <p>Buat saldo awal untuk periode {{ detail.periodYear }}.</p>
                </div>
              </header>
              <form class="ad-form" @submit.prevent="submitAllocation">
                <div class="ad-field">
                  <label for="ad-allocate-days">Kuota awal (hari)</label>
                  <input id="ad-allocate-days" v-model.number="allocateForm.days" type="number" step="1" min="1" max="365" :disabled="allocateForm.submitting" />
                </div>
                <div class="ad-field">
                  <label for="ad-allocate-reason">Alasan</label>
                  <input id="ad-allocate-reason" v-model="allocateForm.reason" type="text" maxlength="500" :disabled="allocateForm.submitting" />
                </div>
                <button class="button button-primary ad-submit" type="submit" :disabled="allocateForm.submitting">
                  <Save :size="15" aria-hidden="true" />
                  {{ allocateForm.submitting ? 'Menyimpan…' : 'Alokasikan saldo' }}
                </button>
              </form>
            </section>

            <section v-else class="ad-panel">
              <header class="ad-panel-heading">
                <div>
                  <h3>Penyesuaian kuota</h3>
                  <p>Hanya Admin yang dapat menambah atau mengurangi kuota cuti tahunan.</p>
                </div>
              </header>
            </section>
          </aside>
        </div>
      </template>
    </template>
  </section>
</template>

<style scoped>
.admin-directory {
  --ink: #142f3a;
  --text: #3d525c;
  --muted: #5a6f78;
  --border: #e1e9f1;
  --divider: #edf2f7;
  --blue: #0d6efd;
  display: grid;
  gap: 20px;
  min-width: 0;
}

.ad-error { margin: 0; padding: 12px 16px; border-radius: 10px; background: #fde9e9; color: #a11d1d; font-size: 13px; }
.ad-loading { margin: 0; color: var(--muted); font-size: 13px; }

.ad-metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; }
.ad-metric {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;
  min-height: 72px; padding: 12px 16px;
  border: 1px solid var(--border); border-radius: 12px; background: #fff;
}
.ad-metric p { margin: 0 0 2px; color: var(--muted); font-size: 10.5px; font-weight: 500; }
.ad-metric strong { color: var(--ink); font-size: 26px; font-weight: 700; line-height: 1.15; }
.ad-metric strong span { color: var(--muted); font-size: 10.5px; font-weight: 500; }
.ad-metric small { display: block; margin-top: 4px; color: var(--muted); font-size: 10px; }
.ad-icon { width: 34px; height: 34px; flex: 0 0 auto; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; }
.tone-blue { background: #e9f1ff; color: #1b4fbf; }
.tone-red { background: #fde9e9; color: #a11d1d; }
.tone-green { background: #e4f7ec; color: #0b6b45; }
.tone-amber { background: #fff6de; color: #8a5a00; }
.tone-teal { background: #e3f4f1; color: #0a6b60; }
.tone-success { background: #e4f7ec; color: #0b6b45; }
.tone-danger { background: #fde9e9; color: #a11d1d; }
.tone-neutral { background: #edf2f6; color: #5a6f78; }

.ad-filters {
  display: flex; align-items: center; flex-wrap: wrap; gap: 10px;
  padding: 12px; border: 1px solid var(--border); border-radius: 12px; background: #fff;
}
.ad-filters > label { min-width: 0; position: relative; }
.ad-search {
  display: flex; align-items: center; gap: 8px;
  width: 260px; height: 40px; padding: 0 12px;
  border: 1px solid #8494a1; border-radius: 8px; color: #6e8590; background: #fff;
}
.ad-search input { width: 100%; border: 0; outline: 0; background: transparent; color: var(--text); font-size: 13px; }
.ad-search:focus-within { border-color: var(--blue); box-shadow: 0 0 0 3px rgba(13, 110, 253, 0.12); }
.ad-select { display: inline-flex; align-items: center; }
.ad-select select {
  width: 145px; height: 40px; padding: 0 32px 0 12px;
  border: 1px solid #8494a1; border-radius: 8px; background: #fff;
  color: var(--text); font-size: 13px; appearance: none; cursor: pointer;
}
.ad-year select { width: 120px; }
.ad-select svg { position: absolute; right: 10px; color: #6e8590; pointer-events: none; }
.ad-filters .button { min-height: 40px; }

.ad-table-panel {
  min-width: 0; border: 1px solid var(--border); border-radius: 12px;
  background: #fff; overflow: hidden;
}
.ad-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
.ad-table th {
  padding: 16px 16px 12px; border-bottom: 1px solid var(--border);
  color: var(--muted); font-size: 9.5px; font-weight: 600; letter-spacing: 0.04em;
  text-align: left; text-transform: uppercase;
}
.ad-table th:nth-child(1) { width: 124px; }
.ad-table th:nth-child(2) { width: 184px; }
.ad-table th:nth-child(3) { width: 96px; }
.ad-table th:nth-child(4) { width: 94px; }
.ad-table th:nth-child(5) { width: 80px; }
.ad-table th:nth-child(6) { width: 78px; }
.ad-table th:nth-child(7) { width: 96px; }
.ad-table th:nth-child(8) { width: 102px; }
.ad-table th:nth-child(9) { width: 148px; }
.ad-table th:nth-child(10) { width: 48px; }
.ad-table th:nth-child(6),
.ad-table th:nth-child(7) { line-height: 1.35; }
.ad-table td {
  padding: 12px 16px; border-bottom: 1px solid var(--divider);
  color: var(--text); font-size: 10.5px; vertical-align: middle;
}
.ad-identity { color: var(--text); font-size: 10px; font-weight: 600; white-space: nowrap; }
.ad-person { display: flex; align-items: center; gap: 10px; }
.ad-avatar {
  width: 28px; height: 28px; flex: 0 0 auto; border-radius: 50%;
  background: #e9f1ff; color: #0b5ed7;
  display: inline-flex; align-items: center; justify-content: center; font-size: 9px; font-weight: 600;
}
.ad-avatar-lg { width: 44px; height: 44px; font-size: 14px; }
.ad-person strong { display: block; color: var(--ink); font-size: 11px; font-weight: 600; }
.ad-person small { display: block; margin-top: 2px; color: var(--muted); font-size: 9px; }
.ad-days { display: block; color: var(--ink); font-size: 11px; font-weight: 600; }
.ad-days-note { display: block; margin-top: 2px; color: var(--muted); font-size: 9px; }
.ad-available { color: var(--ink); font-weight: 650; }
.ad-available-empty { color: #a11d1d; }
.ad-positive { color: #0b6b45; }
.ad-negative { color: #a11d1d; }
.ad-status {
  display: inline-flex; align-items: center; height: 22px; padding: 0 10px;
  border: 1px solid transparent; border-radius: 11px; font-size: 9px; font-weight: 600;
  white-space: nowrap;
}
.ad-status-on_leave { background: #fff6de; border-color: #f2d79a; color: #8a5a00; }
.ad-status-upcoming { background: #e9f1ff; border-color: #c9dafb; color: #1b4fbf; }
.ad-status-none { background: #edf2f6; border-color: #d8e2ea; color: var(--text); }
.ad-badge {
  display: inline-flex; align-items: center; min-height: 22px; padding: 0 8px;
  border-radius: 999px; font-size: 9.5px; font-weight: 600; white-space: nowrap;
  background: #fff6de; color: #8a5a00;
}
.ad-badge-success { background: #e4f7ec; color: #0b6b45; }
.ad-badge-neutral { background: #edf2f6; color: #5a6f78; }
.ad-leave-range {
  display: inline-flex; align-items: center; height: 22px; padding: 0 10px;
  border: 1px solid var(--border); border-radius: 11px; background: #fff;
  color: var(--text); font-size: 9px; font-weight: 600; white-space: nowrap;
}
.ad-icon-button {
  width: 32px; height: 32px; display: inline-flex; align-items: center; justify-content: center;
  border: 0; border-radius: 8px; background: transparent; color: var(--text); cursor: pointer;
}
.ad-icon-button:hover { background: var(--divider); }
.ad-empty { margin: 0; padding: 40px 20px; text-align: center; color: var(--muted); font-size: 13px; }
.ad-pagination {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 12px 20px; color: var(--muted); font-size: 11px;
}
.ad-pagination > div { display: flex; gap: 4px; }
.ad-page-button {
  min-width: 28px; height: 28px; padding: 0 6px; border: 0; border-radius: 8px;
  background: transparent; color: var(--muted); font-size: 11px; cursor: pointer;
}
.ad-page-button.active { background: #e9f1ff; color: #0b5ed7; font-weight: 600; }
.ad-page-button:hover:not(:disabled):not(.active) { background: var(--divider); }
.ad-page-button:disabled { opacity: 0.45; cursor: not-allowed; }

.ad-cards { display: none; }
.ad-card {
  display: grid; gap: 10px; padding: 14px;
  border: 1px solid var(--border); border-radius: 10px; background: #fff;
}
.ad-card-head { display: flex; align-items: flex-start; gap: 10px; }
.ad-card-person { flex: 1 1 auto; min-width: 0; }
.ad-card-person strong { display: block; color: var(--ink); font-size: 12.5px; font-weight: 650; }
.ad-card-person small { display: block; margin-top: 2px; color: var(--muted); font-size: 10px; }
.ad-card-head .ad-status { flex: 0 0 auto; }
.ad-card-facts {
  display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px;
  margin: 0; padding: 10px; border-radius: 8px; background: #f8fafc;
}
.ad-card-facts dt { color: var(--muted); font-size: 9px; }
.ad-card-facts dd { margin: 2px 0 0; color: var(--ink); font-size: 12px; font-weight: 650; }
.ad-card-leave { margin: 0; color: var(--muted); font-size: 10.5px; }
.ad-card > .button { justify-content: center; }

.ad-detail-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.ad-year-inline select { min-width: 130px; }

.ad-alert { margin: 0; padding: 11px 14px; border-radius: 10px; font-size: 13px; }
.ad-alert-danger { background: #fde9e9; color: #a11d1d; }
.ad-alert-success { background: #e4f7ec; color: #0b6b45; }

.ad-person-card {
  display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
  padding: 18px 20px; border: 1px solid var(--border); border-radius: 12px; background: #fff;
}
.ad-person-identity { flex: 1 1 auto; min-width: 0; }
.ad-person-identity h2 { margin: 0 0 3px; color: var(--ink); font-size: 17px; font-weight: 700; }
.ad-person-identity p { margin: 0; color: var(--muted); font-size: 11px; }
.ad-person-identity p + p { margin-top: 2px; }
.ad-person-badges { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }

.ad-detail-grid {
  display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 20px; align-items: start;
}
.ad-detail-main, .ad-detail-side { display: grid; gap: 16px; min-width: 0; }
.ad-panel {
  min-width: 0; padding: 18px 20px;
  border: 1px solid var(--border); border-radius: 12px; background: #fff;
}
.ad-panel-heading { margin-bottom: 14px; }
.ad-panel-heading h3 { margin: 0 0 3px; color: var(--ink); font-size: 14px; font-weight: 650; }
.ad-panel-heading p { margin: 0; color: var(--muted); font-size: 11px; line-height: 1.5; }

.ad-hero {
  display: flex; align-items: center; gap: 24px; padding: 16px;
  border: 1px solid var(--border); border-radius: 10px; background: #f8fafc;
}
.ad-hero-available {
  flex: 0 0 112px; display: grid; justify-items: center;
  padding-right: 20px; border-right: 1px solid var(--border);
}
.ad-hero-available span { color: var(--muted); font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }
.ad-hero-available strong { color: var(--ink); font-size: 36px; line-height: 1.1; }
.ad-hero-available small { color: var(--muted); font-size: 10px; }
.ad-composition { flex: 1 1 auto; display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; }
.ad-composition span { display: block; color: var(--muted); font-size: 9.5px; }
.ad-composition strong { display: block; margin-top: 2px; color: var(--ink); font-size: 14px; font-weight: 650; }
.ad-formula { margin: 10px 0 0; color: var(--muted); font-size: 10.5px; }

.ad-empty-state {
  display: flex; align-items: flex-start; gap: 12px; padding: 14px;
  border: 1px solid #f0dca8; border-radius: 10px; background: #fffdf5;
}
.ad-empty-state strong { display: block; color: var(--ink); font-size: 12px; }
.ad-empty-state p { margin: 3px 0 0; color: var(--muted); font-size: 11px; line-height: 1.5; }

.ad-ledger-wrap { overflow-x: auto; }
.ad-ledger { width: 100%; border-collapse: collapse; min-width: 620px; }
.ad-ledger th {
  padding: 0 10px 9px; border-bottom: 1px solid var(--border);
  color: var(--muted); font-size: 9px; font-weight: 600; letter-spacing: 0.04em;
  text-align: left; text-transform: uppercase;
}
.ad-ledger td {
  padding: 10px; border-bottom: 1px solid var(--divider);
  color: var(--text); font-size: 10.5px; vertical-align: top;
}
.ad-ledger tr:last-child td { border-bottom: 0; }
.ad-ledger th.ad-number, .ad-ledger td.ad-number { text-align: right; }
.ad-nowrap { white-space: nowrap; }
.ad-ledger strong { display: block; color: var(--ink); font-size: 10.5px; font-weight: 600; }
.ad-ledger small { display: block; margin-top: 2px; color: var(--muted); font-size: 9.5px; line-height: 1.45; }
.ad-delta { display: inline-flex; min-width: 36px; justify-content: flex-end; padding: 2px 6px; border-radius: 6px; font-weight: 650; }
.ad-reason { display: block; max-width: 260px; line-height: 1.45; }

.ad-leave-summary { display: grid; gap: 6px; justify-items: start; }
.ad-leave-summary strong { color: var(--ink); font-size: 13px; font-weight: 650; }
.ad-leave-summary p { margin: 0; color: var(--muted); font-size: 11px; }
.ad-leave-summary small { color: var(--muted); font-size: 10px; }

.ad-form-panel { position: sticky; top: 88px; }
.ad-form { display: grid; gap: 14px; }
.ad-field { display: grid; gap: 5px; }
.ad-field label { color: var(--ink); font-size: 11px; font-weight: 600; }
.ad-field input, .ad-field textarea {
  width: 100%; min-height: 38px; padding: 8px 10px;
  border: 1px solid #8494a1; border-radius: 8px; background: #fff;
  color: var(--text); font-size: 12px;
}
.ad-field textarea { resize: vertical; line-height: 1.5; }
.ad-field input:focus-visible, .ad-field textarea:focus-visible {
  outline: 0; border-color: var(--blue); box-shadow: 0 0 0 3px rgba(13, 110, 253, 0.12);
}
.ad-field-hint { color: var(--muted); font-size: 10px; line-height: 1.4; }
.ad-optional { color: var(--muted); font-weight: 400; }

.ad-preview {
  display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px;
  padding: 12px; border: 1px solid var(--border); border-radius: 8px; background: #f8fafc;
}
.ad-preview span { display: block; color: var(--muted); font-size: 9.5px; }
.ad-preview strong { display: block; margin-top: 2px; color: var(--ink); font-size: 13px; font-weight: 650; }
.ad-preview-danger { border-color: #eebcbc; background: #fff7f7; }
.ad-preview-danger strong { color: #a11d1d; }

.ad-form-hint {
  display: flex; align-items: flex-start; gap: 6px; margin: 0;
  color: var(--muted); font-size: 10.5px; line-height: 1.45;
}
.ad-form-hint svg { flex: 0 0 auto; margin-top: 1px; }
.ad-form-hint-danger { color: #a11d1d; }
.ad-submit { width: 100%; justify-content: center; }

/* Riwayat pengajuan cuti */
.ad-history-loading {
  display: flex; align-items: center; justify-content: center; gap: 10px;
  padding: 24px; color: var(--muted); font-size: 12px;
}
.ad-spinner {
  width: 18px; height: 18px; border: 2px solid var(--border);
  border-top-color: var(--blue); border-radius: 50%;
  animation: ad-spin 0.8s linear infinite;
}
@keyframes ad-spin { to { transform: rotate(360deg); } }

.ad-history-list { display: grid; gap: 8px; }
.ad-history-item {
  display: grid; grid-template-columns: 1fr auto;
  align-items: center; gap: 12px;
  padding: 12px 14px;
  border: 1px solid var(--border); border-radius: 10px; background: #fff;
  cursor: pointer; transition: border-color 0.15s, background 0.15s, box-shadow 0.15s;
}
.ad-history-item:hover { border-color: var(--blue); background: #f4f8ff; }
.ad-history-header { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.ad-history-header strong { color: var(--ink); font-size: 12px; font-weight: 650; }
.ad-history-status {
  display: inline-flex; align-items: center; height: 20px; padding: 0 8px;
  border: 1px solid transparent; border-radius: 10px; font-size: 8.5px; font-weight: 600;
  white-space: nowrap;
}
.ad-status-draft { background: #edf2f6; border-color: #d8e2ea; color: var(--muted); }
.ad-status-submitted { background: #e9f1ff; border-color: #c9dafb; color: #1b4fbf; }
.ad-status-admin_review { background: #e9f1ff; border-color: #c9dafb; color: #1b4fbf; }
.ad-status-admin_verified { background: #e9f1ff; border-color: #c9dafb; color: #1b4fbf; }
.ad-status-pertimbangan_review { background: #fff6de; border-color: #f2d79a; color: #8a5a00; }
.ad-status-kasubag_review { background: #fff6de; border-color: #f2d79a; color: #8a5a00; }
.ad-status-kepsta_review { background: #fff6de; border-color: #f2d79a; color: #8a5a00; }
.ad-status-ppk_review { background: #fff6de; border-color: #f2d79a; color: #8a5a00; }
.ad-status-returned_for_revision { background: #fde9e9; border-color: #f5c6cb; color: #a11d1d; }
.ad-status-approved { background: #e4f7ec; border-color: #b8e6c9; color: #0b6b45; }
.ad-status-rejected { background: #fde9e9; border-color: #f5c6cb; color: #a11d1d; }
.ad-status-withdrawn { background: #edf2f6; border-color: #d8e2ea; color: var(--muted); }
.ad-status-cancelled { background: #edf2f6; border-color: #d8e2ea; color: var(--muted); }
.ad-history-meta { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 4px; }
.ad-history-meta span { display: flex; align-items: center; gap: 4px; color: var(--muted); font-size: 10.5px; }
.ad-history-meta svg { color: var(--muted); flex-shrink: 0; }
.ad-history-actions { display: flex; align-items: center; }
.ad-history-go { color: var(--muted); }

@media (max-width: 1180px) {
  .ad-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .ad-table { min-width: 1080px; }
  .ad-table-panel { overflow-x: auto; }
  .ad-detail-grid { grid-template-columns: minmax(0, 1fr); }
  .ad-form-panel { position: static; }
}
@media (max-width: 720px) {
  .ad-metrics { grid-template-columns: 1fr; }
  .ad-search { flex: 1 1 240px; width: auto; }
  .ad-select, .ad-select select { flex: 1 1 100%; width: 100%; }
  .ad-table { display: none; }
  .ad-cards { display: grid; gap: 12px; padding: 12px; }
  .ad-detail-main, .ad-detail-side { display: contents; }
  .ad-balance-panel { order: 1; }
  .ad-form-panel { order: 2; }
  .ad-detail-side > .ad-panel:first-child { order: 3; }
  .ad-detail-main > .ad-panel:last-child { order: 4; }
  .ad-pagination { flex-direction: column; align-items: flex-start; }
  .ad-hero { flex-direction: column; align-items: stretch; gap: 14px; }
  .ad-hero-available { padding-right: 0; padding-bottom: 12px; border-right: 0; border-bottom: 1px solid var(--border); }
  .ad-composition { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .ad-person-identity { flex-basis: calc(100% - 60px); }
  .ad-detail-heading { flex-wrap: wrap; }
}
</style>
