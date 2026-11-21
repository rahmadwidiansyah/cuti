<script setup>
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import {
  AlertCircle,
  ArrowLeft,
  Building2,
  CalendarCheck,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  Eye,
  Save,
  Search,
  Users,
  FileText,
  Clock,
  History,
} from 'lucide-vue-next'
import StatusPill from './StatusPill.vue'
import TablePager from './TablePager.vue'
import { statusLabel } from '../status.js'
import { confirmAction, successDialog } from '../sweetalert.js'
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
const pageSize = 20

const selectedEmployeeId = ref(null)
const detail = ref(null)
const detailLoading = ref(false)
const detailError = ref('')

const adjustForm = reactive({ deltaDays: '', reason: '', reference: '', submitting: false })
const allocateForm = reactive({ days: 12, reason: 'Alokasi awal kuota cuti tahunan', submitting: false })

// Riwayat pengajuan cuti
const leaveHistory = ref([])
const leaveHistoryLoading = ref(false)

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
const paged = computed(() => filtered.value.slice(page.value * pageSize, (page.value + 1) * pageSize))

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
  const ok = await confirmAction({
    title: 'Simpan penyesuaian saldo ini?',
    text: `Saldo ${detail.value?.employee?.fullName || 'pegawai'} ${deltaNumber.value > 0 ? 'bertambah' : 'berkurang'} ${Math.abs(deltaNumber.value)} hari dan tercatat pada riwayat transaksi.`,
    confirmText: 'Ya, simpan',
  })
  if (!ok) return
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
    await successDialog({
      title: 'Penyesuaian tersimpan',
      text: result.message || 'Penyesuaian kuota tercatat pada riwayat transaksi saldo.',
    })
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
  const ok = await confirmAction({
    title: 'Alokasikan saldo tahunan ini?',
    text: `${allocateForm.days} hari saldo dialokasikan untuk ${detail.value?.employee?.fullName || 'pegawai'} pada tahun ${year.value}.`,
    confirmText: 'Ya, alokasikan',
  })
  if (!ok) return
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
    await successDialog({
      title: 'Alokasi tersimpan',
      text: result.message || 'Saldo tahunan berhasil dialokasikan.',
    })
  } catch (cause) {
    detailError.value = cause instanceof Error ? cause.message : 'Gagal mengalokasikan saldo.'
  } finally {
    allocateForm.submitting = false
  }
}

function onKeydown(event) {
  if (event.key === 'Escape' && selectedEmployeeId.value) closeDetail()
}

onMounted(() => {
  load()
  window.addEventListener('keydown', onKeydown)
})
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
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

      <section class="ad-table-panel panel-flex" aria-label="Daftar pegawai dan saldo cuti">
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
                <StatusPill :status="item.leaveStatus" />
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
              <StatusPill :status="item.leaveStatus" />
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
        <TablePager :page="page" :total="filtered.length" :page-size="pageSize" label="pegawai" @change="p => page = p" />
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
            <StatusPill :status="detail.employee.employmentStatus === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE'" />
            <StatusPill :status="detail.employee.leaveStatus" />
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
                      <StatusPill :status="req.status" />
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
                <StatusPill :status="detail.employee.leaveStatus" />
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
  display: grid;
  gap: 20px;
  min-width: 0;
}

.ad-error { margin: 0; padding: 12px 14px; border: 1px solid var(--danger-border); border-radius: var(--radius-control); background: var(--danger-bg); color: var(--danger-text); font-size: 13px; }
.ad-loading { margin: 0; color: var(--muted); font-size: 13px; }

