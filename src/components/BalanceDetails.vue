<script setup>
import { computed } from 'vue'
import { CalendarDays, CircleDollarSign, Clock3, Info, Landmark, RotateCcw, Wallet } from 'lucide-vue-next'

const props = defineProps({
  data: { type: Object, default: null },
  year: { type: Number, required: true },
})
const emit = defineEmits(['year-change'])

const summary = computed(() => props.data?.summary || null)
const types = computed(() => props.data?.types || [])
const ledger = computed(() => props.data?.ledger || [])
const allocated = computed(() => Number(summary.value?.allocated_days || 0))
const used = computed(() => Number(summary.value?.used_days || 0))
const reserved = computed(() => Number(summary.value?.reserved_days || 0))
const available = computed(() => Number(summary.value?.available_days || 0))
const adjustment = computed(() => Number(summary.value?.adjustment_days || 0))
const carryOver = computed(() => Number(summary.value?.carry_over_days || 0))
const years = computed(() => {
  const current = new Date().getFullYear()
  return [current, current - 1, current - 2]
})

function formatDate(value) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return '-'
  return new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }).format(date)
}

function transactionTone(type) {
  if (String(type).includes('RESERV')) return 'amber'
  if (String(type).includes('RESTORE') || String(type).includes('RETURN')) return 'green'
  return 'blue'
}
function transactionLabel(type) {
  return ({
    ALLOCATION: 'ALOKASI',
    RESERVATION: 'RESERVASI',
    USAGE: 'PEMAKAIAN',
    RESTORATION: 'PENGEMBALIAN',
  })[type] || type
}
</script>

<template>
  <section class="bal">
    <div class="bal-metrics">
      <article><div><p>Kuota tahunan</p><strong>{{ allocated }} <span>hari</span></strong></div><span class="bal-icon"><CalendarDays :size="16" aria-hidden="true" /></span></article>
      <article><div><p>Terpakai</p><strong>{{ used }} <span>hari</span></strong></div><span class="bal-icon bal-icon-green"><CircleDollarSign :size="16" aria-hidden="true" /></span></article>
      <article><div><p>Dalam proses</p><strong>{{ reserved }} <span>hari</span></strong></div><span class="bal-icon bal-icon-amber"><Clock3 :size="16" aria-hidden="true" /></span></article>
      <article><div><p>Tersedia</p><strong>{{ available }} <span>hari</span></strong></div><span class="bal-icon bal-icon-teal"><Wallet :size="16" aria-hidden="true" /></span></article>
    </div>

    <div class="bal-grid">
      <section class="bal-panel">
        <div class="bal-head">
          <div><h2>Ringkasan per jenis cuti</h2><p>Cuti sakit dan alasan penting tidak memotong saldo tahunan.</p></div>
        </div>
        <table class="bal-table">
          <thead><tr><th>Jenis cuti</th><th>Kuota</th><th>Terpakai</th><th>Reservasi</th><th>Tersedia</th></tr></thead>
          <tbody>
            <tr v-for="type in types" :key="type.code">
              <td>{{ type.name }}</td>
              <td>{{ type.deductsAnnual ? allocated : '-' }}</td>
              <td>{{ type.usedDays || 0 }}</td>
              <td>{{ type.code === 'ANNUAL' ? reserved : 0 }}</td>
              <td :class="{ 'bal-strong': type.deductsAnnual }">{{ type.deductsAnnual ? `${available} hari` : 'Tidak berlaku' }}</td>
            </tr>
            <tr v-if="!types.length"><td colspan="5" class="bal-empty">Belum ada data jenis cuti.</td></tr>
          </tbody>
        </table>
        <p class="bal-note"><Info :size="12" aria-hidden="true" /> Saldo tersedia adalah kuota ditambah penyesuaian dikurangi terpakai dan reservasi.</p>
      </section>

      <aside class="bal-side">
        <section class="bal-panel">
          <h2>Cara membaca saldo</h2>
          <p class="bal-muted">Saldo tersedia memperhitungkan pengajuan yang masih berjalan.</p>
          <div class="bal-formula">
            <div><span>Kuota tahunan</span><strong>+{{ allocated }}</strong></div>
            <div><span>Penyesuaian + carry-over</span><strong>+{{ adjustment + carryOver }}</strong></div>
            <div><span>Terpakai</span><strong>-{{ used }}</strong></div>
            <div><span>Dalam proses / reservasi</span><strong>-{{ reserved }}</strong></div>
            <hr />
            <div class="bal-total"><span>Tersedia</span><strong>{{ available }} hari</strong></div>
          </div>
          <p class="bal-note"><Info :size="12" aria-hidden="true" /> Reservasi dilepas saat pengajuan ditolak atau dibatalkan.</p>
        </section>

        <section class="bal-panel">
          <h2>Kebijakan periode</h2>
          <ul class="bal-policy">
            <li><CalendarDays :size="14" aria-hidden="true" /> Reset saldo 1 Januari {{ year + 1 }}</li>
            <li><RotateCcw :size="14" aria-hidden="true" /> Carry-over belum diaktifkan</li>
            <li><Landmark :size="14" aria-hidden="true" /> Riwayat {{ year - 1 }} tetap tersedia</li>
          </ul>
          <select class="bal-year" :value="year" aria-label="Tahun saldo" @change="emit('year-change', Number($event.target.value))">
            <option v-for="option in years" :key="option" :value="option">Lihat saldo {{ option }}</option>
          </select>
        </section>
      </aside>
    </div>

    <section class="bal-panel bal-ledger">
      <div class="bal-head">
        <div><h2>Rincian transaksi saldo tahunan</h2><p>Ledger tidak dapat diubah. Setiap perubahan punya pelaku dan alasan.</p></div>
      </div>
      <table class="bal-table">
        <thead><tr><th>Tanggal</th><th>No pengajuan</th><th>Jenis transaksi</th><th>Hari</th><th>Keterangan</th><th>Saldo</th></tr></thead>
        <tbody>
          <tr v-for="row in ledger" :key="row.id">
            <td>{{ formatDate(row.date) }}</td>
            <td>{{ row.requestNumber }}</td>
            <td><span class="bal-badge" :class="`bal-badge-${transactionTone(row.transactionType)}`">{{ transactionLabel(row.transactionType) }}</span></td>
            <td :class="row.days > 0 ? 'bal-green' : 'bal-red'">{{ row.days > 0 ? `+${row.days}` : row.days }}</td>
            <td>{{ row.reason }}</td>
            <td class="bal-strong">{{ row.balanceAfter }}</td>
          </tr>
          <tr v-if="!ledger.length"><td colspan="6" class="bal-empty">Belum ada transaksi saldo pada tahun ini.</td></tr>
        </tbody>
      </table>
      <p class="bal-note">Saldo tersedia saat ini: <strong>{{ available }} hari</strong>.</p>
    </section>
  </section>
