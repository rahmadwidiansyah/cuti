<script setup>
import { computed } from 'vue'
import { ArrowLeft, Check, Download, Eye, FileText, Info, Paperclip, Send, ShieldCheck, Undo2, XCircle } from 'lucide-vue-next'
import StatusPill from './StatusPill.vue'

const props = defineProps({
  request: { type: Object, required: true },
})
const emit = defineEmits(['back', 'edit', 'preview', 'submit', 'withdraw'])

const dayNames = ['Min','Sen','Sel','Rab','Kam','Jum','Sab']
const stageLabels = {
  ADMIN_REVIEW: 'Diajukan',
  PERTIMBANGAN_REVIEW: 'Diperiksa Admin',
  KASUBAG_REVIEW: 'Pertimbangan Analis SDM',
  KEPSTA_REVIEW: 'Diteruskan Kasubag',
  PPK_REVIEW: 'Keputusan PPK',
}
const stageTitles = {
  ADMIN_REVIEW: 'Diajukan',
  PERTIMBANGAN_REVIEW: 'Diperiksa Admin',
  KASUBAG_REVIEW: 'Pertimbangan Analis SDM',
  KEPSTA_REVIEW: 'Diteruskan Kasubag',
  PPK_REVIEW: 'Keputusan PPK',
}
const categoryLabels = {
  PNS_TU: 'PNS · TU', PNS: 'PNS · non-TU', PPPK_PPNPN_TU: 'PPPK/PPNPN · TU',
  PPPK_PPNPN: 'PPPK/PPNPN · non-TU', KONTRAK: 'Kontrak',
}

const stages = computed(() => props.request.stages || [])
const completedStages = computed(() => stages.value.filter(stage => stage.status === 'COMPLETED').length)
const days = computed(() => props.request.days || [])
const attachments = computed(() => props.request.attachments || [])
const sdmEvent = computed(() => (props.request.events || []).find(event => /SDM|Kasubag/i.test(event.description || '')) || null)
const routeLabel = computed(() => stages.value.map(stage => stageLabels[stage.stage_code] || stage.stage_code).join(' > '))
const beforeBalance = computed(() => {
  if (props.request.availableDays === null || props.request.availableDays === undefined) return null
  return Number(props.request.availableDays) + Number(props.request.workingDays || 0)
})

