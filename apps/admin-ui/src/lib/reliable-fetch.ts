export type FetchFailureKind =
	| 'unauthenticated'
	| 'forbidden'
	| 'rate_limited'
	| 'server_error'
	| 'network'
	| 'invalid_response'
	| 'unknown'

export type FetchFailure = {
	kind: FetchFailureKind
	status?: number
	message: string
	retryable: boolean
	attempts: number
	body?: string
}

export type FetchResult<T> =
	| { ok: true; data: T; response: Response; attempts: number }
	| { ok: false; error: FetchFailure }

type FetchWithRetryOptions = RequestInit & {
	retries?: number
	backoffMs?: number
	fetcher?: typeof fetch
	parseJson?: boolean
	onNonOkResponse?: (event: {
		attempt: number
		body: string
		headers: Headers
		status: number
		url: string
	}) => void
}

const DEFAULT_RETRIES = 2
const DEFAULT_BACKOFF_MS = 150
const MAX_ERROR_BODY_LENGTH = 500

export class ReliableFetchError extends Error {
	readonly failure: FetchFailure

	constructor(failure: FetchFailure) {
		super(failure.message)
		this.name = 'ReliableFetchError'
		this.failure = failure
	}
}

export async function fetchJsonWithRetry<T>(
	url: string,
	options: FetchWithRetryOptions = {},
): Promise<FetchResult<T>> {
	const result = await fetchWithRetry(url, options)
	if (!result.ok) {
		return result
	}

	if (options.parseJson === false) {
		return result as FetchResult<T>
	}

	try {
		return {
			ok: true,
			data: (await result.response.json()) as T,
			response: result.response,
			attempts: result.attempts,
		}
	} catch {
		return {
			ok: false,
			error: {
				kind: 'invalid_response',
				status: result.response.status,
				message: 'レスポンスの形式が不正です',
				retryable: false,
				attempts: result.attempts,
			},
		}
	}
}

export async function fetchWithRetry(
	url: string,
	options: FetchWithRetryOptions = {},
): Promise<
	| { ok: true; response: Response; attempts: number }
	| { ok: false; error: FetchFailure }
> {
	const {
		retries = DEFAULT_RETRIES,
		backoffMs = DEFAULT_BACKOFF_MS,
		fetcher = fetch,
		onNonOkResponse,
		...init
	} = options
	const maxAttempts = Math.max(1, retries + 1)
	let lastFailure: FetchFailure | undefined

	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			const response = await fetcher(url, init)
			if (response.ok) {
				return { ok: true, response, attempts: attempt }
			}

			const body = await response.text().catch(() => '')
			onNonOkResponse?.({
				attempt,
				body,
				headers: response.headers,
				status: response.status,
				url,
			})
			const failure = classifyHttpFailure(response.status, body, attempt)
			if (!failure.retryable || attempt === maxAttempts) {
				return { ok: false, error: failure }
			}
			lastFailure = failure
		} catch (error) {
			const failure = classifyNetworkFailure(error, attempt)
			if (attempt === maxAttempts) {
				return { ok: false, error: failure }
			}
			lastFailure = failure
		}

		await wait(backoffMs * attempt)
	}

	return {
		ok: false,
		error:
			lastFailure ??
			({
				kind: 'unknown',
				message: 'データ取得に失敗しました',
				retryable: true,
				attempts: maxAttempts,
			} satisfies FetchFailure),
	}
}

export function unwrapFetchResult<T>(result: FetchResult<T>): T {
	if (result.ok) return result.data
	throw new ReliableFetchError(result.error)
}

export function classifyHttpFailure(
	status: number,
	body: string,
	attempts: number,
): FetchFailure {
	const retryable = status === 429 || status >= 500
	return {
		kind: statusToKind(status),
		status,
		message: buildHttpFailureMessage(status, body),
		retryable,
		attempts,
		body: trimBody(body),
	}
}

function classifyNetworkFailure(
	error: unknown,
	attempts: number,
): FetchFailure {
	const rawMessage = error instanceof Error ? error.message : String(error)
	return {
		kind: 'network',
		message: `ネットワーク接続または外部サービスへの到達に失敗しました: ${rawMessage}`,
		retryable: true,
		attempts,
		body: trimBody(rawMessage),
	}
}

function statusToKind(status: number): FetchFailureKind {
	if (status === 401) return 'unauthenticated'
	if (status === 403) return 'forbidden'
	if (status === 429) return 'rate_limited'
	if (status >= 500) return 'server_error'
	return 'unknown'
}

function buildHttpFailureMessage(status: number, body: string): string {
	const detail = trimBody(body)
	switch (status) {
		case 401:
			return appendDetail(
				'認証情報の有効期限が切れています。再ログインしてください。',
				detail,
			)
		case 403:
			return appendDetail(
				'このテナントで必要な権限またはスコープが不足しています。',
				detail,
			)
		case 429:
			return appendDetail(
				'外部サービスのレート制限に達しました。少し待ってから再試行してください。',
				detail,
			)
		default:
			if (status >= 500) {
				return appendDetail(
					'外部サービスまたはAPIが一時的に利用できません。',
					detail,
				)
			}
			return appendDetail(`データ取得に失敗しました (HTTP ${status})`, detail)
	}
}

function appendDetail(message: string, detail?: string): string {
	return detail ? `${message} ${detail}` : message
}

function trimBody(body: string): string | undefined {
	const trimmed = body.trim()
	if (!trimmed) return undefined
	return trimmed.slice(0, MAX_ERROR_BODY_LENGTH)
}

function wait(ms: number): Promise<void> {
	if (ms <= 0) return Promise.resolve()
	return new Promise(resolve => setTimeout(resolve, ms))
}
