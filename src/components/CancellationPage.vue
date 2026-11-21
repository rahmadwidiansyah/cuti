<script setup>
import { computed, ref, watch } from 'vue'
import { AlertTriangle, ArrowLeft, Check, Info, ShieldCheck } from 'lucide-vue-next'
import DatePicker from './DatePicker.vue'
import { formatDateRange } from '../dates.js'

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
  return formatDateRange(props.request.startDate, props.request.endDate)
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
        <button class="button button-danger button-wide button-lg cp-confirm" type="button" :disabled="submitting" @click="confirm">
          <Check :size="14" aria-hidden="true" /> {{ submitting ? 'Memproses…' : 'Konfirmasi pembatalan' }}
        </button>
        <button class="button button-secondary button-wide cp-secondary" type="button" :disabled="submitting" @click="emit('back')">Batal</button>
        <p class="cp-note"><Info :size="12" aria-hidden="true" /> Notifikasi dikirim ke pegawai setelah pembatalan.</p>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.cancel-page {
  display: grid; gap: var(--space-5); min-width: 0;
}
.cp-head { min-width: 0; }
.cp-back { display: inline-flex; align-items: center; gap: var(--space-1); padding: 0; border: 0; background: transparent; color: var(--primary-dark); font-size: 12px; font-weight: 600; cursor: pointer; }
.cp-back:hover { text-decoration: underline; }
.cp-head h1 { margin: var(--space-2) 0; }
.cp-chips { display: flex; gap: var(--space-2); }
.cp-chip { display: inline-flex; align-items: center; min-height: 22px; padding: 3px 8px; border: 1px solid var(--neutral-border); border-radius: 999px; background: var(--neutral-bg); color: var(--neutral-text); font-size: 10px; font-weight: 650; letter-spacing: 0.04em; text-transform: uppercase; }
.cp-chip-green { background: var(--success-bg); border-color: var(--success-border); color: var(--success-text); }
.cp-meta { margin: var(--space-3) 0 0; color: var(--muted); font-size: 12px; }

.cp-layout { display: grid; grid-template-columns: minmax(0, 716fr) minmax(0, 392fr); gap: var(--space-5); align-items: start; }
.cp-panel { min-width: 0; padding: 20px; border: 1px solid var(--border); border-radius: var(--radius-panel); background: var(--card); }
.cp-form h2, .cp-calc h2 { margin: 20px 0 12px; color: var(--ink); font-size: 12.5px; font-weight: 600; }
.cp-form > h2:first-of-type { margin-top: 20px; }
.cp-alert { display: flex; align-items: flex-start; gap: 10px; padding: 12px 14px; border: 1px solid var(--danger-border); border-radius: var(--radius-control); background: var(--danger-bg); color: var(--danger-text); font-size: 12px; }
.cp-alert svg { flex: 0 0 auto; margin-top: 1px; }
.cp-alert strong { display: block; font-size: 12px; font-weight: 600; }
.cp-alert span { display: block; margin-top: 2px; font-size: 11px; }

.cp-summary-cards { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
.cp-summary-cards > div { min-height: 76px; padding: 10px 12px; border-radius: var(--radius-control); background: var(--subtle); }
.cp-summary-cards span { display: block; color: var(--muted); font-size: 10px; }
.cp-summary-cards strong { display: inline-block; margin-top: 4px; color: var(--ink); font-size: 24px; font-weight: 700; font-variant-numeric: tabular-nums; }
.cp-summary-cards small { margin-left: 3px; color: var(--muted); font-size: 10px; }
.cp-used { color: var(--warning-text); }
.cp-blue { color: var(--primary); }
.cp-green { color: var(--success-text); }

.cp-sources { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-3); }
.cp-source { display: flex; align-items: center; gap: 10px; min-height: 64px; padding: 12px; border: 1px solid var(--control-border); border-radius: var(--radius-control); background: var(--card); cursor: pointer; }
.cp-source.active { border-color: var(--primary); background: var(--primary-tint); }
.cp-source input { accent-color: var(--primary); }
.cp-source strong { display: block; color: var(--ink); font-size: 11px; font-weight: 600; }
.cp-source small { display: block; margin-top: 2px; color: var(--muted); font-size: 10px; }
.cp-fields { display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: var(--space-3); margin-top: 20px; }
.cp-fields > label > span:first-child { display: block; margin-bottom: var(--space-2); color: var(--text); font-size: 11px; font-weight: 600; }
.cp-input-icon { position: relative; display: block; }
.cp-input-icon svg { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); color: var(--muted); }
.cp-input-icon input { width: 100%; height: 44px; padding: 0 10px 0 34px; border: 1px solid var(--control-border); border-radius: var(--radius-control); background: var(--card); color: var(--text); font-size: 13px; }
.cp-fields textarea { width: 100%; min-height: 96px; padding: 10px 12px; border: 1px solid var(--control-border); border-radius: var(--radius-control); background: var(--card); color: var(--text); font-size: 12px; line-height: 1.5; resize: vertical; }

