<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-vue-next'

const props = defineProps({
  modelValue: { type: String, default: '' },
  id: { type: String, default: null },
  label: { type: String, default: '' },
  placeholder: { type: String, default: 'YYYY-MM-DD' },
  min: { type: String, default: '' },
  max: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
  required: { type: Boolean, default: false },
  showMarkers: { type: Boolean, default: true },
})
const emit = defineEmits(['update:modelValue', 'change'])

const monthNames = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember']
const weekDays = ['Sen','Sel','Rab','Kam','Jum','Sab','Min']

const open = ref(false)
const rootRef = ref(null)
const inputRef = ref(null)
const loading = ref(false)
const markers = ref([])
const categories = ref([])
const version = ref(null)
const markerError = ref('')

const initial = parseInput(props.modelValue) || new Date()
const viewYear = ref(initial.getFullYear())
const viewMonth = ref(initial.getMonth() + 1)

function parseInput(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return null
  const [y, m, d] = String(value).split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return Number.isNaN(date.valueOf()) ? null : date
}
function toInput(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
}
function dateAt(y, m, d) {
  return new Date(Date.UTC(y, m - 1, d))
}

const monthLabel = computed(() => `${monthNames[viewMonth.value - 1]} ${viewYear.value}`)
const selectedDate = computed(() => parseInput(props.modelValue))

const markerMap = computed(() => {
  const map = new Map()
  for (const marker of markers.value) {
    if (!map.has(marker.date)) map.set(marker.date, [])
    map.get(marker.date).push(marker)
  }
  return map
})
const categoryMap = computed(() => new Map(categories.value.map(c => [c.code, c])))
const legendCategories = computed(() => {
  const usedCodes = new Set(markers.value.map(m => m.code))
  return categories.value.filter(c => usedCodes.has(c.code))
})

const grid = computed(() => {
  const first = dateAt(viewYear.value, viewMonth.value, 1)
  const firstDay = first.getUTCDay()
  const offset = firstDay === 0 ? 6 : firstDay - 1
  const start = new Date(first)
  start.setUTCDate(start.getUTCDate() - offset)

  const today = toInput(new Date())
  const min = props.min || null
  const max = props.max || null
  const weeks = []
  let cursor = new Date(start)
  for (let w = 0; w < 6; w++) {
    const week = []
    for (let i = 0; i < 7; i++) {
      const value = toInput(cursor)
      const date = cursor.getUTCDate()
      const isCurrentMonth = cursor.getUTCMonth() === viewMonth.value - 1 && cursor.getUTCFullYear() === viewYear.value
      const day = cursor.getUTCDay()
      const cellMarkers = markerMap.value.get(value) || []
      // Prioritaskan BLOCK > SKIP > INFO untuk warna sel
      const priority = { BLOCK: 3, SKIP: 2, INFO: 1 }
      const primary = [...cellMarkers].sort((a, b) => (priority[b.behavior] || 0) - (priority[a.behavior] || 0))[0] || null
      week.push({
        value,
        date,
        isCurrentMonth,
        isWeekend: day === 0 || day === 6,
        isToday: value === today,
        isSelected: value === props.modelValue,
        isDisabled: Boolean((min && value < min) || (max && value > max)),
        marker: primary,
        markerCount: cellMarkers.length,
        markerTitle: cellMarkers.map(m => m.title || m.name).join(', '),
      })
      cursor.setUTCDate(cursor.getUTCDate() + 1)
    }
    weeks.push(week)
  }
  // Sembunyikan baris terakhir jika seluruhnya di luar bulan
  while (weeks.length > 5 && weeks[weeks.length - 1].every(c => !c.isCurrentMonth)) weeks.pop()
  return weeks
})

async function loadMarkers() {
  if (!props.showMarkers) return
  loading.value = true
  markerError.value = ''
  try {
    const res = await fetch(`/api/calendar/markers?year=${viewYear.value}&month=${viewMonth.value}`, { credentials: 'same-origin' })
    const data = await res.json().catch(() => null)
    if (!res.ok) throw new Error(data?.error || 'Gagal memuat penanda kalender.')
    markers.value = data.markers || []
    categories.value = data.categories || []
    version.value = data.version || null
  } catch (error) {
    markerError.value = error.message || 'Gagal memuat penanda kalender.'
    markers.value = []
    categories.value = []
  } finally {
    loading.value = false
  }
}

watch(() => [viewYear.value, viewMonth.value], () => { if (open.value) loadMarkers() })
watch(() => props.modelValue, (value) => {
  const parsed = parseInput(value)
  if (parsed) {
    viewYear.value = parsed.getUTCFullYear()
    viewMonth.value = parsed.getUTCMonth() + 1
  }
})
watch(open, async (value) => {
  if (value) {
    await loadMarkers()
    await nextTick()
    document.addEventListener('mousedown', onOutside)
    document.addEventListener('keydown', onKeydown)
  } else {
    document.removeEventListener('mousedown', onOutside)
    document.removeEventListener('keydown', onKeydown)
  }
})