.ad-metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; }
.ad-metric {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;
  min-height: 96px; padding: 16px;
  border: 1px solid var(--border); border-radius: var(--radius-panel); background: var(--card);
}
.ad-metric p { margin: 0 0 2px; color: var(--muted); font-size: 10.5px; font-weight: 500; }
.ad-metric strong { color: var(--ink); font-size: 26px; font-weight: 700; line-height: 1.15; font-variant-numeric: tabular-nums; }
.ad-metric strong span { color: var(--muted); font-size: 10.5px; font-weight: 500; }
.ad-metric small { display: block; margin-top: 4px; color: var(--muted); font-size: 10px; }
.ad-icon { width: 34px; height: 34px; flex: 0 0 auto; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; }
.tone-blue { background: var(--info-bg); color: var(--info-text); }
.tone-red { background: var(--danger-bg); color: var(--danger-text); }
.tone-green { background: var(--success-bg); color: var(--success-text); }
.tone-amber { background: var(--warning-bg); color: var(--warning-text); }
.tone-teal { background: var(--teal-bg); color: var(--teal-text); }
.tone-success { background: var(--success-bg); color: var(--success-text); }
.tone-danger { background: var(--danger-bg); color: var(--danger-text); }
.tone-neutral { background: var(--neutral-bg); color: var(--muted); }

.ad-filters {
  display: flex; align-items: center; flex-wrap: wrap; gap: 12px;
  padding: 12px 16px; border: 1px solid var(--border); border-radius: var(--radius-panel); background: var(--subtle);
}
.ad-filters > label { min-width: 0; position: relative; }
.ad-search {
  display: flex; align-items: center; gap: 8px;
  width: 260px; height: 40px; padding: 0 12px;
  border: 1px solid var(--control-border); border-radius: var(--radius-control); color: var(--muted); background: var(--card);
}
.ad-search input { width: 100%; border: 0; background: transparent; color: var(--text); font-size: 13px; }
.ad-select { display: inline-flex; align-items: center; }
.ad-select select {
  width: 145px; height: 40px; padding: 0 32px 0 12px;
  border: 1px solid var(--control-border); border-radius: var(--radius-control); background: var(--card);
  color: var(--text); font-size: 13px; appearance: none; cursor: pointer;
}
.ad-year select { width: 120px; }
.ad-select svg { position: absolute; right: 10px; color: var(--muted); pointer-events: none; }
.ad-filters .button { min-height: 40px; }

.ad-table-panel {
  min-width: 0; border: 1px solid var(--border); border-radius: var(--radius-panel);
  background: var(--card); overflow: hidden;
}
.ad-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
.ad-table th {
  padding: 16px 16px 12px; border-bottom: 1px solid var(--border);
  color: var(--muted); font-size: 9.5px; font-weight: 700; letter-spacing: 0.06em;
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
  color: var(--text); font-size: 12px; vertical-align: middle;
}
.ad-identity { color: var(--text); font-size: 11px; font-weight: 600; white-space: nowrap; }
.ad-person { display: flex; align-items: center; gap: 10px; }
.ad-avatar {
  width: 28px; height: 28px; flex: 0 0 auto; border-radius: 50%;
  background: var(--info-bg); color: var(--primary-dark);
  display: inline-flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 600;
}
.ad-avatar-lg { width: 44px; height: 44px; font-size: 14px; }
.ad-person strong { display: block; color: var(--ink); font-size: 11px; font-weight: 600; }
.ad-person small { display: block; margin-top: 2px; color: var(--muted); font-size: 10px; }
.ad-days { display: block; color: var(--ink); font-size: 11px; font-weight: 600; }
.ad-days-note { display: block; margin-top: 2px; color: var(--muted); font-size: 10px; }
.ad-available { color: var(--ink); font-weight: 650; }
.ad-available-empty { color: var(--danger-text); }
.ad-positive { color: var(--success-text); }
.ad-negative { color: var(--danger-text); }
.ad-badge {
  display: inline-flex; align-items: center; min-height: 22px; padding: 3px 8px;
  border: 1px solid var(--warning-border); border-radius: 999px; font-size: 10px; font-weight: 650;
  letter-spacing: 0.04em; text-transform: uppercase; white-space: nowrap;
  background: var(--warning-bg); color: var(--warning-text);
}
.ad-leave-range {
  display: inline-flex; align-items: center; height: 22px; padding: 0 10px;
  border: 1px solid var(--border); border-radius: 999px; background: var(--card);
  color: var(--text); font-size: 10px; font-weight: 600; white-space: nowrap;
}
.ad-icon-button {
  width: 32px; height: 32px; display: inline-flex; align-items: center; justify-content: center;
  border: 0; border-radius: var(--radius-control); background: transparent; color: var(--text); cursor: pointer;
}
.ad-icon-button:hover { background: var(--subtle); }
.ad-empty { margin: 0; padding: 40px 20px; text-align: center; color: var(--muted); font-size: 13px; }
.ad-cards { display: none; }
.ad-card {
  display: grid; gap: 10px; padding: 14px;
  border: 1px solid var(--border); border-radius: var(--radius-panel); background: var(--card);
}
.ad-card-head { display: flex; align-items: flex-start; gap: 10px; }
.ad-card-person { flex: 1 1 auto; min-width: 0; }
.ad-card-person strong { display: block; color: var(--ink); font-size: 12.5px; font-weight: 650; }
.ad-card-person small { display: block; margin-top: 2px; color: var(--muted); font-size: 10px; }
.ad-card-head .status-badge { flex: 0 0 auto; }
.ad-card-facts {
  display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px;
  margin: 0; padding: 10px; border-radius: var(--radius-control); background: var(--canvas);
}
.ad-card-facts dt { color: var(--muted); font-size: 10px; }
.ad-card-facts dd { margin: 2px 0 0; color: var(--ink); font-size: 12px; font-weight: 650; }
.ad-card-leave { margin: 0; color: var(--muted); font-size: 11px; }
.ad-card > .button { justify-content: center; }

