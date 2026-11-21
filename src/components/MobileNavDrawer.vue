<script setup>
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { CircleHelp, LogOut, Search, UserRound, X } from 'lucide-vue-next'

const props = defineProps({
  open: { type: Boolean, default: false },
  items: { type: Array, default: () => [] },
  active: { type: String, default: '' },
  roleLabel: { type: String, default: 'Pegawai' },
  userInitial: { type: String, default: 'U' },
  year: { type: Number, default: () => new Date().getFullYear() },
  badgeFor: { type: Function, default: null },
  search: { type: String, default: '' },
})
const emit = defineEmits(['close', 'navigate', 'profile', 'guide', 'signout', 'update:search', 'submit-search'])

const panelRef = ref(null)
let lastFocused = null

watch(() => props.open, async (open) => {
  if (open) {
    lastFocused = document.activeElement
    document.body.style.overflow = 'hidden'
    await nextTick()
    panelRef.value?.querySelector('button')?.focus()
  } else {
    document.body.style.overflow = ''
    lastFocused?.focus?.()
  }
})

function onKeydown(event) {
  if (!props.open) return
  if (event.key === 'Escape') {
    emit('close')
    return
  }
  if (event.key !== 'Tab' || !panelRef.value) return
  const focusable = [...panelRef.value.querySelectorAll('button, input')]
  if (!focusable.length) return
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  document.body.style.overflow = ''
})

function go(item) {
  emit('navigate', item)
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <Transition name="drawer">
      <div v-if="open" class="nav-drawer-root">
        <div class="nav-scrim" aria-hidden="true" @click="emit('close')"></div>
        <aside
          ref="panelRef"
          class="nav-drawer"
          role="dialog"
          aria-modal="true"
          aria-label="Navigasi modul cuti"
        >
          <header class="nav-drawer-head">
            <span class="nav-drawer-mark" aria-hidden="true">TU</span>
            <span class="nav-drawer-title">
              <strong>TU DIGITAL</strong>
              <small>Menu pengajuan cuti</small>
            </span>
            <span class="nav-drawer-avatar" aria-hidden="true">{{ userInitial }}</span>
            <button class="nav-drawer-close" type="button" aria-label="Tutup menu" @click="emit('close')">
              <X :size="18" aria-hidden="true" />
            </button>
          </header>

          <p class="nav-drawer-label">MODUL CUTI</p>
          <div class="nav-drawer-module">
            <span>{{ roleLabel }}</span>
            <small>Tahun {{ year }}</small>
          </div>

          <form class="nav-drawer-search" role="search" @submit.prevent="emit('submit-search')">
            <Search :size="15" aria-hidden="true" />
            <input
              :value="props.search"
              type="search"
              placeholder="Cari pengajuan atau nomor cuti…"
              aria-label="Cari pengajuan, nama pegawai, atau nomor cuti"
              @input="emit('update:search', $event.target.value)"
            />
          </form>

          <nav class="nav-drawer-nav" aria-label="Menu utama">
            <button
              v-for="item in items"
              :key="item.view"
              type="button"
              :class="{ active: active === item.view }"
              :aria-current="active === item.view ? 'page' : undefined"
              @click="go(item)"
            >
              <component :is="item.icon" :size="18" aria-hidden="true" />
              <span>{{ item.text }}</span>
              <span v-if="badgeFor?.(item.view)" class="nav-drawer-count">{{ badgeFor(item.view) }}</span>
            </button>
          </nav>

          <div class="nav-drawer-foot">
            <button type="button" @click="emit('profile'); emit('close')">
              <UserRound :size="16" aria-hidden="true" /> Profil
            </button>
            <button type="button" @click="emit('guide'); emit('close')">
              <CircleHelp :size="16" aria-hidden="true" /> Panduan cuti
            </button>
            <button class="nav-drawer-signout" type="button" @click="emit('signout'); emit('close')">
              <LogOut :size="16" aria-hidden="true" /> Keluar
            </button>
            <small>Modul cuti · v1.0 · {{ year }}</small>
          </div>
        </aside>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.nav-drawer-root {
  position: fixed;
  inset: 0;
  z-index: 60;
}
.nav-scrim {
  position: absolute;
  inset: 0;
  background: rgb(20 47 58 / 50%);
}
.nav-drawer {
  position: relative;
  display: flex;
  flex-direction: column;
  width: var(--drawer-w);
  max-width: 86vw;
  height: 100%;
  background: var(--card);
  box-shadow: 8px 0 32px rgb(20 47 58 / 18%);
  overflow-y: auto;
}
.nav-drawer-head {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 76px;
  padding: 12px 10px 12px 16px;
  background: var(--ink);
  color: var(--on-dark);
}
.nav-drawer-mark {
  display: grid;
  width: 36px;
  height: 36px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 10px;
  background: var(--primary);
  color: var(--on-dark);
  font-size: 12px;
  font-weight: 700;
}
.nav-drawer-title {
  display: grid;
  gap: 2px;
  min-width: 0;
  overflow: hidden;
}
.nav-drawer-title strong,
.nav-drawer-title small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nav-drawer-title strong { font-size: 14px; letter-spacing: .02em; }
.nav-drawer-title small { color: var(--on-dark-faint); font-size: 10px; }
.nav-drawer-avatar {
  display: grid;
  width: 32px;
  height: 32px;
  margin-left: auto;
  place-items: center;
  border-radius: 50%;
  background: var(--primary);
  color: var(--on-dark);
  font-size: 11px;
  font-weight: 600;
}
.nav-drawer-close {
  display: grid;
  width: 32px;
  height: 32px;
  flex: 0 0 auto;
  place-items: center;
  border: 0;
  border-radius: var(--radius-control);
  background: transparent;
  color: var(--on-dark-muted);
  cursor: pointer;
}
.nav-drawer-close:hover { background: rgb(255 255 255 / 10%); color: var(--on-dark); }

.nav-drawer-label {
  margin: 18px 20px 6px;
  color: var(--muted);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: .08em;
}
.nav-drawer-module {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin: 0 16px 12px;
  padding: 10px 12px;
  border: 1px solid var(--info-border);
  border-radius: 10px;
  background: var(--primary-tint);
  color: var(--ink);
  font-size: 11px;
  font-weight: 600;
}
.nav-drawer-module small { color: var(--muted); font-size: 10px; font-weight: 500; }

.nav-drawer-search {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  margin: 0 16px 12px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  background: var(--canvas);
  color: var(--muted);
}
.nav-drawer-search input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  color: var(--text);
  font-size: 13px;
}
.nav-drawer-search input:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}

