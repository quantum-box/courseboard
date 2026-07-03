export const LIBRARY_MASTER_ERROR_MESSAGES: Record<string, string> = {
	LIBRARY_MASTER_VALIDATION:
		'Library の入力検証で拒否されました。入力内容を確認してください。',
	LIBRARY_MASTER_PERMISSION_DENIED:
		'Library の権限ポリシーで拒否されました。操作権限を確認してください。',
	LIBRARY_MASTER_CONFLICT:
		'Library 側の商品マスタが更新されています。再読み込みしてから保存してください。',
	LIBRARY_MASTER_UNAVAILABLE:
		'Library API が利用できないため、商品マスタの保存を停止しました。',
	LIBRARY_MASTER_NETWORK:
		'Library API への接続に失敗しました。時間をおいて再実行してください。',
	LIBRARY_MASTER_RESPONSE_PARSE: 'Library API の応答を処理できませんでした。',
}

export const LIBRARY_MASTER_ERROR_TITLES: Record<string, string> = {
	LIBRARY_MASTER_VALIDATION: 'Library の入力検証で拒否されました',
	LIBRARY_MASTER_PERMISSION_DENIED: 'Library の権限で拒否されました',
	LIBRARY_MASTER_CONFLICT: 'Library 側の商品マスタと競合しました',
	LIBRARY_MASTER_UNAVAILABLE: 'Library API が利用できません',
	LIBRARY_MASTER_NETWORK: 'Library API に接続できません',
	LIBRARY_MASTER_RESPONSE_PARSE: 'Library API の応答を処理できません',
}

type GraphqlErrorLike = {
	message?: string
	extensions?: {
		code?: string
	}
}

export type LibraryMasterErrorDetails = {
	code: string
	title: string
	message: string
}

export function libraryMasterErrorMessage(error: unknown): string | null {
	return libraryMasterErrorDetails(error)?.message ?? null
}

export function libraryMasterErrorDetails(
	error: unknown,
): LibraryMasterErrorDetails | null {
	const graphqlErrors = extractGraphqlErrors(error)
	for (const graphqlError of graphqlErrors) {
		const code = graphqlError.extensions?.code
		if (code && code in LIBRARY_MASTER_ERROR_MESSAGES) {
			return {
				code,
				title:
					LIBRARY_MASTER_ERROR_TITLES[code] ??
					'Library 商品マスタの保存に失敗しました',
				message: LIBRARY_MASTER_ERROR_MESSAGES[code],
			}
		}
	}
	return null
}

function extractGraphqlErrors(error: unknown): GraphqlErrorLike[] {
	if (isGraphqlErrorPayload(error)) {
		return error.response.errors
	}

	if (!(error instanceof Error)) {
		return []
	}

	const jsonStart = error.message.indexOf('{')
	const jsonEnd = error.message.lastIndexOf('}')
	if (jsonStart === -1 || jsonEnd <= jsonStart) {
		return []
	}

	try {
		const parsed = JSON.parse(
			error.message.slice(jsonStart, jsonEnd + 1),
		) as unknown
		return isGraphqlErrorPayload(parsed) ? parsed.response.errors : []
	} catch {
		return []
	}
}

function isGraphqlErrorPayload(
	value: unknown,
): value is { response: { errors: GraphqlErrorLike[] } } {
	return (
		typeof value === 'object' &&
		value !== null &&
		'response' in value &&
		typeof value.response === 'object' &&
		value.response !== null &&
		'errors' in value.response &&
		Array.isArray(value.response.errors)
	)
}
