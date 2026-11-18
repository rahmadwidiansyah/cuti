<script setup>
import { computed, ref, watch } from 'vue'
import { AlertTriangle, ArrowLeft, Check, Info, ShieldCheck } from 'lucide-vue-next'
import DatePicker from './DatePicker.vue'

const props = defineProps({
  request: { type: Object, required: true },
  submitting: { type: Boolean, default: false },
})
const emit = defineEmits(['back', 'confirm'])

const source = ref('EMPLOYEE_REQUEST')
const effectiveDate = ref(new Date().toISOString().slice(0, 10))
const reason = ref('')
const restoredDays = ref(0)
const localError = ref('')

const approvedDays = computed(() => Number(props.request.approvedDays || props.request.workingDays || 0))
const usedDays = computed(() => {
  if (props.request.status !== 'APPROVED') return 0
  let used = 0
  for (const day of props.request.days || []) {
    const date = String(day.leave_date || '').slice(0, 10)
    if (day.is_counted && date && date <= effectiveDate.value) used += 1
  }
  return used
})
const maxRestorable = computed(() => Math.max(0, approvedDays.value - usedDays.value))
const remainingDays = computed(() => Math.max(0, approvedDays.value - usedDays.value))
const balanceBefore = computed(() => Number(props.request.availableDays ?? 0))
const balanceAfter = computed(() => balanceBefore.value + Number(restoredDays.value || 0))
const periodLabel = computed(() => {
  if (!props.request.startDate) return '-'
  return `${formatDate(props.request.startDate)} s.d. ${formatDate(props.request.endDate)}`
})

