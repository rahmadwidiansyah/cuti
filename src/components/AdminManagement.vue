<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'

const activeTab = ref('employees')
const employees = ref([])
const employeeOptions = ref({ units: [], positions: [], summary: { total: 0, active: 0 } })
const accounts = ref([])
const accountOptions = ref({ roles: [], employees: [], units: [], summary: { total: 0 } })
const employeeQuery = ref('')
const employeeStatus = ref('')
const accountQuery = ref('')
const employeePage = ref(0)
const accountPage = ref(0)
const employeeFormOpen = ref(false)
const accountFormOpen = ref(false)
const employeeEditingId = ref(null)
const accountEditingId = ref(null)
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const formError = ref('')
const notice = ref('')

const today = new Date().toISOString().slice(0, 10)
const employeeForm = reactive({
  fullName: '',
  category: 'PNS_TU',
  nip: '',
  nik: '',
  profession: '',
  unitId: '',
  positionId: '',
  joinDate: today,
  status: 'ACTIVE',
  email: '',
  phone: '',
  address: '',
})
const accountForm = reactive({
  username: '',
  email: '',
  fullName: '',
  password: '',
  isActive: true,
  employeeId: '',
  roles: [],
  unitId: '',
})

const employeePages = computed(() => Math.max(1, Math.ceil(Number(employeeOptions.value.summary?.total || 0) / 25)))
const accountPages = computed(() => Math.max(1, Math.ceil(Number(accountOptions.value.summary?.total || 0) / 25)))
const isContract = computed(() => employeeForm.category === 'KONTRAK')

function categoryLabel(code) {
  return ({
    PNS_TU: 'PNS TU',
    PNS: 'PNS non-TU',
    PPPK_PPNPN_TU: 'PPPK/PPNPN TU',
    PPPK_PPNPN: 'PPPK/PPNPN non-TU',
    KONTRAK: 'Kontrak',
  })[code] || code || '-'
}

function professionLabel(code) {
  return ({
    PENGEMUDI: 'Pengemudi',
    PETUGAS_KEBERSIHAN: 'Petugas kebersihan',
    PETUGAS_KEAMANAN: 'Petugas keamanan',
  })[code] || '-'
}