function formatDate(value, weekday = false) {
  if (!value) return '-'
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00Z`)
  if (Number.isNaN(date.valueOf())) return '-'
  return new Intl.DateTimeFormat('id-ID', {
    ...(weekday ? { weekday: 'long' } : {}),
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  }).format(date)
}
function formatDateTime(value) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return '-'
  return `${formatDate(String(value).slice(0, 10))}, ${new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit' }).format(date).replace(':', '.')}`
}
function dayCell(day) {
  const date = new Date(`${String(day.leave_date).slice(0, 10)}T12:00:00Z`)
  return {
    dow: dayNames[date.getUTCDay()],
    day: date.getUTCDate(),
    counted: Boolean(day.is_counted),
    note: day.is_counted ? '' : (day.note || (date.getUTCDay() === 0 || date.getUTCDay() === 6 ? '-' : 'Libur')),
  }
}
function stageStatus(stage) {
  if (stage.status === 'COMPLETED') return 'Selesai'
  if (stage.status === 'ACTIVE') return 'Sedang menunggu'
  return 'Menunggu'
}
</script>

<template>
  <section class="rd">
    <div class="rd-head">
      <div>
        <button class="rd-back" type="button" @click="emit('back')"><ArrowLeft :size="14" aria-hidden="true" /> Kembali ke riwayat</button>
        <h1>{{ request.requestNumber }}</h1>
        <div class="rd-chips">
          <span class="rd-chip">{{ request.leaveTypeName }}</span>
          <StatusPill :status="request.status" />
          <span class="rd-chip">{{ categoryLabels[request.employeeCategory] || request.employeeCategory }}</span>
          <span class="rd-chip">Rute {{ routeLabel || '-' }}</span>
        </div>
        <p class="rd-meta">Diajukan {{ formatDateTime(request.submittedAt) }} · {{ request.workingDays }} hari kerja · {{ request.employeeName }}</p>
      </div>
      <div class="rd-actions">
        <a class="button button-secondary" :href="`/api/requests/${request.id}/preview-document`" target="_blank" rel="noopener">
          <Download :size="15" aria-hidden="true" /> Pratinjau PDF
        </a>
        <!-- Audit K1: aksi pegawai pada draf & pengajuan yang dikembalikan. -->
        <template v-if="request.canEditDraft">
          <button class="button button-secondary" type="button" @click="emit('edit')">
            <Undo2 :size="15" aria-hidden="true" /> {{ request.status === 'RETURNED_FOR_REVISION' ? 'Perbaiki pengajuan' : 'Lanjutkan draf' }}
          </button>
          <button class="button button-primary" type="button" @click="emit('preview')">
            <FileText :size="15" aria-hidden="true" /> Pratinjau &amp; tanda tangan
          </button>
          <button class="button button-primary" type="button" @click="emit('submit')">
            <Send :size="15" aria-hidden="true" /> {{ request.status === 'RETURNED_FOR_REVISION' ? 'Kirim ulang pengajuan' : 'Kirim draf' }}
          </button>
        </template>
        <button v-if="request.canWithdraw" class="button button-danger" type="button" @click="emit('withdraw')">
          <XCircle :size="15" aria-hidden="true" /> Batalkan pengajuan
        </button>
      </div>
    </div>

    <div class="rd-grid">
      <section class="rd-panel rd-main">
        <h2>Ringkasan pengajuan</h2>
        <dl class="rd-facts">
          <div><dt>Jenis cuti</dt><dd>{{ request.leaveTypeName }}</dd></div>
          <div><dt>Tanggal mulai</dt><dd>{{ formatDate(request.startDate, true) }}</dd></div>
          <div><dt>Tanggal selesai</dt><dd>{{ formatDate(request.endDate, true) }}</dd></div>
          <div><dt>Durasi</dt><dd>{{ request.workingDays }} hari kerja</dd></div>
          <div><dt>Diajukan</dt><dd>{{ formatDateTime(request.submittedAt) }}</dd></div>
          <div><dt>Alamat &amp; telepon</dt><dd>{{ request.address || '-' }}<br />{{ request.phone || '-' }}</dd></div>
        </dl>

        <hr />
        <div class="rd-section-head">
          <h2>Tanggal yang dihitung</h2>
          <span class="rd-chip rd-chip-blue">SNAPSHOT KALENDER</span>
        </div>
        <div class="rd-days">
          <div v-for="day in days" :key="day.leave_date" class="rd-day" :class="{ counted: dayCell(day).counted }">
            <span>{{ dayCell(day).dow }}</span>
            <strong>{{ dayCell(day).day }}</strong>
            <small>{{ dayCell(day).note }}</small>
          </div>
          <p v-if="!days.length" class="rd-muted">Tanggal hasil hitung belum tersedia.</p>
        </div>
        <p class="rd-hint"><Info :size="12" aria-hidden="true" /> Sabtu, Minggu, dan hari libur tidak dihitung sebagai hari cuti.</p>

        <hr />
        <h2>Alasan cuti</h2>
        <p class="rd-text">{{ request.reason || 'Tidak ada alasan yang tercatat.' }}</p>

        <div class="rd-section-head rd-spaced">
          <h2>Lampiran</h2>
          <span class="rd-chip">OPSIONAL</span>
        </div>
        <div v-if="attachments.length" class="rd-files">
          <div v-for="file in attachments" :key="file.id" class="rd-file">
            <span class="rd-file-icon"><FileText :size="17" aria-hidden="true" /></span>
            <div><strong>{{ file.original_filename }}</strong><small>{{ file.document_type }} · {{ file.file_size }} byte · diunggah {{ formatDate(file.uploaded_at) }}</small></div>
            <a class="rd-icon" :href="`/api/attachments/${encodeURIComponent(file.id)}?mode=inline`" target="_blank" rel="noopener" aria-label="Lihat lampiran"><Eye :size="14" aria-hidden="true" /></a>
            <a class="rd-icon" :href="`/api/attachments/${encodeURIComponent(file.id)}`" download aria-label="Unduh lampiran"><Download :size="14" aria-hidden="true" /></a>
          </div>
        </div>
        <p v-else class="rd-muted">Tidak ada lampiran pada pengajuan ini.</p>

        <h2 class="rd-spaced">Dampak saldo</h2>
        <div class="rd-balance">
          <div><span>Sebelum</span><strong>{{ beforeBalance ?? '-' }} <small>hari</small></strong></div>
          <span class="rd-arrow">→</span>
          <div><span>Reservasi</span><strong class="rd-red">-{{ request.workingDays }} <small>hari</small></strong></div>
          <span class="rd-arrow">→</span>
          <div><span>Sesudah</span><strong class="rd-green">{{ request.availableDays ?? '-' }} <small>hari</small></strong></div>
        </div>
        <p class="rd-hint"><Info :size="12" aria-hidden="true" /> Reservasi dilepas jika pengajuan dibatalkan, ditolak, atau diubah.</p>
        <p class="rd-foot">Catatan cuti: tahun berjalan dan carry-over dihitung ulang saat pengajuan dikirim.</p>
      </section>

      <aside class="rd-panel rd-side">
        <div class="rd-section-head">
          <h2>Timeline persetujuan</h2>
          <span class="rd-chip rd-chip-blue">{{ completedStages }} DARI {{ stages.length }} TAHAP</span>
        </div>
        <ol class="rd-timeline">
          <li v-for="stage in stages" :key="`${stage.stage_code}-${stage.status}`" :class="stage.status.toLowerCase()">
            <span class="rd-dot"><Check v-if="stage.status === 'COMPLETED'" :size="10" aria-hidden="true" /></span>
            <div>
              <strong>{{ stageTitles[stage.stage_code] || stage.stage_code }}</strong>
              <small>{{ stageStatus(stage) }}<template v-if="stage.completed_at"> · {{ formatDateTime(stage.completed_at) }}</template></small>
            </div>
          </li>
        </ol>

        <hr />
        <h2>Pertimbangan Analis SDM</h2>
        <div class="rd-note-box">
          <div>
            <strong>{{ sdmEvent ? 'Pertimbangan tercatat' : 'Belum tersedia' }}</strong>
            <small>{{ sdmEvent?.description || 'Menunggu pemeriksaan Analis SDM.' }}</small>
          </div>
          <span v-if="sdmEvent">{{ formatDate(String(sdmEvent.created_at).slice(0, 10)) }}</span>
        </div>

        <div class="rd-info-box">
          <ShieldCheck :size="14" aria-hidden="true" />
          <div><strong>Pembatalan oleh pegawai</strong><small>Pembatalan mandiri hanya sebelum verifikasi Admin. Hubungi Admin untuk pengajuan yang sudah diproses.</small></div>
        </div>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.rd { display:grid; gap:20px; min-width:0; }
.rd-head { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; }
.rd-actions { display:flex; flex-direction:column; align-items:flex-end; gap:8px; flex:0 0 auto; }
.rd-back { display:inline-flex; align-items:center; gap:6px; padding:0; border:0; background:transparent; color:var(--primary-dark); font-size:12px; font-weight:600; cursor:pointer; }
.rd-back:hover { text-decoration:underline; }
.rd-head h1 { margin:8px 0; }
.rd-chips { display:flex; gap:6px; flex-wrap:wrap; }
.rd-chip { display:inline-flex; align-items:center; min-height:22px; padding:3px 8px; border:1px solid var(--neutral-border); border-radius:999px; background:var(--neutral-bg); color:var(--neutral-text); font-size:10px; font-weight:650; letter-spacing:0.04em; text-transform:uppercase; }
.rd-chip-blue { background:var(--info-bg); border-color:var(--info-border); color:var(--info-text); }
.rd-meta { margin:12px 0 0; color:var(--muted); font-size:12px; }
.rd-grid { display:grid; grid-template-columns:minmax(0, 716fr) minmax(0, 392fr); gap:20px; align-items:start; }
.rd-panel { min-width:0; padding:20px; border:1px solid var(--border); border-radius:var(--radius-panel); background:var(--card); }
.rd-panel h2 { margin:0 0 12px; color:var(--ink); font-size:16px; font-weight:600; }
.rd-panel hr { margin:20px 0; border:0; border-top:1px solid var(--border); }
.rd-section-head { display:flex; align-items:center; justify-content:space-between; gap:12px; }
.rd-section-head h2 { margin-bottom:12px; }
.rd-spaced { margin-top:20px; }
.rd-facts { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:14px; margin:0; }
.rd-facts dt { margin-bottom:3px; color:var(--muted); font-size:10px; font-weight:600; letter-spacing:0.04em; text-transform:uppercase; }
.rd-facts dd { margin:0; color:var(--ink); font-size:11px; font-weight:600; line-height:1.5; overflow-wrap:anywhere; }
.rd-days { display:flex; gap:6px; overflow-x:auto; }
.rd-day { width:72px; min-height:60px; flex:0 0 auto; padding:7px; border:1px solid var(--border); border-radius:var(--radius-control); background:var(--card); text-align:center; }
.rd-day.counted { border-color:var(--info-border); background:var(--info-bg); }
.rd-day span { display:block; color:var(--muted); font-size:10px; }
.rd-day strong { display:block; margin-top:2px; color:var(--text); font-size:15px; font-weight:600; }
.rd-day.counted strong { color:var(--primary-dark); }
.rd-day small { display:block; margin-top:2px; color:var(--muted); font-size:10px; }
.rd-hint { display:flex; align-items:center; gap:6px; margin:12px 0 0; color:var(--muted); font-size:11px; }
.rd-text { margin:0; color:var(--text); font-size:11px; line-height:1.6; }
.rd-files { display:grid; gap:8px; }
.rd-file { display:flex; align-items:center; gap:10px; padding:10px 12px; border:1px solid var(--border); border-radius:var(--radius-control); }
.rd-file-icon { width:38px; height:38px; flex:0 0 auto; border-radius:var(--radius-control); background:var(--success-bg); color:var(--success-text); display:inline-flex; align-items:center; justify-content:center; }
.rd-file > div { flex:1; min-width:0; }
.rd-file strong { display:block; color:var(--ink); font-size:11px; }
.rd-file small { display:block; margin-top:2px; color:var(--muted); font-size:10px; }
.rd-icon { width:32px; height:32px; display:inline-flex; align-items:center; justify-content:center; border-radius:var(--radius-control); color:var(--muted); }
.rd-icon:hover { background:var(--subtle); }
.rd-muted { margin:0; color:var(--muted); font-size:11px; }
.rd-balance { display:grid; grid-template-columns:1fr auto 1fr auto 1fr; align-items:center; gap:8px; }
.rd-balance > div { padding:12px; border-radius:var(--radius-control); background:var(--subtle); }
.rd-balance span { display:block; color:var(--muted); font-size:10px; }
.rd-balance strong { display:block; margin-top:3px; color:var(--ink); font-size:20px; font-variant-numeric:tabular-nums; }
.rd-balance small { font-size:10px; font-weight:500; color:var(--muted); }
.rd-green { color:var(--success-text); }
.rd-red { color:var(--danger-text); }
.rd-arrow { color:var(--muted); }
.rd-foot { margin:10px 0 0; color:var(--muted); font-size:10px; }
.rd-timeline { list-style:none; margin:0; padding:0; display:grid; gap:16px; }
.rd-timeline li { display:flex; align-items:flex-start; gap:10px; }
.rd-dot { width:18px; height:18px; flex:0 0 auto; border:1px solid var(--info-border); border-radius:50%; background:var(--info-bg); color:var(--on-dark); display:inline-flex; align-items:center; justify-content:center; }
.rd-timeline li.completed .rd-dot { border-color:var(--primary); background:var(--primary); }
.rd-timeline li.active .rd-dot { border-color:var(--primary); background:var(--card); box-shadow:inset 0 0 0 4px var(--primary-soft); }
.rd-timeline strong { display:block; color:var(--ink); font-size:12px; }
.rd-timeline small { display:block; margin-top:2px; color:var(--muted); font-size:10px; }
.rd-note-box { display:flex; align-items:flex-start; gap:10px; padding:12px; border-radius:var(--radius-control); background:var(--subtle); }
.rd-note-box > div { flex:1; }
.rd-note-box strong { display:block; color:var(--ink); font-size:11px; }
.rd-note-box small { display:block; margin-top:2px; color:var(--muted); font-size:10px; line-height:1.5; }
.rd-note-box > span { color:var(--muted); font-size:10px; white-space:nowrap; }
.rd-info-box { display:flex; align-items:flex-start; gap:8px; margin-top:16px; padding:12px; border:1px solid var(--info-border); border-radius:var(--radius-control); background:var(--primary-tint); color:var(--primary-dark); }
.rd-info-box strong { display:block; color:var(--ink); font-size:11px; }
.rd-info-box small { display:block; margin-top:2px; color:var(--muted); font-size:10px; line-height:1.5; }
@media (max-width:1200px){ .rd-grid{ grid-template-columns:1fr; } }
@media (max-width:640px){ .rd-facts{ grid-template-columns:1fr 1fr; } .rd-head{ flex-direction:column; } .rd-actions{ align-items:stretch; width:100%; } }
</style>
