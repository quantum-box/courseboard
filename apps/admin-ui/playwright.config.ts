import { defineConfig, devices } from '@playwright/test'

const slowMo = Number(process.env.PLAYWRIGHT_SLOW_MO_MS ?? 0)

export default defineConfig({
	testDir: './e2e',
	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	retries: 2,
	workers: 1,
	reporter: [['list'], ['html', { open: 'never' }]],
	timeout: 30_000,
	use: {
		baseURL:
			process.env.TACHYON_FIELD_ADMIN_URL || process.env.FIELD_ADMIN_URL ||
			process.env.FIELD_ADMIN_UI_URL ||
			'https://fieldadmin.txcloud.app',
		trace: 'on-first-retry',
		screenshot: 'only-on-failure',
		launchOptions: slowMo > 0 ? { slowMo } : undefined,
	},
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] },
		},
	],
})
