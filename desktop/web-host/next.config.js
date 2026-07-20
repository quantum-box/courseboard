import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const appDir = import.meta.dirname

const isCloudflarePagesBuild =
	process.env.DEPLOYMENT_TARGET === 'cloudflare_pages' ||
	process.env.DEPLOYMENT_TARGET === 'cloudflare_workers' ||
	process.env.TACHYON_DEPLOYMENT_TARGET === 'cloudflare_pages' ||
	process.env.TACHYON_DEPLOYMENT_TARGET === 'cloudflare_workers' ||
	process.env.CF_PAGES === '1' ||
	process.env.VERCEL === '1'

const enableSentryNextjs =
	process.env.ENABLE_SENTRY_NEXTJS === 'true' ||
	Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN)
const tachyonFieldApiUrl =
	process.env.TACHYON_FIELD_API_URL ||
	process.env.BACKEND_API_URL ||
	process.env.NEXT_PUBLIC_BACKEND_API_URL ||
	process.env.VITE_PHOTON_API_BASE_URL
const browserBackendApiUrl =
	process.env.NEXT_PUBLIC_BACKEND_API_URL || tachyonFieldApiUrl

/** @type {import('next').NextConfig} */
const nextConfig = {
	experimental: {
		instrumentationHook: true,
		serverActions: {
			allowedOrigins: ['courseboard.txcloud.app', '*.txcloud.app'],
		},
	},
	transpilePackages: [
		'awesome_module',
		'@tachyon-sdk/agent',
		'@tachyon-sdk/agent-chat',
	],
	eslint: {
		ignoreDuringBuilds: true,
	},
	env: tachyonFieldApiUrl
		? {
				TACHYON_FIELD_API_URL: tachyonFieldApiUrl,
				BACKEND_API_URL: tachyonFieldApiUrl,
				NEXT_PUBLIC_BACKEND_API_URL: browserBackendApiUrl,
				VITE_PHOTON_API_BASE_URL: tachyonFieldApiUrl,
			}
		: undefined,
	async rewrites() {
		return {
			beforeFiles: [
				// Cognito Hosted UI PKCEのコールバック。React SPAをこのパスのまま
				// 配信し、SPA側がcode/stateクエリを処理する（Auth.js非依存）。
				{
					source: '/oauth/callback',
					destination: '/courseboard-ui/index.html',
				},
				{ source: '/sandbox', destination: '/?_mode=sandbox' },
				{
					source: '/sandbox/:path*',
					destination: '/:path*?_mode=sandbox',
				},
			],
		}
	},
	images: {
		loader: 'custom',
		loaderFile: './src/image-loader.ts',
	},
}

if (!isCloudflarePagesBuild) {
	nextConfig.output = 'standalone'
	nextConfig.experimental = {
		...nextConfig.experimental,
		outputFileTracingRoot: path.join(appDir, '../../'),
	}
}

const sentryOptions = {
	silent: true,
	webpack: {
		treeshake: {
			removeDebugLogging: true,
		},
		automaticVercelMonitors: false,
	},
}

export default enableSentryNextjs
	? require('@sentry/nextjs').withSentryConfig(nextConfig, sentryOptions)
	: nextConfig
