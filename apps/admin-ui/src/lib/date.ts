/**
 * 日付をフォーマットする
 * `2024/08/25 午後02:42`のような形式で返す
 */
export const formatDate = (date: number | string | Date) => {
	return new Date(date).toLocaleString('ja-JP', {
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		hour12: true,
	})
}

/**
 * 日付をフォーマットする
 * `2024年08月25日`のような形式で返す
 */
export const formatDateOnly = (date: number | string | Date) => {
	const formattedDate = new Date(date).toLocaleString('ja-JP', {
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	})
	const [year, month, day] = formattedDate.split('/')
	return `${year}年${month}月${day}日`
}
