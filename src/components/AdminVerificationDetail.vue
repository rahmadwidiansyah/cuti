<script setup>
import { computed, ref } from 'vue'
import { downloadPdf } from '../download.js'
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Download,
  Eye,
  FileText,
  Info,
  ShieldCheck,
  Undo2,
} from 'lucide-vue-next'
import StatusPill from './StatusPill.vue'

const props = defineProps({
  request: { type: Object, required: true },
  submitting: { type: Boolean, default: false },
})
const emit = defineEmits(['back', 'action', 'cancel'])

const notes = ref('')
const notesField = ref(null)
const localError = ref('')
const downloading = ref(false)

async function downloadFinal() {
  if (downloading.value) return
  downloading.value = true
  localError.value = ''
  try {
    await downloadPdf(`/api/requests/${props.request.id}/pdf`, `Formulir-Cuti-${props.request.requestNumber}.pdf`)
  } catch (error) {
    localError.value = error instanceof Error ? error.message : 'Gagal mengunduh PDF.'
  } finally {
    downloading.value = false
  }
}

const monthShort =['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des']
const dayNames = ['Min','Sen','Sel','Rab','Kam','Jum','Sab']
const categoryLabels = {
  PNS_TU: 'PNS · TU',
  PNS: 'PNS · non-TU',
  PPPK_PPNPN_TU: 'PPPK/PPNPN · TU',
  PPPK_PPNPN: 'PPPK/PPNPN · non-TU',
  KONTRAK: 'Kontrak',
}
const kindLabel = computed(() => `CUTI ${String(props.request.leaveTypeCode || props.request.leaveTypeName || '').toUpperCase()}`)
const categoryText = computed(() => categoryLabels[props.request.employeeCategory] || props.request.employeeCategory || 'Pegawai')
const isCompleted = computed(() => ['APPROVED', 'REJECTED', 'CANCELLED', 'WITHDRAWN'].includes(props.request.status))
const canPreview = computed(() => isCompleted.value || props.request.status !== 'DRAFT')

const canAct = computed(() => Boolean(props.request.canAct) && !props.submitting)

const submittedMeta = computed(() => {
  const raw = props.request.submittedAt
  if (!raw) return `Pegawai ${categoryText.value}`
  const date = new Date(raw)
  const now = new Date()
  const time = new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit' }).format(date).replace(':', '.')
  const when = date.toDateString() === now.toDateString()
    ? `hari ini, ${time}`
    : `${date.getDate()} ${monthShort[date.getMonth()]} ${date.getFullYear()}`
  return `Diajukan ${when}`
})

const employeeInitials = computed(() => initials(props.request.employeeName))

const checks = computed(() => {
  const r = props.request
  return [
    { label: 'Identitas & status pegawai', ok: Boolean(r.employeeName && r.employeeCategory) },
    { label: 'Nomor identitas tercatat', ok: Boolean(r.identity) },
    { label: 'Jenis cuti tercatat', ok: Boolean(r.leaveTypeName) },
    { label: 'Tanggal hasil hitung', ok: Array.isArray(r.days) && r.days.length > 0 },
    { label: 'Durasi & reservasi', ok: Number(r.workingDays) > 0 },
    { label: 'Lampiran wajib', ok: Array.isArray(r.attachments) && r.attachments.length > 0 },
    { label: 'Tumpang tindih jadwal', ok: false, manual: true },
  ]
})
const passedChecks = computed(() => checks.value.filter(check => check.ok).length)
const trail = computed(() => (props.request.events || []).slice(-3).reverse())
const attachment = computed(() => (props.request.attachments || [])[0] || null)
const hasAttachmentIssue = computed(() => attachment.value && ['REJECTED', 'SCAN_FAILED'].includes(String(attachment.value.status || '').toUpperCase()))

function initials(name) {
  return String(name || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0].toUpperCase())
    .join('') || '?'
}

function formatDate(value, weekday = false) {
  if (!value) return '-'
  const text = String(value)
  const isTimestamp = text.includes('T')
  const date = isTimestamp ? new Date(text) : new Date(`${text.slice(0, 10)}T12:00:00Z`)
  if (Number.isNaN(date.valueOf())) return '-'
  return new Intl.DateTimeFormat('id-ID', {
    ...(weekday ? { weekday: 'long' } : {}),
    day: 'numeric', month: 'short', year: 'numeric',
    timeZone: isTimestamp ? 'Asia/Jakarta' : 'UTC',
  }).format(date)
}

