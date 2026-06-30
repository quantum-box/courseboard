export function formatStockLevelDateTime(
	value: string | null | undefined,
): string {
	if (!value) {
		return '未設定'
	}

	const date = new Date(value)
	if (Number.isNaN(date.getTime())) {
		return '未設定'
	}

	return date.toLocaleString('ja-JP', {
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
	})
}
