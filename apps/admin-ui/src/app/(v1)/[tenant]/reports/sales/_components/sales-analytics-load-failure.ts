export type LoadFailureKind = 'permission' | 'unavailable' | 'error'

function isErrorLike(error: unknown): error is {
	message?: string
	response?: { status?: number }
	status?: number
} {
	return typeof error === 'object' && error !== null
}

export function classifySalesAnalyticsLoadFailure(
	error: unknown,
): LoadFailureKind {
	const status = isErrorLike(error)
		? (error.response?.status ?? error.status)
		: undefined
	const message = isErrorLike(error) ? (error.message ?? '') : ''
	const normalized = message.toLowerCase()

	if (
		status === 401 ||
		status === 403 ||
		normalized.includes('permission') ||
		normalized.includes('unauthorized') ||
		normalized.includes('forbidden')
	) {
		return 'permission'
	}

	if (
		normalized.includes('fetch failed') ||
		normalized.includes('network') ||
		normalized.includes('econnrefused') ||
		normalized.includes('timeout')
	) {
		return 'unavailable'
	}

	return 'error'
}

export function salesAnalyticsLoadFailureMessage(
	kind: LoadFailureKind,
): string {
	switch (kind) {
		case 'permission':
			return '売上分析データを取得できませんでした。閲覧権限またはテナント権限を確認してください。'
		case 'unavailable':
			return '売上分析 API に接続できませんでした。API の稼働状況を確認してから再実行してください。'
		case 'error':
			return '売上分析データを取得できませんでした。条件を見直すか、時間をおいて再度お試しください。'
	}
}
