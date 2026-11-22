<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { downloadPdf } from './download.js'
import { confirmAction, successDialog } from './sweetalert.js'
import {
  ArrowLeft, CalendarDays, ChevronDown, CircleHelp, Download, LogOut, Plus,
  RotateCcw, Settings2, Upload, UserRound, X,
} from 'lucide-vue-next'
import AdminManagement from './components/AdminManagement.vue'
import AdminDirectory from './components/AdminDirectory.vue'
import AdminQueue from './components/AdminQueue.vue'
import AdminVerificationDetail from './components/AdminVerificationDetail.vue'
import ApprovalQueue from './components/ApprovalQueue.vue'
import ApprovalVerificationDetail from './components/ApprovalVerificationDetail.vue'
import ProfilePage from './components/ProfilePage.vue'
import CalendarManagement from './components/CalendarManagement.vue'
import BalanceDetails from './components/BalanceDetails.vue'
import CancellationPage from './components/CancellationPage.vue'
import EmployeeDashboard from './components/EmployeeDashboard.vue'
import LeaveRequestForm from './components/LeaveRequestForm.vue'
import PreviewSignPage from './components/PreviewSignPage.vue'
import RequestDetail from './components/RequestDetail.vue'
import RequestHistory from './components/RequestHistory.vue'
import ReportsManagement from './components/ReportsManagement.vue'
import AuditLogManagement from './components/AuditLogManagement.vue'
import TeamManagement from './components/TeamManagement.vue'
import MetricCard from './components/MetricCard.vue'
import StatusPill from './components/StatusPill.vue'
import AppTopBar from './components/AppTopBar.vue'
import MobileNavDrawer from './components/MobileNavDrawer.vue'
import PageHeader from './components/PageHeader.vue'
import StateView from './components/StateView.vue'
import { statusLabel } from './status.js'
import { navItemsFor } from './nav.js'
import { formatDateRange } from './dates.js'

const user = ref(null)
const calendarRef = ref(null)
const cancelRef = ref(null)
const previewRef = ref(null)
const previewRequestId = ref(null)
const blackoutInfo = ref(null)
const balanceData = ref(null)
const balanceYear = ref(new Date().getFullYear())
const historyCounts = reactive({ total: 0, draft: 0, pending: 0, approved: 0, rejected: 0, returned: 0, cancelled: 0 })
const cancelReturnView = ref('detail')
const approvalStatus = ref('pending')
const approvalLoadedStatus = ref('pending')
const approvalSort = reactive({ by: 'submittedAt', dir: 'desc' })
const approvalCounts = reactive({
  pending: 0, approved: 0, rejected: 0,
  forward: 0, final: 0, overdue: 0, today: 0, leaveTypes: 0, units: 0,
})
const approvalItems = ref([])
// VITE_USER_NODE_ENV berasal dari NODE_ENV di .env; daftar akun demo hanya
// tampil saat NODE_ENV=local. VITE_SHOW_DEMO_LOGIN tetap dipakai untuk build demo.
const isDevelopment = import.meta.env.VITE_USER_NODE_ENV === 'local'
  || import.meta.env.VITE_SHOW_DEMO_LOGIN === 'true'
const view = ref('login')

// Topbar & sidebar (desain FigCraft)
const globalSearch = ref('')
const globalFilter = ref('')
const accountMenuOpen = ref(false)
const guideOpen = ref(false)
const drawerOpen = ref(false)
const returnView = ref('dashboard')
const requestId = ref(null)
const loginForm = reactive({ username: '', password: '' })

// Akun demo untuk bubble login cepat (hanya ditampilkan di lingkungan development)
const demoPassword = 'Cuti123!'
const demoBubbleOpen = ref(false)
const demoAccounts = [
  { username: 'admin', label: 'Admin', role: 'Administrator' },
  { username: 'analis', label: 'Analis SDM', role: 'HR_ANALYST' },
  { username: 'kasubag', label: 'Kasubag', role: 'KASUBAG' },
  { username: 'kepsta', label: 'Kepsta', role: 'Keputusan akhir' },
  { username: 'ppk', label: 'PPK', role: 'Keputusan PPK' },
  { username: 'pns_tu', label: 'PNS TU', role: 'Pegawai' },
  { username: 'pns', label: 'PNS non-TU', role: 'Pegawai' },
  { username: 'pppk_tu', label: 'PPPK/PPNPN TU', role: 'Pegawai' },
  { username: 'pppk', label: 'PPPK/PPNPN non-TU', role: 'Pegawai' },
  { username: 'kontrak', label: 'Kontrak', role: 'Pegawai' },
]

function fillDemoAccount(account) {
  loginForm.username = account.username
  loginForm.password = demoPassword
  pageError.value = ''
  demoBubbleOpen.value = false
}
const leaveForm = reactive({
  leaveTypeCode: '',
  startDate: '',
  workingDays: 1,
  reason: '',
  address: '',
  phone: '',
})
const queueSearch = ref('')
const actionNotes = ref('')
const decision = ref('APPROVED')
const selectedFiles = ref([])
const existingAttachments = ref([])
const signatureFile = ref(null)
const signatureCanvas = ref(null)
const hasDrawnSignature = ref(false)
let drawingSignature = false
const dashboard = ref(null)
const queue = ref([])
const history = ref([])
const historyFilters = reactive({ year: '', leaveType: '', status: '', startDate: '', endDate: '', q: '', sortBy: 'submittedAt', sortDir: 'desc' })
const historyPage = ref(0)
// Ukuran halaman riwayat — juga dikirim ke komponen pager (20 item/halaman).
const historyPageSize = 20
const historyTotal = ref(0)
const historyYears = ref([])
const historyStatuses = [
  { value: 'DRAFT', label: 'Draf' },
  { value: 'SUBMITTED', label: 'Menunggu verifikasi' },
  { value: 'ADMIN_REVIEW', label: 'Menunggu verifikasi' },
  { value: 'ADMIN_VERIFIED', label: 'Terverifikasi' },
  { value: 'PERTIMBANGAN_REVIEW', label: 'Pertimbangan SDM' },
  { value: 'KASUBAG_REVIEW', label: 'Antrean Kasubag' },
  { value: 'KEPSTA_REVIEW', label: 'Antrean Kepsta' },
  { value: 'PPK_REVIEW', label: 'Antrean PPK' },
  { value: 'RETURNED_FOR_REVISION', label: 'Dikembalikan' },
  { value: 'APPROVED', label: 'Disetujui' },
  { value: 'REJECTED', label: 'Ditolak' },
  { value: 'WITHDRAWN', label: 'Dibatalkan pegawai' },
  { value: 'CANCELLED', label: 'Dibatalkan Admin' },
]
const requestDetail = ref(null)
const leaveTypes = ref([])
const preview = ref(null)
const loading = ref(false)
const pageError = ref('')
const formError = ref('')
const notice = ref('')
const signing = ref(false)
const submittingAction = ref(false)
const downloadingFinal = ref(false)

async function downloadFinalPdf(request) {
  if (downloadingFinal.value) return
  downloadingFinal.value = true
  pageError.value = ''
  try {
    await downloadPdf(`/api/requests/${request.id}/pdf`, `Formulir-Cuti-${request.requestNumber}.pdf`)
  } catch (error) {
    pageError.value = errorText(error)
  } finally {
    downloadingFinal.value = false
  }
}

// Foto profil (avatar) untuk ditampilkan di topbar
const profileAvatarUrl = ref('')

// Notifikasi
const notifPanel = ref(false)
const notifications = ref([])
const notifUnread = ref(0)
const notifLoading = ref(false)
const notifError = ref('')
let notifPollTimer = null

function startNotifPoll() {
  stopNotifPoll()
  loadNotifications()
  loadAvatar()
  notifPollTimer = setInterval(loadNotifications, 30000)
}
function stopNotifPoll() {
  if (notifPollTimer) { clearInterval(notifPollTimer); notifPollTimer = null }
}
async function loadNotifications() {
  notifLoading.value = true
  notifError.value = ''
  try {
    const data = await api('/notifications')
    notifications.value = data.items || []
    notifUnread.value = Number(data.unreadCount || 0)
  } catch (error) {
    notifError.value = errorText(error)
  } finally {
    notifLoading.value = false
  }
}

async function loadAvatar() {
  // GET avatar mengembalikan 200 + gambar bila ada, 204 bila tidak ada.
  try {
    const res = await fetch('/api/profile/avatar', { credentials: 'same-origin' })
    profileAvatarUrl.value = res.status === 200 ? `/api/profile/avatar?t=${Date.now()}` : ''
  } catch (_) {
    profileAvatarUrl.value = ''
  }
}
async function markNotifRead(id) {
  // Endpoint membaca notifikasi adalah POST (bukan GET)
  await api(`/notifications/${id}/read`, { method: 'POST' })
  await loadNotifications()
}
async function markAllNotifRead() {
  const ok = await confirmAction({
    title: 'Tandai semua pemberitahuan dibaca?',
    text: 'Semua pemberitahuan akan ditandai sudah dibaca.',
    confirmText: 'Ya, tandai',
    icon: 'info',
  })
  if (!ok) return
  try {
    await api('/notifications/read-all', { method: 'POST' })
    await loadNotifications()
  } catch (error) {
    pageError.value = errorText(error)
  }
}

async function clearNotifAll() {
  if (!notifications.value.length) return
  const ok = await confirmAction({
    title: 'Hapus semua pemberitahuan?',
    text: 'Seluruh pemberitahuan akan dihapus. Tindakan ini tidak dapat dibatalkan.',
    confirmText: 'Ya, hapus',
    danger: true,
  })
  if (!ok) return
  try {
    await api('/notifications', { method: 'DELETE' })
    notifications.value = []
    notifUnread.value = 0
  } catch (error) {
    pageError.value = errorText(error)
  }
}

async function clearNotifItem(id) {
  const ok = await confirmAction({
    title: 'Hapus pemberitahuan ini?',
    text: 'Pemberitahuan akan dihapus dari daftar Anda.',
    confirmText: 'Ya, hapus',
    danger: true,
  })
  if (!ok) return
  try {
    await api(`/notifications/${id}`, { method: 'DELETE' })
    await loadNotifications()
  } catch (error) {
    pageError.value = errorText(error)
  }
}

async function handleNotifClick(notification) {
  // Tutup dropdown lebih dulu agar terasa responsif
  notifPanel.value = false
  // Tandai dibaca tanpa menghalangi navigasi bila gagal
  try {
    await markNotifRead(notification.id)
  } catch (error) {
    pageError.value = errorText(error)
  }
  if (notification.leave_request_id) {
    await openDetail(notification.leave_request_id, view.value)
  }
}
// Pembatalan Mandiri Pegawai (Layar 16)
const showWithdrawModal = ref(false)
const withdrawReasonInput = ref('')
const submittingWithdraw = ref(false)

