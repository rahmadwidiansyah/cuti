<script setup>
import { computed } from 'vue'
import { ArrowRight, CalendarDays, CheckCircle2, Clock3, FileText, RotateCcw } from 'lucide-vue-next'

const props = defineProps({
  dashboard: { type: Object, default: null },
  leaveTypes: { type: Array, default: () => [] },
})
const emit = defineEmits(['apply', 'history', 'balance', 'detail'])

const balance = computed(() => props.dashboard?.balance || null)
const requests = computed(() => props.dashboard?.requests || [])
const nonAnnual = computed(() => props.dashboard?.nonAnnual || [])
const returnedCount = computed(() => Number(props.dashboard?.returnedCount || 0))
const year = computed(() => balance.value?.period_year || new Date().getFullYear())
const available = computed(() => Number(balance.value?.available_days || 0))
const used = computed(() => Number(balance.value?.used_days || 0))
const reserved = computed(() => Number(balance.value?.reserved_days || 0))
const allocated = computed(() => Number(balance.value?.allocated_days || 0))
const total = computed(() => Math.max(1, used.value + reserved.value + available.value))
const warning = computed(() => available.value < 3 && requests.value.some(item => ['SUBMITTED', 'ADMIN_REVIEW', 'PERTIMBANGAN_REVIEW'].includes(item.status)))

