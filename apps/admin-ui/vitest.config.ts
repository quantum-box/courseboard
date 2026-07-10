import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const srcDir = fileURLToPath(new URL('./src', import.meta.url))

export default defineConfig({
	esbuild: {
		jsx: 'automatic',
	},
	resolve: {
		alias: {
			app: `${srcDir}/app`,
			components: `${srcDir}/components`,
			gen: `${srcDir}/gen`,
			lib: `${srcDir}/lib`,
		},
	},
	test: {
		environment: 'node',
		globals: true,
		include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
	},
})