// Pembatalan oleh Admin (Layar 19)
const submittingCancel = ref(false)

async function submitWithdrawal() {
  const detail = requestDetail.value
  if (!detail) return
  const reason = withdrawReasonInput.value.trim()
  if (reason.length < 10) {
    pageError.value = 'Alasan pembatalan wajib diisi, minimal 10 karakter.'
    return
  }
  submittingWithdraw.value = true
  pageError.value = ''
  try {
    const res = await api(`/requests/${encodeURIComponent(detail.id)}/withdraw`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    })
    showWithdrawModal.value = false
    withdrawReasonInput.value = ''
    await loadViewData('detail')
    notice.value = res.message || 'Pengajuan cuti berhasil ditarik dan dibatalkan.'
    await successDialog({
      title: 'Pengajuan ditarik',
      text: res.message || 'Pengajuan cuti ditarik dan dibatalkan.',
    })
  } catch (err) {
    pageError.value = errorText(err)
  } finally {
    submittingWithdraw.value = false
  }
}

function openCancelPage() {
  if (!requestDetail.value) return
  cancelReturnView.value = view.value
  view.value = 'cancel'
}

function backFromCancel() {
  openDetail(requestId.value, cancelReturnView.value === 'queue' ? 'queue' : 'detail')
}

async function runCancellation(payload) {
  const detail = requestDetail.value
  if (!detail) return
  const ok = await confirmAction({
    title: 'Batalkan pengajuan cuti ini?',
    text: 'Pembatalan oleh Admin tercatat pada pengajuan dan reservasi saldo dilepas.',
    confirmText: 'Ya, batalkan',
    danger: true,
  })
  if (!ok) return
  submittingCancel.value = true
  pageError.value = ''
  try {
    const res = await api(`/requests/${encodeURIComponent(detail.id)}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ ...payload, idempotencyKey: `CANCEL:${detail.id}:${Date.now()}` }),
    })
    notice.value = res.message || 'Cuti berhasil dibatalkan oleh Admin.'
    await openDetail(detail.id, cancelReturnView.value === 'queue' ? 'queue' : 'detail')
    await successDialog({
      title: 'Cuti dibatalkan',
      text: res.message || 'Pengajuan cuti dibatalkan oleh Admin.',
    })
  } catch (err) {
    pageError.value = errorText(err)
  } finally {
    submittingCancel.value = false
  }
}

const employeeView = computed(() => {
  const staffRoles = ['ADMIN', 'HR_ANALYST', 'KASUBAG', 'KEPSTA', 'PPK']
  return Boolean(user.value?.employee)
    && !user.value.roles.some((role) => staffRoles.includes(role.code))
})
const roleLabel = computed(() => {
  const roles = user.value?.roles?.map((role) => roleLabelFor(role.code)) || []
  return roles.join(' · ') || 'Pegawai'
})
const filteredQueue = computed(() => {
  const term = queueSearch.value.trim().toLocaleLowerCase('id')
  if (!term) return queue.value
  return queue.value.filter((item) =>
    [item.request_number, item.employee_name, item.employee_unit_name, item.leave_type_name]
      .some((value) => String(value || '').toLocaleLowerCase('id').includes(term)),
  )
})
const queueStageCards = computed(() => {
  const stages = ['ADMIN_REVIEW', 'PERTIMBANGAN_REVIEW', 'KASUBAG_REVIEW', 'KEPSTA_REVIEW', 'PPK_REVIEW']
  return stages.map((stageCode) => {
    const items = filteredQueue.value.filter((item) => item.stage_code === stageCode)
    return {
      stageCode,
      label: ({
        ADMIN_REVIEW: 'Menunggu verifikasi',
        PERTIMBANGAN_REVIEW: 'Menunggu pertimbangan SDM',
        KASUBAG_REVIEW: 'Menunggu Kasubag',
        KEPSTA_REVIEW: 'Menunggu Kepsta',
        PPK_REVIEW: 'Menunggu PPK',
      })[stageCode],
      count: items.length,
      overdue: items.filter((item) => item.is_overdue).length,
      tone: items.some((item) => item.is_overdue) ? 'amber' : 'blue',
    }
  }).filter((card) => card.count > 0 || queue.value.some((item) => item.stage_code === card.stageCode))
})
const selectedLeaveType = computed(() =>
  leaveTypes.value.find((item) => item.code === leaveForm.leaveTypeCode) || null,
)
const needsAttachment = computed(() =>
  selectedLeaveType.value?.requires_attachment
  && selectedFiles.value.length < Number(selectedLeaveType.value.attachment_min_count || 0),
)
const insufficientBalance = computed(() =>
  Boolean(preview.value?.annualBalance && Number(preview.value.annualBalance.remainingAfter) < 0),
)
const canManageCalendar = computed(() =>
  (user.value?.roles || []).some(role => role.code === 'ADMIN' || role.code === 'HR_ANALYST')
)
const isAdmin = computed(() => (user.value?.roles || []).some(role => role.code === 'ADMIN'))
const approvalRole = computed(() => {
  const codes = (user.value?.roles || []).map(role => role.code)
  return ['HR_ANALYST', 'KASUBAG', 'KEPSTA', 'PPK'].find(code => codes.includes(code)) || ''
})

// Sidebar desktop dan drawer mobile memakai daftar menu yang sama dari src/nav.js
const settingsOpen = ref(false)
const navItems = computed(() => navItemsFor({
  employeeView: employeeView.value,
  isAdmin: isAdmin.value,
  queueLabel: isAdmin.value ? 'Antrean Verifikasi' : queueTitle(),
  hasEmployee: Boolean(user.value?.employee),
}))
const mainNavItems = computed(() => navItems.value.filter(item => !item.group))
const settingsNavItems = computed(() => navItems.value.filter(item => item.group === 'settings'))
const navBadge = (viewName) => {
  if (viewName === 'queue') {
    const count = approvalRole.value ? Number(approvalCounts.pending || 0) : Number(dashboard.value?.waiting || 0)
    return count > 0 ? count : null
  }
  return null
}
const displayedApprovalItems = computed(() => {
  const term = globalFilter.value.trim().toLocaleLowerCase('id')
  if (!term) return approvalItems.value
  return approvalItems.value.filter(item =>
    [item.request_number, item.employee_name, item.employee_unit_name, item.leave_type_name]
      .some(value => String(value || '').toLocaleLowerCase('id').includes(term)),
  )
})
const approvalPageTitle = computed(() => ({
  HR_ANALYST: 'Pertimbangan SDM',
  KASUBAG: 'Antrean Kasubag',
  KEPSTA: 'Keputusan akhir',
  PPK: 'Keputusan PPK',
})[approvalRole.value] || queueTitle())
const pageTitle = computed(() => {
  if (view.value === 'dashboard') return 'Cuti saya'
  if (view.value === 'request-form') return 'Ajukan cuti'
  if (view.value === 'history') return 'Riwayat pengajuan'
  if (view.value === 'balance') return 'Saldo & rincian cuti'
  if (view.value === 'queue') return approvalPageTitle.value
  if (view.value === 'directory') return 'Pegawai & cuti'
  if (view.value === 'admin-master') return 'Pengelolaan data'
  if (view.value === 'calendar') return 'Kalender kerja'
  if (view.value === 'reports') return 'Laporan cuti'
  if (view.value === 'audit') return 'Audit log'
  if (view.value === 'verify') return 'Verifikasi dokumen'
  if (view.value === 'teams') return 'Tim kerja'
  if (view.value === 'profile') return 'Profil saya'
  if (view.value === 'detail') return 'Detail pengajuan'
  if (view.value === 'cancel') return 'Pembatalan cuti'
  if (view.value === 'preview') return 'Pratinjau pengajuan'
  return ''
})
const pageSubtitle = computed(() => {
  if (view.value === 'dashboard') return 'Ringkasan saldo dan pengajuan cuti Anda.'
  if (view.value === 'request-form') return 'Tanggal selesai dihitung dari hari kerja dan kalender aktif.'
  if (view.value === 'history') return 'Status dan jadwal seluruh pengajuan Anda.'
  if (view.value === 'balance') return 'Kuota, terpakai, reservasi, dan rincian transaksi saldo.'
  if (view.value === 'queue') {
    if (approvalRole.value) return 'Pengajuan yang menunggu tinjauan dan keputusan Anda.'
    if (isAdmin.value) {
      return `${dashboard.value?.waiting || 0} pengajuan menunggu pemeriksaan · ${dashboard.value?.overdue || 0} melewati SLA`
    }
    return 'Pengajuan yang berada dalam lingkup tugas Anda.'
  }
  if (view.value === 'directory') return 'Saldo cuti tahunan, pemakaian, dan cuti aktif atau berikutnya.'
  if (view.value === 'verify') return 'Periksa token QR pada dokumen final untuk melihat status dan penandatangan.'
  if (view.value === 'calendar') return 'Hari libur dan tanggal larangan cuti yang memengaruhi perhitungan.'
  if (view.value === 'profile') return 'Kelola foto profil dan tanda tangan digital Anda.'
  if (view.value === 'reports') return 'Rekap periode, unit, dan pembatalan · Tahun 2026'
  if (view.value === 'audit') return 'Jejak tindakan administratif. Catatan audit bersifat tetap.'
  return 'Ringkasan, tahapan, dan tindakan sesuai kewenangan.'
})
const canRetryLoad = computed(() =>
  ['dashboard', 'queue', 'directory', 'history', 'detail', 'request-form'].includes(view.value),
)

function roleLabelFor(code) {
  return ({
    EMPLOYEE: 'Pegawai',
    ADMIN: 'Admin',
    HR_ANALYST: 'SDM',
    KASUBAG: 'Kasubag',
    KEPSTA: 'Kepsta',
    PPK: 'PPK',
  })[code] || 'Pegawai'
}

function queueTitle() {
  const codes = user.value?.roles?.map((role) => role.code) || []
  if (codes.includes('ADMIN')) return 'Antrean verifikasi cuti'
  if (codes.includes('HR_ANALYST')) return 'Antrean pertimbangan SDM'
  if (codes.includes('KASUBAG')) return 'Antrean Kasubag'
  if (codes.includes('KEPSTA')) return 'Antrean keputusan Kepsta'
  if (codes.includes('PPK')) return 'Antrean keputusan PPK'
  return 'Antrean cuti'
}

function formatNumber(value) {
  return new Intl.NumberFormat('id-ID').format(Number(value || 0))
}

function formatDate(value, options = {}) {
  if (!value) return '—'
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00Z`)
  if (Number.isNaN(date.valueOf())) return '—'
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
    ...options,
  }).format(date)
}

function formatNotifDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return '—'
  return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }).format(date)
}

function formatDateTime(value) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function categoryLabel(code) {
  return ({
    PNS_TU: 'PNS · TU',
    PNS: 'PNS · non-TU',
    PPPK_PPNPN_TU: 'PPPK/PPNPN · TU',
    PPPK_PPNPN: 'PPPK/PPNPN · non-TU',
    KONTRAK: 'Kontrak',
  })[code] || code || '—'
}

function canViewPreview(detail) {
  if (!detail) return false
  if (detail.status === 'APPROVED') return true
  const role = user.value?.roles || []
  return role.includes('ADMIN') || role.includes('HR_ANALYST') ||
         role.includes('KASUBAG') || role.includes('KEPSTA') || role.includes('PPK')
}

function errorText(error) {
  return error instanceof Error ? error.message : 'Permintaan gagal. Coba lagi.'
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {})
  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  const response = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    ...options,
    headers,
  })
  const contentType = response.headers.get('content-type') || ''
  const data = contentType.includes('application/json') ? await response.json() : null
  if (!response.ok) {
    const error = new Error(data?.error || `Permintaan gagal (${response.status}).`)
    error.status = response.status
    error.details = data?.details || null
    throw error
  }
  return data
}

function historyQueryString(includePagination = true) {
  const params = new URLSearchParams()
  const map = {
    year: 'year', leaveType: 'leaveType', status: 'status',
    startDate: 'startDate', endDate: 'endDate', q: 'q',
    sortBy: 'sortBy', sortDir: 'sortDir',
  }
  for (const [key, name] of Object.entries(map)) {
    if (historyFilters[key]) params.set(name, String(historyFilters[key]))
  }
  if (includePagination) {
    params.set('limit', String(historyPageSize))
    params.set('offset', String(historyPage.value * historyPageSize))
  }
  return params.toString()
}

async function loadHistory() {
  const result = await api(`/requests?${historyQueryString()}`)
  history.value = result.items
  historyTotal.value = Number(result.total ?? result.summary?.total ?? 0)
  Object.assign(historyCounts, result.summary || {})
  historyYears.value = result.years || []
}

function changeBalanceYear(year) {
  balanceYear.value = year
  if (view.value === 'balance') loadViewData('balance').catch((error) => { pageError.value = errorText(error) })
}

function applyHistoryFilters() {
  historyPage.value = 0
  loadHistory().catch((error) => { pageError.value = error.message })
}

function resetHistoryFilters() {
  Object.assign(historyFilters, { year: '', leaveType: '', status: '', startDate: '', endDate: '', q: '', sortBy: 'submittedAt', sortDir: 'desc' })
  applyHistoryFilters()
}

function changeHistoryPage(delta) {
  historyPage.value = Math.max(0, historyPage.value + delta)
  loadHistory().catch((error) => { pageError.value = error.message })
}

function mapApprovalItem(item) {
  return {
    stage_id: item.stageId,
    id: item.id,
    stage_code: item.stageCode,
    role_code: item.roleCode,
    decision_mode: item.decisionMode,
    is_overdue: item.isOverdue,
    request_number: item.requestNumber,
    request_status: item.requestStatus,
    decision: item.decision,
    employee_id: item.employeeId,
    employee_name: item.employeeName,
    employee_category: item.employeeCategory,
    employee_unit_name: item.employeeUnitName,
    start_date: item.startDate,
    end_date: item.endDate,
    requested_working_days: item.requestedWorkingDays,
    submitted_at: item.submittedAt,
    completed_at: item.completedAt,
    leave_type_name: item.leaveTypeName,
    status: item.status,
  }
}

function approvalSortQuery() {
  return `sortBy=${encodeURIComponent(approvalSort.by)}&sortDir=${encodeURIComponent(approvalSort.dir)}`
}

async function loadApprovalHistory(status = approvalStatus.value) {
  approvalLoadedStatus.value = status
  const result = await api(`/approvals?status=${encodeURIComponent(status)}&${approvalSortQuery()}`)
  Object.assign(approvalCounts, result.summary || {})
  approvalItems.value = (result.items || []).map(mapApprovalItem)
}

function changeApprovalSort(next) {
  approvalSort.by = next.by
  approvalSort.dir = next.dir
  loadApprovalHistory(approvalLoadedStatus.value).catch((error) => { pageError.value = errorText(error) })
}

async function changeApprovalStatus(status) {
  approvalStatus.value = status
  try {
    await loadApprovalHistory(status)
  } catch (error) {
    pageError.value = errorText(error)
  }
}

async function loadViewData(target = view.value) {
  pageError.value = ''
  loading.value = true
  try {
    if (target === 'dashboard') {
      const [dashboardData, types] = await Promise.all([api('/dashboard'), api('/leave-types')])
      dashboard.value = dashboardData
      leaveTypes.value = types.items || []
    } else if (target === 'balance') {
      balanceData.value = await api(`/balance-details?year=${balanceYear.value}`)
    } else if (target === 'queue') {
      const [dashboardData, queueData] = await Promise.all([api('/dashboard'), api(`/queue?${approvalSortQuery()}`)])
      dashboard.value = dashboardData
      queue.value = queueData.items
      if (isAdmin.value) {
        approvalStatus.value = 'pending'
        await loadApprovalHistory('all')
      } else {
        approvalStatus.value = 'pending'
        await loadApprovalHistory('pending')
        // Jika tidak ada antrean menunggu, otomatis tampilkan tab berisi agar halaman tidak kosong
        if (!approvalCounts.pending && (approvalCounts.approved || approvalCounts.rejected)) {
          const next = approvalCounts.approved ? 'approved' : 'rejected'
          approvalStatus.value = next
          await loadApprovalHistory(next)
        }
      }
    } else if (target === 'directory') {
      return
    } else if (target === 'admin-master') {
      return
    } else if (target === 'profile') {
      return
    } else if (target === 'calendar') {
    } else if (target === 'history') {
      await Promise.all([
        loadHistory(),
        leaveTypes.value.length ? Promise.resolve() : api('/leave-types').then((result) => { leaveTypes.value = result.items }),
      ])
    } else if (target === 'request-form') {
      const result = await api('/leave-types')
      leaveTypes.value = result.items
      if (!leaveForm.leaveTypeCode && result.items.length) {
        leaveForm.leaveTypeCode = result.items[0].code
      }
    } else if (target === 'detail' && requestId.value) {
      const result = await api(`/requests/${encodeURIComponent(requestId.value)}`)
      requestDetail.value = result.request
    } else if (target === 'preview' && previewRequestId.value) {
      const result = await api(`/requests/${encodeURIComponent(previewRequestId.value)}`)
      requestDetail.value = result.request
    }
  } catch (error) {
    pageError.value = errorText(error)
  } finally {
    loading.value = false
  }
}

async function openPage(target, item = null) {
  view.value = target
  if (target === 'history') {
    historyFilters.status = item?.cancellationOnly ? 'CANCELLED' : ''
  }
  preview.value = null
  formError.value = ''
  notice.value = ''
  if (target !== 'profile') loadAvatar()
  if (target !== 'queue') globalFilter.value = ''
  await loadViewData(target)
}

function onDrawerNavigate(item) {
  openPage(item.view, item)
}

async function openDetail(id, from) {
  returnView.value = from
  requestId.value = id
  requestDetail.value = null
  actionNotes.value = ''
  decision.value = 'APPROVED'
  view.value = 'detail'
  await loadViewData('detail')
}

async function restoreSession() {
  try {
    const result = await api('/me')
    user.value = result.user
    view.value = employeeView.value ? 'dashboard' : 'queue'
    await loadViewData()
    startNotifPoll()
  } catch (error) {
    if (error.status !== 401) pageError.value = errorText(error)
    view.value = 'login'
  }
}

async function signIn() {
  pageError.value = ''
  loading.value = true
  try {
    const result = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify(loginForm),
    })
    user.value = result.user
    view.value = employeeView.value ? 'dashboard' : 'queue'
    await loadViewData()
    startNotifPoll()
  } catch (error) {
    pageError.value = errorText(error)
  } finally {
    loading.value = false
  }
}

function submitGlobalSearch() {
  const term = globalSearch.value.trim()
  if (!term) return
  accountMenuOpen.value = false
  if (employeeView.value) {
    historyFilters.q = term
    openPage('history')
  } else {
    globalFilter.value = term
    openPage('queue')
  }
}

async function signOut() {
  try {
    await api('/auth/logout', { method: 'POST' })
  } catch (error) {
    pageError.value = errorText(error)
    return
  }
  stopNotifPoll()
  user.value = null
  view.value = 'login'
  dashboard.value = null
  queue.value = []
  notifications.value = []
  notifUnread.value = 0
}

async function calculatePreview() {
  formError.value = ''
  blackoutInfo.value = null
  preview.value = null
  try {
    if (!leaveForm.leaveTypeCode || !leaveForm.startDate || !leaveForm.workingDays) {
      throw new Error('Pilih jenis cuti, tanggal mulai, dan jumlah hari kerja.')
    }
    preview.value = await api('/preview', {
      method: 'POST',
      body: JSON.stringify(leaveForm),
    })
  } catch (error) {
    formError.value = errorText(error)
    blackoutInfo.value = error.details || null
  }
}

function onFilesChanged(event) {
  const files = Array.from(event.target.files || [])
  const acceptedTypes = ['application/pdf', 'image/jpeg', 'image/png']
  const invalid = files.find((file) => !acceptedTypes.includes(file.type) || file.size > 10 * 1024 * 1024)
  if (invalid) {
    selectedFiles.value = []
    formError.value = 'Lampiran harus PDF, JPG, atau PNG dengan ukuran maksimal 10 MB per file.'
    event.target.value = ''
    return
  }
  if (files.length > 5) {
    selectedFiles.value = []
    formError.value = 'Maksimal lima file untuk satu pengajuan.'
    event.target.value = ''
    return
  }
  selectedFiles.value = files
  formError.value = ''
}

const editingDraftId = ref(null)
const verifyToken = ref('')
const verifyResult = ref(null)
const verifyError = ref('')

