const NANODOLLAR_PER_USD = 1_000_000_000

/**
 * Format a NanoDollar amount (string or number) as USD.
 *
 * @example formatNanodollarAsUsd('1000000000') // '$1.00'
 * @example formatNanodollarAsUsd(500000000)    // '$0.50'
 */
export function formatNanodollarAsUsd(nanodollars: number | string): string {
	const n = typeof nanodollars === 'string' ? Number(nanodollars) : nanodollars
	if (Number.isNaN(n)) return '$0.00'
	const usd = n / NANODOLLAR_PER_USD
	return usd.toLocaleString('en-US', {
		style: 'currency',
		currency: 'USD',
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	})
}

/**
 * Format a NanoDollar amount as JPY using an approximate exchange rate.
 *
 * @deprecated The field storefront stores JPY at a fixed scale of
 * 1 JPY = 1,000,000 nanodollars. Use formatNanodollarAsListPrice instead.
 *
 * @example formatNanodollarAsJpy('1000000000', 150) // '¥150'
 */
export function formatNanodollarAsJpy(
	nanodollars: number | string,
	rate = 150,
): string {
	const n = typeof nanodollars === 'string' ? Number(nanodollars) : nanodollars
	if (Number.isNaN(n)) return '¥0'
	const usd = n / NANODOLLAR_PER_USD
	const jpy = Math.round(usd * rate)
	return jpy.toLocaleString('ja-JP', {
		style: 'currency',
		currency: 'JPY',
	})
}

/**
 * Format a raw catalog list_price (u32) as a display price.
 * The catalog list_price is NOT in NanoDollar but a simpler
 * integer representation. Divide by 100 to get a readable price.
 */
export function formatListPrice(listPrice: number): string {
	return `¥${listPrice.toLocaleString()}`
}

const NANODOLLAR_PER_JPY = 1_000_000

/**
 * Convert a NanoDollar amount to JPY and format as a display price.
 *
 * The field storefront stores JPY amounts at a fixed scale of
 * 1 JPY = 1,000,000 nanodollars (NanoDollar::from_jpy).
 *
 * @example formatNanodollarAsListPrice('1500000000') // '¥1,500'
 */
export function formatNanodollarAsListPrice(
	nanodollars: number | string,
): string {
	const n = typeof nanodollars === 'string' ? Number(nanodollars) : nanodollars
	if (Number.isNaN(n)) return '¥0'
	const jpy = Math.round(n / NANODOLLAR_PER_JPY)
	return `¥${jpy.toLocaleString()}`
}