function dayCell(day) {
  const date = new Date(`${String(day.leave_date).slice(0, 10)}T12:00:00Z`)
  return {
    dow: dayNames[date.getUTCDay()],
    day: date.getUTCDate(),
    counted: Boolean(day.is_counted),
    weekend: [0, 6].includes(date.getUTCDay()) && !day.is_counted,
    note: day.note || day.day_class || '',
  }
}

function formatDateTime(value) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return '-'
  return `${date.getDate()} ${monthShort[date.getMonth()]} ${date.getFullYear()}, ${new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit' }).format(date).replace(':', '.')}`
}

function act(kind) {
  localError.value = ''
  if (kind === 'return' && notes.value.trim().length < 10) {
    localError.value = 'Isi alasan pengembalian minimal 10 karakter sebelum mengirim.'
    notesField.value?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    notesField.value?.focus()
    return
  }
  emit('action', { kind, notes: notes.value.trim() })
}
</script>

<template>
  <section class="av-detail">
    <div class="av-head">
      <div class="av-head-main">
        <button class="av-back" type="button" @click="emit('back')">
          <ArrowLeft :size="14" aria-hidden="true" /> Kembali ke antrean
        </button>
        <h1>{{ request.requestNumber }}</h1>
        <div class="av-chips">
          <span class="av-chip av-chip-neutral">{{ kindLabel }}</span>
          <StatusPill :status="request.status" />
        </div>
        <p class="av-meta">{{ submittedMeta }}</p>
      </div>
      <div class="av-head-actions">
        <button v-if="request.canCancel" class="button button-danger" type="button" @click="emit('cancel')">
          {{ request.status === 'APPROVED' ? 'Batalkan cuti' : 'Batalkan pengajuan' }}
        </button>
        <template v-if="canPreview">
          <a class="button button-secondary" :href="`/api/requests/${request.id}/preview-document`" target="_blank" rel="noopener">Pratinjau PDF</a>
          <button v-if="request.status === 'APPROVED'" class="button button-primary" type="button" :disabled="downloading" @click="downloadFinal">
            <Download :size="15" aria-hidden="true" /> {{ downloading ? 'Mengunduh…' : 'Unduh PDF final' }}
          </button>
        </template>
        <!-- Tombol aksi blok terpisah (bukan v-else-if): pratinjau dan aksi tampil berdampingan. -->
        <template v-if="canAct">
          <button class="button button-warning" type="button" :disabled="submitting" @click="act('return')">
            <Undo2 :size="15" aria-hidden="true" /> Kembalikan
          </button>
          <button class="button button-primary" type="button" :disabled="submitting" @click="act('verify')">
            <Check :size="15" aria-hidden="true" /> Verifikasi &amp; teruskan ke Analis SDM
          </button>
        </template>
        <p v-if="localError" class="av-error av-header-error" role="alert">{{ localError }}</p>
      </div>
    </div>

    <section v-if="request.status === 'WITHDRAWN'" class="av-banner av-banner-neutral">
      <strong>Pengajuan dibatalkan oleh pegawai</strong>
      <span>{{ request.cancellation?.reason || 'Pengajuan ditarik sebelum verifikasi Admin.' }}</span>
    </section>
    <section v-if="request.status === 'CANCELLED'" class="av-banner av-banner-red">
      <strong>Cuti dibatalkan oleh Admin</strong>
      <span>{{ request.cancellation?.reason || 'Tidak ada alasan yang tercatat.' }}</span>
    </section>

    <div class="av-grid">
      <section class="av-panel av-main">
        <h2>Data pegawai</h2>
        <div class="av-employee">
          <span class="av-avatar" aria-hidden="true">{{ employeeInitials }}</span>
          <div>
            <strong>{{ request.employeeName }}</strong>
            <small>{{ request.identity || 'Nomor identitas tidak tersedia' }} · {{ request.employeePositionName || 'Jabatan tidak tersedia' }}</small>
          </div>
          <div class="av-employee-tags">
            <span class="av-tag av-tag-green">{{ request.employeeCategory || 'Pegawai' }}</span>
            <span v-if="request.employeeUnitName" class="av-tag av-tag-neutral">{{ request.employeeUnitName }}</span>
            <span class="av-tag av-tag-blue">Aktif</span>
          </div>
        </div>

        <hr />
        <h2>Ringkasan pengajuan</h2>
        <dl class="av-facts">
          <div><dt>Jenis cuti</dt><dd>{{ request.leaveTypeName }}</dd></div>
          <div><dt>Tanggal mulai</dt><dd>{{ formatDate(request.startDate, true) }}</dd></div>
          <div><dt>Tanggal selesai</dt><dd>{{ formatDate(request.endDate, true) }}</dd></div>
          <div><dt>Durasi</dt><dd>{{ request.workingDays }} hari kerja</dd></div>
          <div><dt>Telepon</dt><dd>{{ request.phone || 'Tidak tersedia' }}</dd></div>
          <div><dt>Alamat</dt><dd>{{ request.address || 'Tidak tersedia' }}</dd></div>
        </dl>

        <hr />
        <div class="av-section-head">
          <h2>Tanggal yang dihitung</h2>
          <span class="av-tag av-tag-blue">HARI KERJA SESUAI KALENDER</span>
        </div>
        <div class="av-days">
          <div
            v-for="day in request.days"
            :key="day.leave_date"
            class="av-day"
            :class="{ counted: dayCell(day).counted, weekend: dayCell(day).weekend }"
          >
            <span>{{ dayCell(day).dow }}</span>
            <strong>{{ dayCell(day).day }}</strong>
            <small v-if="!dayCell(day).counted">{{ dayCell(day).note || '-' }}</small>
          </div>
        </div>
        <p v-if="!request.days?.length" class="av-muted">Tanggal hasil hitung belum tersedia.</p>
        <p class="av-inline-note">
          <Info :size="13" aria-hidden="true" />
          {{ request.workingDays }} hari kerja dihitung. Tanggal libur dan akhir pekan tidak dihitung.
        </p>

        <hr />
        <h2>Alasan cuti</h2>
        <p class="av-reason">{{ request.reason || 'Tidak ada alasan yang tercatat.' }}</p>

        <h2 class="av-spaced">Lampiran wajib</h2>
        <div v-if="attachment" class="av-file" :class="{ 'av-file-bad': hasAttachmentIssue }">
          <span class="av-file-icon"><FileText :size="18" aria-hidden="true" /></span>
          <div class="av-file-info">
            <strong>{{ attachment.original_filename }}</strong>
            <small>{{ attachment.document_type }} · {{ attachment.detected_mime || 'MIME tidak tersedia' }}</small>
            <small class="av-file-note">{{ hasAttachmentIssue ? 'Lampiran perlu diperiksa ulang.' : 'Berkas tercatat pada pengajuan ini.' }}</small>
          </div>
          <div class="av-file-actions">
            <a class="av-icon-button" :href="`/api/attachments/${encodeURIComponent(attachment.id)}?mode=inline`" target="_blank" rel="noopener" aria-label="Lihat lampiran">
              <Eye :size="14" aria-hidden="true" />
            </a>
            <a class="av-icon-button" :href="`/api/attachments/${encodeURIComponent(attachment.id)}`" download aria-label="Unduh lampiran">
              <Download :size="14" aria-hidden="true" />
            </a>
          </div>
        </div>
        <p v-else class="av-muted">Tidak ada lampiran pada pengajuan ini.</p>

        <h2 class="av-spaced">Dampak saldo</h2>
        <div class="av-balance">
          <Info :size="18" aria-hidden="true" />
          <div>
            <strong>{{ request.workingDays }} hari kerja diajukan</strong>
            <small>Jenis cuti: {{ request.leaveTypeName }}. Perhitungan saldo mengikuti aturan jenis cuti ini.</small>
          </div>
          <b>{{ request.workingDays }} hari</b>
        </div>
        <p class="av-shield"><ShieldCheck :size="13" aria-hidden="true" /> Admin tidak dapat memverifikasi pengajuan miliknya sendiri.</p>
      </section>

      <aside class="av-panel av-side">
        <div class="av-section-head">
          <h2>Checklist pemeriksaan</h2>
          <span class="av-tag av-tag-green">{{ passedChecks }}/{{ checks.length }}</span>
        </div>
        <ul class="av-checks">
          <li v-for="check in checks" :key="check.label" :class="{ manual: check.manual }">
            <span class="av-check-icon" :class="{ ok: check.ok, manual: check.manual }">
              <Check v-if="check.ok" :size="10" aria-hidden="true" />
              <Info v-else-if="check.manual" :size="10" aria-hidden="true" />
            </span>
            <span>{{ check.label }}<small v-if="check.manual">Diperiksa manual oleh petugas</small></span>
          </li>
        </ul>

        <hr />
        <h2>Catatan pemeriksaan</h2>
        <textarea ref="notesField" v-model="notes" rows="4" placeholder="Tulis hasil pemeriksaan atau alasan pengembalian"></textarea>
        <p v-if="localError" class="av-error" role="alert">{{ localError }}</p>

        <p class="av-hint">Alasan wajib diisi saat mengembalikan pengajuan.</p>

        <hr />
        <h2>Jejak pemeriksaan</h2>
        <ol v-if="trail.length" class="av-trail">
          <li v-for="event in trail" :key="`${event.event_type}-${event.created_at}`">
            <span class="av-trail-dot" :class="{ active: event.to_status !== 'SUBMITTED' }"></span>
            <div>
              <strong>{{ event.description }}</strong>
              <small>{{ formatDateTime(event.created_at) }}</small>
            </div>
          </li>
        </ol>
        <p v-else class="av-muted">Belum ada jejak pemeriksaan.</p>
      </aside>
    </div>

    <!-- Audit UX mobile: duplikat tombol aksi di bawah catatan — di layar sempit
         pengguna mengisi catatan lebih dulu, jadi aksi tidak boleh hanya di atas. -->
    <div v-if="canPreview || canAct || request.canCancel" class="av-bottom-actions">
      <button v-if="request.canCancel" class="button button-danger" type="button" @click="emit('cancel')">
        {{ request.status === 'APPROVED' ? 'Batalkan cuti' : 'Batalkan pengajuan' }}
      </button>
      <template v-if="canPreview">
        <a class="button button-secondary" :href="`/api/requests/${request.id}/preview-document`" target="_blank" rel="noopener">Pratinjau PDF</a>
        <button v-if="request.status === 'APPROVED'" class="button button-primary" type="button" :disabled="downloading" @click="downloadFinal">
          <Download :size="15" aria-hidden="true" /> {{ downloading ? 'Mengunduh…' : 'Unduh PDF final' }}
        </button>
      </template>
      <template v-if="canAct">
        <button class="button button-warning" type="button" :disabled="submitting" @click="act('return')">
          <Undo2 :size="15" aria-hidden="true" /> Kembalikan
        </button>
        <button class="button button-primary" type="button" :disabled="submitting" @click="act('verify')">
          <Check :size="15" aria-hidden="true" /> Verifikasi &amp; teruskan ke Analis SDM
        </button>
      </template>
      <p v-if="localError" class="av-error" role="alert">{{ localError }}</p>
    </div>
  </section>