function dateLabel(value) {
  if (!value) return '-'
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${String(value).slice(0, 10)}T12:00:00Z`))
}

function dateTimeLabel(value) {
  if (!value) return 'Belum pernah masuk'
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {})
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  const response = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    ...options,
    headers,
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) throw new Error(data?.error || `Permintaan gagal (${response.status}).`)
  return data
}

async function loadEmployees() {
  loading.value = true
  error.value = ''
  try {
    const params = new URLSearchParams({
      limit: '25',
      offset: String(employeePage.value * 25),
    })
    if (employeeQuery.value.trim()) params.set('q', employeeQuery.value.trim())
    if (employeeStatus.value) params.set('status', employeeStatus.value)
    const data = await api(`/admin/employees?${params}`)
    employees.value = data.items
    employeeOptions.value = {
      units: data.units,
      positions: data.positions,
      summary: data.summary,
    }
    if (!employeeForm.unitId) {
      employeeForm.unitId = String(data.units.find((unit) => unit.code === 'TU')?.id || data.units[0]?.id || '')
    }
  } catch (requestError) {
    error.value = requestError.message
  } finally {
    loading.value = false
  }
}

async function loadAccounts() {
  loading.value = true
  error.value = ''
  try {
    const params = new URLSearchParams({
      limit: '25',
      offset: String(accountPage.value * 25),
    })
    if (accountQuery.value.trim()) params.set('q', accountQuery.value.trim())
    const data = await api(`/admin/accounts?${params}`)
    accounts.value = data.items
    accountOptions.value = {
      roles: data.roles,
      employees: data.employees,
      units: data.units,
      summary: data.summary,
    }
    if (!accountForm.unitId) {
      accountForm.unitId = String(data.units.find((unit) => unit.code === 'TU')?.id || data.units[0]?.id || '')
    }
  } catch (requestError) {
    error.value = requestError.message
  } finally {
    loading.value = false
  }
}

async function reloadActiveTab() {
  if (activeTab.value === 'employees') await loadEmployees()
  else await loadAccounts()
}

function startNewEmployee() {
  employeeEditingId.value = null
  Object.assign(employeeForm, {
    fullName: '',
    category: 'PNS_TU',
    nip: '',
    nik: '',
    profession: '',
    unitId: String(employeeOptions.value.units.find((unit) => unit.code === 'TU')?.id || ''),
    positionId: '',
    joinDate: today,
    status: 'ACTIVE',
    email: '',
    phone: '',
    address: '',
  })
  formError.value = ''
  employeeFormOpen.value = true
}

function editEmployee(employee) {
  employeeEditingId.value = employee.id
  Object.assign(employeeForm, {
    fullName: employee.full_name,
    category: employee.employment_category,
    nip: employee.nip || '',
    nik: employee.nik || '',
    profession: employee.profession || '',
    unitId: String(employee.unit_id),
    positionId: employee.position_id ? String(employee.position_id) : '',
    joinDate: String(employee.join_date).slice(0, 10),
    status: employee.employment_status,
    email: employee.email || '',
    phone: employee.phone || '',
    address: employee.address || '',
  })
  formError.value = ''
  employeeFormOpen.value = true
}

function closeEmployeeForm() {
  employeeFormOpen.value = false
  employeeEditingId.value = null
  formError.value = ''
}

function changeEmployeeCategory() {
  employeeForm.nip = ''
  employeeForm.nik = ''
  employeeForm.profession = ''
  if (isContract.value) {
    employeeForm.unitId = String(employeeOptions.value.units.find((unit) => unit.code === 'UMUM')?.id || '')
    employeeForm.positionId = ''
  } else if (String(employeeForm.unitId) === String(employeeOptions.value.units.find((unit) => unit.code === 'UMUM')?.id || '')) {
    employeeForm.unitId = String(employeeOptions.value.units.find((unit) => unit.code === 'TU')?.id || '')
  }
}

async function saveEmployee() {
  formError.value = ''
  if (employeeEditingId.value && employeeForm.status === 'INACTIVE') {
    const current = employees.value.find((item) => String(item.id) === String(employeeEditingId.value))
    if (current?.employment_status === 'ACTIVE' && !window.confirm('Nonaktifkan pegawai ini? Akun yang terhubung juga akan dinonaktifkan.')) return
  }
  saving.value = true
  try {
    const path = employeeEditingId.value
      ? `/admin/employees/${encodeURIComponent(employeeEditingId.value)}`
      : '/admin/employees'
    await api(path, {
      method: employeeEditingId.value ? 'PUT' : 'POST',
      body: JSON.stringify(employeeForm),
    })
    notice.value = employeeEditingId.value ? 'Data pegawai diperbarui.' : 'Data pegawai ditambahkan.'
    closeEmployeeForm()
    await loadEmployees()
  } catch (requestError) {
    formError.value = requestError.message
  } finally {
    saving.value = false
  }
}

function startNewAccount() {
  accountEditingId.value = null
  Object.assign(accountForm, {
    username: '',
    email: '',
    fullName: '',
    password: '',
    isActive: true,
    employeeId: '',
    roles: [],
    unitId: String(accountOptions.value.units.find((unit) => unit.code === 'TU')?.id || ''),
  })
  formError.value = ''
  accountFormOpen.value = true
}

function editAccount(account) {
  accountEditingId.value = account.id
  Object.assign(accountForm, {
    username: account.username,
    email: account.email,
    fullName: account.full_name,
    password: '',
    isActive: account.is_active,
    employeeId: account.employee_id ? String(account.employee_id) : '',
    roles: account.roles.map((role) => role.code),
    unitId: String(account.roles.find((role) => role.code === 'KASUBAG')?.unitId || ''),
  })
  formError.value = ''
  accountFormOpen.value = true
}

function closeAccountForm() {
  accountFormOpen.value = false
  accountEditingId.value = null
  formError.value = ''
}

function syncEmployeeRole() {
  if (accountForm.employeeId && !accountForm.roles.includes('EMPLOYEE')) accountForm.roles.push('EMPLOYEE')
  if (!accountForm.employeeId) accountForm.roles = accountForm.roles.filter((role) => role !== 'EMPLOYEE')
}

watch(() => accountForm.employeeId, syncEmployeeRole)
watch(() => accountForm.roles.includes('KASUBAG'), (isKasubag) => {
  if (isKasubag && !accountForm.unitId) {
    accountForm.unitId = String(accountOptions.value.units.find((unit) => unit.code === 'TU')?.id || '')
  }
})

async function saveAccount() {
  formError.value = ''
  if (accountEditingId.value && !accountForm.isActive) {
    const current = accounts.value.find((item) => String(item.id) === String(accountEditingId.value))
    if (current?.is_active && !window.confirm('Nonaktifkan akun ini dan cabut semua sesi masuknya?')) return
  }
  saving.value = true
  try {
    const path = accountEditingId.value
      ? `/admin/accounts/${encodeURIComponent(accountEditingId.value)}`
      : '/admin/accounts'
    await api(path, {
      method: accountEditingId.value ? 'PUT' : 'POST',
      body: JSON.stringify(accountForm),
    })
    notice.value = accountEditingId.value ? 'Akun diperbarui.' : 'Akun ditambahkan.'
    closeAccountForm()
    await loadAccounts()
  } catch (requestError) {
    formError.value = requestError.message
  } finally {
    saving.value = false
  }
}

async function searchEmployees() {
  employeePage.value = 0
  await loadEmployees()
}

async function searchAccounts() {
  accountPage.value = 0
  await loadAccounts()
}

async function moveEmployeePage(delta) {
  employeePage.value = Math.max(0, Math.min(employeePages.value - 1, employeePage.value + delta))
  await loadEmployees()
}

async function moveAccountPage(delta) {
  accountPage.value = Math.max(0, Math.min(accountPages.value - 1, accountPage.value + delta))
  await loadAccounts()
}

watch(activeTab, (tab) => {
  notice.value = ''
  formError.value = ''
  if (tab === 'employees') loadEmployees()
  else loadAccounts()
})

onMounted(loadEmployees)
</script>

<template>
  <section class="content-stack admin-management">
    <nav class="admin-tabs" aria-label="Jenis data yang dikelola">
      <button type="button" :aria-pressed="activeTab === 'employees'" @click="activeTab = 'employees'">Master pegawai</button>
      <button type="button" :aria-pressed="activeTab === 'accounts'" @click="activeTab = 'accounts'">Akun dan role</button>
    </nav>

    <p v-if="notice" class="alert alert-success" role="status">{{ notice }}</p>
    <p v-if="error" class="alert alert-danger" role="alert">
      {{ error }}
      <button class="text-button" type="button" @click="reloadActiveTab">Coba lagi</button>
    </p>
    <p v-if="loading" class="state-message" role="status">Memuat {{ activeTab === 'employees' ? 'data pegawai' : 'akun pengguna' }}…</p>

    <template v-if="activeTab === 'employees'">
      <section class="panel">
        <div class="section-heading">
          <h2>Data pegawai</h2>
          <button class="button button-primary" type="button" @click="startNewEmployee">Tambah pegawai</button>
        </div>

        <form class="admin-filter-row" @submit.prevent="searchEmployees">
          <div class="field">
            <label for="employee-search">Cari pegawai</label>
            <input id="employee-search" v-model="employeeQuery" type="search" placeholder="Nama, NIP/NIK, atau username" />
          </div>
          <div class="field">
            <label for="employee-status-filter">Status kepegawaian</label>
            <select id="employee-status-filter" v-model="employeeStatus">
              <option value="">Semua status</option>
              <option value="ACTIVE">Aktif</option>
              <option value="INACTIVE">Nonaktif</option>
            </select>
          </div>
          <button class="button button-secondary" type="submit">Terapkan</button>
        </form>

        <div v-if="employees.length" class="table-wrap">
          <table>
            <thead>
              <tr><th>Pegawai</th><th>NIP/NIK</th><th>Kategori</th><th>Unit / jabatan</th><th>Status</th><th>Akun</th><th></th></tr>
            </thead>
            <tbody>
              <tr v-for="employee in employees" :key="employee.id">
                <td><strong>{{ employee.full_name }}</strong><small>Mulai {{ dateLabel(employee.join_date) }}</small></td>
                <td>{{ employee.nik || employee.nip }}</td>
                <td>{{ categoryLabel(employee.employment_category) }}<small v-if="employee.profession">{{ professionLabel(employee.profession) }}</small></td>
                <td>{{ employee.unit_name || '-' }}<small>{{ employee.position_name || 'Jabatan belum diisi' }}</small></td>
                <td><span class="status-badge" :class="employee.employment_status === 'ACTIVE' ? 'tone-success' : 'tone-neutral'">{{ employee.employment_status === 'ACTIVE' ? 'Aktif' : 'Nonaktif' }}</span></td>
                <td>{{ employee.username || 'Belum terhubung' }}</td>
                <td><button class="button button-secondary button-small" type="button" @click="editEmployee(employee)">Ubah</button></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="employees.length" class="admin-cards">
          <article v-for="employee in employees" :key="employee.id" class="record-card">
            <div class="directory-card-heading">
              <div><strong>{{ employee.full_name }}</strong><small>{{ categoryLabel(employee.employment_category) }}<span v-if="employee.profession"> · {{ professionLabel(employee.profession) }}</span></small></div>
              <span class="status-badge" :class="employee.employment_status === 'ACTIVE' ? 'tone-success' : 'tone-neutral'">{{ employee.employment_status === 'ACTIVE' ? 'Aktif' : 'Nonaktif' }}</span>
            </div>
            <p>{{ employee.nik || employee.nip }}</p>
            <small>{{ employee.unit_name || 'Unit belum diisi' }} · {{ employee.position_name || 'Jabatan belum diisi' }}</small>
            <small>{{ employee.username ? `Akun: ${employee.username}` : 'Belum terhubung ke akun' }}</small>
            <button class="button button-secondary" type="button" @click="editEmployee(employee)">Ubah data</button>
          </article>
        </div>
        <p v-if="!loading && !error && !employees.length" class="empty-state">Tidak ada pegawai yang cocok. Ubah pencarian atau filter status.</p>
        <div v-if="employeeOptions.summary.total > 25" class="pagination">
          <span>Halaman {{ employeePage + 1 }} dari {{ employeePages }}</span>
          <div>
            <button class="button button-secondary button-small" type="button" :disabled="employeePage === 0" @click="moveEmployeePage(-1)">Sebelumnya</button>
            <button class="button button-secondary button-small" type="button" :disabled="employeePage + 1 >= employeePages" @click="moveEmployeePage(1)">Berikutnya</button>
          </div>
        </div>
      </section>

      <section v-if="employeeFormOpen" class="modal-backdrop-overlay" @click.self="closeEmployeeForm">
        <div class="modal-form-card">
          <div class="modal-form-header">
            <h3>{{ employeeEditingId ? 'Ubah data pegawai' : 'Tambah pegawai' }}</h3>
            <button class="button button-quiet button-small" type="button" @click="closeEmployeeForm">✕</button>
          </div>
          <div class="modal-form-body">
            <p v-if="formError" class="alert alert-danger">{{ formError }}</p>
            <form @submit.prevent="saveEmployee">
              <div class="form-grid">
                <div class="field field-span">
                  <label for="master-employee-name">Nama lengkap</label>
                  <input id="master-employee-name" v-model.trim="employeeForm.fullName" minlength="3" maxlength="150" required />
                </div>
                <div class="field">
                  <label for="master-employee-category">Kategori pegawai</label>
                  <select id="master-employee-category" v-model="employeeForm.category" required @change="changeEmployeeCategory">
                    <option value="PNS_TU">PNS TU</option>
                    <option value="PNS">PNS non-TU</option>
                    <option value="PPPK_PPNPN_TU">PPPK/PPNPN TU</option>
                    <option value="PPPK_PPNPN">PPPK/PPNPN non-TU</option>
                    <option value="KONTRAK">Kontrak</option>
                  </select>
                </div>
                <div v-if="isContract" class="field">
                  <label for="master-employee-nik">NIK</label>
                  <input id="master-employee-nik" v-model.trim="employeeForm.nik" inputmode="numeric" minlength="16" maxlength="16" pattern="[0-9]{16}" required />
                </div>
                <div v-else class="field">
                  <label for="master-employee-nip">NIP</label>
                  <input id="master-employee-nip" v-model.trim="employeeForm.nip" inputmode="numeric" minlength="8" maxlength="18" pattern="[0-9]{8,18}" required />
                </div>
                <div v-if="isContract" class="field">
                  <label for="master-employee-profession">Profesi</label>
                  <select id="master-employee-profession" v-model="employeeForm.profession" required>
                    <option value="" disabled>Pilih profesi</option>
                    <option value="PENGEMUDI">Pengemudi</option>
                    <option value="PETUGAS_KEBERSIHAN">Petugas kebersihan</option>
                    <option value="PETUGAS_KEAMANAN">Petugas keamanan</option>
                  </select>
                </div>
                <div class="field">
                  <label for="master-employee-unit">Unit kerja</label>
                  <select id="master-employee-unit" v-model="employeeForm.unitId" :disabled="isContract" required>
                    <option v-for="unit in employeeOptions.units" :key="unit.id" :value="String(unit.id)">{{ unit.name }}</option>
                  </select>
                  <small v-if="isContract">Pegawai Kontrak ditempatkan pada unit Umum.</small>
                </div>
                <div class="field">
                  <label for="master-employee-position">Jabatan</label>
                  <select id="master-employee-position" v-model="employeeForm.positionId">
                    <option value="">Belum ditentukan</option>
                    <option v-for="position in employeeOptions.positions" :key="position.id" :value="String(position.id)">{{ position.name }}</option>
                  </select>
                </div>
                <div class="field">
                  <label for="master-employee-join-date">Tanggal mulai kerja</label>
                  <input id="master-employee-join-date" v-model="employeeForm.joinDate" type="date" required />
                </div>
                <div class="field">
                  <label for="master-employee-status">Status kepegawaian</label>
                  <select id="master-employee-status" v-model="employeeForm.status" required>
                    <option value="ACTIVE">Aktif</option>
                    <option value="INACTIVE">Nonaktif</option>
                  </select>
                </div>
                <div class="field">
                  <label for="master-employee-email">Email</label>
                  <input id="master-employee-email" v-model.trim="employeeForm.email" type="email" autocomplete="email" maxlength="254" />
                </div>
                <div class="field">
                  <label for="master-employee-phone">Nomor telepon</label>
                  <input id="master-employee-phone" v-model.trim="employeeForm.phone" type="tel" inputmode="tel" minlength="8" maxlength="20" pattern="[0-9+]{8,20}" />
                </div>
                <div class="field field-span">
                  <label for="master-employee-address">Alamat</label>
                  <textarea id="master-employee-address" v-model.trim="employeeForm.address" rows="2"></textarea>
                </div>
              </div>
              <div class="form-actions field-span">
                <button class="button button-secondary" type="button" @click="closeEmployeeForm">Batal</button>
                <button class="button button-primary" type="submit" :disabled="saving">{{ saving ? 'Menyimpan…' : 'Simpan data pegawai' }}</button>
              </div>
            </form>
          </div>
        </div>
      </section>
    </template>

    <template v-else>
      <section class="panel">
        <div class="section-heading">
          <h2>Akun pengguna</h2>
          <button class="button button-primary" type="button" @click="startNewAccount">Tambah akun</button>
        </div>
        <form class="admin-filter-row account-filter" @submit.prevent="searchAccounts">
          <div class="field">
            <label for="account-search">Cari akun</label>
            <input id="account-search" v-model="accountQuery" type="search" placeholder="Nama, username, email, atau pegawai" />
          </div>
          <button class="button button-secondary" type="submit">Cari</button>
        </form>
        <div v-if="accounts.length" class="table-wrap">
          <table>
            <thead><tr><th>Akun</th><th>Role aktif</th><th>Pegawai</th><th>Terakhir masuk</th><th>Status</th><th></th></tr></thead>
            <tbody>
              <tr v-for="account in accounts" :key="account.id">
                <td><strong>{{ account.full_name }}</strong><small>{{ account.username }} · {{ account.email }}</small></td>
                <td>{{ account.roles.map((role) => role.name).join(', ') || 'Tanpa role' }}<small v-if="account.roles.some((role) => role.code === 'KASUBAG')">{{ account.roles.find((role) => role.code === 'KASUBAG')?.unitName }}</small></td>
                <td>{{ account.employee_name ? `${account.employee_name} · ${categoryLabel(account.employment_category)}` : 'Tidak terhubung' }}</td>
                <td>{{ dateTimeLabel(account.last_login_at) }}</td>
                <td><span class="status-badge" :class="account.is_active ? 'tone-success' : 'tone-neutral'">{{ account.is_active ? 'Aktif' : 'Nonaktif' }}</span></td>
                <td><button class="button button-secondary button-small" type="button" @click="editAccount(account)">Ubah</button></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="accounts.length" class="admin-cards">
          <article v-for="account in accounts" :key="account.id" class="record-card">
            <div class="directory-card-heading">
              <div><strong>{{ account.full_name }}</strong><small>{{ account.username }} · {{ account.email }}</small></div>
              <span class="status-badge" :class="account.is_active ? 'tone-success' : 'tone-neutral'">{{ account.is_active ? 'Aktif' : 'Nonaktif' }}</span>
            </div>
            <p>{{ account.roles.map((role) => role.name).join(', ') || 'Tanpa role' }}</p>
            <small>{{ account.employee_name ? `Pegawai: ${account.employee_name}` : 'Tidak terhubung ke data pegawai' }}</small>
            <button class="button button-secondary" type="button" @click="editAccount(account)">Ubah akun</button>
          </article>
        </div>
        <p v-if="!loading && !error && !accounts.length" class="empty-state">Tidak ada akun yang cocok dengan pencarian.</p>
        <div v-if="accountOptions.summary.total > 25" class="pagination">
          <span>Halaman {{ accountPage + 1 }} dari {{ accountPages }}</span>
          <div>
            <button class="button button-secondary button-small" type="button" :disabled="accountPage === 0" @click="moveAccountPage(-1)">Sebelumnya</button>
            <button class="button button-secondary button-small" type="button" :disabled="accountPage + 1 >= accountPages" @click="moveAccountPage(1)">Berikutnya</button>
          </div>
        </div>
      </section>

      <section v-if="accountFormOpen" class="modal-backdrop-overlay" @click.self="closeAccountForm">
        <div class="modal-form-card">
          <div class="modal-form-header">
            <h3>{{ accountEditingId ? 'Ubah akun' : 'Tambah akun' }}</h3>
            <button class="button button-quiet button-small" type="button" @click="closeAccountForm">✕</button>
          </div>
          <div class="modal-form-body">
            <p v-if="formError" class="alert alert-danger">{{ formError }}</p>
            <form @submit.prevent="saveAccount">
              <div class="form-grid">
                <div class="field">
                  <label for="account-full-name">Nama akun</label>
                  <input id="account-full-name" v-model.trim="accountForm.fullName" minlength="3" maxlength="150" required />
                </div>
                <div class="field">
                  <label for="account-username">Username</label>
                  <input id="account-username" v-model.trim="accountForm.username" minlength="3" maxlength="60" autocomplete="username" required />
                </div>
                <div class="field">
                  <label for="account-email">Email</label>
                  <input id="account-email" v-model.trim="accountForm.email" type="email" autocomplete="email" maxlength="254" required />
                </div>
                <div class="field">
                  <label for="account-password">{{ accountEditingId ? 'Kata sandi baru' : 'Kata sandi awal' }}</label>
                  <input id="account-password" v-model="accountForm.password" type="password" autocomplete="new-password" :required="!accountEditingId" minlength="8" />
                  <small>{{ accountEditingId ? 'Kosongkan jika tidak ingin mengganti kata sandi.' : 'Minimal 8 karakter.' }}</small>
                </div>
                <div class="field field-span">
                  <label for="account-employee">Data pegawai terhubung</label>
                  <select id="account-employee" v-model="accountForm.employeeId">
                    <option value="">Tidak terhubung ke pegawai</option>
                    <option
                      v-for="employee in accountOptions.employees"
                      :key="employee.id"
                      :value="String(employee.id)"
                      :disabled="employee.user_id && String(employee.user_id) !== String(accountEditingId || '')"
                    >
                      {{ employee.full_name }} · {{ categoryLabel(employee.employment_category) }}{{ employee.user_id && String(employee.user_id) !== String(accountEditingId || '') ? ' · sudah terhubung' : '' }}
                    </option>
                  </select>
                </div>
                <div class="role-field-wrap">
                  <p class="role-field-label">Role aplikasi</p>
                  <div class="role-options">
                    <label v-for="role in accountOptions.roles" :key="role.code" class="role-option">
                      <input v-model="accountForm.roles" type="checkbox" :value="role.code" :disabled="role.code === 'EMPLOYEE' && !accountForm.employeeId" />
                      <span>{{ role.name }}</span>
                    </label>
                  </div>
                  <small>Role Pegawai/PIC mengikuti data pegawai yang terhubung.</small>
                </div>
                <div v-if="accountForm.roles.includes('KASUBAG')" class="field field-span">
                  <label for="account-unit">Lingkup unit Kasubag</label>
                  <select id="account-unit" v-model="accountForm.unitId" required>
                    <option v-for="unit in accountOptions.units" :key="unit.id" :value="String(unit.id)">{{ unit.name }}</option>
                  </select>
                </div>
                <label v-if="accountEditingId" class="account-active-option field-span">
                  <input v-model="accountForm.isActive" type="checkbox" />
                  <span>Akun aktif dan dapat masuk</span>
                </label>
                <div class="form-actions field-span">
                  <button class="button button-secondary" type="button" @click="closeAccountForm">Batal</button>
                  <button class="button button-primary" type="submit" :disabled="saving">{{ saving ? 'Menyimpan…' : 'Simpan akun' }}</button>
                </div>
              </div>
            </form>
          </div>
        </div>
      </section>
    </template>
  </section>
</template>

<style scoped>
</style>
