import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    exclude: [
      'web-host/**',
      'node_modules/**',
      'dist/**',
      'src-tauri/**',
    ],
  },
})
