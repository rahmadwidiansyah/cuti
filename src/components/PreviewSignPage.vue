<script setup>
import { computed, ref } from 'vue'
import { Download, FileText, Info, PenLine, RotateCcw, Send, ShieldCheck, Upload } from 'lucide-vue-next'

const props = defineProps({
  request: { type: Object, required: true },
  submitting: { type: Boolean, default: false },
})
const emit = defineEmits(['back', 'submit', 'save-draft', 'save-signature'])

const canvasRef = ref(null)
const fileInput = ref(null)
const localError = ref('')
const mode = ref('draw')
let drawing = false

const stageLabels = {
  ADMIN_REVIEW: 'Admin',
  PERTIMBANGAN_REVIEW: 'Analis SDM',
  KASUBAG_REVIEW: 'Kasubag',
  KEPSTA_REVIEW: 'Kepsta',
  PPK_REVIEW: 'PPK',
}
const categoryLabels = {
  PNS_TU: 'PNS · TU',
  PNS: 'PNS · non-TU',
  PPPK_PPNPN_TU: 'PPPK/PPNPN · TU',
  PPPK_PPNPN: 'PPPK/PPNPN · non-TU',
  KONTRAK: 'Kontrak',
}
const roleLabels = { ADMIN: 'Admin', HR_ANALYST: 'Analis SDM', KASUBAG: 'Kasubag', KEPSTA: 'Kepsta', PPK: 'PPK' }

const routeLabel = computed(() =>
  (props.request.stages || []).map(stage => stageLabels[stage.stage_code] || stage.stage_code).join(' > ')
)
const previewUrl = computed(() => `/api/requests/${props.request.id}/preview-document`)
const signatures = computed(() => props.request.signatures || [])
const statusLabel = computed(() => ({
  SUBMITTED: 'menunggu verifikasi',
  ADMIN_REVIEW: 'menunggu verifikasi',
  APPROVED: 'disetujui',
})[props.request.status] || props.request.status || '-')

function formatDate(value) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return '-'
  return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }).format(date)
}

function point(event, canvas) {
  const rect = canvas.getBoundingClientRect()
  return {
    x: (event.clientX - rect.left) * (canvas.width / rect.width),
    y: (event.clientY - rect.top) * (canvas.height / rect.height),
  }
}
function startDraw(event) {
  drawing = true
  const canvas = event.currentTarget
  const p = point(event, canvas)
  const ctx = canvas.getContext('2d')
  ctx.strokeStyle = '#142f3a'
  ctx.lineWidth = 2
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(p.x, p.y)
}
function draw(event) {
  if (!drawing) return
  const canvas = event.currentTarget
  const p = point(event, canvas)
  const ctx = canvas.getContext('2d')
  ctx.lineTo(p.x, p.y)
  ctx.stroke()
}
function endDraw() { drawing = false }

function clearCanvas() {
  const canvas = canvasRef.value
  if (!canvas) return
  canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height)
  localError.value = ''
}

function saveCanvas() {
  const canvas = canvasRef.value
  if (!canvas) return
  canvas.toBlob((blob) => {
    if (!blob) {
      localError.value = 'Gagal membuat gambar tanda tangan.'
      return
    }
    localError.value = ''
    emit('save-signature', new File([blob], 'tanda-tangan-pegawai.png', { type: 'image/png' }))
  }, 'image/png')
}
function chooseFile(event) {
  const file = event.target.files?.[0]
  if (file) emit('save-signature', file)
}
function submit() {
  localError.value = ''
  emit('submit')
}
</script>