</template>

<style scoped>
.av-detail {
  display: grid;
  gap: 20px;
  min-width: 0;
}

.av-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; }
.av-head-main { min-width: 0; }
.av-back {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 0; border: 0; background: transparent;
  color: var(--primary-dark); font-size: 12px; font-weight: 600; cursor: pointer;
}
.av-back:hover { text-decoration: underline; }
.av-head h1 { margin: 8px 0; }
.av-chips { display: flex; gap: 8px; flex-wrap: wrap; }
.av-chip {
  display: inline-flex; align-items: center; min-height: 22px; padding: 3px 8px;
  border: 1px solid transparent; border-radius: 999px; font-size: 10px; font-weight: 650;
  letter-spacing: 0.04em; text-transform: uppercase;
}
.av-chip-neutral { background: var(--neutral-bg); border-color: var(--neutral-border); color: var(--neutral-text); }
.av-meta { margin: 12px 0 0; color: var(--muted); font-size: 12px; }
.av-head-actions { display: flex; gap: 8px; flex: 0 0 auto; flex-wrap: wrap; justify-content: flex-end; }
.av-header-error { flex: 1 1 100%; text-align: right; }

.av-banner {
  display: flex; flex-direction: column; gap: 4px;
  padding: 12px 14px; border: 1px solid transparent; border-radius: var(--radius-control); font-size: 12px;
}
.av-banner-neutral { background: var(--neutral-bg); border-color: var(--neutral-border); color: var(--neutral-text); }
.av-banner-red { background: var(--danger-bg); border-color: var(--danger-border); color: var(--danger-text); }