async function submitRequest(mode = 'submit') {
  if (mode === 'submit' && !preview.value) {
    formError.value = 'Hitung tanggal cuti sebelum mengirim pengajuan.'
    return
  }
  if (mode === 'submit' && needsAttachment.value) {
    formError.value = `Lampirkan minimal ${selectedLeaveType.value.attachment_min_count} file untuk jenis cuti ini.`
    return
  }
  const ok = await confirmAction(mode === 'draft'
    ? {
        title: 'Simpan sebagai draf?',
        text: 'Draf dapat dilanjutkan kapan saja dari Riwayat pengajuan.',
        confirmText: 'Ya, simpan draf',
        icon: 'info',
      }
    : {
        title: 'Kirim pengajuan cuti ini?',
        text: 'Pengajuan masuk ke antrean Admin untuk verifikasi.',
        confirmText: 'Ya, kirim',
      })
  if (!ok) return
  loading.value = true
  formError.value = ''
  try {
    let result
    if (mode === 'draft' && editingDraftId.value) {
      const body = new FormData()
      for (const [key, value] of Object.entries(leaveForm)) body.append(key, String(value))
      // Kirim daftar lampiran lama yang dipertahankan agar backend tahu mana yang dihapus.
      body.append('keepAttachmentIds', JSON.stringify(existingAttachments.value.map(a => a.id)))
      for (const file of selectedFiles.value) body.append('attachments', file)
      result = await api(`/requests/${editingDraftId.value}/draft`, { method: 'PUT', body })
    } else {
      const body = new FormData()
      for (const [key, value] of Object.entries(leaveForm)) body.append(key, String(value))
      body.append('submit', mode === 'submit' ? 'true' : 'false')
      for (const file of selectedFiles.value) body.append('attachments', file)
      result = await api('/requests', { method: 'POST', body })
    }
    editingDraftId.value = null
    selectedFiles.value = []
    existingAttachments.value = []
    if (mode === 'draft') {
      notice.value = 'Draf berhasil disimpan. Anda dapat melanjutkannya dari Riwayat pengajuan.'
      await openPage('history')
      await successDialog({ title: 'Draf tersimpan', text: 'Draf dapat dilanjutkan dari Riwayat pengajuan.' })
    } else {
      notice.value = 'Pengajuan berhasil dikirim ke antrean Admin.'
      await openDetail(result.request.id, 'history')
      await successDialog({ title: 'Pengajuan terkirim', text: 'Pengajuan masuk ke antrean Admin untuk verifikasi.' })
    }
  } catch (error) {
    formError.value = errorText(error)
  } finally {
    loading.value = false
  }
}

async function submitDraft(id) {
  const ok = await confirmAction({
    title: 'Kirim pengajuan ini?',
    text: 'Pengajuan dikirim ke antrean Admin untuk diverifikasi.',
    confirmText: 'Ya, kirim',
  })
  if (!ok) return
  loading.value = true
  pageError.value = ''
  try {
    await api(`/requests/${id}/submit`, { method: 'POST' })
    notice.value = 'Pengajuan berhasil dikirim ke antrean Admin.'
    await openDetail(id, 'history')
    await successDialog({ title: 'Pengajuan terkirim', text: 'Pengajuan masuk ke antrean Admin untuk verifikasi.' })
  } catch (error) {
    pageError.value = errorText(error)
  } finally {
    loading.value = false
  }
}

function startNewRequest() {
  editingDraftId.value = null
  selectedFiles.value = []
  existingAttachments.value = []
  preview.value = null
  blackoutInfo.value = null
  Object.assign(leaveForm, { leaveTypeCode: '', startDate: '', workingDays: 1, reason: '', address: '', phone: '' })
  openPage('request-form')
}

async function ensureDraftId() {
  if (editingDraftId.value) return editingDraftId.value
  const body = new FormData()
  for (const [key, value] of Object.entries(leaveForm)) body.append(key, String(value))
  body.append('submit', 'false')
  for (const file of selectedFiles.value) body.append('attachments', file)
  const result = await api('/requests', { method: 'POST', body })
  editingDraftId.value = result.request.id
  return result.request.id
}

async function openDocumentPreview(id = null) {
  try {
    const requestIdValue = id || await ensureDraftId()
    previewRequestId.value = requestIdValue
    requestId.value = requestIdValue
    view.value = 'preview'
    await loadViewData('preview')
  } catch (error) {
    pageError.value = errorText(error)
  }
}

async function submitFromPreview() {
  if (!previewRequestId.value) return
  await submitDraft(previewRequestId.value)
}

async function savePreviewSignature(file) {
  signatureFile.value = file
  await uploadSignature()
}

async function verifyDocument() {
  verifyError.value = ''
  verifyResult.value = null
  if (!verifyToken.value.trim()) {
    verifyError.value = 'Masukkan token verifikasi dari QR code.'
    return
  }
  try {
    verifyResult.value = await api(`/verify/${encodeURIComponent(verifyToken.value.trim())}`)
  } catch (error) {
    verifyError.value = errorText(error)
  }
}

async function continueDraft(draft) {
  editingDraftId.value = draft.id
  leaveForm.leaveTypeCode = draft.leaveTypeCode || ''
  leaveForm.startDate = String(draft.startDate || '').slice(0, 10)
  leaveForm.workingDays = Number(draft.workingDays || 1)
  leaveForm.reason = draft.reason || ''
  leaveForm.address = draft.address || ''
  leaveForm.phone = draft.phone || ''
  preview.value = null
  selectedFiles.value = []
  // Muat lampiran yang sudah tersimpan pada draf agar bisa dikelola.
  try {
    const detail = await api(`/requests/${encodeURIComponent(draft.id)}`)
    existingAttachments.value = detail.request?.attachments || []
  } catch (_) {
    existingAttachments.value = []
  }
  notice.value = draft.status === 'RETURNED_FOR_REVISION'
    ? 'Perbaiki data pengajuan, lalu kirim ulang ke antrean Admin.'
    : 'Draf dimuat. Perbarui data lalu simpan atau kirim.'
  await openPage('request-form')
}

async function removeExistingAttachment(id) {
  if (!editingDraftId.value) return
  const ok = await confirmAction({
    title: 'Hapus lampiran ini?',
    text: 'Lampiran dihapus dari draf. Perubahan tersimpan saat draf disimpan.',
    confirmText: 'Ya, hapus',
    danger: true,
  })
  if (!ok) return
  try {
    await api(`/attachments/${encodeURIComponent(id)}`, { method: 'DELETE', body: JSON.stringify({ reason: 'Dihapus pemilik saat menyunting draf.' }) })
    existingAttachments.value = existingAttachments.value.filter(a => String(a.id) !== String(id))
    notice.value = 'Lampiran dihapus. Simpan draf untuk menyimpan perubahan.'
  } catch (error) {
    formError.value = errorText(error)
  }
}

function signaturePoint(event, canvas) {
  const rect = canvas.getBoundingClientRect()
  return {
    x: (event.clientX - rect.left) * (canvas.width / rect.width),
    y: (event.clientY - rect.top) * (canvas.height / rect.height),
  }
}

function startSignatureDraw(event) {
  drawingSignature = true
  const canvas = event.currentTarget
  const point = signaturePoint(event, canvas)
  const ctx = canvas.getContext('2d')
  ctx.strokeStyle = '#142f3a'
  ctx.lineWidth = 2
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(point.x, point.y)
  hasDrawnSignature.value = true
}

function drawSignature(event) {
  if (!drawingSignature) return
  const canvas = event.currentTarget
  const point = signaturePoint(event, canvas)
  const ctx = canvas.getContext('2d')
  ctx.lineTo(point.x, point.y)
  ctx.stroke()
}

function endSignatureDraw() {
  drawingSignature = false
}

function clearSignatureCanvas() {
  const canvas = signatureCanvas.value
  if (!canvas) return
  canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height)
  hasDrawnSignature.value = false
}

function saveDrawnSignature() {
  const canvas = signatureCanvas.value
  if (!canvas || !hasDrawnSignature.value) {
    pageError.value = 'Gambar tanda tangan terlebih dahulu.'
    return
  }
  canvas.toBlob((blob) => {
    if (!blob) {
      pageError.value = 'Gagal membuat gambar tanda tangan.'
      return
    }
    signatureFile.value = new File([blob], 'tanda-tangan.png', { type: 'image/png' })
    uploadSignature()
  }, 'image/png')
}

async function uploadSignature() {
  if (!signatureFile.value) {
    pageError.value = 'Pilih file tanda tangan PNG atau JPG.'
    return
  }
  const ok = await confirmAction({
    title: 'Simpan tanda tangan ini?',
    text: 'Tanda tangan dipakai pada dokumen keputusan cuti Anda.',
    confirmText: 'Ya, simpan',
  })
  if (!ok) return
  signing.value = true
  pageError.value = ''
  try {
    await api('/signature', {
      method: 'POST',
      headers: { 'Content-Type': signatureFile.value.type },
      body: signatureFile.value,
    })
    signatureFile.value = null
    hasDrawnSignature.value = false
    await loadViewData('detail')
    await successDialog({ title: 'Tanda tangan tersimpan', text: 'Tanda tangan dipakai pada dokumen keputusan cuti Anda.' })
  } catch (error) {
    pageError.value = errorText(error)
  } finally {
    signing.value = false
  }
}

