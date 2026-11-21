<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { Plus, X } from 'lucide-vue-next'
import StatusPill from './StatusPill.vue'
import TablePager from './TablePager.vue'
import { confirmAction, successDialog } from '../sweetalert.js'

const teams = ref([])
const employees = ref([])
const units = ref([])
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const notice = ref('')
const editingId = ref(null)
const showForm = ref(false)
const memberIds = ref([])
const form = reactive({ code: '', name: '', unitId: '', description: '', isActive: true })

// Tampil 20 tim per halaman (konsisten dengan tabel lain).
const page = ref(0)
const pageSize = 20
const paged = computed(() => teams.value.slice(page.value * pageSize, (page.value + 1) * pageSize))

async function request(path, options = {}) {
  const headers = new Headers(options.headers || {})
  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  const response = await fetch(`/api${path}`, { credentials: 'include', ...options, headers })
  const contentType = response.headers.get('content-type') || ''
  const data = contentType.includes('application/json') ? await response.json() : null
  if (!response.ok) throw new Error(data?.error || `Permintaan gagal (${response.status}).`)
  return data
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const result = await request('/admin/teams')
    teams.value = result.items
    employees.value = result.employees
    units.value = result.units
  } catch (e) {
    error.value = e.message || 'Gagal memuat tim kerja.'
  } finally {
    loading.value = false
  }
}

function resetForm() {
  editingId.value = null
  memberIds.value = []
  Object.assign(form, { code: '', name: '', unitId: '', description: '', isActive: true })
}

function startNew() {
  resetForm()
  notice.value = ''
  showForm.value = true
}

function closeForm() {
  showForm.value = false
}

function edit(team) {
  editingId.value = team.id
  memberIds.value = (team.member_ids || []).map(String)
  Object.assign(form, {
    code: team.code,
    name: team.name,
    unitId: team.unit_id ? String(team.unit_id) : '',
    description: team.description || '',
    isActive: !!team.is_active,
  })
  notice.value = ''
  showForm.value = true
}

async function save() {
  const ok = await confirmAction(editingId.value
    ? {
        title: 'Simpan perubahan tim kerja?',
        text: 'Perubahan nama, unit, dan anggota tim langsung berlaku.',
        confirmText: 'Ya, simpan',
      }
    : {
        title: 'Tambah tim kerja baru?',
        text: 'Tim kerja dipakai untuk penugasan verifikasi pengajuan cuti.',
        confirmText: 'Ya, simpan',
        icon: 'info',
      })
  if (!ok) return
  saving.value = true
  error.value = ''
  notice.value = ''
  try {
    const payload = {
      code: form.code,
      name: form.name,
      unitId: form.unitId || null,
      description: form.description || null,
    }
    if (editingId.value) {
      await request(`/admin/teams/${editingId.value}`, { method: 'PUT', body: JSON.stringify(payload) })
      await request(`/admin/teams/${editingId.value}/members`, {
        method: 'PUT',
        body: JSON.stringify({ employeeIds: memberIds.value.map(Number) }),
      })
      notice.value = 'Tim kerja berhasil diperbarui.'
    } else {
      await request('/admin/teams', {
        method: 'POST',
        body: JSON.stringify({ ...payload, isActive: form.isActive }),
      })
      notice.value = 'Tim kerja berhasil ditambahkan.'
    }
    await load()
    resetForm()
    closeForm()
    await successDialog({
      title: 'Tim kerja tersimpan',
      text: editingId.value ? 'Perubahan tim kerja berhasil disimpan.' : 'Tim kerja baru berhasil ditambahkan.',
    })
  } catch (e) {
    error.value = e.message || 'Gagal menyimpan tim kerja.'
  } finally {
    saving.value = false
  }
}

async function toggle(team) {
  const ok = await confirmAction(team.is_active
    ? {
        title: 'Nonaktifkan tim kerja ini?',
        text: 'Tim yang dinonaktifkan tidak lagi menerima penugasan verifikasi baru.',
        confirmText: 'Ya, nonaktifkan',
        danger: true,
      }
    : {
        title: 'Aktifkan tim kerja ini?',
        text: 'Tim yang aktif kembali menerima penugasan verifikasi.',
        confirmText: 'Ya, aktifkan',
        icon: 'info',
      })
  if (!ok) return
  error.value = ''
  try {
    await request(`/admin/teams/${team.id}/toggle`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive: !team.is_active }),
    })
    notice.value = team.is_active ? 'Tim kerja dinonaktifkan.' : 'Tim kerja diaktifkan.'
    await load()
  } catch (e) {
    error.value = e.message || 'Gagal mengubah status tim.'
  }
}

onMounted(load)
</script>

