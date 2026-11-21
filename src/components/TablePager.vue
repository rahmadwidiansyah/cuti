<script setup>
// Pager tabel bersama: < 1 2 3 … 10 > — halaman pertama/terakhir selalu ada,
// jendela 3 angka di sekitar halaman aktif (diperluas dekat tepi), elipsis di celah.
import { computed } from 'vue'
import { ChevronLeft, ChevronRight } from 'lucide-vue-next'

const props = defineProps({
  page: { type: Number, default: 0 }, // 0-based
  total: { type: Number, default: 0 },
  pageSize: { type: Number, default: 25 },
  label: { type: String, default: 'entri' },
})
const emit = defineEmits(['change'])

const totalPages = computed(() => Math.max(1, Math.ceil(Number(props.total) / Math.max(1, props.pageSize))))
const firstShown = computed(() => (props.total ? props.page * props.pageSize + 1 : 0))
const lastShown = computed(() => Math.min((props.page + 1) * props.pageSize, props.total))

const pageItems = computed(() => {
  const current = props.page + 1
  const total = totalPages.value
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  let start = Math.min(Math.max(current - 1, 2), total - 2)
  let end = Math.min(Math.max(current + 1, start + 1), total - 1)
  // Dekat tepi awal: 1 2 3 … (tanpa elipsis untuk satu halaman hilang)
  if (start <= 3) { start = 2; end = Math.max(end, 3) }
  // Dekat tepi akhir: … 8 9 10
  if (end >= total - 3) { end = total - 1; start = Math.min(start, total - 3) }
  const items = [1]
  if (start > 2) items.push('…')
  for (let p = start; p <= end; p += 1) items.push(p)
  if (end < total - 1) items.push('…')
  items.push(total)
  return items
})

function goTo(n) {
  const target = Math.min(Math.max(n, 0), totalPages.value - 1)
  if (target !== props.page) emit('change', target)
}
</script>

<template>
  <footer class="tp">
    <span>Menampilkan {{ firstShown }}-{{ lastShown }} dari {{ total }} {{ label }}</span>
    <div class="tp-pages">
      <button class="tp-button" type="button" aria-label="Halaman sebelumnya" :disabled="page === 0" @click="goTo(page - 1)">
        <ChevronLeft :size="14" aria-hidden="true" />
      </button>
      <template v-for="(item, i) in pageItems" :key="`${item}-${i}`">
        <span v-if="item === '…'" class="tp-gap" aria-hidden="true">…</span>
        <button
          v-else
          class="tp-button"
          :class="{ active: page === item - 1 }"
          type="button"
          :aria-label="`Halaman ${item}`"
          :aria-current="page === item - 1 ? 'page' : undefined"
          @click="goTo(item - 1)"
        >{{ item }}</button>
      </template>
      <button class="tp-button" type="button" aria-label="Halaman berikutnya" :disabled="page >= totalPages - 1" @click="goTo(page + 1)">
        <ChevronRight :size="14" aria-hidden="true" />
      </button>
    </div>
  </footer>
</template>

<style scoped>
.tp {
  display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
  padding: 12px 20px; color: var(--muted); font-size: 11px;
}
.tp-pages { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.tp-gap { min-width: 20px; text-align: center; color: var(--muted); }
.tp-button {
  min-width: 28px; height: 28px; padding: 0 6px;
  border: 0; border-radius: var(--radius-control); background: transparent;
  color: var(--muted); font-size: 11px; cursor: pointer;
}
.tp-button.active { background: var(--primary-soft); color: var(--primary-dark); font-weight: 600; }
.tp-button:hover:not(:disabled):not(.active) { background: var(--subtle); }
.tp-button:disabled { opacity: 0.45; cursor: not-allowed; }
@media (max-width: 700px) {
  .tp { flex-direction: column; align-items: flex-start; }
}
</style>
