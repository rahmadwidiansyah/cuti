<script setup>
defineProps({
  counts: { type: Object, required: true },
  active: { type: String, default: 'pending' },
})
const emit = defineEmits(['change'])

const tabs = [
  { key: 'pending', label: 'Menunggu keputusan', countKey: 'pending' },
  { key: 'approved', label: 'Disetujui', countKey: 'approved' },
  { key: 'rejected', label: 'Tidak disetujui', countKey: 'rejected' },
]
</script>

<template>
  <div class="status-tabs" role="tablist" aria-label="Filter status keputusan">
    <button
      v-for="tab in tabs"
      :key="tab.key"
      class="status-tab"
      :class="{ active: active === tab.key }"
      type="button"
      role="tab"
      :aria-selected="active === tab.key"
      @click="emit('change', tab.key)"
    >
      {{ tab.label }} <span>{{ counts[tab.countKey] || 0 }}</span>
    </button>
  </div>
</template>

<style scoped>
.status-tabs {
  display: flex;
  align-items: center;
  gap: 24px;
  border-bottom: 1px solid #e1e9f1;
  overflow-x: auto;
}
.status-tab {
  height: 40px;
  padding: 0 0 10px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: #5a6f78;
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
}
.status-tab span { margin-left: 4px; font-size: 11px; font-weight: 600; }
.status-tab.active { border-bottom-color: #0d6efd; color: #0d6efd; font-weight: 600; }
.status-tab.active span { color: #0d6efd; }
.status-tab:hover:not(.active) { color: #142f3a; }
</style>