async function performAction(kind) {
  const detail = requestDetail.value
  if (!detail) return
  const actionNotesValue = actionNotes.value.trim()
  if (kind === 'return' && actionNotesValue.length < 10) {
    pageError.value = 'Alasan pengembalian wajib diisi, minimal 10 karakter.'
    return
  }
  if (kind === 'decision' && decision.value === 'REJECTED' && actionNotesValue.length < 10) {
    pageError.value = 'Catatan penolakan wajib diisi, minimal 10 karakter.'
    return
  }
  if (kind === 'return') {
    const ok = await confirmAction({
      title: 'Kembalikan pengajuan ini?',
      text: 'Pengajuan dikembalikan ke pegawai untuk diperbaiki. Reservasi saldo dilepas.',
      confirmText: 'Ya, kembalikan',
      danger: true,
    })
    if (!ok) return
  }
  if (kind === 'decision' && detail.activeStage?.decision_mode === 'FINAL') {
    const outcome = decision.value === 'APPROVED' ? 'setujui' : 'tolak'
    const ok = await confirmAction({
      title: outcome === 'setujui' ? 'Setujui pengajuan ini?' : 'Tolak pengajuan ini?',
      text: outcome === 'setujui'
        ? 'Keputusan SETUJUI tercatat dan surat final dapat dibuat.'
        : 'Keputusan TIDAK DISETUJUI tercatat pada pengajuan.',
      confirmText: outcome === 'setujui' ? 'Ya, setujui' : 'Ya, tolak',
      icon: outcome === 'setujui' ? 'question' : 'warning',
      danger: outcome !== 'setujui',
    })
    if (!ok) return
  }
  if (kind === 'verify') {
    const ok = await confirmAction({
      title: 'Verifikasi & teruskan ke Analis SDM?',
      text: 'Pengajuan diteruskan ke tahap pertimbangan SDM setelah checklist diperiksa.',
      confirmText: 'Ya, verifikasi',
    })
    if (!ok) return
  }
  const action = kind === 'verify'
    ? { action: 'VERIFY' }
    : kind === 'return'
      ? { action: 'RETURN', notes: actionNotesValue }
      : detail.activeStage.role_code === 'HR_ANALYST'
        ? { action: 'PERTIMBANGAN', notes: actionNotesValue }
        : detail.activeStage.role_code === 'KASUBAG' && detail.activeStage.decision_mode === 'FORWARD'
          ? { action: 'FORWARD', notes: actionNotesValue }
          : { action: 'DECIDE', decision: decision.value, notes: actionNotesValue }
  if (action.action === 'PERTIMBANGAN' && !actionNotesValue) {
    pageError.value = 'Isi catatan pertimbangan sebelum meneruskan pengajuan.'
    return
  }
  if (['PERTIMBANGAN', 'FORWARD', 'DECIDE'].includes(action.action) && !detail.hasSignature) {
    pageError.value = 'Simpan tanda tangan internal sebelum memproses pengajuan.'
    return
  }
  submittingAction.value = true
  pageError.value = ''
  try {
    await api(`/requests/${encodeURIComponent(detail.id)}/action`, {
      method: 'POST',
      body: JSON.stringify(action),
    })
    actionNotes.value = ''
    await loadViewData('detail')
    if (returnView.value === 'queue') await loadViewData('queue')
    const feedback = {
      VERIFY: { title: 'Verifikasi selesai', text: 'Pengajuan diverifikasi dan diteruskan ke Analis SDM.' },
      PERTIMBANGAN: { title: 'Pertimbangan terkirim', text: 'Catatan pertimbangan dikirim, pengajuan diteruskan ke Kasubag.' },
      FORWARD: { title: 'Diteruskan ke Kepsta', text: 'Pengajuan diteruskan untuk keputusan akhir.' },
      RETURN: { title: 'Pengajuan dikembalikan', text: 'Pengajuan dikembalikan ke pegawai untuk diperbaiki.' },
    }[action.action]
    || (action.action === 'DECIDE'
      ? (decision.value === 'APPROVED'
        ? { title: 'Pengajuan disetujui', text: 'Keputusan setujui tercatat, surat final dapat diunduh di detail pengajuan.' }
        : { title: 'Keputusan tercatat', text: 'Pengajuan dinyatakan tidak disetujui.' })
      : null)
    if (feedback) {
      await successDialog({
        ...feedback,
        icon: action.action === 'DECIDE' && decision.value !== 'APPROVED' ? 'error' : 'success',
        timer: 2200,
      })
    }
  } catch (error) {
    pageError.value = errorText(error)
  } finally {
    submittingAction.value = false
  }
}

async function runApprovalAction({ kind, notes, decision: outcome }) {
  returnView.value = 'queue'
  actionNotes.value = notes
  decision.value = outcome
  await performAction(kind)
  await loadViewData('queue')
}

async function saveApprovalSignature(file) {
  signatureFile.value = file
  await uploadSignature()
}

async function runAdminAction({ kind, notes }) {
  actionNotes.value = notes
  await performAction(kind)
}

// Computed untuk detail keputusan yang sudah selesai (APPROVED/REJECTED)
const decisionNotes = computed(() => {
  if (!requestDetail.value?.events) return null
  const decisionEvent = [...requestDetail.value.events].reverse().find(e =>
    e.event_type === 'DECIDED' || e.event_type === 'APPROVED' || e.event_type === 'REJECTED'
  )
  return decisionEvent?.description || null
})

const decisionSignature = computed(() => {
  if (!requestDetail.value?.signatures) return null
  const role = approvalRole.value
  if (!role) return null
  return requestDetail.value.signatures.find(s => s.roleCode === role) || null
})

const decisionSignerLabel = computed(() => {
  const role = approvalRole.value
  if (role === 'KEPSTA') return 'Kepsta'
  if (role === 'KASUBAG') return 'Kasubag'
  if (role === 'PPK') return 'PPK'
  if (role === 'HR_ANALYST') return 'Analis SDM'
  if (role === 'ADMIN') return 'Admin'
  return 'Petugas'
})

function backFromDetail() {
  openPage(returnView.value)
}

onMounted(() => {
  restoreSession()
  document.addEventListener('mousedown', (event) => {
    if (!event.target.closest?.('.account-menu, .account-chevron')) accountMenuOpen.value = false
  })
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      notifPanel.value = false
      accountMenuOpen.value = false
    }
  })
})
</script>