function onOutside(event) {
  if (rootRef.value && !rootRef.value.contains(event.target)) open.value = false
}
function onKeydown(event) {
  if (event.key === 'Escape') {
    open.value = false
    inputRef.value?.focus()
  }
}

function toggle() {
  if (props.disabled) return
  open.value = !open.value
}
function shiftMonth(delta) {
  let year = viewYear.value
  let month = viewMonth.value + delta
  if (month < 1) { month = 12; year-- }
  if (month > 12) { month = 1; year++ }
  viewYear.value = year
  viewMonth.value = month
}
function goToday() {
  const today = new Date()
  viewYear.value = today.getFullYear()
  viewMonth.value = today.getMonth() + 1
}
function selectCell(cell) {
  if (cell.isDisabled) return
  emit('update:modelValue', cell.value)
  emit('change', cell.value)
  // Menutup popover tanpa memicu handler @focus pada input.
  suppressFocusOpen.value = true
  open.value = false
  inputRef.value?.focus()
  requestAnimationFrame(() => { suppressFocusOpen.value = false })
}
const suppressFocusOpen = ref(false)
function onFocus() {
  if (!suppressFocusOpen.value) open.value = true
}
function onInput(event) {
  const value = event.target.value
  emit('update:modelValue', value)
  emit('change', value)
  const parsed = parseInput(value)
  if (parsed) {
    viewYear.value = parsed.getFullYear()
    viewMonth.value = parsed.getMonth() + 1
  }
}
function cellStyle(marker) {
  if (!marker) return {}
  const color = marker.color || '#5a6f78'
  return {
    '--dp-marker-color': color,
    '--dp-marker-soft': `${color}1f`,
  }
}

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onOutside)
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div ref="rootRef" class="date-picker">
    <label v-if="label" :for="id || undefined" class="dp-label">{{ label }}</label>
    <div class="dp-input-wrap" :class="{ disabled: disabled, open: open }">
      <CalendarDays :size="15" aria-hidden="true" class="dp-input-icon" />
      <input
        :id="id || undefined"
        ref="inputRef"
        :value="modelValue"
        type="text"
        inputmode="numeric"
        :placeholder="placeholder"
        :disabled="disabled"
        :required="required"
        autocomplete="off"
        class="dp-input"
        @input="onInput"
        @focus="onFocus"
      />
      <button class="dp-toggle" type="button" :disabled="disabled" :aria-expanded="open" aria-label="Buka kalender" @click="toggle">
        <ChevronRight :size="14" aria-hidden="true" />
      </button>
    </div>

    <div v-if="open" class="dp-popover" role="dialog" aria-label="Pilih tanggal">
      <div class="dp-toolbar">
        <button class="dp-nav" type="button" aria-label="Bulan sebelumnya" @click="shiftMonth(-1)"><ChevronLeft :size="15" aria-hidden="true" /></button>
        <strong class="dp-month">{{ monthLabel }}</strong>
        <button class="dp-nav" type="button" aria-label="Bulan berikutnya" @click="shiftMonth(1)"><ChevronRight :size="15" aria-hidden="true" /></button>
        <button class="dp-today" type="button" @click="goToday">Hari ini</button>
      </div>

      <div v-if="version && showMarkers" class="dp-version">{{ version.name }}</div>
      <p v-if="markerError" class="dp-error" role="alert">{{ markerError }}</p>

      <div class="dp-weekdays" aria-hidden="true"><span v-for="day in weekDays" :key="day">{{ day }}</span></div>
      <div class="dp-grid" role="grid">
        <div v-for="(week, wi) in grid" :key="wi" class="dp-grid-row" role="row">
          <button
            v-for="cell in week"
            :key="cell.value"
            type="button"
            role="gridcell"
            class="dp-cell"
            :class="{
              outside: !cell.isCurrentMonth,
              weekend: cell.isWeekend && cell.isCurrentMonth,
              today: cell.isToday,
              selected: cell.isSelected,
              disabled: cell.isDisabled,
              'has-marker': Boolean(cell.marker),
            }"
            :style="cellStyle(cell.marker)"
            :disabled="cell.isDisabled"
            :aria-label="`${cell.value}${cell.markerTitle ? ', ' + cell.markerTitle : ''}`"
            :aria-selected="cell.isSelected"
            @click="selectCell(cell)"
          >
            <span class="dp-cell-day">{{ cell.date }}</span>
            <span v-if="cell.marker" class="dp-marker-dot" :title="cell.markerTitle"></span>
          </button>
        </div>
      </div>

      <div v-if="showMarkers && legendCategories.length" class="dp-legend">
        <span v-for="category in legendCategories" :key="category.code" class="dp-legend-item">
          <i :style="{ background: category.color }"></i>{{ category.name }}
        </span>
      </div>
      <div v-else-if="showMarkers && !loading" class="dp-hint">Tidak ada tanggal khusus bulan ini.</div>
      <div v-if="loading" class="dp-hint">Memuat penanda…</div>
    </div>
  </div>