.av-grid { display: grid; grid-template-columns: minmax(0, 716fr) minmax(0, 392fr); gap: 20px; align-items: start; }
.av-panel {
  min-width: 0; padding: 20px;
  border: 1px solid var(--border); border-radius: var(--radius-panel); background: var(--card);
}
.av-panel h2 { margin: 0 0 12px; color: var(--ink); font-size: 16px; font-weight: 600; }
.av-panel h2.av-spaced { margin-top: 20px; }
.av-panel hr { margin: 20px 0; border: 0; border-top: 1px solid var(--border); }
.av-muted { margin: 8px 0 0; color: var(--muted); font-size: 11px; }
.av-section-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.av-section-head h2 { margin-bottom: 12px; }
.av-tag {
  display: inline-flex; align-items: center; min-height: 22px; padding: 3px 8px;
  border: 1px solid transparent; border-radius: 999px; font-size: 10px; font-weight: 650; white-space: nowrap;
}
.av-tag-green { background: var(--success-bg); border-color: var(--success-border); color: var(--success-text); }
.av-tag-blue { background: var(--info-bg); border-color: var(--info-border); color: var(--info-text); }
.av-tag-neutral { background: var(--neutral-bg); border-color: var(--neutral-border); color: var(--neutral-text); }

.av-employee { display: flex; align-items: center; gap: 14px; }
.av-avatar {
  width: 44px; height: 44px; flex: 0 0 auto; border-radius: 50%;
  background: var(--info-bg); color: var(--primary-dark);
  display: inline-flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 600;
}
.av-employee > div:first-of-type { min-width: 0; }
.av-employee strong { display: block; color: var(--ink); font-size: 16px; font-weight: 700; }
.av-employee small { display: block; margin-top: 2px; color: var(--muted); font-size: 11px; }
.av-employee-tags { display: flex; gap: 6px; margin-left: auto; flex-wrap: wrap; justify-content: flex-end; }

