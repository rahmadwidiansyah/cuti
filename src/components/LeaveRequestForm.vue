<script setup>
import { computed, ref } from 'vue'
import { AlertTriangle, CheckCircle2, FileText, Info, Send, Upload, X } from 'lucide-vue-next'
import DatePicker from './DatePicker.vue'

const props = defineProps({
  form: { type: Object, required: true },
  leaveTypes: { type: Array, default: () => [] },
  preview: { type: Object, default: null },
  previewError: { type: Object, default: null },
  files: { type: Array, default: () => [] },
  existingAttachments: { type: Array, default: () => [] },
  submitting: { type: Boolean, default: false },
  canSubmit: { type: Boolean, default: true },
  routeLabel: { type: String, default: '' },
  categoryLabel: { type: String, default: '' },
})
const emit = defineEmits(['calculate', 'submit', 'draft', 'files', 'remove-existing', 'preview-document', 'dismiss-blackout'])

const fileInput = ref(null)
const dragging = ref(false)
const fileError = ref('')
const MAX_FILE_BYTES = 10 * 1024 * 1024
const MAX_FILES = 5
const ALLOWED_EXT = ['pdf', 'jpg', 'jpeg', 'png']
const dayNames = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab']
const monthShort = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des']

const selectedType = computed(() => props.leaveTypes.find(type => type.code === props.form.leaveTypeCode) || null)
const remaining = computed(() => props.preview?.annualBalance
  ? Number(props.preview.annualBalance.remainingAfter)
  : null)
const blackoutDetails = computed(() => props.previewError?.details || props.previewError)
const isBlackout = computed(() => blackoutDetails.value?.type === 'LEAVE_BLACKOUT')
const previewDays = computed(() => props.preview?.days || [])
const endDate = computed(() => props.preview?.endDate || null)