.ad-detail-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.ad-year-inline select { min-width: 130px; }

.ad-alert { margin: 0; padding: 12px 14px; border: 1px solid transparent; border-radius: var(--radius-control); font-size: 13px; }
.ad-alert-danger { border-color: var(--danger-border); background: var(--danger-bg); color: var(--danger-text); }
.ad-alert-success { border-color: var(--success-border); background: var(--success-bg); color: var(--success-text); }

.ad-person-card {
  display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
  padding: 20px; border: 1px solid var(--border); border-radius: var(--radius-panel); background: var(--card);
}
.ad-person-identity { flex: 1 1 auto; min-width: 0; }
.ad-person-identity h2 { margin: 0 0 3px; color: var(--ink); font-size: 20px; font-weight: 700; }
.ad-person-identity p { margin: 0; color: var(--muted); font-size: 11px; }
.ad-person-identity p + p { margin-top: 2px; }
.ad-person-badges { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }

.ad-detail-grid {
  display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 20px; align-items: start;
}
.ad-detail-main, .ad-detail-side { display: grid; gap: 16px; min-width: 0; }
.ad-panel {
  min-width: 0; padding: 20px;
  border: 1px solid var(--border); border-radius: var(--radius-panel); background: var(--card);
}
.ad-panel-heading { margin-bottom: 14px; }
.ad-panel-heading h3 { margin: 0 0 3px; color: var(--ink); font-size: 16px; font-weight: 650; }
.ad-panel-heading p { margin: 0; color: var(--muted); font-size: 11px; line-height: 1.5; }

.ad-hero {
  display: flex; align-items: center; gap: 24px; padding: 16px;
  border: 1px solid var(--border); border-radius: 10px; background: var(--canvas);
}
.ad-hero-available {
  flex: 0 0 112px; display: grid; justify-items: center;
  padding-right: 20px; border-right: 1px solid var(--border);
}
.ad-hero-available span { color: var(--muted); font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; }
.ad-hero-available strong { color: var(--ink); font-size: 34px; line-height: 1.2; font-variant-numeric: tabular-nums; }
.ad-hero-available small { color: var(--muted); font-size: 10px; }
.ad-composition { flex: 1 1 auto; display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; }
.ad-composition span { display: block; color: var(--muted); font-size: 10px; }
.ad-composition strong { display: block; margin-top: 2px; color: var(--ink); font-size: 14px; font-weight: 650; }
.ad-formula { margin: 10px 0 0; color: var(--muted); font-size: 10.5px; }

.ad-empty-state {
  display: flex; align-items: flex-start; gap: 12px; padding: 14px;
  border: 1px solid var(--warning-border); border-radius: var(--radius-control); background: var(--warning-bg);
}
.ad-empty-state strong { display: block; color: var(--ink); font-size: 12px; }
.ad-empty-state p { margin: 3px 0 0; color: var(--muted); font-size: 11px; line-height: 1.5; }