.nav-drawer-nav {
  display: grid;
  gap: 4px;
  padding: 0 12px;
}
.nav-drawer-nav button {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 46px;
  padding: 0 12px;
  border: 0;
  border-radius: var(--radius-control);
  background: transparent;
  color: var(--text);
  font-size: 13px;
  font-weight: 500;
  text-align: left;
  cursor: pointer;
}
.nav-drawer-nav button svg { flex: 0 0 auto; color: var(--muted); }
.nav-drawer-nav button > span:first-of-type { flex: 1; min-width: 0; }
.nav-drawer-nav button:hover { background: var(--subtle); }
.nav-drawer-nav button.active {
  background: var(--primary-soft);
  color: var(--primary-dark);
  font-weight: 600;
  box-shadow: inset 3px 0 0 var(--primary);
}
.nav-drawer-nav button.active svg { color: var(--primary); }
.nav-drawer-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 18px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--primary);
  color: var(--on-dark);
  font-size: 10px;
  font-weight: 600;
}

.nav-drawer-foot {
  display: grid;
  gap: 4px;
  margin-top: auto;
  padding: 16px 12px calc(20px + env(safe-area-inset-bottom));
  border-top: 1px solid var(--border);
}
.nav-drawer-foot button {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  padding: 0 12px;
  border: 0;
  border-radius: var(--radius-control);
  background: transparent;
  color: var(--text);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.nav-drawer-foot button:hover { background: var(--subtle); }
.nav-drawer-signout { color: var(--primary-dark); font-weight: 600; }
.nav-drawer-foot small {
  margin: 8px 12px 0;
  color: var(--muted);
  font-size: 10px;
}

.drawer-enter-active,
.drawer-leave-active { transition: opacity .18s ease; }
.drawer-enter-active .nav-drawer,
.drawer-leave-active .nav-drawer { transition: transform .18s ease; }
.drawer-enter-from,
.drawer-leave-to { opacity: 0; }
.drawer-enter-from .nav-drawer,
.drawer-leave-to .nav-drawer { transform: translateX(-100%); }

@media (prefers-reduced-motion: reduce) {
  .drawer-enter-active,
  .drawer-leave-active,
  .drawer-enter-active .nav-drawer,
  .drawer-leave-active .nav-drawer { transition: none; }
}
</style>
