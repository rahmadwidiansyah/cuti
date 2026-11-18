<script setup>
import { computed, onMounted, ref } from 'vue'
import { Camera, CheckCircle2, Download, Eye, FileImage, Loader2, RotateCcw, ShieldCheck, Trash2, Upload, UserRound } from 'lucide-vue-next'

const emit = defineEmits(['back'])

const profile = ref(null)
const loading = ref(true)
const error = ref('')
const notice = ref('')
const savingAvatar = ref(false)
const savingSignature = ref(false)

const avatarFile = ref(null)
const avatarPreview = ref(null)
const avatarInput = ref(null)

const signatureFile = ref(null)
const signaturePreview = ref(null)
const signatureInput = ref(null)
const drawing = ref(false)
const canvasRef = ref(null)
let ctx = null

const initials = computed(() => {
  const name = profile.value?.user?.fullName || 'U'
  return String(name).split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join('')
})
const roleText = computed(() => (profile.value?.user?.roles || []).join(' · ') || 'Pegawai')
const limits = computed(() => profile.value?.limits || {
  avatar: { maxBytes: 2097152, maxEdge: 4096, mime: ['image/png', 'image/jpeg'] },
  signature: { maxBytes: 2097152, maxEdge: 4096, mime: ['image/png', 'image/jpeg'] },
})

function formatBytes(n) {
  if (!n && n !== 0) return '-'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
function formatDate(v) {
  if (!v) return '-'
  return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(v))
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {})
  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  const response = await fetch(`/api${path}`, { credentials: 'same-origin', ...options, headers })
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    const err = new Error(data?.error || 'Permintaan gagal.')
    err.status = response.status
    throw err
  }
  return data
}

