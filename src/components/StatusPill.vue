<script setup>
import { computed } from 'vue'
import { statusLabel, statusTone } from '../status.js'

const props = defineProps({
  status: { type: String, default: '' },
  label: { type: String, default: '' },
})

const tone = computed(() => `tone-${statusTone(props.status)}`)
const label = computed(() => props.label || statusLabel(props.status))
</script>

<template>
  <span class="status-badge" :class="tone">{{ label }}</span>
</template>
