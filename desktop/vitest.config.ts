import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    setupFiles: ['./src/test/setup.ts'],
    exclude: [
      'node_modules/**',
      'dist/**',
      'src-tauri/**',
      // Playwright の E2E は vitest では拾わない
      'e2e/**',
    ],
  },
})
