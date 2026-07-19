import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export function authProxy(target: string) {
  return { target, changeOrigin: false }
}

export default defineConfig(({ mode }) => {
  // Vite exposes .env files to application code automatically, but config-time
  // proxy targets must be loaded explicitly.
  const env = loadEnv(mode, process.cwd(), '')
  const host = env.TAURI_DEV_HOST
  const apiProxyTarget = env.VITE_DEV_API_PROXY_TARGET ?? 'http://127.0.0.1:8080'
  const authProxyTarget = env.VITE_AUTH_PROXY_TARGET

  return {
    plugins: [react()],
    // Relative assets work unchanged from Axum's /ui mount, Tauri's custom
    // protocol, and iOS/Android WebViews.
    base: env.VITE_BASE_PATH ?? './',
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
        '/field-api': { target: apiProxyTarget, changeOrigin: true },
        '/v1/course': { target: apiProxyTarget, changeOrigin: true },
        '/cancellation-fee-collections': { target: apiProxyTarget, changeOrigin: true },
        '/public/cancellation-fees': { target: apiProxyTarget, changeOrigin: true },
        ...(authProxyTarget ? {
          // Auth.js derives redirect_uri and cookie origin from the incoming
          // host. Preserve 127.0.0.1:5173 so Cognito returns through Vite and
          // the resulting HttpOnly cookie belongs to the UI origin.
          '/api/auth': authProxy(authProxyTarget),
          '/api/tenant-name': authProxy(authProxyTarget),
          '/auth': authProxy(authProxyTarget),
        } : {}),
      },
    },
  }
})
