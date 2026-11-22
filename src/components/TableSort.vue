<script setup>
import { computed } from 'vue'
import { ArrowDown, ArrowUp } from 'lucide-vue-next'
import { directionLabel } from '../sort.js'

const props = defineProps({
  sortBy: { type: String, default: 'submittedAt' },
  sortDir: { type: String, default: 'desc' },
  options: { type: Array, required: true },
})
const emit = defineEmits(['update:sortBy', 'update:sortDir'])

const label = computed(() => directionLabel(props.sortBy, props.sortDir))
</script>

<template>
  <div class="ts-control">
    <label class="ts-select">
      <span class="sr-only">Urutkan berdasarkan</span>
      <select
        :value="sortBy"
        aria-label="Urutkan berdasarkan"
        @change="emit('update:sortBy', $event.target.value)"
      >
        <option v-for="option in options" :key="option.value" :value="option.value">{{ option.label }}</option>
      </select>
    </label>
    <button
      class="ts-direction"
      type="button"
      :aria-label="`Arah pengurutan: ${label}. Klik untuk membalik.`"
      @click="emit('update:sortDir', sortDir === 'desc' ? 'asc' : 'desc')"
    >
      <ArrowDown v-if="sortDir === 'desc'" :size="13" aria-hidden="true" />
      <ArrowUp v-else :size="13" aria-hidden="true" />
      <span>{{ label }}</span>
    </button>
  </div>
</template>

<style scoped>
.ts-control { display: inline-flex; align-items: center; gap: 6px; }
.ts-select select {
  height: 40px;
  padding: 0 30px 0 10px;
  border: 1px solid var(--control-border);
  border-radius: var(--radius-control);
  background: var(--card);
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
}
.ts-direction {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 40px;
  padding: 0 10px;
  border: 1px solid var(--control-border);
  border-radius: var(--radius-control);
  background: var(--card);
  color: var(--text);
  font-size: 11px;
  white-space: nowrap;
  cursor: pointer;
}
.ts-direction:hover { background: var(--subtle); }
@media (max-width: 700px) {
  .ts-control { width: 100%; }
  .ts-select { flex: 1 1 auto; min-width: 0; }
  .ts-select select { width: 100%; }
}
</style>