</template>

<style scoped>
.bal { --ink:#142f3a; --text:#3d525c; --muted:#5a6f78; --border:#e1e9f1; display:grid; gap:20px; min-width:0; }
.bal-metrics { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:16px; }
.bal-metrics article { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; min-height:72px; padding:12px 16px; border:1px solid var(--border); border-radius:12px; background:#fff; }
.bal-metrics p { margin:0 0 2px; color:var(--muted); font-size:10.5px; }
.bal-metrics strong { color:var(--ink); font-size:26px; font-weight:700; }
.bal-metrics strong span { color:var(--muted); font-size:10.5px; font-weight:500; }
.bal-icon { width:34px; height:34px; border-radius:50%; background:#e9f1ff; color:#1b4fbf; display:inline-flex; align-items:center; justify-content:center; }
.bal-icon-green { background:#e4f7ec; color:#0b6b45; }
.bal-icon-amber { background:#fff6de; color:#8a5a00; }
.bal-icon-teal { background:#e3f4f1; color:#0a6b60; }
.bal-grid { display:grid; grid-template-columns:minmax(0, 716fr) minmax(0, 392fr); gap:20px; align-items:start; }
.bal-side { display:grid; gap:20px; min-width:0; }
.bal-panel { min-width:0; padding:20px; border:1px solid var(--border); border-radius:12px; background:#fff; }
.bal-panel h2 { margin:0 0 4px; color:var(--ink); font-size:14px; font-weight:600; }
.bal-head { margin-bottom:16px; }
.bal-head p, .bal-muted { margin:0; color:var(--muted); font-size:10px; }
.bal-table { width:100%; border-collapse:collapse; }
.bal-table th { padding:0 10px 10px; border-bottom:1px solid var(--border); color:var(--muted); font-size:9px; font-weight:600; letter-spacing:.03em; text-align:left; text-transform:uppercase; }
.bal-table td { padding:12px 10px; border-bottom:1px solid #edf2f7; color:var(--text); font-size:10.5px; }
.bal-table th:first-child,.bal-table td:first-child { padding-left:0; }
.bal-table th:last-child,.bal-table td:last-child { padding-right:0; }
.bal-strong { color:var(--ink); font-weight:600; }
.bal-green { color:#0b6b45; font-weight:600; }
.bal-red { color:#a11d1d; font-weight:600; }
.bal-empty { padding:24px 0; text-align:center; color:var(--muted); }
.bal-note { display:flex; align-items:center; gap:6px; margin:14px 0 0; color:var(--muted); font-size:9px; }
.bal-formula { margin-top:14px; padding:14px; border-radius:10px; background:#f7f9fc; }
.bal-formula > div { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:8px; font-size:10px; }
.bal-formula span { color:var(--muted); }
.bal-formula strong { color:var(--ink); }
.bal-formula hr { margin:10px 0; border:0; border-top:1px solid var(--border); }
.bal-total strong { color:#0d6efd; font-size:13px; }
.bal-policy { list-style:none; margin:12px 0; padding:0; display:grid; gap:12px; }
.bal-policy li { display:flex; align-items:flex-start; gap:8px; color:var(--text); font-size:11px; }
.bal-policy svg { flex:0 0 auto; color:var(--muted); }
.bal-year { width:100%; height:38px; padding:0 10px; border:1px solid #8494a1; border-radius:8px; background:#fff; color:var(--text); font-size:11px; cursor:pointer; }
.bal-badge { display:inline-flex; align-items:center; padding:3px 8px; border-radius:10px; font-size:9px; font-weight:600; white-space:nowrap; }
.bal-badge-blue { background:#e9f1ff; color:#1b4fbf; }
.bal-badge-amber { background:#fff6de; color:#8a5a00; }
.bal-badge-green { background:#e4f7ec; color:#0b6b45; }
@media (max-width:1180px){ .bal-metrics{ grid-template-columns:repeat(2,minmax(0,1fr)); } .bal-grid{ grid-template-columns:1fr; } .bal-ledger{ overflow-x:auto; } .bal-ledger .bal-table{ min-width:800px; } }
@media (max-width:640px){ .bal-metrics{ grid-template-columns:1fr; } }
</style>