.ad-ledger-wrap { overflow-x: auto; }
.ad-ledger { width: 100%; border-collapse: collapse; min-width: 620px; }
.ad-ledger th {
  padding: 0 10px 9px; border-bottom: 1px solid var(--border);
  color: var(--muted); font-size: 9.5px; font-weight: 700; letter-spacing: 0.06em;
  text-align: left; text-transform: uppercase;
}
.ad-ledger td {
  padding: 10px; border-bottom: 1px solid var(--divider);
  color: var(--text); font-size: 12px; vertical-align: top;
}
.ad-ledger tr:last-child td { border-bottom: 0; }
.ad-ledger th.ad-number, .ad-ledger td.ad-number { text-align: right; }
.ad-nowrap { white-space: nowrap; }
.ad-ledger strong { display: block; color: var(--ink); font-size: 12px; font-weight: 600; }
.ad-ledger small { display: block; margin-top: 2px; color: var(--muted); font-size: 11px; line-height: 1.45; }
.ad-delta { display: inline-flex; min-width: 36px; justify-content: flex-end; padding: 2px 6px; border-radius: var(--radius-control); font-weight: 650; }
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
  width: 100%; min-height: 44px; padding: 10px 12px;
  border: 1px solid var(--control-border); border-radius: var(--radius-control); background: var(--card);
  color: var(--text); font-size: 12px;
}
.ad-field textarea { resize: vertical; line-height: 1.5; }
.ad-field-hint { color: var(--muted); font-size: 10px; line-height: 1.4; }
.ad-optional { color: var(--muted); font-weight: 400; }

.ad-preview {
  display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px;
  padding: 12px; border: 1px solid var(--border); border-radius: var(--radius-control); background: var(--canvas);
}
.ad-preview span { display: block; color: var(--muted); font-size: 10px; }
.ad-preview strong { display: block; margin-top: 2px; color: var(--ink); font-size: 13px; font-weight: 650; }
.ad-preview-danger { border-color: var(--danger-border); background: var(--danger-bg); }
.ad-preview-danger strong { color: var(--danger-text); }

.ad-form-hint {
  display: flex; align-items: flex-start; gap: 6px; margin: 0;
  color: var(--muted); font-size: 10.5px; line-height: 1.45;
}
.ad-form-hint svg { flex: 0 0 auto; margin-top: 1px; }
.ad-form-hint-danger { color: var(--danger-text); }
.ad-submit { width: 100%; justify-content: center; }

/* Riwayat pengajuan cuti */
.ad-history-loading {
  display: flex; align-items: center; justify-content: center; gap: 10px;
  padding: 24px; color: var(--muted); font-size: 12px;
}
.ad-spinner {
  width: 18px; height: 18px; border: 2px solid var(--border);
  border-top-color: var(--primary); border-radius: 50%;
  animation: ad-spin 0.8s linear infinite;
}
@keyframes ad-spin { to { transform: rotate(360deg); } }

.ad-history-list { display: grid; gap: 8px; }
.ad-history-item {
  display: grid; grid-template-columns: 1fr auto;
  align-items: center; gap: 12px;
  padding: 12px 14px;
  border: 1px solid var(--border); border-radius: var(--radius-panel); background: var(--card);
  cursor: pointer; transition: border-color 120ms ease-out, background 120ms ease-out;
}
.ad-history-item:hover { border-color: var(--primary); background: var(--primary-tint); }
.ad-history-header { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.ad-history-header strong { color: var(--ink); font-size: 12px; font-weight: 650; }
.ad-history-meta { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 4px; }
.ad-history-meta span { display: flex; align-items: center; gap: 4px; color: var(--muted); font-size: 10.5px; }
.ad-history-meta svg { color: var(--muted); flex-shrink: 0; }
.ad-history-actions { display: flex; align-items: center; }
.ad-history-go { color: var(--muted); }

@media (max-width: 1200px) {
  .ad-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .ad-table { min-width: 1080px; }
  .ad-table-panel { overflow-x: auto; }
  .ad-detail-grid { grid-template-columns: minmax(0, 1fr); }
  .ad-form-panel { position: static; }
}
@media (max-width: 700px) {
  .ad-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
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
