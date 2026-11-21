<script setup>
import { Menu, Search } from 'lucide-vue-next'

defineProps({
  roleLabel: { type: String, default: 'Pegawai' },
  search: { type: String, default: '' },
  searchPlaceholder: { type: String, default: 'Cari pengajuan, nama pegawai, atau nomor cuti…' },
})
const emit = defineEmits(['menu', 'update:search', 'submit-search'])
</script>

<template>
  <header class="topbar">
    <button class="topbar-menu" type="button" aria-label="Buka menu navigasi" @click="emit('menu')">
      <Menu :size="20" aria-hidden="true" />
    </button>
    <div class="topbar-brand-cell">
      <div class="brand-lockup">
        <span class="brand-mark" aria-hidden="true">TU</span>
        <span class="brand-copy"><strong>TU DIGITAL</strong><small>{{ roleLabel }}</small></span>
      </div>
    </div>
    <div class="topbar-main">
      <form class="topbar-search" role="search" @submit.prevent="emit('submit-search')">
        <Search :size="15" aria-hidden="true" />
        <input
          :value="search"
          type="search"
          :placeholder="searchPlaceholder"
          :aria-label="searchPlaceholder"
          @input="emit('update:search', $event.target.value)"
        />
      </form>
      <div class="topbar-right">
        <slot name="right" />
      </div>
    </div>
  </header>
</template>

<style scoped>
.topbar-menu {
  display: none;
  width: 44px;
  height: 44px;
  flex: 0 0 auto;
  place-items: center;
  border: 0;
  border-radius: var(--radius-control);
  background: transparent;
  color: var(--on-dark-muted);
  cursor: pointer;
}
.topbar-menu:hover { background: rgb(255 255 255 / 10%); color: var(--on-dark); }
.topbar-menu:focus-visible { outline: 2px solid var(--on-dark); outline-offset: 2px; }

@media (max-width: 1024px) {
  .topbar-menu { display: grid; }
}
</style>
