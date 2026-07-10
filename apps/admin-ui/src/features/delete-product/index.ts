'use server'

import { authWithCheck } from 'app/auth'
import { getGraphqlSdk } from 'lib/graphqlClient'
import { revalidatePath } from 'next/cache'

export async function deleteProduct(formData: FormData) {
	const productId = formData.get('productId')
	const tenantId = formData.get('tenantId')
	const session = await authWithCheck()
	const sdk = await getGraphqlSdk(session, tenantId as string)
	await sdk.deleteProduct({ id: productId as string })
	revalidatePath(`/${tenantId}/library/products`)
}