<template>
  <main v-if="view === 'login'" class="login-page">
    <section class="login-brand">
      <div class="brand-lockup">
        <span class="brand-mark">TU</span>
        <span><strong>TU DIGITAL</strong><small>Modul pengelolaan cuti</small></span>
      </div>
      <div class="login-message">
        <h1>Pengajuan cuti dalam satu alur yang jelas.</h1>
        <p>Ajukan cuti, pantau saldo, dan lihat posisi pengajuan tanpa berpindah proses.</p>
      </div>
      <p class="login-footer">Aplikasi internal · TU Digital</p>
    </section>
    <section class="login-panel">
      <form class="login-card" @submit.prevent="signIn">
        <p class="eyebrow">AKSES PEGAWAI DAN PETUGAS</p>
        <h2>Masuk ke akun</h2>
        <p class="muted">Gunakan akun TU Digital yang diberikan administrator.</p>
        <p v-if="pageError" class="alert alert-danger" role="alert">{{ pageError }}</p>
        <label for="username">Nama pengguna</label>
        <input id="username" v-model.trim="loginForm.username" autocomplete="username" required />
        <label for="password">Kata sandi</label>
        <input id="password" v-model="loginForm.password" type="password" autocomplete="current-password" required />
        <button class="button button-primary button-wide" type="submit" :disabled="loading">
          {{ loading ? 'Memeriksa akun…' : 'Masuk' }}
        </button>
        <p v-if="isDevelopment" class="demo-hint">
          Untuk seed lokal: akun demo memakai kata sandi <strong>Cuti123!</strong>. Jangan gunakan akun seed di luar lingkungan demo.
        </p>
      </form>

      <!-- Bubble login cepat (hanya di development) -->
      <div v-if="isDevelopment" class="demo-login-bubble">
        <div v-if="demoBubbleOpen" class="demo-bubble-menu" role="menu" aria-label="Pilih akun demo">
          <div class="demo-bubble-head">
            <div>
              <strong>Masuk sebagai</strong>
              <small>Pilih peran untuk mengisi kredensial otomatis</small>
            </div>
            <button class="demo-bubble-close" type="button" @click="demoBubbleOpen = false" aria-label="Tutup">
              <X :size="16" aria-hidden="true" />
            </button>
          </div>
          <ul class="demo-bubble-list">
            <li v-for="account in demoAccounts" :key="account.username">
              <button type="button" role="menuitem" @click="fillDemoAccount(account)">
                <span class="demo-account-mark" aria-hidden="true">{{ account.label.slice(0, 1) }}</span>
                <span class="demo-account-text">
                  <strong>{{ account.label }}</strong>
                  <small>{{ account.username }} · {{ account.role }}</small>
                </span>
              </button>
            </li>
          </ul>
          <p class="demo-bubble-foot">Kata sandi diisi otomatis: <strong>{{ demoPassword }}</strong></p>
        </div>
        <button
          class="demo-bubble-toggle"
          :class="{ open: demoBubbleOpen }"
          type="button"
          :aria-expanded="demoBubbleOpen"
          aria-label="Pilih akun demo"
          @click="demoBubbleOpen = !demoBubbleOpen"
        >
          <UsersRound :size="20" aria-hidden="true" />
        </button>
      </div>
    </section>
  </main>

  <div v-else class="app-shell">
    <AppTopBar
      :role-label="roleLabel"
      v-model:search="globalSearch"
      @menu="drawerOpen = true"
      @submit-search="submitGlobalSearch"
    >
      <template #right>
        <div class="notification-center">
          <button class="notif-bell-btn" type="button" :aria-expanded="notifPanel" aria-controls="notif-panel" aria-label="Pemberitahuan" @click="notifPanel = !notifPanel; if(notifPanel) loadNotifications()">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
            <span v-if="notifUnread > 0" class="notif-badge">{{ notifUnread > 9 ? '9+' : notifUnread }}</span>
          </button>
          <div v-if="notifPanel" id="notif-panel" class="notif-dropdown" role="region" aria-label="Pemberitahuan" @click.stop>
            <div class="notif-dropdown-header">
              <strong>Pemberitahuan</strong>
              <span v-if="notifUnread > 0" class="muted">{{ notifUnread }} belum dibaca</span>
            </div>
            <div class="notif-dropdown-actions">
              <button class="text-button" type="button" @click="markAllNotifRead" :disabled="notifUnread === 0">Semua dibaca</button>
              <button class="text-button" type="button" @click="clearNotifAll" :disabled="notifications.length === 0">Bersihkan semua</button>
              <button class="text-button notif-close" type="button" @click="notifPanel = false" aria-label="Tutup"><X :size="16" aria-hidden="true" /></button>
            </div>
            <div v-if="notifLoading && notifications.length === 0" class="notif-state">Memuat pemberitahuan…</div>
            <div v-else-if="notifError" class="notif-state notif-state-error" role="alert">
              <p>{{ notifError }}</p>
              <button class="text-button" type="button" @click="loadNotifications()">Coba lagi</button>
            </div>
            <div v-else-if="notifications.length === 0" class="notif-empty">
              <p>Belum ada pemberitahuan. Notifikasi pengajuan cuti akan muncul di sini.</p>
            </div>
            <ul v-else class="notif-dropdown-list">
              <li v-for="n in notifications" :key="n.id" :class="{ unread: !n.is_read }" class="notif-item">
                <span class="notif-severity-dot" :class="{'tone-action': n.severity==='ACTION', 'tone-success': n.severity==='SUCCESS', 'tone-warning': n.severity==='WARNING', 'tone-danger': n.severity==='DANGER', 'tone-info': n.severity==='INFO'}"></span>
                <div class="notif-item-content">
                  <button class="notif-item-open" type="button" @click="handleNotifClick(n)">
                    <span class="notif-item-top">
                      <span class="notif-title">{{ n.title }}</span>
                      <small class="notif-time">{{ formatNotifDate(n.created_at) }}</small>
                    </span>
                    <span class="notif-body-text">{{ n.body }}</span>
                  </button>
                  <div class="notif-item-actions">
                    <span v-if="!n.is_read" class="notif-unread-tag">Baru</span>
                    <button class="text-button notif-delete" type="button" @click.stop="clearNotifItem(n.id)">Hapus</button>
                  </div>
                </div>
              </li>
            </ul>
          </div>
        </div>
        <span class="topbar-divider topbar-divider-short" aria-hidden="true"></span>
        <button class="account account-button" type="button" @click="openPage('profile')" aria-label="Buka profil">
          <span v-if="profileAvatarUrl" class="account-mark account-photo"><img :src="profileAvatarUrl" alt="" /></span>
          <span v-else class="account-mark">{{ user?.fullName?.slice(0, 1) || 'U' }}</span>
          <span class="account-copy"><strong>{{ user?.fullName }}</strong><small>{{ roleLabel }}</small></span>
        </button>
        <button class="account-chevron" type="button" :aria-expanded="accountMenuOpen" aria-label="Menu akun" @click="accountMenuOpen = !accountMenuOpen">
          <ChevronDown :size="14" aria-hidden="true" />
        </button>
        <div v-if="accountMenuOpen" class="account-menu" @click.stop>
          <button type="button" @click="accountMenuOpen = false; openPage('profile')"><UserRound :size="14" aria-hidden="true" /> Profil saya</button>
          <button type="button" @click="signOut"><LogOut :size="14" aria-hidden="true" /> Keluar</button>
        </div>
      </template>
    </AppTopBar>

    <aside class="sidebar" aria-label="Navigasi modul cuti">
      <p class="menu-label">MODUL CUTI</p>
      <div class="module-card">
        <span class="module-card-icon"><CalendarDays :size="15" aria-hidden="true" /></span>
        <span class="module-card-copy">
          <strong>Cuti Pegawai</strong>
          <small>{{ roleLabel }} · {{ dashboard?.balance?.period_year || new Date().getFullYear() }}</small>
        </span>
      </div>
      <nav class="side-nav">
        <button
          v-for="item in mainNavItems"
          :key="item.view"
          :class="{ active: view === item.view && !item.cancellationOnly }"
          type="button"
          @click="openPage(item.view, item)"
        >
          <component :is="item.icon" :size="15" aria-hidden="true" />
          <span>{{ item.text }}</span>
          <small v-if="navBadge(item.view)" class="nav-count">{{ navBadge(item.view) }}</small>
        </button>

        <div v-if="settingsNavItems.length" class="side-nav-group">
          <button
            class="side-nav-toggle"
            type="button"
            :aria-expanded="settingsOpen"
            @click="settingsOpen = !settingsOpen"
          >
            <Settings2 :size="15" aria-hidden="true" />
            <span>Pengaturan</span>
            <ChevronDown :size="13" :class="{ rotated: settingsOpen }" aria-hidden="true" />
          </button>
          <div v-if="settingsOpen" class="side-nav-sub">
            <button
              v-for="item in settingsNavItems"
              :key="item.view"
              :class="{ active: view === item.view }"
              type="button"
              @click="openPage(item.view, item)"
            >
              <component :is="item.icon" :size="14" aria-hidden="true" />
              <span>{{ item.text }}</span>
            </button>
          </div>
        </div>
      </nav>
      <div class="sidebar-bottom">
        <span class="sidebar-divider" aria-hidden="true"></span>
        <button class="sidebar-back" type="button" @click="signOut">
          <ArrowLeft :size="14" aria-hidden="true" /> Kembali ke TU Digital
        </button>
        <div class="sidebar-help">
          <CircleHelp :size="16" aria-hidden="true" />
          <strong>Panduan cuti</strong>
          <p>Alur pengajuan, kalender, dan aturan saldo.</p>
          <button type="button" @click="guideOpen = true">Buka panduan</button>
        </div>
        <small class="sidebar-version">v1.0 · Modul cuti</small>
      </div>
    </aside>

    <MobileNavDrawer
      :open="drawerOpen"
      :items="navItems"
      :active="view"
      :role-label="roleLabel"
      :user-initial="user?.fullName?.slice(0, 1) || 'U'"
      :year="dashboard?.balance?.period_year || new Date().getFullYear()"
      :badge-for="navBadge"
      :search="globalSearch"
      @update:search="globalSearch = $event"
      @submit-search="submitGlobalSearch(); drawerOpen = false"
      @close="drawerOpen = false"
      @navigate="onDrawerNavigate"
      @profile="openPage('profile')"
      @guide="guideOpen = true"
      @signout="signOut"
    />

    <main class="main-content" :class="{ 'main-reports': view === 'reports' }">
      <PageHeader
        v-if="!(view === 'detail' && (isAdmin || approvalRole || employeeView)) && view !== 'cancel' && view !== 'preview'"
        :eyebrow="view === 'reports' ? '' : 'TU DIGITAL / MODUL CUTI'"
        :title="pageTitle"
        :subtitle="pageSubtitle"
      >
        <template #actions>
          <template v-if="view === 'dashboard'">
            <button class="button button-primary" type="button" @click="startNewRequest">
              <Plus :size="15" aria-hidden="true" /> Ajukan cuti
            </button>
          </template>
          <template v-if="view === 'calendar' && canManageCalendar">
            <button class="button button-secondary" type="button" @click="calendarRef?.openImport()">
              <Upload :size="15" aria-hidden="true" /> Impor kalender
            </button>
            <button class="button button-primary" type="button" @click="calendarRef?.startNew()">
              <Plus :size="15" aria-hidden="true" /> Tambah tanggal
            </button>
          </template>
        </template>
      </PageHeader>

      <p v-if="notice" class="alert alert-success" role="status">{{ notice }}</p>
      <StateView
        v-if="pageError"
        state="error"
        title="Data belum bisa dimuat"
        :description="pageError"
        :action-label="canRetryLoad ? 'Coba lagi' : ''"
        @action="loadViewData()"
      />
      <StateView
        v-else-if="loading && view !== 'login'"
        state="loading"
        :title="`Memuat ${pageTitle.toLocaleLowerCase('id')}…`"
      />

      <template v-if="!loading && !pageError">
        <ProfilePage v-if="view === 'profile'" @back="openPage(employeeView ? 'dashboard' : 'queue')" />

        <EmployeeDashboard
          v-if="view === 'dashboard' && dashboard?.kind === 'employee'"
          :dashboard="dashboard"
          :leave-types="leaveTypes"
          @apply="openPage('request-form')"
          @history="openPage('history')"
          @balance="openPage('balance')"
          @detail="openDetail($event, 'dashboard')"
        />

        <p v-if="formError && view === 'request-form'" class="alert alert-danger" role="alert">{{ formError }}</p>
        <LeaveRequestForm
          v-if="view === 'request-form'"
          :form="leaveForm"
          :leave-types="leaveTypes"
          :preview="preview"
          :preview-error="blackoutInfo"
          :files="selectedFiles"
          :existing-attachments="existingAttachments"
          :submitting="loading"
          :can-submit="!needsAttachment && !insufficientBalance && !(selectedLeaveType?.deducts_annual_balance && !preview?.annualBalance)"
          :route-label="roleLabel"
          :category-label="categoryLabel(user?.employee?.employment_category)"
          @calculate="calculatePreview"
          @submit="submitRequest('submit')"
          @draft="submitRequest('draft')"
          @files="selectedFiles = $event"
          @remove-existing="removeExistingAttachment"
          @preview-document="openDocumentPreview()"
          @dismiss-blackout="blackoutInfo = null"
        />

        <RequestHistory
          v-else-if="view === 'history'"
          :items="history"
          :total="historyTotal"
          :page="historyPage"
          :page-size="historyPageSize"
          :years="historyYears"
          :leave-types="leaveTypes"
          :filters="historyFilters"
          :status-counts="historyCounts"
          :loading="loading"
          @apply="applyHistoryFilters"
          @reset="resetHistoryFilters"
          @page="historyPage = $event; loadHistory()"
          @open="openDetail($event, 'history')"
        />

        <AdminQueue
          v-if="view === 'queue' && isAdmin"
          :items="displayedApprovalItems"
          :status-counts="approvalCounts"
          :active-status="approvalStatus"
          :sort-by="approvalSort.by"
          :sort-dir="approvalSort.dir"
          @sort-change="changeApprovalSort"
          @open="openDetail($event, 'queue')"
        />

        <ApprovalQueue
          v-else-if="view === 'queue' && approvalRole"
          :role-code="approvalRole"
          :items="displayedApprovalItems"
          :status-counts="approvalCounts"
          :active-status="approvalStatus"
          :sort-by="approvalSort.by"
          :sort-dir="approvalSort.dir"
          @sort-change="changeApprovalSort"
          @status-change="changeApprovalStatus"
          @open="openDetail($event, 'queue')"
        />

        <section v-else-if="view === 'queue'" class="content-stack">
          <div class="metrics-grid">
            <MetricCard label="Perlu tindakan" :value="formatNumber(filteredQueue.length)" caption="pengajuan pada antrean Anda" tone="blue" />
            <MetricCard label="Melewati SLA" :value="formatNumber(filteredQueue.filter((item) => item.is_overdue).length)" caption="perlu ditinjau" tone="amber" />
            <MetricCard
              v-for="card in queueStageCards"
              :key="card.stageCode"
              :label="card.label"
              :value="formatNumber(card.count)"
              :caption="card.overdue ? `${formatNumber(card.overdue)} melewati SLA` : 'sesuai filter aktif'"
              :tone="card.tone"
            />
          </div>
          <section class="panel">
            <div class="filter-row">
              <div class="field search-field">
                <label for="queue-search">Cari pengajuan</label>
                <input id="queue-search" v-model="queueSearch" type="search" placeholder="Nomor, nama pegawai, atau unit" />
              </div>
              <p class="muted">{{ formatNumber(filteredQueue.length) }} pengajuan ditampilkan</p>
            </div>
            <div v-if="filteredQueue.length" class="table-wrap">
              <table>
                <thead><tr><th>Nomor pengajuan</th><th>Pegawai</th><th>Unit kerja</th><th>Jenis</th><th>Jadwal</th><th>Durasi</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  <tr v-for="item in filteredQueue" :key="item.stage_id">
                    <td><button class="row-link" type="button" @click="openDetail(item.id, 'queue')">{{ item.request_number }}</button></td>
                    <td>{{ item.employee_name }}</td>
                    <td>{{ item.employee_unit_name || '—' }}</td>
                    <td>{{ item.leave_type_name }}</td>
                    <td>{{ formatDateRange(item.start_date, item.end_date) }}</td>
                    <td>{{ formatNumber(item.requested_working_days) }} hari</td>
                    <td><StatusPill :status="item.is_overdue ? 'OVERDUE' : item.request_status" /></td>
                    <td><button class="button button-small button-secondary" type="button" @click="openDetail(item.id, 'queue')">Buka</button></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div v-if="filteredQueue.length" class="queue-cards">
              <article v-for="item in filteredQueue" :key="item.stage_id" class="record-card">
                <div><button class="row-link" type="button" @click="openDetail(item.id, 'queue')">{{ item.request_number }}</button><StatusPill :status="item.is_overdue ? 'OVERDUE' : item.request_status" /></div>
                <p><strong>{{ item.employee_name }}</strong> · {{ item.employee_unit_name || 'Unit tidak tersedia' }}</p>
                <small>{{ item.leave_type_name }} · {{ formatNumber(item.requested_working_days) }} hari</small>
                <small>{{ formatDateRange(item.start_date, item.end_date) }}</small>
                <button class="button button-secondary button-small" type="button" @click="openDetail(item.id, 'queue')">Buka</button>
              </article>
            </div>
            <p v-else class="empty-state">
              {{ queue.length ? 'Tidak ada pengajuan yang cocok dengan pencarian.' : 'Tidak ada pengajuan yang menunggu tindakan Anda.' }}
            </p>
          </section>
        </section>

        <BalanceDetails
          v-else-if="view === 'balance'"
          :data="balanceData"
          :year="balanceYear"
          @year-change="changeBalanceYear"
        />

        <AdminDirectory v-else-if="view === 'directory'" ref="directoryRef" @open-request="openDetail" />

        <AdminManagement v-else-if="view === 'admin-master'" />

        <CalendarManagement v-else-if="view === 'calendar'" ref="calendarRef" :userRoles="user?.roles || []" />

        <TeamManagement v-else-if="view === 'teams'" />

        <ReportsManagement v-else-if="view === 'reports'" ref="reportsRef" />

        <AuditLogManagement v-else-if="view === 'audit'" ref="auditRef" />

        <section v-else-if="view === 'verify'" class="content-stack">
          <section class="panel">
            <header class="panel-heading">
              <h2>Verifikasi dokumen</h2>
            </header>
            <form class="admin-filter-row" @submit.prevent="verifyDocument">
              <div class="field">
                <label for="verify-token">Token verifikasi</label>
                <input id="verify-token" v-model="verifyToken" type="text" placeholder="Token dari QR code" />
              </div>
              <button class="button button-primary" type="submit">Periksa</button>
            </form>
            <p v-if="verifyError" class="alert alert-danger">{{ verifyError }}</p>
            <div v-if="verifyResult" class="verify-result">
              <p><strong>{{ verifyResult.document.requestNumber }}</strong> · {{ statusLabel(verifyResult.document.requestStatus) }}</p>
              <p class="muted">{{ verifyResult.document.employeeName }} · {{ verifyResult.document.employeeCategory }}</p>
              <p class="muted">Nomor surat: {{ verifyResult.document.letterNumber || '—' }}</p>
              <p class="muted">Hash dokumen: <code>{{ verifyResult.document.sha256 }}</code></p>
              <h3>Penandatangan ({{ verifyResult.signatures.length }})</h3>
              <ul>
                <li v-for="(sig, index) in verifyResult.signatures" :key="index">
                  {{ sig.signer_role_code }} — {{ sig.signer_name }}<span v-if="sig.decision"> ({{ sig.decision }})</span>
                </li>
              </ul>
            </div>
          </section>
        </section>

        <RequestDetail
          v-if="view === 'detail' && employeeView && requestDetail"
          :request="requestDetail"
          @back="backFromDetail"
          @edit="continueDraft(requestDetail)"
          @preview="openDocumentPreview(requestDetail.id)"
          @submit="submitDraft(requestDetail.id)"
          @withdraw="showWithdrawModal = true"
        />

        <AdminVerificationDetail
          v-else-if="view === 'detail' && isAdmin && requestDetail"
          :request="requestDetail"
          :submitting="submittingAction"
          @back="backFromDetail"
          @action="runAdminAction"
          @cancel="openCancelPage"
        />

        <ApprovalVerificationDetail
          v-else-if="view === 'detail' && approvalRole && requestDetail"
          :request="requestDetail"
          :role-code="approvalRole"
          :submitting="submittingAction"
          @back="backFromDetail"
          @action="runApprovalAction"
          @save-signature="saveApprovalSignature"
        />

        <CancellationPage
          v-else-if="view === 'cancel' && requestDetail"
          :request="requestDetail"
          :submitting="submittingCancel"
          @back="backFromCancel"
          @confirm="runCancellation"
        />

        <PreviewSignPage
          v-else-if="view === 'preview' && requestDetail"
          :request="requestDetail"
          :submitting="loading"
          @back="openDetail(requestDetail.id, 'history')"
          @submit="submitFromPreview"
          @save-draft="openDetail(requestDetail.id, 'history')"
          @save-signature="savePreviewSignature"
        />

        <section v-else-if="view === 'detail' && requestDetail" class="content-stack">
          <section class="panel detail-heading">
            <div>
              <p class="eyebrow">{{ requestDetail.requestNumber }}</p>
              <h2>{{ requestDetail.leaveTypeName }}</h2>
              <p class="muted">{{ requestDetail.employeeName }} · {{ requestDetail.employeeUnitName || 'Unit tidak tersedia' }}</p>
            </div>
            <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
              <template v-if="requestDetail.status === 'APPROVED'">
                <a class="button button-secondary button-small" :href="`/api/requests/${requestDetail.id}/preview-document`" target="_blank" rel="noopener">Pratinjau PDF</a>
                <button class="button button-primary button-small" type="button" :disabled="downloadingFinal" @click="downloadFinalPdf(requestDetail)">
                  <Download :size="14" aria-hidden="true" /> {{ downloadingFinal ? 'Mengunduh…' : 'Unduh PDF final' }}
                </button>
              </template>
              <template v-else-if="canViewPreview(requestDetail)">
                <a class="button button-secondary button-small" :href="`/api/requests/${requestDetail.id}/preview-document`" target="_blank" rel="noopener">Pratinjau PDF</a>
                <button
                  v-if="requestDetail.status === 'CANCELLED' || requestDetail.status === 'WITHDRAWN'"
                  class="button button-secondary button-small"
                  type="button"
                  @click="openDocumentPreview(requestDetail.id)"
                >
                  Lihat pratinjau
                </button>
              </template>
              <template v-if="requestDetail.canEditDraft">
                <button class="button button-secondary button-small" type="button" @click="continueDraft(requestDetail)">
                  {{ requestDetail.status === 'RETURNED_FOR_REVISION' ? 'Perbaiki pengajuan' : 'Lanjutkan draf' }}
                </button>
                <button class="button button-secondary button-small" type="button" @click="openDocumentPreview(requestDetail.id)">Pratinjau &amp; tanda tangan</button>
                <button class="button button-primary button-small" type="button" :disabled="loading" @click="submitDraft(requestDetail.id)">
                  {{ requestDetail.status === 'RETURNED_FOR_REVISION' ? 'Kirim ulang pengajuan' : 'Kirim draf' }}
                </button>
              </template>
              <button
                v-if="requestDetail.canWithdraw"
                class="button button-danger button-small"
                type="button"
                @click="showWithdrawModal = true"
              >
                Batalkan pengajuan
              </button>
              <button
                v-if="requestDetail.canCancel"
                class="button button-danger button-small"
                type="button"
                @click="openCancelPage"
              >
                {{ requestDetail.status === 'APPROVED' ? 'Batalkan cuti' : 'Batalkan pengajuan' }}
              </button>
              <StatusPill :status="requestDetail.status" />
            </div>
          </section>

          <!-- Banner status pembatalan -->
          <section v-if="requestDetail.status === 'WITHDRAWN'" class="alert alert-neutral">
            <div>
              <strong>Pengajuan Dibatalkan oleh Pegawai</strong>
              <p style="margin: 4px 0 0;">
                Alasan: {{ requestDetail.cancellation?.reason || 'Pengajuan ditarik sebelum verifikasi Admin.' }}
                <span v-if="requestDetail.cancellation?.cancelled_at"> · {{ formatDateTime(requestDetail.cancellation.cancelled_at) }}</span>
              </p>
              <small class="muted">{{ (requestDetail.cancellation?.balance_before ?? requestDetail.cancellation?.balance_after) !== null && Number(requestDetail.cancellation?.balance_after) === Number(requestDetail.cancellation?.balance_before) ? 'Tidak ada reservasi yang dilepas (saldo tidak berubah).' : 'Reservasi saldo cuti tahunan telah dilepas kembali ke saldo Anda.' }}</small>
            </div>
          </section>

          <section v-if="requestDetail.status === 'CANCELLED'" class="alert alert-danger">
            <div>
              <strong>Cuti Dibatalkan oleh Admin</strong>
              <p style="margin: 4px 0 0;">
                Sumber: {{ requestDetail.cancellation?.cancellation_source === 'EMPLOYEE_REQUEST' ? 'Permintaan Pegawai' : 'Inisiatif Admin' }} ·
                Alasan: {{ requestDetail.cancellation?.reason || '-' }}
                <span v-if="requestDetail.cancellation?.cancelled_at"> · {{ formatDateTime(requestDetail.cancellation.cancelled_at) }}</span>
              </p>
              <small v-if="requestDetail.cancellation?.restored_days > 0" style="font-weight: 600; color: var(--success-text);">
                ✓ {{ requestDetail.cancellation.restored_days }} hari kerja telah dipulihkan ke saldo cuti tahunan pegawai.
              </small>
              <small v-else class="muted">Pengajuan dibatalkan tanpa pemulihan saldo (cuti belum dijalani atau tidak ada sisa hari).</small>
            </div>
          </section>

          <!-- Catatan edukasi untuk pegawai setelah tahap verifikasi (AT-049) -->
          <section
            v-if="employeeView && !['SUBMITTED', 'ADMIN_REVIEW', 'RETURNED_FOR_REVISION', 'WITHDRAWN', 'CANCELLED'].includes(requestDetail.status)"
            class="alert alert-neutral"
          >
            <div>
              <strong>Informasi Pembatalan</strong>
              <p style="margin: 2px 0 0;" class="muted">
                Pengajuan telah melewati verifikasi Admin. Tombol pembatalan mandiri tidak lagi aktif. Jika Anda memerlukan pembatalan cuti, silakan hubungi Admin Tata Usaha.
              </p>
            </div>
          </section>
          <div class="detail-grid">
            <div class="content-stack">
              <section class="panel">
                <h2>Rincian cuti</h2>
                <dl class="detail-list">
                  <div><dt>Identitas</dt><dd>{{ requestDetail.identity || 'Tidak tersedia untuk role Anda' }}</dd></div>
                  <div><dt>Kategori</dt><dd>{{ categoryLabel(requestDetail.employeeCategory) }}</dd></div>
                  <div><dt>Jabatan</dt><dd>{{ requestDetail.employeePositionName || '—' }}</dd></div>
                  <div><dt>Jadwal</dt><dd>{{ formatDate(requestDetail.startDate) }} – {{ formatDate(requestDetail.endDate) }}</dd></div>
                  <div><dt>Durasi</dt><dd>{{ formatNumber(requestDetail.workingDays) }} hari kerja</dd></div>
                  <div><dt>Alasan</dt><dd>{{ requestDetail.reason }}</dd></div>
                  <div v-if="requestDetail.address"><dt>Alamat selama cuti</dt><dd>{{ requestDetail.address }}</dd></div>
                  <div v-if="requestDetail.phone"><dt>Nomor telepon</dt><dd>{{ requestDetail.phone }}</dd></div>
                </dl>
              </section>
              <section class="panel">
                <h2>Kalender hari kerja</h2>
                <ul class="day-list">
                  <li v-for="day in requestDetail.days" :key="day.leave_date" :class="{ counted: day.is_counted }">
                    <span>{{ formatDate(day.leave_date) }}</span>
                    <span>{{ day.is_counted ? 'Hari kerja dihitung' : day.note || day.day_class }}</span>
                  </li>
                </ul>
              </section>
              <section class="panel">
                <h2>Lampiran</h2>
                <ul v-if="requestDetail.attachments.length" class="attachment-list">
                  <li v-for="file in requestDetail.attachments" :key="file.id">
                    <span>{{ file.original_filename }}<small>{{ file.document_type }} · {{ formatNumber(file.file_size) }} byte</small></span>
                    <a class="button button-secondary button-small" :href="`/api/attachments/${encodeURIComponent(file.id)}`">Unduh</a>
                  </li>
                </ul>
                <p v-else class="empty-inline">Tidak ada lampiran pada pengajuan ini.</p>
              </section>
            </div>
            <aside class="content-stack">
              <section class="panel">
                <h2>Tahap persetujuan</h2>
                <ol class="timeline">
                  <li v-for="stage in requestDetail.stages" :key="`${stage.stage_code}-${stage.status}`" :class="`stage-${stage.status.toLowerCase()}`">
                    <span class="timeline-mark" aria-hidden="true"></span>
                    <div><strong>{{ statusLabel(stage.stage_code) }}</strong><small>{{ roleLabelFor(stage.role_code) }} · {{ statusLabel(stage.status) }}</small></div>
                  </li>
                </ol>
              </section>
              <section v-if="requestDetail.canAct" class="panel action-panel">
                <h2>Tindakan petugas</h2>
                <p class="muted">Tahap aktif: {{ statusLabel(requestDetail.activeStage?.stage_code) }}.</p>
                <div v-if="requestDetail.activeStage?.role_code !== 'ADMIN' && !requestDetail.hasSignature" class="signature-box">
                  <strong>Tanda tangan internal belum tersedia</strong>
                  <label>Gambar tanda tangan di bawah ini</label>
                  <canvas
                    ref="signatureCanvas"
                    class="signature-canvas"
                    width="360"
                    height="110"
                    @pointerdown.prevent="startSignatureDraw"
                    @pointermove.prevent="drawSignature"
                    @pointerup.prevent="endSignatureDraw"
                    @pointerleave="endSignatureDraw"
                  ></canvas>
                  <div class="signature-canvas-actions">
                    <button class="button button-secondary button-small" type="button" @click="clearSignatureCanvas">Reset</button>
                    <button class="button button-primary button-small" type="button" :disabled="signing || !hasDrawnSignature" @click="saveDrawnSignature">
                      {{ signing ? 'Menyimpan…' : 'Simpan tanda tangan gambar' }}
                    </button>
                  </div>
                  <label for="signature-file">Atau unggah PNG/JPG</label>
                  <input id="signature-file" type="file" accept="image/png,image/jpeg" @change="signatureFile = $event.target.files?.[0] || null" />
                  <button class="button button-secondary button-wide" type="button" :disabled="signing || !signatureFile" @click="uploadSignature">
                    {{ signing ? 'Menyimpan…' : 'Simpan tanda tangan terunggah' }}
                  </button>
                </div>
                <label for="action-notes">Catatan petugas</label>
                <textarea id="action-notes" v-model.trim="actionNotes" rows="4" placeholder="Tulis catatan atau alasan pengembalian"></textarea>
                <div v-if="requestDetail.activeStage?.decision_mode === 'FINAL'" class="field">
                  <label for="decision">Keputusan</label>
                  <select id="decision" v-model="decision">
                    <option value="APPROVED">Setujui</option>
                    <option value="REJECTED">Tolak</option>
                  </select>
                </div>
                <div class="action-buttons">
                  <button v-if="requestDetail.activeStage?.role_code === 'ADMIN'" class="button button-primary button-wide" type="button" :disabled="submittingAction" @click="performAction('verify')">
                    {{ submittingAction ? 'Memproses…' : 'Verifikasi &amp; teruskan' }}
                  </button>
                  <button v-else class="button button-primary button-wide" type="button" :disabled="submittingAction || !requestDetail.hasSignature" @click="performAction('decision')">
                    {{ submittingAction ? 'Memproses…' : requestDetail.activeStage?.decision_mode === 'FINAL' ? 'Simpan keputusan' : 'Tandatangani &amp; teruskan' }}
                  </button>
                  <button class="button button-danger button-wide" type="button" :disabled="submittingAction" @click="performAction('return')">
                    Kembalikan untuk perbaikan
                  </button>
                </div>
              </section>
              <section v-else-if="requestDetail.status === 'APPROVED' || requestDetail.status === 'REJECTED'" class="panel action-panel">
                <h2>Hasil keputusan</h2>
                <div class="decision-result">
                  <div class="decision-badge" :class="requestDetail.status === 'APPROVED' ? 'approved' : 'rejected'">
                    {{ requestDetail.status === 'APPROVED' ? 'DISETUJUI' : 'TIDAK DISETUJUI' }}
                  </div>
                  <div v-if="decisionNotes" class="decision-notes">
                    <strong>Catatan keputusan:</strong>
                    <p>{{ decisionNotes }}</p>
                  </div>
                  <div v-if="decisionSignature" class="decision-signature">
                    <strong>Tanda tangan {{ decisionSignerLabel }}:</strong>
                    <div class="sig-info">
                      <span>{{ decisionSignature.name }}</span>
                      <small v-if="decisionSignature.position">{{ decisionSignature.position }}</small>
                      <small>{{ formatDateTime(decisionSignature.signedAt) }}</small>
                    </div>
                  </div>
                </div>
              </section>
              <section class="panel">
                <h2>Riwayat perubahan</h2>
                <ol v-if="requestDetail.events.length" class="event-list">
                  <li v-for="event in requestDetail.events" :key="`${event.event_type}-${event.created_at}`">
                    <strong>{{ event.description }}</strong>
                    <small>{{ event.actor_name || 'Sistem' }} · {{ formatDateTime(event.created_at) }}</small>
                  </li>
                </ol>
                <p v-else class="empty-inline">Belum ada perubahan status.</p>
              </section>
            </aside>
          </div>
        </section>

        <!-- Modal Penarikan / Pembatalan Mandiri oleh Pegawai (Layar 16) -->
        <div v-if="showWithdrawModal && requestDetail" class="modal-backdrop" @click.self="showWithdrawModal = false">
          <div class="modal-card">
            <div class="modal-header">
              <h3>Batalkan Pengajuan Cuti</h3>
              <button class="button button-secondary button-small" type="button" @click="showWithdrawModal = false" aria-label="Tutup"><X :size="14" aria-hidden="true" /></button>
            </div>
            <div class="modal-body">
              <div class="alert alert-neutral">
                <p style="margin: 0;">
                  Pengajuan nomor <strong>{{ requestDetail.requestNumber }}</strong> akan ditarik.
                  Reservasi saldo cuti tahunan sebanyak {{ formatNumber(requestDetail.workingDays) }} hari kerja akan segera dilepas kembali ke saldo Anda.
                </p>
              </div>
              <div class="field">
                <label for="withdraw-reason">Alasan pembatalan (wajib, minimal 10 karakter)</label>
                <textarea
                  id="withdraw-reason"
                  v-model.trim="withdrawReasonInput"
                  rows="4"
                  placeholder="Contoh: Rencana perjalanan dibatalkan karena ada kegiatan mendadak keluarga."
                ></textarea>
                <small class="muted">{{ withdrawReasonInput.length }} / 10 karakter minimum</small>
              </div>
            </div>
            <div class="modal-footer">
              <button class="button button-secondary" type="button" :disabled="submittingWithdraw" @click="showWithdrawModal = false">
                Batal
              </button>
              <button
                class="button button-danger"
                type="button"
                :disabled="submittingWithdraw || withdrawReasonInput.length < 10"
                @click="submitWithdrawal"
              >
                {{ submittingWithdraw ? 'Membatalkan…' : 'Konfirmasi batalkan pengajuan' }}
              </button>
            </div>
          </div>
        </div>

      </template>

    </main>

    <!-- Panduan cuti (dari sidebar) -->
    <div v-if="guideOpen" class="modal-backdrop" @click.self="guideOpen = false">
      <div class="modal-card guide-modal" role="dialog" aria-label="Panduan cuti">
        <div class="modal-header">
          <h3>Panduan cuti</h3>
          <button class="button button-secondary button-small" type="button" @click="guideOpen = false" aria-label="Tutup"><X :size="14" aria-hidden="true" /></button>
        </div>
        <div class="modal-body guide-body">
          <p class="muted">Alur pengajuan, kalender, dan aturan saldo dalam satu ringkasan.</p>
          <ol class="guide-steps">
            <li><strong>Ajukan cuti</strong><span>Pilih jenis cuti, tanggal mulai, dan jumlah hari kerja.</span></li>
            <li><strong>Perhitungan otomatis</strong><span>Sabtu, Minggu, dan hari libur dilewati. Tanggal larangan menghentikan pengajuan.</span></li>
            <li><strong>Verifikasi &amp; keputusan</strong><span>Pengajuan berjalan melalui tahap verifikasi sesuai rute kategori pegawai.</span></li>
            <li><strong>Saldo &amp; dokumen</strong><span>Setelah disetujui, saldo berkurang dan formulir final tersedia.</span></li>
          </ol>
          <p class="guide-hint">Atur tanda tangan digital di menu Profil saya agar terpasang otomatis pada dokumen.</p>
        </div>
        <div class="modal-footer">
          <button class="button button-primary" type="button" @click="guideOpen = false">Mengerti</button>
        </div>
      </div>
    </div>

  </div>
</template>
