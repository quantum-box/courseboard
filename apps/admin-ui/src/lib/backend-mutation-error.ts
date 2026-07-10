const MAX_BACKEND_ERROR_DETAIL_LENGTH = 700

export type BackendMutationFailure = {
	status: number
	message: string
	detail?: string
}

export async function backendMutationFailureFromResponse(
	response: Response,
	fallbackMessage: string,
): Promise<BackendMutationFailure> {
	const body = await response.text().catch(() => '')
	const detail = extractBackendErrorDetail(body)
	const status = response.status
	const statusLabel = Number.isFinite(status) ? `HTTP ${status}` : 'HTTP error'

	return {
		status,
		detail,
		message: detail
			? `${fallbackMessage} (${statusLabel}): ${detail}`
			: `${fallbackMessage} (${statusLabel})`,
	}
}

export function extractBackendErrorDetail(body: string): string | undefined {
	const trimmed = trimErrorDetail(body)
	if (!trimmed) return undefined

	try {
		const parsed = JSON.parse(trimmed) as unknown
		return trimErrorDetail(extractJsonErrorDetail(parsed) ?? trimmed)
	} catch {
		return trimmed
	}
}

function extractJsonErrorDetail(value: unknown): string | undefined {
	if (!value || typeof value !== 'object') return asDisplayString(value)

	if (Array.isArray(value)) {
		return value.map(extractJsonErrorDetail).filter(Boolean).join('; ')
	}

	const record = value as Record<string, unknown>
	for (const key of [
		'message',
		'error',
		'detail',
		'details',
		'provider_error',
		'providerError',
		'body',
	]) {
		const detail = extractJsonErrorDetail(record[key])
		if (detail) return detail
	}

	return JSON.stringify(value)
}

function asDisplayString(value: unknown): string | undefined {
	if (typeof value === 'string') return value
	if (typeof value === 'number' || typeof value === 'boolean') {
		return String(value)
	}
	return undefined
}

function trimErrorDetail(value?: string): string | undefined {
	const trimmed = value?.replace(/\s+/g, ' ').trim()
	if (!trimmed) return undefined
	return trimmed.slice(0, MAX_BACKEND_ERROR_DETAIL_LENGTH)
}
