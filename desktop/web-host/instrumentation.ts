export async function register() {
	if (process.env.NEXT_RUNTIME === 'nodejs') {
		await import('./sentry.server.config')
	}
}

export async function onRequestError(...args: Parameters<typeof import('@sentry/nextjs').captureRequestError>) {
	if (process.env.NEXT_RUNTIME === 'edge') {
		return
	}

	const Sentry = await import('@sentry/nextjs')
	return Sentry.captureRequestError(...args)
}
