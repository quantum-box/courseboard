'use server'

import { authWithCheck } from 'app/auth'
import { getGraphqlSdk } from 'lib/graphqlClient'
import { getServerModePrefix } from 'lib/mode'
import { revalidatePath } from 'next/cache'

function optionalString(value: FormDataEntryValue | null) {
	const text = String(value ?? '').trim()
	return text.length > 0 ? text : undefined
}

export async function createClientAction(tenant: string, formData: FormData) {
	const name = optionalString(formData.get('name'))
	if (!name) {
		throw new Error('取引先名を入力してください')
	}

	const postalCode = optionalString(formData.get('postalCode'))
	const state = optionalString(formData.get('state'))
	const city = optionalString(formData.get('city'))
	const address1 = optionalString(formData.get('address1'))
	const address2 = optionalString(formData.get('address2'))
	const address =
		postalCode && state && city && address1
			? { postalCode, state, city, address1, address2 }
			: undefined

	const session = await authWithCheck()
	const sdk = getGraphqlSdk(session, tenant)
	await sdk.createClientForClientsList({
		input: {
			name,
			email: optionalString(formData.get('email')),
			phoneNumber: optionalString(formData.get('phoneNumber')),
			industry: optionalString(formData.get('industry')),
			address,
		},
	})

	revalidatePath(`/${tenant}/library/clients`)
	revalidatePath(`${getServerModePrefix(tenant)}/${tenant}/library/clients`)
}