async function loadProfile() {
  loading.value = true
  error.value = ''
  try {
    profile.value = await api('/profile')
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}
onMounted(loadProfile)

function validateClient(file, cfg) {
  if (!file) return 'Pilih file terlebih dahulu.'
  if (!cfg.mime.includes(file.type)) return 'Format harus PNG atau JPG.'
  if (file.size > cfg.maxBytes) return `Ukuran maksimal ${formatBytes(cfg.maxBytes)}.`
  return null
}

function onAvatarChange(e) {
  error.value = ''
  const file = e.target.files?.[0] || null
  const problem = validateClient(file, limits.value.avatar)
  if (problem) { error.value = problem; avatarFile.value = null; avatarPreview.value = null; return }
  avatarFile.value = file
  avatarPreview.value = URL.createObjectURL(file)
}
function resetAvatarSelection() {
  avatarFile.value = null
  avatarPreview.value = null
  if (avatarInput.value) avatarInput.value.value = ''
}

async function saveAvatar() {
  if (!avatarFile.value) return
  savingAvatar.value = true
  error.value = ''
  notice.value = ''
  try {
    const fd = new FormData()
    fd.append('avatar', avatarFile.value)
    await api('/profile/avatar', { method: 'POST', body: fd })
    notice.value = 'Foto profil berhasil disimpan.'
    resetAvatarSelection()
    await loadProfile()
  } catch (e) {
    error.value = e.message
  } finally {
    savingAvatar.value = false
  }
}

async function removeAvatar() {
  error.value = ''
  notice.value = ''
  try {
    await api('/profile/avatar', { method: 'DELETE' })
    notice.value = 'Foto profil dihapus.'
    resetAvatarSelection()
    await loadProfile()
  } catch (e) {
    error.value = e.message
  }
}

function onSignatureChange(e) {
  error.value = ''
  const file = e.target.files?.[0] || null
  const problem = validateClient(file, limits.value.signature)
  if (problem) { error.value = problem; signatureFile.value = null; signaturePreview.value = null; return }
  signatureFile.value = file
  signaturePreview.value = URL.createObjectURL(file)
}
function resetSignatureSelection() {
  signatureFile.value = null
  signaturePreview.value = null
  if (signatureInput.value) signatureInput.value.value = ''
}

async function saveSignature() {
  if (!signatureFile.value) return
  savingSignature.value = true
  error.value = ''
  notice.value = ''
  try {
    await api('/signature', {
      method: 'POST',
      headers: { 'Content-Type': signatureFile.value.type },
      body: signatureFile.value,
    })
    notice.value = 'Tanda tangan digital berhasil disimpan.'
    resetSignatureSelection()
    await loadProfile()
  } catch (e) {
    error.value = e.message
  } finally {
    savingSignature.value = false
  }
}

// Canvas draw for signature
function initCanvas() {
  if (canvasRef.value && !ctx) {
    ctx = canvasRef.value.getContext('2d')
    ctx.strokeStyle = '#142f3a'
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
  }
}
function point(e) {
  const s = e.touches?.[0] || e.changedTouches?.[0] || e
  const r = canvasRef.value.getBoundingClientRect()
  return { x: (s.clientX - r.left) * (canvasRef.value.width / r.width), y: (s.clientY - r.top) * (canvasRef.value.height / r.height) }
}
function startDraw(e) { initCanvas(); if (!ctx) return; drawing.value = true; const p = point(e); ctx.beginPath(); ctx.moveTo(p.x, p.y) }
function draw(e) { if (!drawing.value || !ctx) return; const p = point(e); ctx.lineTo(p.x, p.y); ctx.stroke() }
function endDraw() { drawing.value = false }
function clearCanvas() { initCanvas(); if (ctx) ctx.clearRect(0, 0, canvasRef.value.width, canvasRef.value.height) }
function useDrawn() {
  if (!canvasRef.value) return
  canvasRef.value.toBlob(blob => {
    if (!blob) return
    signatureFile.value = new File([blob], 'tanda-tangan.png', { type: 'image/png' })
    signaturePreview.value = URL.createObjectURL(signatureFile.value)
  }, 'image/png')
}
function signatureSrc() {
  return signaturePreview.value || `/api/me/signature?t=${profile.value?.signature?.id || ''}`
}
function avatarSrc() {
  return avatarPreview.value || `/api/profile/avatar?t=${profile.value?.avatar?.updatedAt || ''}`
}
</script>

<template>
  <section class="profile-page">
    <p class="profile-intro">Kelola foto profil dan tanda tangan digital yang digunakan pada dokumen.</p>

    <p v-if="error" class="alert alert-danger" role="alert">{{ error }}</p>
    <p v-if="notice" class="alert alert-success" role="status">{{ notice }}</p>
    <p v-if="loading" class="muted">Memuat profil…</p>

    <template v-if="profile">
      <div class="profile-grid">
        <!-- Identitas -->
        <section class="panel">
          <h2>Data akun</h2>
          <dl class="pf-facts">
            <div><dt>Nama lengkap</dt><dd>{{ profile.user.fullName }}</dd></div>
            <div><dt>Username</dt><dd>{{ profile.user.username }}</dd></div>
            <div><dt>Email</dt><dd>{{ profile.user.email || '-' }}</dd></div>
            <div><dt>Peran</dt><dd>{{ roleText }}</dd></div>
          </dl>
          <p class="pf-hint"><ShieldCheck :size="13" aria-hidden="true" /> Anda hanya dapat mengubah profil akun Anda sendiri.</p>
        </section>

        <!-- Foto profil -->
        <section class="panel">
          <h2>Foto profil</h2>
          <div class="pf-avatar-row">
            <div class="pf-avatar-preview">
              <img v-if="profile.avatar || avatarPreview" :src="avatarSrc()" alt="Pratinjau foto profil" />
              <span v-else class="pf-avatar-initial" aria-hidden="true">{{ initials }}</span>
            </div>
            <div class="pf-avatar-info">
              <strong>{{ profile.avatar ? 'Foto profil aktif' : 'Belum ada foto profil' }}</strong>
              <small v-if="profile.avatar">{{ formatBytes(profile.avatar.size) }} · diperbarui {{ formatDate(profile.avatar.updatedAt) }}</small>
              <small v-else>Gunakan PNG atau JPG maksimal {{ formatBytes(limits.avatar.maxBytes) }}.</small>
            </div>
          </div>

          <input ref="avatarInput" type="file" accept="image/png,image/jpeg" class="sr-only" @change="onAvatarChange" />
          <div class="pf-actions">
            <button class="button button-secondary button-small" type="button" @click="avatarInput?.click()">
              <Camera :size="14" aria-hidden="true" /> Pilih foto
            </button>
            <button v-if="avatarFile" class="button button-primary button-small" type="button" :disabled="savingAvatar" @click="saveAvatar">
              {{ savingAvatar ? 'Menyimpan…' : 'Simpan foto' }}
            </button>
            <button v-if="avatarFile" class="button button-quiet button-small" type="button" @click="resetAvatarSelection">Batal</button>
            <button v-if="profile.avatar && !avatarFile" class="button button-danger button-small" type="button" @click="removeAvatar">
              <Trash2 :size="14" aria-hidden="true" /> Hapus
            </button>
          </div>
          <p class="pf-hint">Maksimal {{ limits.avatar.maxEdge }}×{{ limits.avatar.maxEdge }} piksel. Tipe dan ukuran divalidasi ulang di server.</p>
        </section>

        <!-- Tanda tangan digital -->
        <section class="panel pf-signature">
          <h2>Tanda tangan digital</h2>
          <p class="pf-sub">Tanda tangan ini ditempel pada formulir cuti saat pengajuan diproses.</p>

          <div class="pf-signature-status">
            <CheckCircle2 v-if="profile.signature" :size="16" aria-hidden="true" class="pf-ok" />
            <FileImage v-else :size="16" aria-hidden="true" />
            <span>{{ profile.signature ? `Tanda tangan tersimpan (${formatBytes(profile.signature.file_size)})` : 'Belum ada tanda tangan' }}</span>
            <a v-if="profile.signature && !signaturePreview" class="button button-quiet button-small" :href="'/api/me/signature'" target="_blank" rel="noopener">
              <Eye :size="13" aria-hidden="true" /> Lihat
            </a>
          </div>

          <div class="pf-mode-switch">
            <button class="pf-mode" type="button" @click="resetSignatureSelection">Unggah / gambar</button>
          </div>

          <div class="pf-sign-layout">
            <div>
              <canvas ref="canvasRef" class="pf-canvas" width="704" height="220"
                @mousedown.prevent="startDraw" @mousemove.prevent="draw" @mouseup="endDraw" @mouseleave="endDraw"
                @touchstart.prevent="startDraw" @touchmove.prevent="draw" @touchend="endDraw"></canvas>
              <div class="pf-canvas-actions">
                <button class="button button-secondary button-small" type="button" @click="clearCanvas"><RotateCcw :size="13" aria-hidden="true" /> Reset</button>
                <button class="button button-secondary button-small" type="button" @click="useDrawn">Gunakan gambar ini</button>
              </div>
              <label class="pf-upload">Atau unggah PNG/JPG
                <input ref="signatureInput" type="file" accept="image/png,image/jpeg" class="sr-only" @change="onSignatureChange" />
                <button class="button button-quiet button-small" type="button" @click="signatureInput?.click()"><Upload :size="13" aria-hidden="true" /> Pilih file</button>
              </label>
            </div>
            <div class="pf-sign-preview">
              <span class="pf-preview-label">Pratinjau</span>
              <div class="pf-sign-box">
                <img v-if="signatureFile || profile.signature" :src="signatureSrc()" alt="Pratinjau tanda tangan" />
                <span v-else class="pf-sign-empty">Belum ada tanda tangan</span>
              </div>
            </div>
          </div>

          <div class="pf-actions">
            <button class="button button-primary" type="button" :disabled="!signatureFile || savingSignature" @click="saveSignature">
              {{ savingSignature ? 'Menyimpan…' : 'Simpan tanda tangan' }}
            </button>
            <button v-if="signatureFile" class="button button-quiet button-small" type="button" @click="resetSignatureSelection">Batal</button>
          </div>
          <p class="pf-hint">Maksimal {{ limits.signature.maxBytes / 1024 / 1024 }} MB dan {{ limits.signature.maxEdge }}×{{ limits.signature.maxEdge }} piksel. File divalidasi berdasarkan isi (magic bytes), bukan nama.</p>
        </section>
      </div>
    </template>
  </section>
</template>

<style scoped>
.profile-page { --ink:#142f3a; --text:#3d525c; --muted:#5a6f78; --border:#e1e9f1; --divider:#edf2f7; --blue:#0d6efd; display:grid; gap:18px; min-width:0; }
.profile-intro { margin:0; color:var(--muted); font-size:12px; }
.profile-grid { display:grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr); gap:18px; align-items:start; }
.panel { min-width:0; padding:20px; border:1px solid var(--border); border-radius:12px; background:#fff; }
.panel h2 { margin:0 0 14px; color:var(--ink); font-size:14px; font-weight:650; }
.pf-sub { margin:0 0 12px; color:var(--muted); font-size:11px; }
.pf-signature { grid-column:1 / -1; }
.pf-facts { display:grid; gap:12px; margin:0; }
.pf-facts dt { color:var(--muted); font-size:10px; }
.pf-facts dd { margin:2px 0 0; color:var(--ink); font-size:12px; font-weight:600; }
.pf-hint { display:flex; align-items:center; gap:6px; margin:12px 0 0; color:var(--muted); font-size:10px; line-height:1.5; }
.pf-avatar-row { display:flex; align-items:center; gap:14px; }
.pf-avatar-preview { width:72px; height:72px; flex:0 0 auto; border-radius:50%; overflow:hidden; background:#e9f1ff; display:flex; align-items:center; justify-content:center; }
.pf-avatar-preview img { width:100%; height:100%; object-fit:cover; }
.pf-avatar-initial { color:#0b5ed7; font-size:24px; font-weight:700; }
.pf-avatar-info { min-width:0; display:grid; gap:3px; }
.pf-avatar-info strong { color:var(--ink); font-size:12px; }
.pf-avatar-info small { color:var(--muted); font-size:10px; }
.pf-actions { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-top:14px; }
.pf-signature-status { display:flex; align-items:center; gap:8px; padding:10px 12px; border:1px solid var(--border); border-radius:8px; background:var(--divider,#f8fafc); font-size:11px; color:var(--text); }
.pf-signature-status span { flex:1; }
.pf-ok { color:#0b6b45; }
.pf-mode-switch { margin:12px 0; }
.pf-mode { padding:6px 12px; border:1px solid var(--blue); border-radius:8px; background:#e9f1ff; color:#1b4fbf; font-size:10px; font-weight:600; }
.pf-sign-layout { display:grid; grid-template-columns:minmax(0,1.4fr) minmax(200px,1fr); gap:16px; align-items:start; }
.pf-canvas { width:100%; height:160px; border:1px solid #8494a1; border-radius:8px; background:#fff; touch-action:none; cursor:crosshair; }
.pf-canvas-actions { display:flex; gap:8px; margin-top:8px; flex-wrap:wrap; }
.pf-upload { display:block; margin-top:10px; color:var(--muted); font-size:10px; }
.pf-upload .button { margin-top:6px; }
.pf-sign-preview { display:grid; gap:6px; }
.pf-preview-label { color:var(--muted); font-size:10px; font-weight:600; }
.pf-sign-box { min-height:120px; padding:8px; border:1px dashed var(--border); border-radius:8px; background:#fff; display:flex; align-items:center; justify-content:center; }
.pf-sign-box img { max-width:100%; max-height:104px; object-fit:contain; }
.pf-sign-empty { color:var(--muted); font-size:10px; }
@media (max-width:1000px){ .profile-grid{grid-template-columns:1fr;} .pf-sign-layout{grid-template-columns:1fr;} }
</style>