.cp-segments { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }
.cp-segment { width: 52px; height: 40px; border: 1px solid var(--control-border); border-radius: var(--radius-control); background: var(--card); color: var(--text); font-size: 13px; font-weight: 600; cursor: pointer; }
.cp-segment.active { border-color: var(--primary); background: var(--primary); color: var(--on-dark); }
.cp-segments > span { color: var(--muted); font-size: 11px; }
.cp-ledger { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; margin-top: var(--space-4); padding: 14px 16px; border-radius: var(--radius-control); background: var(--subtle); }
.cp-ledger span { color: var(--muted); font-size: 10px; }
.cp-ledger strong { color: var(--ink); font-size: 24px; font-weight: 700; font-variant-numeric: tabular-nums; }
.cp-arrow { color: var(--muted); font-size: 16px; }
.cp-audit { display: flex; align-items: center; gap: var(--space-1); margin: 14px 0 0; color: var(--muted); font-size: 11px; }

.cp-calc-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); }
.cp-calc-head h2 { margin: 0; font-size: 14px; }
.cp-auto { padding: 3px 8px; border: 1px solid var(--info-border); border-radius: 999px; background: var(--info-bg); color: var(--info-text); font-size: 10px; font-weight: 650; letter-spacing: 0.04em; }
.cp-formula { margin-top: 14px; padding: 14px; border: 1px solid var(--info-border); border-radius: 10px; background: var(--primary-tint); }
.cp-formula > div { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); margin-bottom: var(--space-2); color: var(--text); font-size: 11px; }
.cp-formula strong { color: var(--ink); font-size: 12px; font-variant-numeric: tabular-nums; }
.cp-formula hr { margin: 10px 0; border: 0; border-top: 1px solid var(--info-border); }
.cp-formula > div:nth-of-type(3) strong { color: var(--primary); font-size: 20px; }
.cp-formula small { display: block; margin-top: var(--space-2); color: var(--muted); font-size: 10px; }
.cp-restoration { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.cp-badge { padding: 3px 8px; border: 1px solid var(--success-border); border-radius: 999px; background: var(--success-bg); color: var(--success-text); font-size: 10px; font-weight: 650; letter-spacing: 0.04em; }
.cp-restoration strong { color: var(--success-text); font-size: 13px; }
.cp-restoration p { width: 100%; margin: 0; color: var(--muted); font-size: 11px; }
.cp-balance-boxes { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: var(--space-2); }
.cp-balance-boxes > div { padding: 10px; border-radius: var(--radius-control); background: var(--subtle); }
.cp-balance-boxes span { display: block; color: var(--muted); font-size: 10px; }
.cp-balance-boxes strong { display: block; margin-top: 3px; font-size: 24px; font-weight: 700; color: var(--ink); font-variant-numeric: tabular-nums; }
.cp-balance-boxes small { font-size: 10px; font-weight: 500; color: var(--muted); }
.cp-warning { display: flex; align-items: flex-start; gap: var(--space-2); margin-top: var(--space-4); padding: 10px 12px; border: 1px solid var(--warning-border); border-radius: var(--radius-control); background: var(--warning-bg); color: var(--warning-text); }
.cp-warning svg { flex: 0 0 auto; margin-top: 1px; }
.cp-warning strong { display: block; font-size: 11px; font-weight: 600; }
.cp-warning span { display: block; margin-top: 2px; font-size: 10px; }
.cp-error { margin: var(--space-3) 0 0; color: var(--danger-text); font-size: 11px; }
.cp-confirm { margin-top: var(--space-4); }
.cp-secondary { margin-top: var(--space-2); }
.cp-note { display: flex; align-items: center; gap: var(--space-1); margin: 10px 0 0; color: var(--muted); font-size: 10px; }

@media (max-width: 1200px) {
  .cp-layout { grid-template-columns: 1fr; }
  .cp-fields { grid-template-columns: 1fr; }
}
@media (max-width: 640px) {
  .cp-summary-cards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .cp-sources { grid-template-columns: 1fr; }
}
</style>
