import { z } from 'zod'

export const importValidator = z.object({
	name: z.string().min(1, '必須項目です。'),
	status: z.enum(['active', 'inactive']),
	file: z.any(),
})

export type ImportValidatorType = z.infer<typeof importValidator>