const statusLabels = {
  DRAFT: 'Draf', SUBMITTED: 'Menunggu verifikasi', ADMIN_REVIEW: 'Menunggu verifikasi',
  ADMIN_VERIFIED: 'Diteruskan', PERTIMBANGAN_REVIEW: 'Pertimbangan SDM',
  KASUBAG_REVIEW: 'Antrean Kasubag', KEPSTA_REVIEW: 'Menunggu Kepsta', PPK_REVIEW: 'Menunggu PPK',
  RETURNED_FOR_REVISION: 'Dikembalikan', APPROVED: 'Disetujui', REJECTED: 'Tidak disetujui',
  WITHDRAWN: 'Dibatalkan pegawai', CANCELLED: 'Dibatalkan Admin',
}
function statusTone(status) {
  if (['APPROVED'].includes(status)) return 'green'
  if (['RETURNED_FOR_REVISION', 'REJECTED', 'CANCELLED'].includes(status)) return 'red'
  if (['SUBMITTED', 'ADMIN_REVIEW', 'PERTIMBANGAN_REVIEW', 'KASUBAG_REVIEW', 'KEPSTA_REVIEW', 'PPK_REVIEW'].includes(status)) return 'amber'
  return 'neutral'
}
function formatDate(value) {
  if (!value) return '-'
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00Z`)
  if (Number.isNaN(date.valueOf())) return '-'
  return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date)
}
</script>

<template>
  <section class="dash">
    <div class="dash-grid">
      <div class="dash-main">
        <section class="ds-panel ds-balance">
          <div class="ds-balance-head">
            <div>
              <p class="ds-eyebrow">SALDO CUTI TAHUNAN · {{ year }}</p>
              <strong class="ds-big">{{ available }} <span>hari tersedia</span></strong>
              <span v-if="warning" class="ds-warning">Tidak cukup untuk 1 pengajuan 5 hari</span>
            </div>
            <div class="ds-breakdown">
              <div><span>Kuota tahunan</span><strong>{{ allocated }}</strong></div>
              <div><span>Penyesuaian</span><strong>{{ balance?.adjustment_days || 0 }}</strong></div>
              <div><span>Carry-over</span><strong>{{ balance?.carry_over_days || 0 }}</strong></div>
              <div><span>Dalam proses</span><strong>{{ reserved }}</strong></div>
              <div><span>Periode berakhir</span><strong>31 Des {{ year }}</strong></div>
            </div>
          </div>
          <div class="ds-track" role="img" :aria-label="`Terpakai ${used} hari, dalam proses ${reserved} hari, tersedia ${available} hari`">
            <span class="ds-used" :style="{ flexGrow: used }"></span>
            <span class="ds-reserved" :style="{ flexGrow: reserved }"></span>
            <span class="ds-available" :style="{ flexGrow: available }"></span>
          </div>
          <div class="ds-legend">
            <span><i class="ds-dot ds-dot-used"></i> Terpakai {{ used }}</span>
            <span><i class="ds-dot ds-dot-reserved"></i> Dalam proses {{ reserved }}</span>
            <span><i class="ds-dot ds-dot-available"></i> Tersedia {{ available }}</span>
          </div>
        </section>

        <section class="ds-panel ds-requests">
          <div class="ds-section-head">
            <h2>Pengajuan terbaru</h2>
            <button class="ds-link" type="button" @click="emit('history')">Lihat riwayat <ArrowRight :size="13" aria-hidden="true" /></button>
          </div>
          <table class="ds-table">
            <thead><tr><th>No pengajuan</th><th>Jenis</th><th>Tanggal cuti</th><th>Durasi</th><th>Status</th><th></th></tr></thead>
            <tbody>
              <tr v-for="(item, index) in requests" :key="item.id">
                <td>
                  <button class="ds-request-link" type="button" @click="emit('detail', item.id)">{{ item.request_number }}</button>
                  <small>Tahap: {{ statusLabels[item.status] || item.status }}</small>
                </td>
                <td>{{ item.leave_type_name }}</td>
                <td>{{ formatDate(item.start_date) }} s.d. {{ formatDate(item.end_date) }}</td>
                <td>{{ item.requested_working_days }} hari</td>
                <td><span class="ds-badge" :class="`ds-badge-${statusTone(item.status)}`">{{ statusLabels[item.status] || item.status }}</span></td>
                <td><button class="ds-icon-button" type="button" :aria-label="`Buka ${item.request_number}`" @click="emit('detail', item.id)"><ArrowRight :size="14" aria-hidden="true" /></button></td>
              </tr>
              <tr v-if="!requests.length"><td colspan="6" class="ds-empty">Belum ada pengajuan. Mulai dengan mengajukan cuti.</td></tr>
            </tbody>
          </table>
        </section>

        <button class="ds-how" type="button" @click="emit('apply')">
          <span class="ds-how-icon">1</span>
          <div><strong>Pilih periode</strong><small>Tanggal mulai dan jumlah hari kerja.</small></div>
          <ArrowRight :size="14" aria-hidden="true" />
          <span class="ds-how-icon">2</span>
          <div><strong>Hari kerja dihitung</strong><small>Sabtu, Minggu, dan hari libur dilewati.</small></div>
          <ArrowRight :size="14" aria-hidden="true" />
          <span class="ds-how-icon">3</span>
          <div><strong>Pratinjau &amp; kirim</strong><small>Cek jadwal dan dampak saldo sebelum kirim.</small></div>
        </button>
      </div>

      <aside class="dash-side">
        <section class="ds-panel">
          <h2>Cuti di luar saldo tahunan</h2>
          <p class="ds-muted">Tetap dicatat, tidak memotong kuota tahunan.</p>
          <ul class="ds-nonannual">
            <li v-for="item in nonAnnual" :key="item.code"><span>{{ item.name }}</span><strong>{{ item.days }} hari</strong></li>
            <li v-if="!nonAnnual.length"><span class="ds-muted">Belum ada catatan.</span></li>
          </ul>
          <p class="ds-footnote">Angka ini terpisah dari saldo cuti tahunan.</p>
        </section>

        <section v-if="returnedCount" class="ds-panel ds-returned">
          <span class="ds-returned-icon"><RotateCcw :size="18" aria-hidden="true" /></span>
          <div>
            <strong>{{ returnedCount }} pengajuan dikembalikan</strong>
            <small>Perbaiki pengajuan yang dikembalikan petugas.</small>
          </div>
          <button class="ds-wide-button" type="button" @click="emit('history')">Perbaiki pengajuan</button>
        </section>

        <section class="ds-panel">
          <h2>Kebijakan periode</h2>
          <ul class="ds-policy">
            <li><CalendarDays :size="14" aria-hidden="true" /> Kuota tahunan {{ allocated }} hari kerja</li>
            <li><Clock3 :size="14" aria-hidden="true" /> Reset saldo setiap 1 Januari</li>
            <li><CheckCircle2 :size="14" aria-hidden="true" /> Carry-over belum diaktifkan</li>
          </ul>
          <button class="ds-link" type="button" @click="emit('balance')">Lihat saldo &amp; rincian <ArrowRight :size="13" aria-hidden="true" /></button>
        </section>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.dash { --ink:#142f3a; --text:#3d525c; --muted:#5a6f78; --border:#e1e9f1; display:grid; gap:20px; min-width:0; }
.dash-grid { display:grid; grid-template-columns:minmax(0, 716fr) minmax(0, 392fr); gap:20px; align-items:start; }
.dash-main, .dash-side { display:grid; gap:20px; min-width:0; }
.ds-panel { min-width:0; padding:20px; border:1px solid var(--border); border-radius:12px; background:#fff; }
.ds-panel h2 { margin:0 0 6px; color:var(--ink); font-size:14px; font-weight:600; }
.ds-muted { margin:0; color:var(--muted); font-size:11px; }
.ds-eyebrow { margin:0 0 6px; color:var(--muted); font-size:10px; font-weight:600; letter-spacing:.04em; }
.ds-big { display:block; color:var(--ink); font-size:38px; font-weight:700; line-height:1.1; }
.ds-big span { font-size:13px; font-weight:500; color:var(--muted); }
.ds-warning { display:inline-flex; margin-top:8px; padding:3px 10px; border-radius:11px; background:#fff6de; color:#8a5a00; font-size:9px; font-weight:600; }
.ds-balance-head { display:grid; grid-template-columns:1fr 1fr; gap:24px; }
.ds-breakdown { display:grid; gap:7px; padding-left:24px; border-left:1px solid var(--border); }
.ds-breakdown > div { display:flex; justify-content:space-between; gap:12px; font-size:11px; }
.ds-breakdown span { color:var(--muted); }
.ds-breakdown strong { color:var(--ink); }
.ds-track { display:flex; height:10px; margin-top:18px; border-radius:5px; overflow:hidden; background:#edf2f7; }
.ds-track span { display:block; height:100%; }
.ds-used { background:#0d6efd; }
.ds-reserved { background:#8a5a00; }
.ds-available { background:#c9d8e5; }
.ds-legend { display:flex; gap:16px; margin-top:10px; color:var(--muted); font-size:10px; }
.ds-legend span { display:flex; align-items:center; gap:6px; }
.ds-dot { width:8px; height:8px; border-radius:50%; }
.ds-dot-used { background:#0d6efd; }
.ds-dot-reserved { background:#8a5a00; }
.ds-dot-available { background:#c9d8e5; }
.ds-section-head { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:12px; }
.ds-section-head h2 { margin:0; }
.ds-link { display:inline-flex; align-items:center; gap:4px; padding:0; border:0; background:transparent; color:var(--blue,#0d6efd); font-size:11px; font-weight:600; cursor:pointer; }
.ds-link:hover { text-decoration:underline; }
.ds-table { width:100%; border-collapse:collapse; }
.ds-table th { padding:0 8px 10px; border-bottom:1px solid var(--border); color:var(--muted); font-size:9px; font-weight:600; letter-spacing:.03em; text-align:left; text-transform:uppercase; }
.ds-table td { padding:11px 8px; border-bottom:1px solid #edf2f7; color:var(--text); font-size:10.5px; }
.ds-table th:first-child, .ds-table td:first-child { padding-left:0; }
.ds-table th:last-child, .ds-table td:last-child { padding-right:0; }
.ds-request-link { padding:0; border:0; background:transparent; color:#0d6efd; font-size:10.5px; font-weight:600; cursor:pointer; }
.ds-request-link:hover { text-decoration:underline; }
.ds-table td small { display:block; margin-top:2px; color:var(--muted); font-size:9px; }
.ds-badge { display:inline-flex; align-items:center; height:20px; padding:0 8px; border-radius:10px; font-size:9px; font-weight:600; white-space:nowrap; }
.ds-badge-green { background:#e4f7ec; color:#0b6b45; }
.ds-badge-red { background:#fde9e9; color:#a11d1d; }
.ds-badge-amber { background:#fff6de; color:#8a5a00; }
.ds-badge-neutral { background:#edf2f6; color:var(--text); }
.ds-icon-button { width:28px; height:28px; border:0; border-radius:8px; background:transparent; color:var(--text); cursor:pointer; }
.ds-icon-button:hover { background:#f7f9fc; }
.ds-empty { padding:24px 0; text-align:center; color:var(--muted); }
.ds-how { display:flex; align-items:center; gap:10px; padding:16px; border:1px solid #c9dafb; border-radius:12px; background:#f4f8ff; text-align:left; cursor:pointer; }
.ds-how > div { flex:1; min-width:0; }
.ds-how strong { display:block; color:var(--ink); font-size:11px; }
.ds-how small { display:block; margin-top:2px; color:var(--muted); font-size:9px; }
.ds-how-icon { width:22px; height:22px; flex:0 0 auto; border-radius:50%; background:#e9f1ff; color:#1b4fbf; display:inline-flex; align-items:center; justify-content:center; font-size:10px; font-weight:600; }
.ds-how > svg { color:#6e8590; flex:0 0 auto; }
.ds-nonannual { list-style:none; margin:14px 0 0; padding:0; display:grid; gap:8px; }
.ds-nonannual li { display:flex; justify-content:space-between; gap:12px; font-size:11px; }
.ds-nonannual li span { color:var(--text); }
.ds-nonannual li strong { color:var(--ink); }
.ds-footnote { margin:14px 0 0; color:var(--muted); font-size:9px; }
.ds-returned { display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
.ds-returned-icon { width:36px; height:36px; flex:0 0 auto; border-radius:50%; background:#fff6de; color:#8a5a00; display:inline-flex; align-items:center; justify-content:center; }
.ds-returned > div { flex:1; min-width:0; }
.ds-returned strong { display:block; color:var(--ink); font-size:11px; }
.ds-returned small { display:block; margin-top:2px; color:var(--muted); font-size:9px; }
.ds-wide-button { width:100%; min-height:34px; border:0; border-radius:8px; background:#e9f1ff; color:#1b4fbf; font-size:11px; font-weight:600; cursor:pointer; }
.ds-policy { list-style:none; margin:12px 0; padding:0; display:grid; gap:10px; }
.ds-policy li { display:flex; align-items:center; gap:8px; color:var(--text); font-size:11px; }
.ds-policy svg { color:var(--muted); flex:0 0 auto; }

@media (max-width:1180px){ .dash-grid{ grid-template-columns:1fr; } }
@media (max-width:640px){ .ds-balance-head{ grid-template-columns:1fr; } .ds-breakdown{ padding-left:0; border-left:0; } .ds-how{ flex-wrap:wrap; } }
</style>