function formatDate(value) {
  if (!value) return '-'
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00Z`)
  if (Number.isNaN(date.valueOf())) return '-'
  return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date)
}

function confirm() {
  localError.value = ''
  if (reason.value.trim().length < 10) {
    localError.value = 'Alasan pembatalan wajib diisi, minimal 10 karakter.'
    return
  }
  if (restoredDays.value > maxRestorable.value) {
    localError.value = 'Jumlah hari dikembalikan melebihi batas yang dihitung sistem.'
    return
  }
  emit('confirm', {
    source: source.value,
    effectiveDate: effectiveDate.value,
    reason: reason.value.trim(),
    restoredDays: props.request.status === 'APPROVED' ? Number(restoredDays.value) : 0,
  })
}

watch(maxRestorable, (value) => {
  if (restoredDays.value > value) restoredDays.value = value
}, { immediate: true })

watch(effectiveDate, () => {
  if (restoredDays.value > maxRestorable.value) restoredDays.value = maxRestorable.value
})
</script>

<template>
  <section class="cancel-page">
    <div class="cp-head">
      <button class="cp-back" type="button" @click="emit('back')">
        <ArrowLeft :size="14" aria-hidden="true" /> Kembali ke detail
      </button>
      <h1>Pembatalan cuti</h1>
      <div class="cp-chips">
        <span class="cp-chip">{{ request.requestNumber }}</span>
        <span class="cp-chip cp-chip-green">{{ request.status === 'APPROVED' ? 'DISETUJUI' : 'DALAM PROSES' }}</span>
      </div>
      <p class="cp-meta">{{ request.employeeName }} · {{ request.workingDays }} hari kerja · {{ periodLabel }}</p>
    </div>

    <div class="cp-layout">
      <section class="cp-panel cp-form">
        <div class="cp-alert">
          <AlertTriangle :size="16" aria-hidden="true" />
          <div>
            <strong>Pembatalan hanya untuk cuti yang sudah disetujui</strong>
            <span>Saldo dikembalikan maksimal hari yang belum digunakan.</span>
          </div>
        </div>

        <h2>Ringkasan cuti</h2>
        <div class="cp-summary-cards">
          <div><span>Disetujui</span><strong>{{ approvedDays }}</strong><small>hari</small></div>
          <div><span>Digunakan</span><strong class="cp-used">{{ usedDays }}</strong><small>hari</small></div>
          <div><span>Belum digunakan</span><strong class="cp-blue">{{ remainingDays }}</strong><small>hari</small></div>
          <div><span>Maks. kembali</span><strong class="cp-green">{{ maxRestorable }}</strong><small>hari</small></div>
        </div>

        <h2>Sumber pembatalan</h2>
        <div class="cp-sources">
          <label class="cp-source" :class="{ active: source === 'EMPLOYEE_REQUEST' }">
            <input v-model="source" type="radio" value="EMPLOYEE_REQUEST" />
            <span><strong>Permintaan pegawai</strong><small>Pegawai mengajukan pembatalan</small></span>
          </label>
          <label class="cp-source" :class="{ active: source === 'ADMIN_INITIATED' }">
            <input v-model="source" type="radio" value="ADMIN_INITIATED" />
            <span><strong>Inisiatif Admin</strong><small>Keputusan institusi atau operasional</small></span>
          </label>
        </div>

        <div class="cp-fields">
          <DatePicker
            v-model="effectiveDate"
            label="Tanggal efektif pembatalan"
            placeholder="Pilih tanggal"
          />
          <label>
            <span>Alasan pembatalan (wajib)</span>
            <textarea v-model.trim="reason" rows="3" placeholder="Tuliskan alasan pembatalan secara jelas."></textarea>
          </label>
        </div>

        <h2>Jumlah hari dikembalikan</h2>
        <div class="cp-segments">
          <button
            v-for="day in maxRestorable + 1"
            :key="day"
            class="cp-segment"
            :class="{ active: restoredDays === day - 1 }"
            type="button"
            @click="restoredDays = day - 1"
          >{{ day - 1 }}</button>
          <span>Maksimal {{ maxRestorable }} hari · sistem menghitung ulang batas ini.</span>
        </div>

        <div class="cp-ledger">
          <span>Saldo sebelum</span><strong>{{ balanceBefore }} hari</strong>
          <span class="cp-arrow">→</span>
          <span>Pengembalian</span><strong class="cp-blue">+{{ restoredDays }} hari</strong>
          <span class="cp-arrow">→</span>
          <span>Saldo sesudah</span><strong class="cp-green">{{ balanceAfter }} hari</strong>
        </div>
        <p class="cp-audit"><ShieldCheck :size="13" aria-hidden="true" /> Tindakan ini dicatat di audit log dan tidak dapat diubah.</p>
      </section>

      <aside class="cp-panel cp-calc">
        <div class="cp-calc-head">
          <h2>Perhitungan pengembalian</h2>
          <span class="cp-auto">OTOMATIS</span>
        </div>
        <div class="cp-formula">
          <div><span>Hari disetujui</span><strong>{{ approvedDays }}</strong></div>
          <div><span>Hari digunakan</span><strong>-{{ usedDays }}</strong></div>
          <hr />
          <div><span>Maksimal dikembalikan</span><strong>{{ maxRestorable }} hari</strong></div>
          <small>Tidak boleh melebihi hari yang belum digunakan.</small>
        </div>

        <h2>Dampak ledger</h2>
        <div class="cp-restoration">
          <span class="cp-badge">RESTORATION</span><strong>+{{ restoredDays }} hari</strong>
          <p>Saldo bertambah setelah konfirmasi pembatalan.</p>
        </div>

        <h2>Saldo tahunan</h2>
        <div class="cp-balance-boxes">
          <div><span>Sebelum</span><strong>{{ balanceBefore }} <small>hari</small></strong></div>
          <span class="cp-arrow">→</span>
          <div><span>Sesudah</span><strong class="cp-blue">{{ balanceAfter }} <small>hari</small></strong></div>
        </div>

        <div class="cp-warning">
          <AlertTriangle :size="14" aria-hidden="true" />
          <div><strong>Batas pengembalian {{ maxRestorable }} hari</strong><span>Input di atas batas akan ditolak backend.</span></div>
        </div>

        <p v-if="localError" class="cp-error" role="alert">{{ localError }}</p>
        <button class="cp-confirm" type="button" :disabled="submitting" @click="confirm">
          <Check :size="14" aria-hidden="true" /> {{ submitting ? 'Memproses…' : 'Konfirmasi pembatalan' }}
        </button>
        <button class="cp-secondary" type="button" :disabled="submitting" @click="emit('back')">Batal</button>
        <p class="cp-note"><Info :size="12" aria-hidden="true" /> Notifikasi dikirim ke pegawai setelah pembatalan.</p>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.cancel-page {
  --ink: #142f3a; --text: #3d525c; --muted: #5a6f78;
  --border: #e1e9f1; --divider: #edf2f7; --blue: #0d6efd;
  display: grid; gap: 20px; min-width: 0;
}
.cp-head { min-width: 0; }
.cp-back { display: inline-flex; align-items: center; gap: 6px; padding: 0; border: 0; background: transparent; color: var(--blue); font-size: 12px; font-weight: 600; cursor: pointer; }
.cp-back:hover { text-decoration: underline; }
.cp-head h1 { margin: 8px 0; font-size: 22px; font-weight: 700; color: var(--ink); }
.cp-chips { display: flex; gap: 8px; }
.cp-chip { display: inline-flex; align-items: center; height: 24px; padding: 0 10px; border: 1px solid #d8e2ea; border-radius: 12px; background: #edf2f6; color: var(--text); font-size: 9px; font-weight: 600; }
.cp-chip-green { background: #e4f7ec; border-color: #b9e6cc; color: #0b6b45; }
.cp-meta { margin: 12px 0 0; color: var(--muted); font-size: 12px; }

.cp-layout { display: grid; grid-template-columns: minmax(0, 716fr) minmax(0, 392fr); gap: 20px; align-items: start; }
.cp-panel { min-width: 0; padding: 20px; border: 1px solid var(--border); border-radius: 12px; background: #fff; }
.cp-form h2, .cp-calc h2 { margin: 20px 0 12px; color: var(--ink); font-size: 12.5px; font-weight: 600; }
.cp-form > h2:first-of-type { margin-top: 20px; }
.cp-alert { display: flex; align-items: flex-start; gap: 10px; padding: 12px 16px; border: 1px solid #f4c6c6; border-radius: 10px; background: #fde9e9; color: #a11d1d; }
.cp-alert svg { flex: 0 0 auto; margin-top: 1px; }
.cp-alert strong { display: block; font-size: 11px; font-weight: 600; }
.cp-alert span { display: block; margin-top: 2px; font-size: 9.5px; }

.cp-summary-cards { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
.cp-summary-cards > div { min-height: 76px; padding: 10px 12px; border-radius: 10px; background: var(--divider); }
.cp-summary-cards span { display: block; color: var(--muted); font-size: 9px; }
.cp-summary-cards strong { display: inline-block; margin-top: 4px; color: var(--ink); font-size: 22px; font-weight: 700; }
.cp-summary-cards small { margin-left: 3px; color: var(--muted); font-size: 9px; }
.cp-used { color: #8a5a00; }
.cp-blue { color: var(--blue); }
.cp-green { color: #0b6b45; }

.cp-sources { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.cp-source { display: flex; align-items: center; gap: 10px; min-height: 64px; padding: 12px; border: 1px solid var(--border); border-radius: 10px; cursor: pointer; }
.cp-source.active { border-color: var(--blue); background: #f4f8ff; }
.cp-source input { accent-color: var(--blue); }
.cp-source strong { display: block; color: var(--ink); font-size: 11px; font-weight: 600; }
.cp-source small { display: block; margin-top: 2px; color: var(--muted); font-size: 9px; }
.cp-fields { display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 12px; margin-top: 20px; }
.cp-fields > label > span:first-child { display: block; margin-bottom: 6px; color: var(--text); font-size: 11px; font-weight: 600; }
.cp-input-icon { position: relative; display: block; }
.cp-input-icon svg { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); color: #6e8590; }
.cp-input-icon input { width: 100%; height: 44px; padding: 0 10px 0 34px; border: 1px solid #8494a1; border-radius: 8px; color: var(--text); font-size: 13px; }
.cp-fields textarea { width: 100%; min-height: 88px; padding: 10px; border: 1px solid #8494a1; border-radius: 8px; color: var(--text); font-size: 11px; line-height: 1.5; resize: vertical; }
.cp-fields input:focus, .cp-fields textarea:focus { outline: none; border-color: var(--blue); box-shadow: 0 0 0 3px rgba(13, 110, 253, 0.12); }

.cp-segments { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.cp-segment { width: 52px; height: 40px; border: 1px solid #8494a1; border-radius: 8px; background: #fff; color: var(--text); font-size: 13px; font-weight: 600; cursor: pointer; }
.cp-segment.active { border-color: var(--blue); background: var(--blue); color: #fff; }
.cp-segments > span { color: var(--muted); font-size: 9.5px; }
.cp-ledger { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 16px; padding: 14px 16px; border-radius: 10px; background: var(--divider); }
.cp-ledger span { color: var(--muted); font-size: 9px; }
.cp-ledger strong { color: var(--ink); font-size: 20px; font-weight: 700; }
.cp-arrow { color: #6e8590; font-size: 16px; }
.cp-audit { display: flex; align-items: center; gap: 6px; margin: 14px 0 0; color: var(--muted); font-size: 9.5px; }

.cp-calc-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.cp-calc-head h2 { margin: 0; font-size: 14px; }
.cp-auto { padding: 4px 10px; border: 1px solid #c9dafb; border-radius: 11px; background: #e9f1ff; color: #1b4fbf; font-size: 9px; font-weight: 600; }
.cp-formula { margin-top: 14px; padding: 14px; border: 1px solid #c9dafb; border-radius: 10px; background: #f4f8ff; }
.cp-formula > div { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 8px; color: var(--text); font-size: 10px; }
.cp-formula strong { color: var(--ink); font-size: 11px; }
.cp-formula hr { margin: 10px 0; border: 0; border-top: 1px solid #c9dafb; }
.cp-formula > div:nth-of-type(3) strong { color: var(--blue); font-size: 18px; }
.cp-formula small { display: block; margin-top: 8px; color: var(--muted); font-size: 9px; }
.cp-restoration { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.cp-badge { padding: 3px 8px; border: 1px solid #b9e6cc; border-radius: 11px; background: #e4f7ec; color: #0b6b45; font-size: 9px; font-weight: 600; }
.cp-restoration strong { color: #0b6b45; font-size: 13px; }
.cp-restoration p { width: 100%; margin: 0; color: var(--muted); font-size: 9.5px; }
.cp-balance-boxes { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 8px; }
.cp-balance-boxes > div { padding: 10px; border-radius: 8px; background: var(--divider); }
.cp-balance-boxes span { display: block; color: var(--muted); font-size: 9px; }
.cp-balance-boxes strong { display: block; margin-top: 3px; font-size: 19px; font-weight: 700; color: var(--ink); }
.cp-balance-boxes small { font-size: 9px; font-weight: 500; color: var(--muted); }
.cp-warning { display: flex; align-items: flex-start; gap: 8px; margin-top: 16px; padding: 10px 12px; border-radius: 8px; background: #fff6de; color: #8a5a00; }
.cp-warning svg { flex: 0 0 auto; margin-top: 1px; }
.cp-warning strong { display: block; font-size: 10px; font-weight: 600; }
.cp-warning span { display: block; margin-top: 2px; font-size: 9px; }
.cp-error { margin: 12px 0 0; color: #a11d1d; font-size: 10px; }
.cp-confirm { display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; min-height: 46px; margin-top: 16px; border: 0; border-radius: 8px; background: #b42318; color: #fff; font-size: 12px; font-weight: 600; cursor: pointer; }
.cp-confirm:hover:not(:disabled) { background: #991b1b; }
.cp-confirm:disabled { opacity: 0.5; cursor: not-allowed; }
.cp-secondary { width: 100%; min-height: 40px; margin-top: 8px; border: 1px solid #8494a1; border-radius: 8px; background: #fff; color: var(--ink); font-size: 12px; font-weight: 600; cursor: pointer; }
.cp-note { display: flex; align-items: center; gap: 6px; margin: 10px 0 0; color: var(--muted); font-size: 9px; }

@media (max-width: 1180px) {
  .cp-layout { grid-template-columns: 1fr; }
  .cp-fields { grid-template-columns: 1fr; }
}
@media (max-width: 640px) {
  .cp-summary-cards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .cp-sources { grid-template-columns: 1fr; }
}
</style>
