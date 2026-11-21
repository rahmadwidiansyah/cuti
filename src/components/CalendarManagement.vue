<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { confirmAction, successDialog, detailDialog } from '../sweetalert.js'
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Info,
  Pencil,
  Upload,
  X,
} from 'lucide-vue-next'

const props = defineProps({
  userRoles: { type: Array, default: () => [] },
})

const canManageCalendar = computed(() =>
  props.userRoles.some((role) => role.code === 'ADMIN' || role.code === 'HR_ANALYST')
)

// Daftar "Tanggal khusus terbaru" hanya untuk Admin — non-admin & SDM melihat
// detail tanggal lewat popup pada sel kalender.
const isAdminUser = computed(() =>
  props.userRoles.some((role) => role.code === 'ADMIN')
)

const today = new Date()
const monthsId = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember']
const weekDays = ['Sen','Sel','Rab','Kam','Jum','Sab','Min']

const loading = ref(false)
const saving = ref(false)
const error = ref('')
const notice = ref('')
const formError = ref('')
const busyId = ref(null)
const editingId = ref(null)
const showImportModal = ref(false)
const importing = ref(false)
const importPreview = ref(null)
const importErrors = ref([])
const recentLimit = ref(3)

// Tab untuk panel manajemen di kolom kanan (Admin & HR)
const activeTab = ref('date')

const filters = reactive({
  versionId: '',
  month: String(today.getMonth() + 1),
  year: String(today.getFullYear()),
})

const form = reactive({
  calendarVersionId: '',
  calendarDate: dateInputValue(today),
  dateType: 'NATIONAL_HOLIDAY',
  title: '',
  description: '',
  scopeType: 'ALL',
  unitId: '',
  isActive: true,
})

const versions = ref([])
const units = ref([])
const grid = ref([])
const recentItems = ref([])

// Kategori tanggal (dynamic, menggantikan daftar hardcoded)
const categories = ref([])
const behaviors = ['SKIP', 'BLOCK', 'INFO']
const behaviorLabel = { SKIP: 'Dilewati', BLOCK: 'Diblokir', INFO: 'Info saja' }
const behaviorHint = {
  SKIP: 'Tanggal tidak dihitung sebagai hari kerja.',
  BLOCK: 'Pengajuan cuti dihentikan pada tanggal ini.',
  INFO: 'Hanya penanda; tetap dihitung sebagai hari kerja.',
}
const categoryMap = computed(() => new Map(categories.value.map(c => [c.code, c])))

// Form kategori custom
const categoryForm = reactive({ id: null, code: '', name: '', behavior: 'INFO', color: '#6f42c1', icon: '', description: '' })
const categoryError = ref('')
const savingCategory = ref(false)
const showCategoryForm = ref(false)

function dateInputValue(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

const monthLabel = computed(() =>
  `${monthsId[Number(filters.month) - 1] || ''} ${filters.year}`
)

const editableVersions = computed(() =>
  versions.value.filter(v => v.status !== 'ARCHIVED')
)

function dateTypeShortLabel(type) {
  const category = categoryMap.value.get(type)
  if (!category) return 'Tanggal'
  if (category.behavior === 'BLOCK') return 'Larangan'
  if (category.behavior === 'SKIP') return 'Libur'
  return category.name.length > 10 ? category.name.slice(0, 9) + '…' : category.name
}
function dateTypeColor(type) {
  return categoryMap.value.get(type)?.color || '#5a6f78'
}
function cellStyle(special) {
  if (!special) return {}
  const color = dateTypeColor(special.type)
  return { '--cell-color': color, '--cell-soft': `${color}1f` }
}

function formatLongDate(value) {
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00Z`)
  if (Number.isNaN(date.valueOf())) return String(value)
  return new Intl.DateTimeFormat('id-ID', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  }).format(date)
}

// Popup detail tanggal ber-acara (klik sel kalender). Isi di-escape karena
// judul dan kategori adalah data yang diinput pengguna.
function showDateDetail(cell) {
  const special = cell?.special
  if (!special) return
  const safe = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ))
  const behavior = behaviorLabel[special.behavior] || special.behavior
  const hint = behaviorHint[special.behavior] || ''
  const scope = !special.scopeType || special.scopeType === 'ALL' ? 'Semua unit' : 'Unit tertentu'
  detailDialog({
    title: formatLongDate(cell.date),
    html: [
      `<p class="cal-detail-name">${safe(special.title)}</p>`,
      '<dl class="cal-detail">',
      `<div><dt>Kategori</dt><dd>${safe(special.name || '-')}</dd></div>`,
      `<div><dt>Perilaku</dt><dd>${safe(behavior)}</dd></div>`,
      ...(hint ? [`<div><dt>Keterangan</dt><dd>${safe(hint)}</dd></div>`] : []),
      `<div><dt>Cakupan</dt><dd>${safe(scope)}</dd></div>`,
      '</dl>',
    ].join(''),
  })
}

function versionLabel(status) {
  return ({ ACTIVE: 'Aktif', DRAFT: 'Draf', ARCHIVED: 'Diarsipkan' })[status] || status
}

function formatDate(value, opts = {}) {
  if (!value) return '-'
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00Z`)
  if (Number.isNaN(date.valueOf())) return '-'
  return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC', ...opts }).format(date)
}