function formatDate(value, weekday = false) {
  if (!value) return '-'
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00Z`)
  if (Number.isNaN(date.valueOf())) return '-'
  return new Intl.DateTimeFormat('id-ID', {
    ...(weekday ? { weekday: 'long' } : {}),
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  }).format(date)
}

function dayCell(day) {
  const date = new Date(`${String(day.date).slice(0, 10)}T12:00:00Z`)
  return {
    dow: dayNames[date.getUTCDay()],
    day: date.getUTCDate(),
    counted: Boolean(day.counted),
    tag: day.counted ? '' : (day.note || (day.dayClass === 'WEEKEND' ? '-' : 'Libur')),
  }
}

function extensionOf(name) {
  const dot = String(name || '').lastIndexOf('.')
  return dot === -1 ? '' : String(name).slice(dot + 1).toLowerCase()
}
function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

// Gabungkan file lama (tersimpan) + baru, validasi per file, lalu emisikan yang baru.
function acceptFiles(incoming) {
  fileError.value = ''
  const existingCount = props.existingAttachments.length
  const next = [...props.files]
  for (const raw of Array.from(incoming || [])) {
    const name = raw.name || 'file'
    const ext = extensionOf(name)
    if (!ALLOWED_EXT.includes(ext)) {
      fileError.value = `"${name}" ditolak. Gunakan PDF, JPG, atau PNG.`
      emit('files', next)
      return
    }
    if (raw.size > MAX_FILE_BYTES) {
      fileError.value = `"${name}" melebihi 10 MB.`
      emit('files', next)
      return
    }
    if (next.length + existingCount >= MAX_FILES) {
      fileError.value = `Maksimal ${MAX_FILES} lampiran per pengajuan.`
      emit('files', next)
      return
    }
    if (next.some(f => f.name === name && f.size === raw.size)) {
      fileError.value = `"${name}" sudah dipilih.`
      continue
    }
    next.push(raw)
  }
  emit('files', next)
}

function onFiles(event) {
  acceptFiles(event.target.files)
  event.target.value = ''
}
function onDrop(event) {
  dragging.value = false
  acceptFiles(event.dataTransfer?.files)
}
function onDragOver() { dragging.value = true }
function onDragLeave() { dragging.value = false }
function removeNew(index) {
  fileError.value = ''
  emit('files', props.files.filter((_, i) => i !== index))
}
function removeExisting(id) {
  fileError.value = ''
  emit('remove-existing', id)
}
function chooseFiles() {
  fileInput.value?.click()
}
</script>

<template>
  <section class="lf">
    <div class="lf-layout">
      <section class="lf-panel lf-form">
        <h2>1. Jenis cuti</h2>
        <p class="lf-muted">Kategori: {{ categoryLabel || 'Pegawai' }}.</p>
        <div class="lf-types">
          <label
            v-for="type in leaveTypes"
            :key="type.code"
            class="lf-type"
            :class="{ active: form.leaveTypeCode === type.code }"
          >
            <input v-model="form.leaveTypeCode" type="radio" :value="type.code" @change="emit('calculate')" />
            <span><strong>{{ type.name }}</strong><small>{{ (type.deducts_annual_balance ?? type.deductsAnnual) ? 'Mengurangi saldo tahunan' : 'Tidak memotong saldo tahunan' }}</small></span>
          </label>
          <p v-if="!leaveTypes.length" class="lf-muted">Jenis cuti belum tersedia untuk kategori Anda.</p>
        </div>

        <h2>2. Periode cuti</h2>
        <div class="lf-period">
          <DatePicker
            v-model="form.startDate"
            label="Tanggal mulai"
            placeholder="Pilih tanggal mulai"
            @change="emit('calculate')"
          />
          <label><span>Jumlah hari kerja</span><span class="lf-suffix"><input v-model.number="form.workingDays" type="number" min="1" max="365" @input="emit('calculate')" /><small>hari kerja</small></span></label>
        </div>
        <p v-if="endDate && !isBlackout" class="lf-success"><CheckCircle2 :size="14" aria-hidden="true" /> Tanggal selesai {{ formatDate(endDate, true) }}, {{ preview?.workingDays }} hari kerja.</p>
        <p v-if="isBlackout" class="lf-danger"><AlertTriangle :size="14" aria-hidden="true" /> Perhitungan berhenti pada tanggal larangan.</p>

        <hr />
        <h2>3. Detail pengajuan</h2>
        <label class="lf-field"><span>Alasan cuti</span><textarea v-model.trim="form.reason" rows="3" placeholder="Tuliskan alasan singkat, jelas, dan sesuai kebutuhan."></textarea></label>
        <div class="lf-two">
          <label class="lf-field"><span>Alamat selama cuti (wajib)</span><input v-model.trim="form.address" type="text" placeholder="cth. Jl. Pandanaran No. 12, Semarang" /></label>
          <label class="lf-field"><span>Nomor telepon (wajib)</span><input v-model.trim="form.phone" type="tel" placeholder="+62 8xx-xxxx-xxxx" /></label>
        </div>

        <h2>4. Lampiran</h2>
        <div
          class="lf-dropzone"
          :class="{ dragging }"
          @dragover.prevent="onDragOver"
          @dragleave.prevent="onDragLeave"
          @drop.prevent="onDrop"
        >
          <Upload :size="18" aria-hidden="true" />
          <span><strong>Tarik file ke sini atau pilih dari perangkat</strong><small>PDF, JPG, atau PNG, maksimal 10 MB per file, hingga {{ MAX_FILES }} file.</small></span>
          <input ref="fileInput" type="file" accept=".pdf,.jpg,.jpeg,.png" multiple class="sr-only" @change="onFiles" />
          <button class="button button-secondary button-small" type="button" @click="chooseFiles">Pilih file</button>
        </div>
        <p v-if="fileError" class="lf-danger" role="alert">{{ fileError }}</p>
        <ul v-if="existingAttachments.length || files.length" class="lf-file-list">
          <li v-for="file in existingAttachments" :key="`saved-${file.id}`" class="lf-file-item">
            <FileText :size="13" aria-hidden="true" />
            <span class="lf-file-name">{{ file.original_filename }} <small>tersimpan · {{ formatBytes(file.file_size) }}</small></span>
            <button class="lf-file-remove" type="button" :aria-label="`Hapus lampiran ${file.original_filename}`" @click="removeExisting(file.id)"><X :size="14" aria-hidden="true" /></button>
          </li>
          <li v-for="(file, index) in files" :key="`new-${file.name}-${file.size}`" class="lf-file-item">
            <FileText :size="13" aria-hidden="true" />
            <span class="lf-file-name">{{ file.name }} <small>{{ formatBytes(file.size) }} · baru</small></span>
            <button class="lf-file-remove" type="button" :aria-label="`Hapus ${file.name}`" @click="removeNew(index)"><X :size="14" aria-hidden="true" /></button>
          </li>
        </ul>
        <p v-else class="lf-footnote">Belum ada lampiran. Lampiran wajib untuk cuti sakit dan melahirkan.</p>
      </section>

      <aside class="lf-panel lf-side">
        <div class="lf-side-head">
          <h2>Pratinjau perhitungan</h2>
          <span class="lf-tag" :class="{ 'lf-tag-danger': isBlackout }">{{ isBlackout ? 'DITENTUKAN' : 'PREVIEW' }}</span>
        </div>
        <p class="lf-muted">Dihitung dari kalender kerja institusi.</p>

        <div class="lf-date-box" :class="{ 'lf-date-box-danger': isBlackout }">
          <div><span>MULAI</span><strong>{{ formatDate(form.startDate) }}</strong><small>{{ form.startDate ? 'Tanggal pengajuan' : '-' }}</small></div>
          <span class="lf-arrow">→</span>
          <div><span>SELESAI</span><strong>{{ isBlackout ? '-' : formatDate(endDate) }}</strong><small>{{ isBlackout ? 'Belum dapat dihitung' : 'Dihitung otomatis' }}</small></div>
        </div>
        <span class="lf-workdays" :class="{ 'lf-workdays-danger': isBlackout }">{{ isBlackout ? 0 : preview?.workingDays || 0 }} HARI KERJA</span>

        <div class="lf-week">
          <div v-for="day in previewDays" :key="day.date" class="lf-day" :class="{ counted: day.counted, weekend: day.dayClass === 'WEEKEND' }">
            <span>{{ dayCell(day).dow }}</span>
            <strong>{{ dayCell(day).day }}</strong>
            <small>{{ dayCell(day).tag }}</small>
          </div>
          <div v-if="isBlackout" class="lf-day lf-day-blackout">
            <span>{{ dayNames[new Date(`${String(blackoutDetails.date).slice(0,10)}T12:00:00Z`).getUTCDay()] }}</span>
            <strong>{{ Number(String(blackoutDetails.date).slice(8,10)) }}</strong>
            <small>Larangan</small>
          </div>
        </div>
        <p class="lf-hint"><Info :size="12" aria-hidden="true" /> Sabtu dan Minggu tidak dihitung sebagai hari cuti.</p>

        <template v-if="!isBlackout">
          <div class="lf-balance">
            <div><span>Saat ini</span><strong>{{ preview?.annualBalance?.available ?? '-' }}</strong></div>
            <span>→</span>
            <div><span>Reservasi</span><strong>-{{ form.workingDays }}</strong></div>
            <span>→</span>
            <div><span>Sisa</span><strong class="lf-green">{{ remaining ?? '-' }}</strong></div>
          </div>
          <div class="lf-progress"><span :style="{ width: remaining === null ? '0%' : `${Math.max(0, Math.min(100, remaining / Math.max(1, Number(preview?.annualBalance?.available || 1)) * 100))}%` }"></span></div>
          <ul class="lf-checks">
            <li><CheckCircle2 :size="13" aria-hidden="true" /> Saldo mencukupi</li>
            <li><CheckCircle2 :size="13" aria-hidden="true" /> Tidak tumpang tindih</li>
            <li><CheckCircle2 :size="13" aria-hidden="true" /> Tidak ada tanggal larangan</li>
          </ul>
          <p class="lf-note">Catatan cuti: tahun berjalan dan carry-over dihitung ulang saat pengajuan dikirim.</p>
          <button class="button button-primary lf-primary" type="button" :disabled="submitting || !preview || !canSubmit" @click="emit('submit')">
            <Send :size="14" aria-hidden="true" /> Kirim pengajuan
          </button>
        </template>
        <template v-else>
          <div class="lf-blackout">
            <AlertTriangle :size="15" aria-hidden="true" />
            <div><strong>Tanggal larangan cuti</strong><span>{{ formatDate(blackoutDetails.date) }} · {{ blackoutDetails.title }}</span><small>{{ previewError?.error || 'Perhitungan berhenti pada tanggal larangan.' }}</small></div>
          </div>
          <button class="button button-secondary lf-primary" type="button" @click="emit('dismiss-blackout')">
            <FileText :size="14" aria-hidden="true" /> Ubah tanggal &amp; durasi
          </button>
        </template>
        <button class="button button-secondary lf-secondary" type="button" @click="emit('draft')">
          <FileText :size="14" aria-hidden="true" /> Simpan sebagai draf
        </button>
        <button class="lf-link" type="button" @click="emit('preview-document')">Pratinjau dokumen</button>
      </aside>
    </div>

    <div v-if="isBlackout" class="lf-modal-backdrop" @click.self="emit('dismiss-blackout')">
      <div class="lf-modal" role="dialog" aria-modal="true" aria-labelledby="blackout-title">
        <div class="lf-modal-icon"><AlertTriangle :size="22" aria-hidden="true" /></div>
        <h2 id="blackout-title">Pengajuan tidak dapat dilanjutkan</h2>
        <p>Tanggal {{ formatDate(blackoutDetails.date) }} termasuk tanggal larangan cuti.</p>
        <dl class="lf-modal-facts">
          <div><dt>Tanggal larangan</dt><dd>{{ formatDate(blackoutDetails.date) }}</dd></div>
          <div><dt>Keterangan</dt><dd>{{ blackoutDetails.title }}</dd></div>
          <div><dt>Ditemukan pada</dt><dd>hari kerja ke-{{ blackoutDetails.dayIndex }} dari {{ blackoutDetails.workingDays }}</dd></div>
        </dl>
        <p class="lf-modal-note">Tidak ada pengajuan yang dibuat dan tidak ada saldo yang direservasi.</p>
        <div class="lf-modal-actions">
          <button class="button button-primary" type="button" @click="emit('dismiss-blackout')">Ubah tanggal</button>
          <button class="button button-secondary" type="button" @click="emit('dismiss-blackout')">Tutup</button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.lf { --ink:#142f3a; --text:#3d525c; --muted:#5a6f78; --border:#e1e9f1; display:grid; gap:20px; min-width:0; }
.lf-layout { display:grid; grid-template-columns:minmax(0, 716fr) minmax(0, 392fr); gap:20px; align-items:start; }
.lf-panel { min-width:0; padding:20px; border:1px solid var(--border); border-radius:12px; background:#fff; }
.lf-panel h2 { margin:20px 0 10px; color:var(--ink); font-size:12.5px; font-weight:600; }
.lf-panel > h2:first-child { margin-top:0; }
.lf-muted { margin:0 0 10px; color:var(--muted); font-size:10px; }
.lf-panel hr { margin:20px 0; border:0; border-top:1px solid var(--border); }
.lf-types { display:grid; grid-template-columns:repeat(3, minmax(0,1fr)); gap:8px; }
.lf-type { display:flex; align-items:center; gap:8px; min-height:52px; padding:10px; border:1px solid var(--border); border-radius:8px; cursor:pointer; }
.lf-type.active { border-color:#0d6efd; background:#f4f8ff; }
.lf-type input { accent-color:#0d6efd; }
.lf-type strong { display:block; color:var(--ink); font-size:10.5px; font-weight:600; }
.lf-type small { display:block; margin-top:2px; color:var(--muted); font-size:9px; }
.lf-period, .lf-two { display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); gap:12px; }
.lf-period label > span, .lf-field > span { display:block; margin-bottom:6px; color:var(--text); font-size:11px; font-weight:600; }
.lf-period input, .lf-field input, .lf-field textarea { width:100%; min-height:42px; padding:10px; border:1px solid #8494a1; border-radius:8px; color:var(--text); font-size:12px; }
.lf-field textarea { resize:vertical; }
.lf-suffix { position:relative; display:block; }
.lf-suffix small { position:absolute; right:12px; top:50%; transform:translateY(-50%); color:var(--muted); font-size:10px; }
.lf-success, .lf-danger { display:flex; align-items:center; gap:6px; margin:10px 0 0; font-size:10px; }
.lf-success { color:#0b6b45; }
.lf-danger { color:#a11d1d; }
.lf-field { display:block; margin-bottom:12px; }
.lf-optional { margin-left:6px; padding:2px 8px; border-radius:10px; background:#edf2f6; color:var(--muted); font-size:9px; }
.lf-dropzone { display:flex; align-items:center; gap:12px; min-height:72px; padding:12px; border:1px dashed #8494a1; border-radius:10px; transition:border-color .15s, background .15s; }
.lf-dropzone.dragging { border-color:#0d6efd; background:#f4f8ff; }
.lf-dropzone > svg { color:#0d6efd; flex:0 0 auto; }
.lf-dropzone > span { flex:1; min-width:0; }
.lf-dropzone strong { display:block; color:var(--ink); font-size:10.5px; }
.lf-dropzone small { display:block; margin-top:2px; color:var(--muted); font-size:9px; }
.lf-file-list { list-style:none; margin:8px 0 0; padding:0; display:grid; gap:6px; }
.lf-file-item { display:flex; align-items:center; gap:8px; padding:6px 8px; border:1px solid var(--border); border-radius:8px; background:#fff; }
.lf-file-item > svg { color:#0d6efd; flex:0 0 auto; }
.lf-file-name { flex:1; min-width:0; color:var(--text); font-size:10px; word-break:break-all; }
.lf-file-name small { display:block; color:var(--muted); font-size:9px; }
.lf-file-remove { width:28px; height:28px; flex:0 0 auto; display:inline-flex; align-items:center; justify-content:center; border:0; border-radius:6px; background:transparent; color:var(--muted); cursor:pointer; }
.lf-file-remove:hover { background:#fde9e9; color:#a11d1d; }
.lf-file-remove:focus-visible { outline:2px solid #0d6efd; outline-offset:2px; }
.lf-footnote { margin:10px 0 0; color:var(--muted); font-size:9px; }
.lf-side-head { display:flex; align-items:center; justify-content:space-between; gap:12px; }
.lf-side h2 { margin:0; }
.lf-tag { padding:3px 8px; border-radius:10px; background:#e9f1ff; color:#1b4fbf; font-size:9px; font-weight:600; }
.lf-tag-danger { background:#fde9e9; color:#a11d1d; }
.lf-date-box { display:grid; grid-template-columns:1fr auto 1fr; align-items:center; gap:10px; margin-top:14px; padding:14px; border-radius:10px; background:#f7f9fc; }
.lf-date-box-danger { background:#fde9e9; }
.lf-date-box span { display:block; color:var(--muted); font-size:9px; }
.lf-date-box strong { display:block; margin-top:4px; color:var(--ink); font-size:13px; font-weight:700; }
.lf-date-box small { display:block; margin-top:2px; color:var(--muted); font-size:9px; }
.lf-arrow { color:#6e8590; font-size:16px; }
.lf-workdays { display:inline-flex; margin-top:10px; padding:3px 10px; border-radius:10px; background:#e9f1ff; color:#1b4fbf; font-size:9px; font-weight:600; }
.lf-workdays-danger { background:#fde9e9; color:#a11d1d; }
.lf-week { display:flex; gap:6px; margin-top:14px; overflow-x:auto; }
.lf-day { width:44px; min-height:56px; flex:0 0 auto; padding:6px; border:1px solid var(--border); border-radius:8px; background:#fff; text-align:center; }
.lf-day.counted { border-color:#c9dafb; background:#e9f1ff; }
.lf-day.weekend { background:#f7f9fc; }
.lf-day-blackout { border-color:#f4c6c6; background:#fde9e9; color:#a11d1d; }
.lf-day span { display:block; color:var(--muted); font-size:9px; }
.lf-day strong { display:block; margin-top:2px; color:var(--text); font-size:14px; font-weight:600; }
.lf-day.counted strong { color:#0b5ed7; }
.lf-day small { display:block; margin-top:2px; color:var(--muted); font-size:8px; }
.lf-hint { display:flex; align-items:center; gap:5px; margin:10px 0 0; color:var(--muted); font-size:9px; }
.lf-balance { display:grid; grid-template-columns:1fr auto 1fr auto 1fr; align-items:center; gap:8px; margin-top:16px; padding:12px; border-radius:10px; background:#f4f8ff; }
.lf-balance span { display:block; color:var(--muted); font-size:9px; }
.lf-balance strong { display:block; margin-top:2px; color:var(--ink); font-size:16px; }
.lf-green { color:#0b6b45 !important; }
.lf-progress { height:6px; margin-top:10px; border-radius:3px; background:var(--border); overflow:hidden; }
.lf-progress span { display:block; height:100%; background:#0d6efd; border-radius:3px; }
.lf-checks { list-style:none; margin:14px 0 0; padding:0; display:grid; gap:8px; }
.lf-checks li { display:flex; align-items:center; gap:8px; color:var(--text); font-size:10px; }
.lf-checks svg { color:#0b6b45; }
.lf-note { margin:12px 0 0; color:var(--muted); font-size:9px; line-height:1.5; }
.lf-primary { width:100%; min-height:44px; margin-top:16px; }
.lf-secondary { width:100%; min-height:40px; margin-top:8px; }
.lf-link { display:block; margin:10px auto 0; padding:0; border:0; background:transparent; color:#0d6efd; font-size:10px; font-weight:600; cursor:pointer; }
.lf-link:hover { text-decoration:underline; }
.lf-blackout { display:flex; align-items:flex-start; gap:8px; margin-top:16px; padding:12px; border:1px solid #f4c6c6; border-radius:8px; background:#fde9e9; color:#a11d1d; }
.lf-blackout strong { display:block; font-size:10px; }
.lf-blackout span, .lf-blackout small { display:block; margin-top:2px; font-size:9px; }
.lf-modal-backdrop { position:fixed; inset:0; z-index:200; display:flex; align-items:center; justify-content:center; padding:16px; background:rgba(20,47,58,.45); }
.lf-modal { width:100%; max-width:540px; padding:28px; border-radius:16px; background:#fff; box-shadow:0 24px 64px rgba(0,0,0,.18); }
.lf-modal-icon { width:44px; height:44px; display:flex; align-items:center; justify-content:center; border-radius:50%; background:#fde9e9; color:#a11d1d; }
.lf-modal h2 { margin:16px 0 8px; color:var(--ink); font-size:20px; }
.lf-modal > p { margin:0; color:var(--text); font-size:12px; }
.lf-modal-facts { margin:20px 0 0; padding:14px 16px; border-radius:10px; background:#f7f9fc; }
.lf-modal-facts > div { display:flex; justify-content:space-between; gap:12px; padding:6px 0; font-size:11px; }
.lf-modal-facts dt { color:var(--muted); }
.lf-modal-facts dd { margin:0; color:var(--ink); font-weight:600; }
.lf-modal-note { margin-top:14px !important; color:var(--muted) !important; font-size:10px !important; }
.lf-modal-actions { display:flex; gap:8px; margin-top:20px; }

@media (max-width:1180px){ .lf-layout{ grid-template-columns:1fr; } }
@media (max-width:640px){ .lf-types{ grid-template-columns:1fr 1fr; } .lf-period,.lf-two{ grid-template-columns:1fr; } }
</style>
