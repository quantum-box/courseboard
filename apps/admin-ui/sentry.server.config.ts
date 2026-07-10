import * as Sentry from '@sentry/nextjs'

const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN

if (dsn) {
	Sentry.init({
		dsn,
		environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
		release:
			process.env.VERCEL_GIT_COMMIT_SHA ??
			process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA,
		sendDefaultPii: false,
		tracesSampleRate: 0.05,
		debug: false,
	})
}
