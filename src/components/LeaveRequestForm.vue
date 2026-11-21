<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { AlertTriangle, CheckCircle2, FileText, Info, Send, Upload, X } from 'lucide-vue-next'
import { confirmAction } from '../sweetalert.js'
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
const blackoutModalRef = ref(null)
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

async function requestDocumentPreview() {
  const ok = await confirmAction({
    title: 'Simpan draf terlebih dahulu?',
    text: 'Pratinjau dokumen menyimpan draf pengajuan ini sebelum ditampilkan.',
    confirmText: 'Ya, lanjutkan',
    icon: 'info',
  })
  if (ok) emit('preview-document')
}

function onModalKeydown(event) {
  if (!isBlackout.value) return
  if (event.key === 'Escape') {
    emit('dismiss-blackout')
    return
  }
  if (event.key !== 'Tab' || !blackoutModalRef.value) return
  const focusable = [...blackoutModalRef.value.querySelectorAll('button')]
  if (!focusable.length) return
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

watch(isBlackout, async (value) => {
  if (!value) return
  await nextTick()
  blackoutModalRef.value?.querySelector('button')?.focus()
})

onMounted(() => document.addEventListener('keydown', onModalKeydown))
onBeforeUnmount(() => document.removeEventListener('keydown', onModalKeydown))
</script>

<template>
  <section class="lf">
    <div class="lf-layout">
      <section class="lf-panel lf-form">
        <h2>1. Jenis cuti</h2>
        <p v-if="categoryLabel && categoryLabel !== '—'" class="lf-muted">Kategori: {{ categoryLabel }}.</p>
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
            id="leave-start-date"
            label="Tanggal mulai"
            placeholder="Pilih tanggal mulai"
            @change="emit('calculate')"
          />
          <label><span>Jumlah hari kerja</span><input v-model.number="form.workingDays" type="number" min="1" max="365" @input="emit('calculate')" /></label>
        </div>
        <p v-if="endDate && !isBlackout" class="lf-success"><CheckCircle2 :size="14" aria-hidden="true" /> Tanggal selesai {{ formatDate(endDate, true) }}.</p>
        <p v-if="isBlackout" class="lf-danger"><AlertTriangle :size="14" aria-hidden="true" /> Perhitungan berhenti pada tanggal larangan.</p>

        <hr />
        <h2>3. Detail pengajuan</h2>
        <label class="lf-field"><span>Alasan cuti (wajib)</span><textarea v-model.trim="form.reason" rows="3" required minlength="10" placeholder="Minimal 10 karakter, jelaskan keperluan cuti Anda."></textarea></label>
        <div class="lf-two">
          <label class="lf-field"><span>Alamat selama cuti (wajib)</span><input v-model.trim="form.address" type="text" required minlength="10" placeholder="cth. Jl. Pandanaran No. 12, Semarang" /></label>
          <label class="lf-field"><span>Nomor telepon (wajib)</span><input v-model.trim="form.phone" type="tel" required pattern="[0-9+]{8,20}" placeholder="+6281234567890" /></label>
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
          <span class="lf-tag" :class="{ 'lf-tag-danger': isBlackout }">{{ isBlackout ? 'TERHENTI' : 'PREVIEW' }}</span>
        </div>
        <p class="lf-muted">Dihitung dari kalender kerja institusi.</p>

        <div class="lf-date-box" :class="{ 'lf-date-box-danger': isBlackout }">
          <div><span>MULAI</span><strong>{{ formatDate(form.startDate) }}</strong><small>{{ form.startDate ? 'Tanggal mulai cuti' : '-' }}</small></div>
          <span class="lf-arrow" aria-hidden="true">→</span>
          <div><span>SELESAI</span><strong>{{ isBlackout ? '-' : formatDate(endDate) }}</strong><small>{{ isBlackout ? 'Belum dapat dihitung' : (endDate ? 'Dihitung otomatis' : '-') }}</small></div>
        </div>
        <span v-if="preview || isBlackout" class="lf-workdays" :class="{ 'lf-workdays-danger': isBlackout }">{{ isBlackout ? 0 : preview?.workingDays || 0 }} HARI KERJA</span>

        <div v-if="previewDays.length || isBlackout" class="lf-week">
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
          <template v-if="preview">
            <div class="lf-balance">
              <div><span>Saat ini</span><strong>{{ preview?.annualBalance?.available ?? '-' }}</strong></div>
              <span aria-hidden="true">→</span>
              <div><span>Reservasi</span><strong>-{{ form.workingDays }}</strong></div>
              <span aria-hidden="true">→</span>
              <div><span>Sisa</span><strong class="lf-green">{{ remaining ?? '-' }}</strong></div>
            </div>
            <div class="lf-progress"><span :style="{ width: remaining === null ? '0%' : `${Math.max(0, Math.min(100, remaining / Math.max(1, Number(preview?.annualBalance?.available || 1)) * 100))}%` }"></span></div>
            <ul class="lf-checks">
              <li><CheckCircle2 :size="13" aria-hidden="true" /> Saldo mencukupi</li>
              <li><CheckCircle2 :size="13" aria-hidden="true" /> Tidak tumpang tindih</li>
              <li><CheckCircle2 :size="13" aria-hidden="true" /> Tidak ada tanggal larangan</li>
            </ul>
            <p class="lf-note">Catatan cuti: tahun berjalan dan carry-over dihitung ulang saat pengajuan dikirim.</p>
          </template>
          <p v-else class="lf-state-empty">Isi jenis cuti dan tanggal mulai untuk melihat perhitungan.</p>
          <p v-if="!canSubmit && !submitting" class="lf-submit-hint">Lengkapi perhitungan dan lampiran sebelum mengirim pengajuan.</p>
          <button class="button button-primary lf-primary" type="button" :disabled="submitting || !preview || !canSubmit" @click="emit('submit')">
            <Send :size="14" aria-hidden="true" /> Kirim pengajuan
          </button>
        </template>
        <template v-else>
          <div class="lf-blackout">
            <AlertTriangle :size="15" aria-hidden="true" />
            <div><strong>Tanggal larangan cuti</strong><span>{{ formatDate(blackoutDetails.date) }} · {{ blackoutDetails.title }}</span><small>{{ previewError?.error || 'Perhitungan berhenti pada tanggal larangan.' }}</small></div>
          </div>
        </template>
        <button class="button button-secondary lf-secondary" type="button" @click="emit('draft')">
          <FileText :size="14" aria-hidden="true" /> Simpan sebagai draf
        </button>
        <button class="lf-link" type="button" @click="requestDocumentPreview">Simpan draf &amp; pratinjau</button>
      </aside>
    </div>

    <div v-if="isBlackout" class="lf-modal-backdrop" @click.self="emit('dismiss-blackout')">
      <div ref="blackoutModalRef" class="lf-modal" role="dialog" aria-modal="true" aria-labelledby="blackout-title">
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
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.lf { display:grid; gap:20px; min-width:0; }
.lf-layout { display:grid; grid-template-columns:minmax(0, 716fr) minmax(0, 392fr); gap:20px; align-items:start; }
.lf-panel { min-width:0; padding:20px; border:1px solid var(--border); border-radius:var(--radius-panel); background:var(--card); }
.lf-panel h2 { margin:20px 0 10px; color:var(--ink); font-size:16px; font-weight:600; }
.lf-panel > h2:first-child { margin-top:0; }
.lf-muted { margin:0 0 10px; color:var(--muted); font-size:11px; }
.lf-panel hr { margin:20px 0; border:0; border-top:1px solid var(--border); }
.lf-types { display:grid; grid-template-columns:repeat(3, minmax(0,1fr)); gap:8px; }
.lf-type { display:flex; align-items:center; gap:8px; min-height:52px; padding:10px; border:1px solid var(--border); border-radius:var(--radius-control); cursor:pointer; background:var(--card); }
.lf-type.active { border-color:var(--primary); background:var(--primary-tint); }
.lf-type input { accent-color:var(--primary); }
.lf-type strong { display:block; color:var(--ink); font-size:11px; font-weight:600; }
.lf-type small { display:block; margin-top:2px; color:var(--muted); font-size:10px; }
.lf-period, .lf-two { display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); gap:12px; }
.lf-period label > span, .lf-field > span { display:block; margin-bottom:6px; color:var(--text); font-size:11px; font-weight:600; }
.lf-period input, .lf-field input, .lf-field textarea { width:100%; min-height:44px; padding:10px 12px; border:1px solid var(--control-border); border-radius:var(--radius-control); background:var(--card); color:var(--text); font-size:12px; }
.lf-field textarea { resize:vertical; }
.lf-success, .lf-danger { display:flex; align-items:center; gap:6px; margin:10px 0 0; font-size:11px; }
.lf-success { color:var(--success-text); }
.lf-danger { color:var(--danger-text); }
.lf-field { display:block; margin-bottom:12px; }
.lf-state-empty {
  margin:16px 0 0;
  padding:14px;
  border:1px dashed var(--border);
  border-radius:var(--radius-control);
  color:var(--muted);
  font-size:11px;
  line-height:1.5;
  text-align:center;
}
.lf-submit-hint { margin:12px 0 -8px; font-size:11px; }
.lf-dropzone { display:flex; align-items:center; gap:12px; min-height:72px; padding:12px; border:1px dashed var(--control-border); border-radius:var(--radius-control); transition:border-color 120ms ease-out, background 120ms ease-out; }
.lf-dropzone.dragging { border-color:var(--primary); background:var(--primary-tint); }
.lf-dropzone > svg { color:var(--primary); flex:0 0 auto; }
.lf-dropzone > span { flex:1; min-width:0; }
.lf-dropzone strong { display:block; color:var(--ink); font-size:11px; }
.lf-dropzone small { display:block; margin-top:2px; color:var(--muted); font-size:10px; }
.lf-file-list { list-style:none; margin:8px 0 0; padding:0; display:grid; gap:6px; }
.lf-file-item { display:flex; align-items:center; gap:8px; padding:6px 8px; border:1px solid var(--border); border-radius:var(--radius-control); background:var(--card); }
.lf-file-item > svg { color:var(--primary); flex:0 0 auto; }
.lf-file-name { flex:1; min-width:0; color:var(--text); font-size:10px; word-break:break-all; }
.lf-file-name small { display:block; color:var(--muted); font-size:10px; }
.lf-file-remove { width:32px; height:32px; flex:0 0 auto; display:inline-flex; align-items:center; justify-content:center; border:0; border-radius:var(--radius-control); background:transparent; color:var(--muted); cursor:pointer; }
.lf-file-remove:hover { background:var(--danger-bg); color:var(--danger-text); }
.lf-footnote { margin:10px 0 0; color:var(--muted); font-size:10px; }
.lf-side-head { display:flex; align-items:center; justify-content:space-between; gap:12px; }
.lf-side h2 { margin:0; }
.lf-tag { padding:3px 8px; border:1px solid var(--info-border); border-radius:999px; background:var(--info-bg); color:var(--info-text); font-size:10px; font-weight:650; letter-spacing:0.04em; text-transform:uppercase; }
.lf-tag-danger { background:var(--danger-bg); border-color:var(--danger-border); color:var(--danger-text); }
.lf-date-box { display:grid; grid-template-columns:1fr auto 1fr; align-items:center; gap:10px; margin-top:14px; padding:14px; border-radius:var(--radius-control); background:var(--subtle); }
.lf-date-box-danger { background:var(--danger-bg); }
.lf-date-box span { display:block; color:var(--muted); font-size:10px; }
.lf-date-box strong { display:block; margin-top:4px; color:var(--ink); font-size:13px; font-weight:700; }
.lf-date-box small { display:block; margin-top:2px; color:var(--muted); font-size:10px; }
.lf-arrow { color:var(--muted); font-size:16px; }
.lf-workdays { display:inline-flex; margin-top:10px; padding:3px 8px; border:1px solid var(--info-border); border-radius:999px; background:var(--info-bg); color:var(--info-text); font-size:10px; font-weight:650; }
.lf-workdays-danger { background:var(--danger-bg); border-color:var(--danger-border); color:var(--danger-text); }
.lf-week { display:flex; gap:6px; margin-top:14px; overflow-x:auto; }
.lf-day { width:44px; min-height:56px; flex:0 0 auto; padding:6px; border:1px solid var(--border); border-radius:var(--radius-control); background:var(--card); text-align:center; }
.lf-day.counted { border-color:var(--info-border); background:var(--info-bg); }
.lf-day.weekend { background:var(--subtle); }
.lf-day-blackout { border-color:var(--danger-border); background:var(--danger-bg); color:var(--danger-text); }
.lf-day span { display:block; color:var(--muted); font-size:10px; }
.lf-day strong { display:block; margin-top:2px; color:var(--text); font-size:14px; font-weight:600; }
.lf-day.counted strong { color:var(--primary-dark); }
.lf-day small { display:block; margin-top:2px; color:var(--muted); font-size:10px; }
.lf-hint { display:flex; align-items:center; gap:5px; margin:10px 0 0; color:var(--muted); font-size:10px; }
.lf-balance { display:grid; grid-template-columns:1fr auto 1fr auto 1fr; align-items:center; gap:8px; margin-top:16px; padding:12px; border-radius:var(--radius-control); background:var(--primary-tint); }
.lf-balance span { display:block; color:var(--muted); font-size:10px; }
.lf-balance strong { display:block; margin-top:2px; color:var(--ink); font-size:16px; font-variant-numeric:tabular-nums; }
.lf-green { color:var(--success-text) !important; }
.lf-progress { height:6px; margin-top:10px; border-radius:3px; background:var(--border); overflow:hidden; }
.lf-progress span { display:block; height:100%; background:var(--primary); border-radius:3px; }
.lf-checks { list-style:none; margin:14px 0 0; padding:0; display:grid; gap:8px; }
.lf-checks li { display:flex; align-items:center; gap:8px; color:var(--text); font-size:11px; }
.lf-checks svg { color:var(--success-text); }
.lf-note { margin:12px 0 0; color:var(--muted); font-size:10px; line-height:1.5; }
.lf-primary { width:100%; min-height:46px; margin-top:16px; }
.lf-secondary { width:100%; min-height:40px; margin-top:8px; }
.lf-link { display:block; margin:10px auto 0; padding:0; border:0; background:transparent; color:var(--primary-dark); font-size:11px; font-weight:600; cursor:pointer; }
.lf-link:hover { text-decoration:underline; }
.lf-link:disabled { opacity:.45; cursor:not-allowed; text-decoration:none; }
.lf-blackout { display:flex; align-items:flex-start; gap:8px; margin-top:16px; padding:12px; border:1px solid var(--danger-border); border-radius:var(--radius-control); background:var(--danger-bg); color:var(--danger-text); }
.lf-blackout strong { display:block; font-size:11px; }
.lf-blackout span, .lf-blackout small { display:block; margin-top:2px; font-size:10px; }
.lf-modal-backdrop { position:fixed; inset:0; z-index:200; display:flex; align-items:center; justify-content:center; padding:16px; background:rgba(20, 47, 58, 0.5); }
.lf-modal { width:100%; max-width:540px; padding:40px; border-radius:var(--radius-modal); background:var(--card); box-shadow:var(--shadow-modal); }
.lf-modal-icon { width:44px; height:44px; display:flex; align-items:center; justify-content:center; border-radius:50%; background:var(--danger-bg); color:var(--danger-text); }
.lf-modal h2 { margin:16px 0 8px; color:var(--ink); font-size:20px; }
.lf-modal > p { margin:0; color:var(--text); font-size:12px; }
.lf-modal-facts { margin:20px 0 0; padding:14px 16px; border-radius:var(--radius-control); background:var(--subtle); }
.lf-modal-facts > div { display:flex; justify-content:space-between; gap:12px; padding:6px 0; font-size:11px; }
.lf-modal-facts dt { color:var(--muted); }
.lf-modal-facts dd { margin:0; color:var(--ink); font-weight:600; }
.lf-modal-note { margin-top:14px !important; color:var(--muted) !important; font-size:10px !important; }
.lf-modal-actions { display:flex; gap:8px; margin-top:20px; }

@media (max-width:1200px){ .lf-layout{ grid-template-columns:1fr; } }
@media (max-width:640px){ .lf-types{ grid-template-columns:1fr 1fr; } .lf-period,.lf-two{ grid-template-columns:1fr; } }
</style>