<template>
  <section class="preview-page">
    <div class="pv-head">
      <div>
        <h1>Pratinjau pengajuan</h1>
        <p>{{ categoryLabels[request.employeeCategory] || request.employeeCategory || '-' }} · {{ routeLabel || 'Rute belum tersedia' }}</p>
      </div>
      <button class="button button-secondary" type="button" @click="emit('back')">Batal</button>
    </div>

    <div class="pv-layout">
      <section class="pv-panel pv-document">
        <div class="pv-document-head">
          <div>
            <h2>Formulir Cuti Pegawai</h2>
            <p>{{ request.requestNumber }} · {{ request.status === 'DRAFT' ? 'pratinjau dokumen, belum final' : statusLabel }}</p>
          </div>
          <div class="pv-document-actions">
            <span>100%</span>
            <a class="pv-download" :href="previewUrl" target="_blank" rel="noopener">
              <Download :size="13" aria-hidden="true" /> Unduh PDF
            </a>
          </div>
        </div>
        <div class="pv-paper">
          <iframe :src="previewUrl" :title="`Pratinjau ${request.requestNumber}`" class="pv-iframe"></iframe>
        </div>
      </section>

      <aside class="pv-panel pv-sign">
        <h2>Tanda tangan &amp; kirim</h2>
        <p class="pv-sub">Tanda tangan pegawai opsional. Tanda tangan pejabat dicatat pada tahapnya masing-masing.</p>

        <h3>TANDA TANGAN PEGAWAI</h3>
        <div class="pv-canvas-wrap">
          <canvas
            ref="canvasRef"
            class="pv-canvas"
            width="704"
            height="256"
            @pointerdown.prevent="startDraw"
            @pointermove.prevent="draw"
            @pointerup="endDraw"
            @pointerleave="endDraw"
          ></canvas>
          <span class="pv-canvas-hint">Tanda tangan pemohon (opsional)</span>
        </div>
        <div class="pv-mode-switch">
          <button class="pv-mode" :class="{ active: mode === 'draw' }" type="button" @click="mode = 'draw'">
            <PenLine :size="14" aria-hidden="true" /> Gambar langsung
          </button>
          <button class="pv-mode" :class="{ active: mode === 'upload' }" type="button" @click="mode = 'upload'">
            <Upload :size="14" aria-hidden="true" /> Unggah gambar
          </button>
        </div>
        <div v-if="mode === 'draw'" class="pv-canvas-actions">
          <button class="button button-secondary pv-reset-sign" type="button" @click="clearCanvas">
            <RotateCcw :size="13" aria-hidden="true" /> Reset
          </button>
          <button class="button button-primary pv-save-sign" type="button" @click="saveCanvas">Simpan tanda tangan</button>
        </div>
        <div v-else class="pv-upload">
          <input ref="fileInput" type="file" accept="image/png,image/jpeg" @change="chooseFile" />
        </div>

        <hr />
        <h3>TANDA TANGAN PEJABAT SETELAH REVIEW</h3>
        <div v-if="signatures.length" class="pv-official-list">
          <div v-for="(sig, index) in signatures" :key="index" class="pv-official">
            <div><strong>{{ sig.name || roleLabels[sig.roleCode] || sig.roleCode }}</strong><small>{{ sig.position || roleLabels[sig.roleCode] || '-' }}</small></div>
            <small>Tersimpan · {{ formatDate(sig.signedAt) }}</small>
            <small v-if="sig.hash">Hash {{ String(sig.hash).slice(0, 8) }}</small>
          </div>
        </div>
        <p v-else class="pv-empty-sign">Belum ada tanda tangan pejabat.</p>

        <div class="pv-info">
          <Info :size="15" aria-hidden="true" />
          <div>
            <p>PDF final, hash, dan QR dibuat setelah keputusan disetujui.</p>
            <p>Nomor surat dibuat otomatis dan dapat diubah Admin sebelum final.</p>
          </div>
        </div>

        <p v-if="localError" class="pv-error" role="alert">{{ localError }}</p>
        <button class="button button-primary pv-primary" type="button" :disabled="submitting || request.status !== 'DRAFT'" @click="submit">
          <Send :size="14" aria-hidden="true" /> {{ submitting ? 'Mengirim…' : 'Kirim pengajuan' }}
        </button>
        <button class="button button-secondary pv-secondary" type="button" @click="emit('save-draft')">
          <FileText :size="14" aria-hidden="true" /> Simpan sebagai draf
        </button>
        <p class="pv-foot"><ShieldCheck :size="12" aria-hidden="true" /> Dengan mengirim, Anda menyetujui snapshot data pada dokumen ini.</p>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.preview-page {
  --ink: #142f3a; --text: #3d525c; --muted: #5a6f78;
  --border: #e1e9f1; --divider: #edf2f7; --blue: #0d6efd;
  display: grid; gap: 20px; min-width: 0;
}
.pv-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.pv-head h1 { margin: 0 0 6px; font-size: 26px; font-weight: 700; color: var(--ink); }
.pv-head p { margin: 0; color: var(--muted); font-size: 13px; }