function shortDate(value) {
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00Z`)
  return {
    day: new Intl.DateTimeFormat('id-ID', { day: 'numeric', timeZone: 'UTC' }).format(date),
    month: new Intl.DateTimeFormat('id-ID', { month: 'short', timeZone: 'UTC' }).format(date),
  }
}

function dayNumber(value) {
  return Number(String(value).slice(8, 10))
}

function cellMonthShort(value) {
  return new Intl.DateTimeFormat('id-ID', { month: 'short', timeZone: 'UTC' })
    .format(new Date(`${String(value).slice(0, 10)}T12:00:00Z`))
}

function isWeekend(value) {
  const day = new Date(`${String(value).slice(0, 10)}T12:00:00Z`).getUTCDay()
  return day === 0 || day === 6
}

function cellTag(cell) {
  if (cell.isToday) return 'Hari ini'
  if (cell.special) return dateTypeShortLabel(cell.special.type)
  return ''
}

function errorText(cause) {
  return cause instanceof Error ? cause.message : 'Permintaan gagal. Coba lagi.'
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {})
  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  const response = await fetch(`/api${path}`, { credentials: 'same-origin', ...options, headers })
  const contentType = response.headers.get('content-type') || ''
  const data = contentType.includes('application/json') ? await response.json() : null
  if (!response.ok) throw new Error(data?.error || `Permintaan gagal (${response.status}).`)
  return data
}

async function loadCalendar() {
  loading.value = true
  try {
    // Audit T9: pegawai memakai jalur baca /calendar (versi ACTIVE otomatis,
    // cakupan unitnya); pengelola memakai /admin/calendar penuh.
    const base = canManageCalendar.value ? '/admin/calendar' : '/calendar'
    const gridQuery = canManageCalendar.value
      ? `versionId=${filters.versionId}&year=${filters.year}&month=${filters.month}`
      : `year=${filters.year}&month=${filters.month}`
    const requests = [
      api(`${base}/grid?${gridQuery}`),
      canManageCalendar.value && filters.versionId
        ? api(`/admin/calendar?versionId=${filters.versionId}&limit=${recentLimit.value}&status=active`)
        : Promise.resolve({ items: [] }),
    ]
    if (canManageCalendar.value) requests.push(api('/admin/calendar/categories'))
    const [gridData, datesData, categoriesData] = await Promise.all(requests)
    grid.value = gridData.grid || []
    if (gridData.categories?.length) categories.value = gridData.categories
    recentItems.value = datesData.items || []
    if (categoriesData) categories.value = categoriesData.items || []
    if (!form.dateType || !categoryMap.value.has(form.dateType)) {
      form.dateType = categories.value.find(c => c.behavior === 'SKIP')?.code || categories.value[0]?.code || ''
    }
  } catch (cause) {
    error.value = errorText(cause)
  } finally {
    loading.value = false
  }
}

async function saveCategory() {
  categoryError.value = ''
  const code = String(categoryForm.code || '').trim().toUpperCase()
  const name = String(categoryForm.name || '').trim()
  if (!/^[A-Z][A-Z0-9_]{2,29}$/.test(code)) { categoryError.value = 'Kode harus 3–30 huruf kapital, angka, atau garis bawah.'; return }
  if (name.length < 3 || name.length > 100) { categoryError.value = 'Nama harus 3–100 karakter.'; return }
  if (!behaviors.includes(categoryForm.behavior)) { categoryError.value = 'Pilih perilaku kategori.'; return }
  if (!/^#[0-9A-Fa-f]{6}$/.test(categoryForm.color)) { categoryError.value = 'Warna harus berupa kode hex #RRGGBB.'; return }

  const wasEdit = Boolean(categoryForm.id)
  const ok = await confirmAction(wasEdit
    ? {
        title: 'Simpan perubahan kategori?',
        text: 'Perubahan perilaku kategori berlaku untuk pengajuan baru.',
        confirmText: 'Ya, simpan',
      }
    : {
        title: 'Tambah kategori kalender baru?',
        text: 'Kategori dipakai untuk menghitung hari kerja pada pengajuan cuti.',
        confirmText: 'Ya, simpan',
        icon: 'info',
      })
  if (!ok) return
  savingCategory.value = true
  try {
    const body = {
      code, name, behavior: categoryForm.behavior, color: categoryForm.color,
      icon: categoryForm.icon || null, description: categoryForm.description || null,
    }
    if (categoryForm.id) {
      await api(`/admin/calendar/categories/${categoryForm.id}`, { method: 'PUT', body: JSON.stringify(body) })
      notice.value = 'Kategori berhasil diperbarui.'
    } else {
      await api('/admin/calendar/categories', { method: 'POST', body: JSON.stringify(body) })
      notice.value = 'Kategori berhasil ditambahkan.'
    }
    resetCategoryForm()
    await loadCalendar()
    await successDialog({
      title: 'Kategori tersimpan',
      text: wasEdit ? 'Perubahan kategori berhasil disimpan.' : 'Kategori baru berhasil ditambahkan.',
    })
  } catch (cause) {
    categoryError.value = errorText(cause)
  } finally {
    savingCategory.value = false
  }
}

async function editCategory(item) {
  categoryError.value = ''
  categoryForm.id = item.id
  categoryForm.code = item.code
  categoryForm.name = item.name
  categoryForm.behavior = item.behavior
  categoryForm.color = item.color
  categoryForm.icon = item.icon || ''
  categoryForm.description = item.description || ''
  showCategoryForm.value = true
  activeTab.value = 'category'
  document.getElementById('category-form-panel')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

function resetCategoryForm() {
  categoryForm.id = null
  categoryForm.code = ''
  categoryForm.name = ''
  categoryForm.behavior = 'INFO'
  categoryForm.color = '#6f42c1'
  categoryForm.icon = ''
  categoryForm.description = ''
  categoryError.value = ''
  showCategoryForm.value = false
}

async function deleteCategory(item) {
  categoryError.value = ''
  const ok = await confirmAction({
    title: `Hapus kategori "${item.name}"?`,
    text: 'Kategori yang dihapus tidak dapat dikembalikan.',
    confirmText: 'Ya, hapus',
    danger: true,
  })
  if (!ok) return
  try {
    await api(`/admin/calendar/categories/${item.id}`, { method: 'DELETE' })
    notice.value = 'Kategori berhasil dihapus.'
    if (categoryForm.id === item.id) resetCategoryForm()
    await loadCalendar()
  } catch (cause) {
    categoryError.value = errorText(cause)
  }
}

async function loadLookups() {
  // Audit T9: pegawai hanya menerima versi ACTIVE dari jalur /calendar.
  const base = canManageCalendar.value ? '/admin/calendar' : '/calendar'
  versions.value = (await api(`${base}/versions`)).items || []
  if (canManageCalendar.value) {
    try {
      const empResult = await api('/admin/employees?limit=1')
      units.value = empResult.units || []
    } catch (_) { units.value = [] }
  }
  setDefaultVersion()
}

function setDefaultVersion() {
  const active = versions.value.find(v => v.status === 'ACTIVE')
  filters.versionId = active ? String(active.id) : ''
  form.calendarVersionId = filters.versionId
}

async function changeMonth(delta) {
  let year = Number(filters.year)
  let month = Number(filters.month) + delta
  if (month < 1) { month = 12; year-- }
  if (month > 12) { month = 1; year++ }
  if (year < 2000 || year > 2100) return
  filters.year = String(year)
  filters.month = String(month)
  await loadCalendar()
}

async function showToday() {
  filters.year = String(today.getFullYear())
  filters.month = String(today.getMonth() + 1)
  await loadCalendar()
}

async function showAllRecent() {
  recentLimit.value = 9
  await loadCalendar()
}

function resetForm() {
  editingId.value = null
  formError.value = ''
  activeTab.value = 'date'
  form.calendarVersionId = filters.versionId || String(editableVersions.value[0]?.id || '')
  form.calendarDate = dateInputValue(today)
  form.dateType = 'NATIONAL_HOLIDAY'
  form.title = ''
  form.description = ''
  form.scopeType = 'ALL'
  form.unitId = ''
  form.isActive = true
}

function editItem(item) {
  editingId.value = item.id
  formError.value = ''
  activeTab.value = 'date'
  form.calendarVersionId = String(item.calendar_version_id)
  form.calendarDate = String(item.calendar_date).slice(0, 10)
  form.dateType = item.date_type
  form.title = item.title
  form.description = item.description || ''
  form.scopeType = item.scope_type
  form.unitId = item.organizational_unit_id ? String(item.organizational_unit_id) : ''
  form.isActive = item.is_active
  document.getElementById('calendar-entry-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

async function saveCalendar() {
  formError.value = ''
  if (!form.calendarVersionId) { formError.value = 'Pilih versi kalender.'; return }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.calendarDate)) { formError.value = 'Tanggal tidak valid (YYYY-MM-DD).'; return }
  if (form.title.length < 3 || form.title.length > 150) { formError.value = 'Judul 3–150 karakter.'; return }

  const wasEdit = Boolean(editingId.value)
  const ok = await confirmAction(wasEdit
    ? {
        title: 'Simpan perubahan tanggal kalender?',
        text: 'Perubahan berlaku untuk penghitungan pengajuan cuti baru.',
        confirmText: 'Ya, simpan',
      }
    : {
        title: 'Tambah tanggal kalender kerja?',
        text: 'Tanggal libur/kerja memengaruhi perhitungan durasi cuti pegawai.',
        confirmText: 'Ya, simpan',
        icon: 'info',
      })
  if (!ok) return
  saving.value = true
  try {
    const body = {
      calendarVersionId: Number(form.calendarVersionId),
      calendarDate: form.calendarDate,
      dateType: form.dateType,
      title: form.title,
      description: form.description || null,
      scopeType: form.scopeType,
      unitId: form.scopeType === 'UNIT' ? Number(form.unitId) : undefined,
      isActive: form.isActive,
    }
    if (editingId.value) {
      await api(`/admin/calendar/${encodeURIComponent(editingId.value)}`, { method: 'PUT', body: JSON.stringify(body) })
      notice.value = 'Tanggal kalender berhasil diperbarui.'
    } else {
      await api('/admin/calendar', { method: 'POST', body: JSON.stringify(body) })
      notice.value = 'Tanggal kalender berhasil ditambahkan.'
    }
    resetForm()
    await loadCalendar()
    await successDialog({
      title: 'Tanggal kalender tersimpan',
      text: wasEdit ? 'Perubahan tanggal kalender berhasil disimpan.' : 'Tanggal kalender baru berhasil ditambahkan.',
    })
  } catch (cause) {
    formError.value = errorText(cause)
  } finally {
    saving.value = false
  }
}

async function toggleActive(item) {
  const ok = await confirmAction(item.is_active
    ? {
        title: 'Nonaktifkan tanggal kalender ini?',
        text: 'Tanggal nonaktif tidak dihitung untuk pengajuan cuti baru. Riwayat pengajuan yang sudah dibuat tidak berubah.',
        confirmText: 'Ya, nonaktifkan',
        danger: true,
      }
    : {
        title: 'Aktifkan tanggal kalender ini?',
        text: 'Tanggal aktif kembali dihitung untuk pengajuan cuti baru.',
        confirmText: 'Ya, aktifkan',
        icon: 'info',
      })
  if (!ok) return
  busyId.value = item.id
  try {
    await api(`/admin/calendar/${encodeURIComponent(item.id)}/toggle`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive: !item.is_active }),
    })
    notice.value = item.is_active ? 'Tanggal dinonaktifkan. Riwayat pengajuan yang sudah dibuat tidak berubah.' : 'Tanggal diaktifkan.'
    await loadCalendar()
  } catch (cause) {
    error.value = errorText(cause)
  } finally {
    busyId.value = null
  }
}

// Import handlers
function openImportModal() {
  showImportModal.value = true
  importPreview.value = null
  importErrors.value = []
}

async function previewImport(file) {
  if (!file || !showImportModal.value) return
  const fd = new FormData()
  fd.append('file', file)
  fd.append('versionId', form.calendarVersionId || filters.versionId)
  importing.value = true
  try {
    importPreview.value = await api('/admin/calendar/import/preview', { method: 'POST', body: fd })
    importErrors.value = importPreview.value.errors || []
  } catch (cause) {
    importErrors.value = [{ error: errorText(cause) }]
  } finally {
    importing.value = false
  }
}

async function commitImport() {
  if (!importPreview.value || !importPreview.value.rows?.length) return
  const ok = await confirmAction({
    title: `Impor ${importPreview.value.rows.length} tanggal kalender?`,
    text: 'Tanggal diimpor ke versi kalender terpilih dan langsung dipakai untuk perhitungan cuti.',
    confirmText: 'Ya, impor',
  })
  if (!ok) return
  importing.value = true
  try {
    const result = await api('/admin/calendar/import/commit', {
      method: 'POST',
      body: JSON.stringify({ versionId: Number(form.calendarVersionId || filters.versionId), rows: importPreview.value.rows }),
    })
    notice.value = `${result.imported || 0} tanggal berhasil diimpor.`
    showImportModal.value = false
    importPreview.value = null
    await loadCalendar()
    await successDialog({
      title: 'Impor selesai',
      text: `${result.imported || 0} tanggal kalender berhasil diimpor.`,
    })
  } catch (cause) {
    importErrors.value = [{ error: errorText(cause) }]
  } finally {
    importing.value = false
  }
}

async function initialize() {
  error.value = ''
  loading.value = true
  try {
    await loadLookups()
    await loadCalendar()
  } catch (cause) {
    error.value = errorText(cause)
    loading.value = false
  }
}

defineExpose({
  openImport: openImportModal,
  startNew: resetForm,
})

onMounted(initialize)
</script>

<template>
  <section class="content-stack calendar-management">
    <p v-if="notice" class="alert alert-success" role="status">{{ notice }}</p>
    <p v-if="error" class="alert alert-danger" role="alert">
      {{ error }}
      <button class="text-button" type="button" @click="initialize">Coba lagi</button>
    </p>
    <p v-if="loading && !grid.length" class="state-message" role="status">Memuat kalender kerja…</p>

    <div v-if="!error" class="calendar-layout" :class="{ 'calendar-layout-solo': !canManageCalendar }">
      <div class="calendar-main">
      <section class="panel calendar-panel" aria-labelledby="calendar-title">
        <div class="calendar-toolbar">
          <div class="calendar-nav">
            <button class="calendar-icon-button" type="button" aria-label="Bulan sebelumnya" @click="changeMonth(-1)">
              <ChevronLeft :size="16" :stroke-width="2" aria-hidden="true" />
            </button>
            <h2 id="calendar-title" class="calendar-month">{{ monthLabel }}</h2>
            <button class="calendar-icon-button" type="button" aria-label="Bulan berikutnya" @click="changeMonth(1)">
              <ChevronRight :size="16" :stroke-width="2" aria-hidden="true" />
            </button>
            <button class="calendar-today-button" type="button" @click="showToday">Hari ini</button>
          </div>
          <div class="calendar-toolbar-side">
            <label v-if="versions.length > 1" class="calendar-version-picker">
              <span class="sr-only">Versi kalender</span>
              <select v-model="filters.versionId" @change="loadCalendar">
                <option v-for="version in versions" :key="version.id" :value="String(version.id)">
                  {{ version.name }} · {{ versionLabel(version.status) }}
                </option>
              </select>
            </label>
          </div>
        </div>

        <div class="calendar-weekdays" aria-hidden="true">
          <span v-for="day in weekDays" :key="day">{{ day }}</span>
        </div>

        <div class="calendar-grid" role="grid" :aria-label="`Kalender ${monthLabel}`">
          <template v-for="(week, wi) in grid">
            <div
              v-for="(cell, ci) in week"
              :key="`${wi}-${ci}-${cell.date}`"
              role="gridcell"
              class="calendar-cell"
              :class="{
                'is-outside': !cell.isCurrentMonth,
                'is-weekend': cell.isCurrentMonth && isWeekend(cell.date),
                'has-special': Boolean(cell.special),
                'is-today': cell.isToday,
              }"
              :style="cellStyle(cell.special)"
              :aria-label="`${formatDate(cell.date)}${cell.special ? ', ' + cell.special.title : ''}${cell.isToday ? ', hari ini' : ''}`"
              :tabindex="cell.special ? 0 : -1"
              @click="showDateDetail(cell)"
              @keydown.enter.prevent="showDateDetail(cell)"
            >
              <div class="calendar-cell-top">
                <span class="calendar-day-number">{{ dayNumber(cell.date) }}</span>
                <span v-if="!cell.isCurrentMonth" class="calendar-cell-month">{{ cellMonthShort(cell.date) }}</span>
              </div>
              <span v-if="cellTag(cell)" class="calendar-cell-tag" :style="{ color: 'var(--cell-color)' }">{{ cellTag(cell) }}</span>
            </div>
          </template>
        </div>

        <div v-if="categories.length" class="calendar-legend-bar" aria-label="Legenda kategori tanggal">
          <span v-for="category in categories" :key="category.code" class="calendar-legend">
            <i class="legend-dot" :style="{ background: category.color }"></i>
            <strong>{{ category.name }}</strong>
            <small>{{ behaviorLabel[category.behavior] || category.behavior }}</small>
          </span>
        </div>

        <div class="calendar-info">
          <Info :size="18" :stroke-width="2" class="calendar-info-icon" aria-hidden="true" />
          <div>
            <p>Perilaku tanggal berikut aturan kategori</p>
            <span>
              <template v-for="(item, index) in categories" :key="item.code">
                <template v-if="index"> · </template>{{ item.name }}: {{ behaviorHint[item.behavior] || item.behavior }}
              </template>
            </span>
          </div>
        </div>
      </section>

        <section v-if="isAdminUser" class="panel calendar-recent-panel">
          <div class="calendar-panel-heading">
            <h2>Tanggal khusus terbaru</h2>
            <button
              v-if="recentItems.length >= recentLimit"
              class="text-button"
              type="button"
              @click="showAllRecent"
            >
              Lihat semua
            </button>
          </div>
          <ul v-if="recentItems.length" class="calendar-recent-list">
            <li v-for="item in recentItems" :key="item.id" class="calendar-recent-item">
              <span
                class="calendar-recent-chip"
                :style="{ color: dateTypeColor(item.date_type), borderColor: dateTypeColor(item.date_type), background: `${dateTypeColor(item.date_type)}1f` }"
              >
                <strong>{{ shortDate(item.calendar_date).day }}</strong>
                <span>{{ shortDate(item.calendar_date).month }}</span>
              </span>
              <div class="calendar-recent-info">
                <button
                  v-if="canManageCalendar"
                  class="calendar-recent-title"
                  type="button"
                  :title="`Ubah ${item.title}`"
                  @click="editItem(item)"
                >
                  {{ item.title }} <Pencil :size="12" aria-hidden="true" />
                </button>
                <strong v-else class="calendar-recent-title-static">{{ item.title }}</strong>
                <span
                  class="calendar-recent-badge"
                  :style="{ color: dateTypeColor(item.date_type), background: `${dateTypeColor(item.date_type)}1f` }"
                >
                  {{ dateTypeShortLabel(item.date_type) }}
                </span>
              </div>
              <button
                v-if="canManageCalendar"
                class="calendar-switch calendar-switch-small"
                type="button"
                role="switch"
                :aria-checked="item.is_active"
                :aria-label="`${item.is_active ? 'Nonaktifkan' : 'Aktifkan'} ${item.title}`"
                :disabled="item.version_status === 'ARCHIVED' || busyId === item.id"
                @click="toggleActive(item)"
              >
                <span aria-hidden="true"></span>
              </button>
            </li>
          </ul>
          <p v-else-if="!loading" class="empty-state">Belum ada tanggal khusus.</p>
        </section>
      </div>

      <aside v-if="canManageCalendar" class="calendar-aside">
        <section class="panel calendar-manage-panel">
          <div class="manage-tabs" role="tablist" aria-label="Panel pengelolaan kalender">
            <button class="manage-tab" :class="{ active: activeTab === 'date' }" type="button" role="tab" :aria-selected="activeTab === 'date'" @click="activeTab = 'date'">Tambah tanggal</button>
            <button class="manage-tab" :class="{ active: activeTab === 'category' }" type="button" role="tab" :aria-selected="activeTab === 'category'" @click="activeTab = 'category'">Kelola kategori</button>
          </div>

        <div v-show="activeTab === 'date'" id="calendar-entry-form" class="manage-tab-content">
          <div class="calendar-panel-heading">
            <h2>{{ editingId ? 'Ubah tanggal' : 'Tambah tanggal' }}</h2>
            <button v-if="editingId" class="button button-quiet button-small" type="button" @click="resetForm">
              <X :size="14" aria-hidden="true" /> Batal
            </button>
          </div>
          <form class="calendar-form" @submit.prevent="saveCalendar">
            <p v-if="formError" class="alert alert-danger" role="alert">{{ formError }}</p>

            <div class="field">
              <label for="cf-version">Versi kalender</label>
              <select id="cf-version" v-model="form.calendarVersionId" required :disabled="Boolean(editingId)">
                <option value="" disabled>Pilih versi</option>
                <option v-for="version in editableVersions" :key="version.id" :value="String(version.id)">
                  {{ version.name }} · {{ versionLabel(version.status) }}
                </option>
              </select>
            </div>

            <div class="field">
              <label for="cf-date">Tanggal</label>
              <div class="calendar-input-icon">
                <CalendarDays :size="15" aria-hidden="true" />
                <input id="cf-date" v-model="form.calendarDate" type="date" required />
              </div>
            </div>

            <div class="field">
              <label for="cf-type">Jenis tanggal</label>
              <select id="cf-type" v-model="form.dateType" required>
                <option value="" disabled>Pilih kategori</option>
                <option v-for="category in categories" :key="category.code" :value="category.code">
                  {{ category.name }} · {{ behaviorLabel[category.behavior] || category.behavior }}
                </option>
              </select>
            </div>

            <div class="field">
              <label for="cf-title">Judul</label>
              <input id="cf-title" v-model.trim="form.title" type="text" minlength="3" maxlength="150" required placeholder="Contoh: Hari Raya Nyepi" />
            </div>

            <div class="field">
              <label for="cf-desc">Keterangan (opsional)</label>
              <textarea id="cf-desc" v-model.trim="form.description" rows="2" placeholder="Tambahan konteks untuk pegawai"></textarea>
            </div>

            <div class="field">
              <label for="cf-scope">Cakupan</label>
              <select id="cf-scope" v-model="form.scopeType" @change="form.unitId = ''">
                <option value="ALL">Semua unit</option>
                <option value="UNIT">Unit tertentu</option>
              </select>
            </div>

            <div v-if="form.scopeType === 'UNIT'" class="field">
              <label for="cf-unit">Unit kerja</label>
              <select id="cf-unit" v-model="form.unitId" required>
                <option value="" disabled>Pilih unit</option>
                <option v-for="unit in units" :key="unit.id" :value="String(unit.id)">{{ unit.name }}</option>
              </select>
            </div>

            <label class="calendar-toggle-row">
              <span>Langsung aktif</span>
              <input v-model="form.isActive" type="checkbox" role="switch" />
              <span class="calendar-switch" aria-hidden="true"><span></span></span>
            </label>

            <button class="button button-primary calendar-save-button" type="submit" :disabled="saving || !editableVersions.length">
              {{ saving ? 'Menyimpan…' : editingId ? 'Simpan perubahan' : 'Simpan tanggal' }}
            </button>
            <p v-if="!editableVersions.length" class="empty-state">Belum ada versi kalender yang dapat diubah.</p>
          </form>
        </div>

        <!-- Kelola kategori hari (Admin & HR) -->
        <div v-show="activeTab === 'category'" id="category-form-panel" class="manage-tab-content calendar-category-panel">
          <div class="calendar-panel-heading">
            <h2>Kelola kategori hari</h2>
            <button class="button button-secondary button-small" type="button" @click="showCategoryForm ? resetCategoryForm() : (showCategoryForm = true)">
              {{ showCategoryForm ? 'Tutup' : 'Tambah kategori' }}
            </button>
          </div>
          <p class="calendar-category-intro">
            Kategori bawaan dikunci. Kategori custom bisa diatur perilakunya & warnanya, lalu dipakai saat menambah tanggal.
          </p>

          <form v-if="showCategoryForm" class="calendar-form category-form" @submit.prevent="saveCategory">
            <p v-if="categoryError" class="alert alert-danger" role="alert">{{ categoryError }}</p>
            <div class="field">
              <label for="cat-name">Nama kategori</label>
              <input id="cat-name" v-model.trim="categoryForm.name" type="text" minlength="3" maxlength="100" required placeholder="Contoh: Hari Pelatihan" />
            </div>
            <div class="field">
              <label for="cat-code">Kode</label>
              <input id="cat-code" v-model.trim="categoryForm.code" type="text" required placeholder="TRAINING_DAY" :disabled="Boolean(categoryForm.id)" />
              <small class="category-hint">3–30 huruf kapital, angka, atau garis bawah.</small>
            </div>
            <div class="field">
              <label for="cat-behavior">Perilaku</label>
              <select id="cat-behavior" v-model="categoryForm.behavior" required>
                <option v-for="behavior in behaviors" :key="behavior" :value="behavior">{{ behaviorLabel[behavior] }} · {{ behaviorHint[behavior] }}</option>
              </select>
            </div>
            <div class="field category-color-field">
              <label for="cat-color">Warna penanda</label>
              <input id="cat-color" v-model="categoryForm.color" type="color" />
              <input v-model.trim="categoryForm.color" type="text" maxlength="7" aria-label="Kode warna hex" />
            </div>
            <div class="field">
              <label for="cat-desc">Keterangan (opsional)</label>
              <textarea id="cat-desc" v-model.trim="categoryForm.description" rows="2"></textarea>
            </div>
            <div class="category-form-actions">
              <button class="button button-primary button-small" type="submit" :disabled="savingCategory">
                {{ savingCategory ? 'Menyimpan…' : categoryForm.id ? 'Simpan perubahan' : 'Tambah kategori' }}
              </button>
              <button class="button button-quiet button-small" type="button" @click="resetCategoryForm">Batal</button>
            </div>
          </form>

          <ul class="category-list">
            <li v-for="category in categories" :key="category.code" class="category-item">
              <i class="category-swatch" :style="{ background: category.color }"></i>
              <div class="category-info">
                <strong>{{ category.name }}</strong>
                <small>{{ category.code }} · {{ behaviorLabel[category.behavior] || category.behavior }}</small>
              </div>
              <span v-if="category.is_system" class="category-lock">Bawaan</span>
              <div v-else class="category-actions">
                <button class="category-action" type="button" title="Ubah" aria-label="Ubah kategori" @click="editCategory(category)"><Pencil :size="15" aria-hidden="true" /></button>
                <button class="category-action category-action-danger" type="button" title="Hapus" aria-label="Hapus kategori" @click="deleteCategory(category)"><X :size="15" aria-hidden="true" /></button>
              </div>
            </li>
          </ul>
        </div>
        </section>
      </aside>
    </div>

    <div v-if="showImportModal" class="modal-backdrop-overlay" @click.self="showImportModal = false">
      <div class="modal-form-card" role="dialog" aria-labelledby="import-title">
        <div class="modal-form-header">
          <h3 id="import-title">Impor kalender dari CSV</h3>
          <button class="button button-quiet button-small" type="button" @click="showImportModal = false">
            <X :size="16" aria-hidden="true" />
          </button>
        </div>
        <div class="modal-form-body">
          <div class="field">
            <label for="import-file">File CSV</label>
            <p class="import-hint">Kolom: <code>date,type,title,description,scopetype,isactive</code>. Contoh: <code>2026-12-25,NATIONAL_HOLIDAY,Hari Raya Natal,,ALL,true</code></p>
            <input id="import-file" type="file" accept=".csv" @change="e => previewImport(e.target.files[0])" />
          </div>
          <div v-if="importErrors.length" class="alert alert-danger" role="alert">
            <p v-for="(err, i) in importErrors" :key="i">{{ err.error }}</p>
          </div>
          <div v-if="importPreview" class="import-preview">
            <p><strong>{{ importPreview.validRows }}</strong> baris valid</p>
            <div class="table-wrap">
              <table class="import-table">
                <thead><tr><th>Tanggal</th><th>Jenis</th><th>Judul</th><th>Status</th></tr></thead>
                <tbody>
                  <tr v-for="(row, i) in importPreview.rows" :key="i" :class="{ 'import-dup': row.duplicateInDb }">
                    <td>{{ row.date }}</td>
                    <td>{{ row.type }}</td>
                    <td>{{ row.title }}</td>
                    <td>{{ row.duplicateInDb ? 'Duplikat' : 'Baru' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="button button-secondary" type="button" @click="showImportModal = false">Tutup</button>
          <button
            class="button button-primary"
            type="button"
            :disabled="!importPreview?.rows?.length || importing"
            @click="commitImport"
          >
            <Upload :size="14" aria-hidden="true" /> {{ importing ? 'Mengimpor…' : 'Konfirmasi impor' }}
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.calendar-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(340px, 392px);
  max-width: 100%;
  gap: 20px;
  align-items: start;
}
.calendar-layout-solo { grid-template-columns: minmax(0, 1fr); }

@media (max-width: 1200px) {
  .calendar-layout { grid-template-columns: 1fr; }
}
@media (max-width: 640px) {
  .calendar-toolbar { flex-wrap: wrap; }
  .calendar-toolbar-side { width: 100%; }
  .calendar-version-picker { flex: 1 1 auto; min-width: 0; }
  .calendar-version-picker select { max-width: 100%; width: 100%; }
  .calendar-legend-bar { gap: 8px 12px; }
}

/* Kolom kiri: kalender + daftar terbaru ditumpuk rapi */
.calendar-main { display: grid; gap: 20px; min-width: 0; }

.calendar-panel {
  padding: 20px;
  min-width: 0;
}

.calendar-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 32px;
  margin-bottom: 16px;
}

.calendar-nav,
.calendar-toolbar-side {
  display: flex;
  align-items: center;
  gap: 8px;
}

.calendar-icon-button {
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  border: 0;
  border-radius: 8px;
  background: var(--subtle);
  color: var(--muted);
  cursor: pointer;
}
.calendar-icon-button:hover { background: var(--subtle); color: var(--ink); }

.calendar-month {
  margin: 0 4px;
  font-size: 16px;
  font-weight: 700;
  color: var(--ink);
  white-space: nowrap;
}

.calendar-today-button {
  height: 32px;
  padding: 0 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}
.calendar-today-button:hover { background: var(--subtle); }

/* Legenda dipindah ke bawah grid agar selalu terlihat */
.calendar-legend-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 18px;
  margin-top: 14px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--subtle);
}
.calendar-legend {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--muted);
  white-space: nowrap;
}
.calendar-legend strong { color: var(--text); font-weight: 600; }
.calendar-legend small { color: var(--muted); font-size: 10px; }
.legend-dot {
  width: 8px;
  height: 8px;
  border-radius: 2px;
  flex: 0 0 auto;
}

.calendar-version-picker select {
  max-width: 170px;
  height: 32px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--card);
  color: var(--muted);
  font-size: 12px;
}

.calendar-weekdays {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 6px;
  margin-bottom: 6px;
}
.calendar-weekdays span {
  text-align: center;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: var(--muted);
}

.calendar-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 6px;
}

.calendar-cell {
  aspect-ratio: 1.15 / 1;
  min-height: 56px;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--card);
  color: var(--text);
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  transition: border-color 120ms ease-out;
}
.calendar-cell:hover { border-color: var(--control-border); }

.calendar-cell-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 4px;
}
.calendar-day-number {
  font-size: 12px;
  font-weight: 600;
  line-height: 1.2;
}
.calendar-cell-month {
  font-size: 9px;
  font-weight: 600;
  color: var(--muted);
}
.calendar-cell-tag {
  align-self: flex-start;
  font-size: 9px;
  font-weight: 600;
  line-height: 1.1;
}

.calendar-cell.is-outside {
  background: var(--page);
  color: var(--muted);
}
.calendar-cell.is-weekend {
  background: var(--subtle);
  border-color: var(--divider);
  color: var(--muted);
}
.calendar-cell.has-special {
  background: var(--cell-soft);
  border-color: var(--cell-color);
  color: var(--cell-color);
  cursor: pointer;
}
.calendar-cell.has-special:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}
.calendar-cell.is-today {
  background: var(--card);
  border-color: var(--primary);
  color: var(--primary);
}

.calendar-info {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-top: 16px;
  padding: 12px 16px;
  border-radius: 10px;
  background: var(--subtle);
}
.calendar-info-icon { color: var(--primary); flex: 0 0 auto; margin-top: 1px; }
.calendar-info p {
  margin: 0 0 2px;
  font-size: 13px;
  font-weight: 700;
  color: var(--ink);
}
.calendar-info span {
  font-size: 12px;
  line-height: 1.45;
  color: var(--muted);
}

.calendar-aside { min-width: 0; }

/* Panel manajemen bertab (Admin & HR) */
.calendar-manage-panel { padding: 0; overflow: hidden; }
.manage-tabs {
  display: flex;
  gap: 0;
  border-bottom: 1px solid var(--border);
  background: var(--subtle);
}
.manage-tab {
  flex: 1;
  min-height: 44px;
  padding: 0 12px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--muted);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.manage-tab:hover:not(.active) { color: var(--ink); }
.manage-tab.active { border-bottom-color: var(--primary); color: var(--primary); background: var(--card); }
.manage-tab-content { padding: 20px; }
.manage-tab-content .calendar-panel-heading { margin-bottom: 14px; }
.manage-tab-content .calendar-panel-heading h2 { font-size: 16px; }

.calendar-panel-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}
.calendar-panel-heading h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: var(--ink);
}
.calendar-panel-heading .button { gap: 6px; }

.calendar-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.calendar-form .field input,
.calendar-form .field select,
.calendar-form .field textarea {
  height: 44px;
  padding: 0 12px;
  border: 1px solid var(--control-border);
  border-radius: var(--radius-control);
  font-size: 13px;
  color: var(--text);
  background: var(--card);
}
.calendar-form .field textarea { height: auto; min-height: 68px; padding: 10px 12px; resize: vertical; }
.calendar-form .field label { margin-bottom: 6px; font-size: 12px; font-weight: 600; color: var(--text); }

.calendar-input-icon { position: relative; }
.calendar-input-icon > svg {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--muted);
  pointer-events: none;
}
.calendar-input-icon input { padding-left: 36px !important; }

.calendar-toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: var(--text);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.calendar-toggle-row > input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
}

.calendar-switch {
  width: 38px;
  height: 22px;
  padding: 3px;
  border: 0;
  border-radius: 11px;
  background: var(--border);
  flex: 0 0 auto;
  cursor: pointer;
  transition: background 120ms ease;
}
.calendar-switch > span {
  display: block;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--card);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
  transition: transform 120ms ease;
}
.calendar-toggle-row input:checked + .calendar-switch,
.calendar-switch[aria-checked="true"] { background: var(--primary); }
.calendar-toggle-row input:checked + .calendar-switch > span,
.calendar-switch[aria-checked="true"] > span { transform: translateX(16px); }
.calendar-toggle-row input:focus-visible + .calendar-switch,
.calendar-switch:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }

.calendar-switch-small { width: 30px; height: 18px; padding: 3px; }
.calendar-switch-small > span { width: 12px; height: 12px; }
.calendar-switch-small[aria-checked="true"] > span { transform: translateX(12px); }
.calendar-switch:disabled { opacity: 0.5; cursor: not-allowed; }

.calendar-save-button { min-height: 44px; margin-top: 2px; }

.calendar-recent-panel { padding: 20px; }
.calendar-recent-list { list-style: none; margin: 0; padding: 0; }
.calendar-recent-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px solid var(--border);
}
.calendar-recent-item:first-child { padding-top: 0; }
.calendar-recent-item:last-child { border-bottom: 0; padding-bottom: 0; }

.calendar-recent-chip {
  width: 40px;
  height: 38px;
  flex: 0 0 auto;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  line-height: 1.1;
}
.calendar-recent-chip strong { font-size: 14px; font-weight: 700; }
.calendar-recent-chip span { font-size: 9px; font-weight: 600; text-transform: uppercase; }

.calendar-recent-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
}
.calendar-recent-title,
.calendar-recent-title-static {
  max-width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  font-size: 13px;
  font-weight: 600;
  color: var(--ink);
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.calendar-recent-title { cursor: pointer; display: inline-flex; align-items: center; gap: 4px; }
.calendar-recent-title:hover { color: var(--primary-dark); }
.calendar-recent-title svg { flex: 0 0 auto; opacity: 0.6; }

.calendar-recent-badge {
  min-height: 22px;
  padding: 3px 8px;
  border-radius: 999px;
  border: 1px solid transparent;
  display: inline-flex;
  align-items: center;
  font-size: 10px;
  font-weight: 650;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

/* Kelola kategori */
.calendar-category-intro { margin: 0 0 18px; color: var(--text); font-size: 12px; line-height: 1.6; }
.category-form { padding: 16px; margin-bottom: 18px; border: 1px solid var(--border); border-radius: 10px; background: var(--subtle); }
.category-hint { display: block; margin-top: 6px; color: var(--muted); font-size: 11px; }
.category-color-field { display: flex; align-items: center; gap: 12px; }
.category-color-field input[type="color"] { width: 48px; height: 44px; padding: 3px; border: 1px solid var(--border); border-radius: 8px; background: var(--card); cursor: pointer; }
.category-color-field input[type="text"] { flex: 1; min-width: 0; height: 44px; padding: 0 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--card); color: var(--text); font-size: 13px; }
.category-form-actions { display: flex; gap: 8px; }
.category-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.category-item { display: flex; align-items: center; gap: 12px; min-height: 64px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 10px; background: var(--card); }
.category-swatch { width: 12px; height: 12px; flex: 0 0 auto; border-radius: 3px; }
.category-info { flex: 1; min-width: 0; display: grid; gap: 3px; }
.category-info strong { color: var(--ink); font-size: 12.5px; font-weight: 600; }
.category-info small { color: var(--muted); font-size: 10.5px; }
.category-lock { padding: 3px 8px; border-radius: var(--radius-control); background: var(--subtle); color: var(--muted); font-size: 10px; font-weight: 600; }
.category-actions { display: flex; gap: 2px; flex: 0 0 auto; }
.category-action { width: 44px; height: 44px; flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; border: 0; border-radius: var(--radius-control); background: transparent; color: var(--muted); cursor: pointer; }
.category-action:hover { background: var(--subtle); color: var(--ink); }
.category-action:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
.category-action-danger:hover { background: var(--danger-bg); color: var(--danger-text); }

.import-hint { margin: 0 0 8px; font-size: 12px; line-height: 1.5; color: var(--muted); }
.import-hint code { font-size: 11px; }
.import-preview > p { margin: 0 0 8px; font-size: 13px; color: var(--text); }
.import-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.import-table th,
.import-table td { padding: 8px; text-align: left; border-bottom: 1px solid var(--border); }
.import-table th { color: var(--muted); font-weight: 700; text-transform: uppercase; font-size: 9.5px; letter-spacing: 0.06em; }
.import-dup { background: var(--warning-bg); }

/* Mobile diletakkan paling akhir agar mengalahkan aturan dasar di atasnya
   (specificity sama, CSS terakhir yang menang). Sel dimampukkan supaya angka
   dan tag ("Libur"/"Hari ini") tidak terpotong pada lebar 7 kolom ponsel. */
@media (max-width: 640px) {
  .calendar-panel { padding: 14px; }
  .calendar-weekdays,
  .calendar-grid { gap: 4px; }
  .calendar-cell {
    aspect-ratio: auto;
    min-height: 48px;
    padding: 5px 4px;
  }
  .calendar-day-number { font-size: 11px; }
  .calendar-cell-month { display: none; }
  .calendar-cell-tag {
    max-width: 100%;
    font-size: 8px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
}
</style>
