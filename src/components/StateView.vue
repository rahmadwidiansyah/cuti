<script setup>
import { computed } from 'vue'
import { AlertTriangle, Inbox, Loader2 } from 'lucide-vue-next'

const props = defineProps({
  state: { type: String, default: 'empty' },
  title: { type: String, default: '' },
  description: { type: String, default: '' },
  actionLabel: { type: String, default: '' },
})
const emit = defineEmits(['action'])

const icon = computed(() => ({
  loading: Loader2,
  error: AlertTriangle,
  empty: Inbox,
})[props.state] || Inbox)
</script>

<template>
  <section class="state-view" :class="`state-view-${state}`" :role="state === 'error' ? 'alert' : 'status'">
    <component :is="icon" :size="22" aria-hidden="true" :class="{ 'state-spin': state === 'loading' }" />
    <div>
      <strong v-if="title">{{ title }}</strong>
      <p v-if="description">{{ description }}</p>
      <button v-if="actionLabel" class="button button-secondary button-small" type="button" @click="emit('action')">
        {{ actionLabel }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.state-view {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 28px 20px;
  border: 1px dashed var(--line);
  border-radius: var(--radius-panel);
  background: var(--canvas);
  color: var(--text);
}
.state-view > svg { flex: 0 0 auto; margin-top: 2px; color: var(--muted); }
.state-view strong { display: block; color: var(--ink); font-size: 13px; }
.state-view p { margin: 4px 0 0; color: var(--muted); font-size: 12px; line-height: 1.5; }
.state-view .button { margin-top: 10px; }
.state-view-error { border-color: var(--danger-border); background: var(--danger-bg); }
.state-view-error > svg { color: var(--danger-text); }
.state-view-error strong { color: var(--danger-text); }
.state-view-error p { color: var(--danger-text); }
.state-spin { animation: state-spin 1s linear infinite; }
@keyframes state-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .state-spin { animation: none; } }
</style>
