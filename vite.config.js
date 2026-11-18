import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  server: {
    // 0.0.0.0 agar bisa dijangkau dari container Cloudflare Tunnel / jaringan LAN
    host: '0.0.0.0',
    // Terima request dengan Host header dari domain Cloudflare Tunnel
    allowedHosts: true,
    proxy: {
      '/api': 'http://127.0.0.1:3001',
    },
  },
})
