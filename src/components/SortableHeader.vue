<script setup>
import { computed } from 'vue'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-vue-next'
import { defaultDirectionFor, directionLabel } from '../sort.js'

const props = defineProps({
  column: { type: String, required: true },
  label: { type: String, required: true },
  sortBy: { type: String, required: true },
  sortDir: { type: String, required: true },
})
const emit = defineEmits(['sort'])

const active = computed(() => props.sortBy === props.column)
const ariaSort = computed(() => {
  if (!active.value) return 'none'
  return props.sortDir === 'asc' ? 'ascending' : 'descending'
})
const nextDir = computed(() => (
  active.value
    ? (props.sortDir === 'asc' ? 'desc' : 'asc')
    : defaultDirectionFor(props.column)
))
const hint = computed(() => directionLabel(props.column, nextDir.value))

function onClick() {
  emit('sort', { by: props.column, dir: nextDir.value })
}
</script>

<template>
  <th scope="col" :aria-sort="ariaSort">
    <button
      class="sortable-head"
      :class="{ active }"
      type="button"
      :aria-label="`Urutkan berdasarkan ${label}, ${hint}`"
      :title="`Urutkan berdasarkan ${label}, ${hint}`"
      @click="onClick"
    >
      <span>{{ label }}</span>
      <ArrowUp v-if="active && sortDir === 'asc'" :size="12" aria-hidden="true" />
      <ArrowDown v-else-if="active" :size="12" aria-hidden="true" />
      <ArrowUpDown v-else :size="12" aria-hidden="true" />
    </button>
  </th>
</template>

<style scoped>
.sortable-head {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 32px;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  letter-spacing: inherit;
  text-transform: inherit;
  text-align: left;
  cursor: pointer;
}
.sortable-head svg { flex: 0 0 auto; opacity: 0.45; }
.sortable-head:hover { color: var(--ink); }
.sortable-head:hover svg,
.sortable-head.active svg { opacity: 1; }
.sortable-head.active { color: var(--primary); }
.sortable-head:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; border-radius: 3px; }
@media (max-width: 700px) {
  .sortable-head { min-height: 44px; }
}
</style>
