import { z } from 'zod'

export const stringOrNull = z
	.string()
	.transform(value => {
		const trimmed = value.trim()
		return trimmed === '' ? null : trimmed
	})
	.nullable()
	.optional()
