import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const host = process.env.TAURI_DEV_HOST
const apiProxyTarget = process.env.VITE_DEV_API_PROXY_TARGET ?? 'http://127.0.0.1:8080'
const authProxyTarget = process.env.VITE_AUTH_PROXY_TARGET

export default defineConfig({
  plugins: [react()],
  // Relative assets work unchanged from Axum's /ui mount, Tauri's custom
  // protocol, and iOS/Android WebViews.
  base: process.env.VITE_BASE_PATH ?? './',
  clearScreen: false,
  server: {
    host: host || false,
    port: 5173,
    strictPort: true,
    hmr: host ? { protocol: 'ws', host, port: 5174 } : undefined,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
    proxy: {
      '/field-api': apiProxyTarget,
      '/cancellation-fee-collections': apiProxyTarget,
      '/public/cancellation-fees': apiProxyTarget,
      ...(authProxyTarget ? {
        '/api/auth': authProxyTarget,
        '/api/tenant-name': authProxyTarget,
        '/auth': authProxyTarget,
      } : {}),
    },
  },
})
