<script setup>
defineProps({
  label: { type: String, required: true },
  value: { type: String, required: true },
  caption: { type: String, required: true },
  tone: { type: String, default: 'neutral' },
})
</script>

<template>
  <article class="metric-card" :class="`metric-${tone}`">
    <div><p>{{ label }}</p><strong>{{ value }}</strong><small>{{ caption }}</small></div>
  </article>
</template>