.av-facts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px 12px; margin: 0; }
.av-facts dt { margin-bottom: 4px; color: var(--muted); font-size: 10px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; }
.av-facts dd { margin: 0; color: var(--ink); font-size: 11px; font-weight: 600; overflow-wrap: anywhere; }

.av-days { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 4px; }
.av-day {
  width: 72px; height: 60px; flex: 0 0 auto; padding: 7px;
  border: 1px solid var(--border); border-radius: var(--radius-control); background: var(--card);
  display: flex; flex-direction: column; gap: 2px;
}
.av-day span { color: var(--muted); font-size: 10px; font-weight: 600; text-align: center; }
.av-day strong { color: var(--text); font-size: 15px; font-weight: 600; text-align: center; }
.av-day small { color: var(--muted); font-size: 10px; text-align: center; }
.av-day.counted { background: var(--info-bg); border-color: var(--info-border); }
.av-day.counted strong { color: var(--primary-dark); }
.av-day.weekend { background: var(--subtle); border-color: var(--divider); }
.av-day.weekend strong { color: var(--muted); }
.av-inline-note { display: flex; align-items: center; gap: 6px; margin: 12px 0 0; color: var(--muted); font-size: 11px; }
.av-reason { margin: 0; color: var(--text); font-size: 11px; line-height: 1.5; }