<template>
  <section class="content-stack">
    <p v-if="error" class="alert alert-danger">{{ error }}</p>
    <p v-if="notice" class="alert alert-success">{{ notice }}</p>

    <section class="panel panel-flex">
      <div class="section-heading">
        <h2>Daftar tim kerja</h2>
        <button class="button button-primary button-small" type="button" @click="startNew">
          <Plus :size="14" aria-hidden="true" /> Tambah tim
        </button>
      </div>
      <p v-if="loading" class="muted">Memuat tim kerja…</p>
      <div v-else-if="teams.length" class="table-wrap">
        <table>
          <thead><tr><th>Kode</th><th>Nama tim</th><th>Unit terkait</th><th>Anggota</th><th>Status</th><th></th></tr></thead>
          <tbody>
            <tr v-for="team in paged" :key="team.id">
              <td><strong>{{ team.code }}</strong></td>
              <td>{{ team.name }}<small v-if="team.description">{{ team.description }}</small></td>
              <td>{{ team.unit_name || '—' }}</td>
              <td>{{ team.member_count }}</td>
              <td><StatusPill :status="team.is_active ? 'ACTIVE' : 'INACTIVE'" /></td>
              <td>
                <button class="button button-secondary button-small" type="button" @click="edit(team)">Ubah</button>
                <button class="button button-secondary button-small" type="button" @click="toggle(team)">{{ team.is_active ? 'Nonaktifkan' : 'Aktifkan' }}</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="paged.length" class="admin-cards team-cards">
        <article v-for="team in paged" :key="`card-${team.id}`" class="record-card">
          <div class="directory-card-heading">
            <div><strong>{{ team.name }}</strong><small>{{ team.code }}</small></div>
            <StatusPill :status="team.is_active ? 'ACTIVE' : 'INACTIVE'" />
          </div>
          <p>{{ team.unit_name || 'Unit belum diisi' }}</p>
          <small>{{ team.member_count }} anggota</small>
          <small v-if="team.description">{{ team.description }}</small>
          <div class="team-card-actions">
            <button class="button button-secondary" type="button" @click="edit(team)">Ubah</button>
            <button class="button button-secondary" type="button" @click="toggle(team)">{{ team.is_active ? 'Nonaktifkan' : 'Aktifkan' }}</button>
          </div>
        </article>
      </div>
      <p v-else class="empty-state">Belum ada tim kerja. Tambahkan tim baru untuk mulai mengelola anggota.</p>
      <TablePager :page="page" :total="teams.length" :page-size="pageSize" label="tim kerja" @change="p => page = p" />
    </section>

    <section v-if="showForm" class="modal-backdrop-overlay" @click.self="closeForm">
      <div class="modal-form-card">
        <div class="modal-form-header">
          <h3>{{ editingId ? 'Ubah tim kerja' : 'Tambah tim kerja' }}</h3>
          <button class="button button-quiet button-small" type="button" aria-label="Tutup" @click="closeForm">
            <X :size="16" aria-hidden="true" />
          </button>
        </div>
        <div class="modal-form-body">
          <form @submit.prevent="save">
            <div class="form-grid">
              <div class="field">
                <label for="team-code">Kode tim</label>
                <input id="team-code" v-model.trim="form.code" required maxlength="30" placeholder="TIM-LAYANAN" :disabled="!!editingId" />
              </div>
              <div class="field">
                <label for="team-name">Nama tim</label>
                <input id="team-name" v-model.trim="form.name" required minlength="3" maxlength="150" />
              </div>
              <div class="field">
                <label for="team-unit">Unit terkait (opsional)</label>
                <select id="team-unit" v-model="form.unitId">
                  <option value="">Tanpa unit</option>
                  <option v-for="unit in units" :key="unit.id" :value="String(unit.id)">{{ unit.name }}</option>
                </select>
              </div>
              <div class="field">
                <label for="team-description">Deskripsi</label>
                <input id="team-description" v-model.trim="form.description" maxlength="255" />
              </div>
            </div>
            <div class="field">
              <label>Anggota tim</label>
              <div class="team-member-list">
                <label v-for="employee in employees" :key="employee.id" class="team-member-item">
                  <input v-model="memberIds" type="checkbox" :value="String(employee.id)" />
                  <span>{{ employee.full_name }} · {{ employee.employment_category }}<small v-if="employee.unit_name"> · {{ employee.unit_name }}</small></span>
                </label>
              </div>
            </div>
            <footer class="form-actions">
              <button class="button button-secondary" type="button" @click="closeForm">Batal</button>
              <button class="button button-primary" type="submit" :disabled="saving">{{ saving ? 'Menyimpan…' : 'Simpan tim' }}</button>
            </footer>
          </form>
        </div>
      </div>
    </section>
  </section>
</template>

<style scoped>
.section-heading {
  align-items: center;
}

.team-member-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 240px;
  overflow-y: auto;
  padding: 6px;
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
}
.team-member-item {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 40px;
  padding: 0 10px;
  border-radius: 6px;
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
}
.team-member-item:hover { background: var(--subtle); }
.team-member-item input {
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
  accent-color: var(--primary);
  cursor: pointer;
}
.team-member-item small { color: var(--muted); }
.team-cards { display: none; }
.team-card-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.team-card-actions .button { flex: 1 1 140px; justify-content: center; }
@media (max-width: 700px) {
  .team-cards { display: grid; gap: 10px; }
}
</style>