.pv-layout { display: grid; grid-template-columns: minmax(0, 716fr) minmax(0, 392fr); gap: 20px; align-items: start; }
.pv-panel { min-width: 0; padding: 20px; border: 1px solid var(--border); border-radius: 12px; background: #fff; }
.pv-document-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 16px; }
.pv-document-head h2 { margin: 0 0 4px; color: var(--ink); font-size: 13px; font-weight: 600; }
.pv-document-head p { margin: 0; color: var(--muted); font-size: 10px; }
.pv-document-actions { display: flex; align-items: center; gap: 12px; }
.pv-document-actions > span { color: var(--muted); font-size: 10px; }
.pv-download { display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; border-radius: 8px; background: #e9f1ff; color: #1b4fbf; font-size: 10px; font-weight: 600; text-decoration: none; }
.pv-download:hover { text-decoration: underline; }
.pv-paper { min-height: 620px; padding: 12px; border: 1px solid #d8e2ea; border-radius: 4px; background: var(--card, #fff); }
.pv-iframe { width: 100%; height: 600px; border: 0; }

.pv-sign hr { margin: 16px 0; border: 0; border-top: 1px solid var(--border); }
.pv-sign h2 { margin: 0 0 4px; color: var(--ink); font-size: 14px; font-weight: 600; }
.pv-sign h3 { margin: 16px 0 8px; color: var(--muted); font-size: 9px; font-weight: 600; letter-spacing: 0.04em; }
.pv-sub { margin: 0; color: var(--muted); font-size: 9.5px; line-height: 1.5; }
.pv-canvas-wrap { position: relative; }
.pv-canvas { width: 100%; height: 128px; border: 1px solid #8494a1; border-radius: 8px; background: #fff; touch-action: none; cursor: crosshair; }
.pv-canvas-hint { position: absolute; left: 12px; bottom: 12px; color: var(--muted); font-size: 9px; pointer-events: none; }
.pv-mode-switch { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 8px; }
.pv-mode { display: flex; align-items: center; justify-content: center; gap: 6px; min-height: 34px; border: 1px solid var(--border); border-radius: 8px; background: #fff; color: var(--text); font-size: 9.5px; font-weight: 600; cursor: pointer; }
.pv-mode.active { border-color: var(--blue); background: #e9f1ff; color: #1b4fbf; }
.pv-upload input { width: 100%; margin-top: 8px; font-size: 10px; }
.pv-canvas-actions { display: grid; grid-template-columns: 100px 1fr; gap: 8px; margin-top: 8px; }
.pv-reset-sign { min-height: 34px; font-size: 10px; display: inline-flex; align-items: center; justify-content: center; gap: 5px; }
.pv-save-sign { min-height: 34px; margin-top: 0; font-size: 10px; }
.pv-official-list { display: grid; gap: 8px; }
.pv-official { padding: 10px 12px; border-radius: 8px; background: var(--divider); }
.pv-official strong { display: block; color: var(--ink); font-size: 10px; font-weight: 600; }
.pv-official small { display: block; margin-top: 2px; color: var(--muted); font-size: 9px; }
.pv-empty-sign { margin: 0; color: var(--text); font-size: 10px; }
.pv-info { display: flex; align-items: flex-start; gap: 8px; margin-top: 16px; padding: 12px; border-radius: 8px; background: #f4f8ff; color: var(--text); }
.pv-info svg { flex: 0 0 auto; color: var(--blue); }
.pv-info p { margin: 0 0 4px; font-size: 9px; line-height: 1.5; }
.pv-info p:last-child { margin-bottom: 0; }
.pv-error { margin: 12px 0 0; color: #a11d1d; font-size: 10px; }
.pv-primary { width: 100%; min-height: 46px; margin-top: 16px; }
.pv-secondary { width: 100%; min-height: 40px; margin-top: 8px; }
.pv-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.pv-foot { display: flex; align-items: flex-start; gap: 6px; margin: 10px 0 0; color: var(--muted); font-size: 9px; line-height: 1.4; }
.pv-foot svg { flex: 0 0 auto; }

@media (max-width: 1180px) {
  .pv-layout { grid-template-columns: 1fr; }
}
</style>
