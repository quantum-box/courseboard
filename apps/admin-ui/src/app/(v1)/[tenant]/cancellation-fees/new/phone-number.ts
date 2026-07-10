export function normalizeSmsPhoneNumber(value: string | undefined) {
	const digits = digitsOnly(value)
	if (!digits) return undefined

	if (value?.trim().startsWith('+')) {
		return `+${digits}`
	}
	if (digits.startsWith('81')) {
		return `+${digits}`
	}

	const nationalNumber = digits.startsWith('0') ? digits.slice(1) : digits
	return `+81${nationalNumber}`
}

function digitsOnly(value: string | undefined) {
	return String(value ?? '')
		.replace(/[０-９]/g, digit =>
			String.fromCharCode(digit.charCodeAt(0) - 0xfee0),
		)
		.replace(/\D/g, '')
}
