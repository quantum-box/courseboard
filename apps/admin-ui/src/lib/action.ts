'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

export const revalidatePathAction = async (path: string) => {
	'use server'
	revalidatePath(path)
}

export const redirectAction = async (path: string) => {
	'use server'
	redirect(path)
}