.av-file {
  display: flex; align-items: center; gap: 12px; padding: 12px;
  border: 1px solid var(--border); border-radius: var(--radius-control);
}
.av-file-bad { border-color: var(--danger-border); }
.av-file-icon {
  width: 40px; height: 40px; flex: 0 0 auto; border-radius: var(--radius-control);
  background: var(--success-bg); color: var(--success-text); display: inline-flex; align-items: center; justify-content: center;
}
.av-file-bad .av-file-icon { background: var(--danger-bg); color: var(--danger-text); }
.av-file-info { flex: 1; min-width: 0; }
.av-file-info strong { display: block; color: var(--ink); font-size: 11.5px; font-weight: 600; }
.av-file-info small { display: block; margin-top: 2px; color: var(--muted); font-size: 11px; }
.av-file-note { color: var(--success-text); }
.av-file-actions { display: flex; gap: 4px; }
.av-icon-button {
  width: 32px; height: 32px; border: 0; border-radius: var(--radius-control); background: transparent;
  color: var(--muted); display: inline-flex; align-items: center; justify-content: center; cursor: pointer;
}
.av-icon-button:hover { background: var(--subtle); }

.av-balance {
  display: flex; align-items: center; gap: 12px; padding: 12px 16px;
  border: 1px solid var(--info-border); border-radius: var(--radius-control); background: var(--primary-tint); color: var(--primary-dark);
}
.av-balance > div { flex: 1; }
.av-balance strong { display: block; color: var(--ink); font-size: 11px; font-weight: 600; }
.av-balance small { display: block; margin-top: 2px; color: var(--muted); font-size: 11px; }
.av-balance b { font-size: 13px; font-weight: 700; color: var(--primary-dark); white-space: nowrap; }
.av-shield { display: flex; align-items: center; gap: 6px; margin: 12px 0 0; color: var(--muted); font-size: 11px; }

.av-checks { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.av-checks li { display: flex; align-items: flex-start; gap: 10px; color: var(--text); font-size: 12px; }
.av-checks li small { display: block; margin-top: 2px; color: var(--muted); font-size: 10px; }
.av-check-icon {
  width: 16px; height: 16px; flex: 0 0 auto; margin-top: 1px; border-radius: 50%;
  background: var(--neutral-bg); color: var(--muted); display: inline-flex; align-items: center; justify-content: center;
}
.av-check-icon.ok { background: var(--success-bg); color: var(--success-text); }
.av-check-icon.manual { background: var(--info-bg); color: var(--info-text); }
.av-side textarea {
  width: 100%; min-height: 96px; padding: 10px 12px; border: 1px solid var(--control-border); border-radius: var(--radius-control);
  color: var(--text); font-size: 12px; line-height: 1.5; resize: vertical; background: var(--card);
}
.av-hint { margin: 8px 0 0; color: var(--muted); font-size: 10px; }
.av-error { margin: 8px 0 0; color: var(--danger-text); font-size: 11px; }

.av-trail { list-style: none; margin: 0; padding: 0; display: grid; gap: 14px; }
.av-trail li { display: flex; align-items: flex-start; gap: 10px; }
.av-trail-dot { width: 16px; height: 16px; flex: 0 0 auto; margin-top: 2px; border: 1px solid var(--info-border); border-radius: 50%; background: var(--info-bg); }
.av-trail-dot.active { border-color: var(--primary); background: var(--primary); box-shadow: inset 0 0 0 4px var(--primary-soft); }
.av-trail strong { display: block; color: var(--ink); font-size: 12px; font-weight: 600; }
.av-trail small { display: block; margin-top: 2px; color: var(--muted); font-size: 10px; }

/* Blok aksi bawah hanya untuk layout satu kolom (mobile/tablet). */
.av-bottom-actions { display: none; }

@media (max-width: 1200px) {
  .av-grid { grid-template-columns: 1fr; }
  .av-head { flex-direction: column; }
  .av-head-actions { display: none; }
  /* Audit UX mobile: aksi pindah ke bawah catatan pada layout satu kolom. */
  .av-bottom-actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .av-bottom-actions .button {
    width: 100%;
    min-height: 44px;
    justify-content: center;
  }
}
@media (max-width: 640px) {
  .av-facts { grid-template-columns: 1fr 1fr; }
  .av-employee { flex-wrap: wrap; }
  .av-employee-tags { margin-left: 0; justify-content: flex-start; }
}
</style>
