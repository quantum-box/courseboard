import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ command, mode }) => {
  // Vite exposes .env files to application code automatically, but config-time
  // proxy targets must be loaded explicitly.
  const env = loadEnv(mode, process.cwd(), '')
  const host = env.TAURI_DEV_HOST
  const apiProxyTarget = env.VITE_DEV_API_PROXY_TARGET ?? 'http://127.0.0.1:8080'

  return {
    plugins: [react()],
    // Relative assets work unchanged from Tauri's custom protocol and
    // iOS/Android WebViews — those load `index.html` off disk and route in the
    // hash, so nothing ever asks for a deeper path.
    //
    // The dev server is the opposite case: it routes on the path, and from
    // `/tn_x/golf/ledger` a relative `./src/main.tsx` is a file that is not
    // there. Anything served over HTTP therefore needs an absolute base —
    // `/` here, `VITE_BASE_PATH` for a mount that is not the root.
    base: env.VITE_BASE_PATH ?? (command === 'serve' ? '/' : './'),
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
        '/v1/me': { target: apiProxyTarget, changeOrigin: true },
        '/v1/course': { target: apiProxyTarget, changeOrigin: true },
        '/cancellation-fee-collections': { target: apiProxyTarget, changeOrigin: true },
        '/public/cancellation-fees': { target: apiProxyTarget, changeOrigin: true },
      },
    },
  }
})