</template>

<style scoped>
.date-picker { position: relative; display: grid; gap: 6px; min-width: 0; }
.dp-label { color: var(--muted); font-size: 10.5px; font-weight: 600; }
.dp-input-wrap {
  position: relative; display: flex; align-items: center; gap: 8px;
  width: 100%; min-width: 0; height: 44px; padding: 0 8px 0 12px;
  border: 1px solid var(--control-border); border-radius: var(--radius-control); background: var(--card); color: var(--muted);
}
.dp-input-wrap:focus-within, .dp-input-wrap.open { border-color: var(--primary); box-shadow: 0 0 0 3px var(--primary-soft); }
.dp-input-wrap.disabled { opacity: .55; }
.dp-input-icon { flex: 0 0 auto; }
.dp-input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--text); font-size: 13px; }
.dp-toggle {
  flex: 0 0 auto; width: 26px; height: 26px; display: inline-flex; align-items: center; justify-content: center;
  border: 0; border-radius: var(--radius-control); background: transparent; color: var(--muted); cursor: pointer;
}
.dp-toggle svg { transform: rotate(90deg); }
.dp-open .dp-toggle svg, .dp-input-wrap.open .dp-toggle svg { transform: rotate(-90deg); }

.dp-popover {
  position: absolute; top: calc(100% + 6px); left: 0; z-index: 200;
  width: 320px; max-width: calc(100vw - 32px);
  padding: 12px; border: 1px solid var(--border); border-radius: var(--radius-panel);
  background: var(--card); box-shadow: var(--shadow-dropdown);
  animation: dpIn .14s ease-out;
}
@keyframes dpIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
.dp-toolbar { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
.dp-month { flex: 1; font-size: 13px; color: var(--ink); }
.dp-nav { width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center; border: 0; border-radius: var(--radius-control); background: var(--subtle); color: var(--muted); cursor: pointer; }
.dp-nav:hover { background: var(--primary-tint); }
.dp-today { border: 0; background: transparent; color: var(--primary-dark); font-size: 11px; font-weight: 600; cursor: pointer; }
.dp-version { margin-bottom: 6px; color: var(--muted); font-size: 10px; }
.dp-error { margin: 0 0 6px; color: var(--danger-text); font-size: 10px; }
.dp-weekdays { display: grid; grid-template-columns: repeat(7, minmax(0,1fr)); gap: 4px; margin-bottom: 4px; }
.dp-weekdays span { text-align: center; font-size: 10px; font-weight: 600; color: var(--muted); }
.dp-grid { display: grid; gap: 4px; }
.dp-grid-row { display: grid; grid-template-columns: repeat(7, minmax(0,1fr)); gap: 4px; }
.dp-cell {
  position: relative; height: 36px; display: flex; align-items: center; justify-content: center;
  border: 1px solid transparent; border-radius: var(--radius-control); background: transparent;
  color: var(--text); font-size: 11px; font-weight: 600; cursor: pointer;
}
.dp-cell:hover:not(:disabled) { background: var(--subtle); }
.dp-cell.outside { color: var(--muted); opacity: .7; }
.dp-cell.weekend:not(.outside) { color: var(--muted); }
.dp-cell.has-marker { background: var(--dp-marker-soft); color: var(--dp-marker-color); border-color: var(--dp-marker-color); }
.dp-cell.today { border-color: var(--primary); }
.dp-cell.selected { background: var(--primary); color: var(--on-dark); border-color: var(--primary); }
.dp-cell.disabled { opacity: .35; cursor: not-allowed; }
.dp-cell-day { line-height: 1; }
.dp-marker-dot { position: absolute; bottom: 3px; left: 50%; transform: translateX(-50%); width: 4px; height: 4px; border-radius: 50%; background: var(--dp-marker-color); }
.dp-cell.selected .dp-marker-dot { background: var(--on-dark); }
.dp-legend { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--divider); }
.dp-legend-item { display: inline-flex; align-items: center; gap: 4px; font-size: 10px; color: var(--muted); }
.dp-legend-item i { width: 7px; height: 7px; border-radius: 2px; }
.dp-hint { margin-top: 8px; color: var(--muted); font-size: 10px; }
</style>
