'use server'

import { authWithCheck } from 'app/auth'
import { getServerGraphqlSdk } from 'lib/serverGraphqlClient'
import { revalidatePath } from 'next/cache'

export async function deleteProduct(formData: FormData) {
	const productId = formData.get('productId')
	const tenantId = formData.get('tenantId')
	const session = await authWithCheck()
	// Server-resolved (internalService) Field API — same as reservation SSR
	// (#36) and the products SSR reads (#38). The client-facing getGraphqlSdk
	// resolves the public Field API URL from process.env, which is not the
	// internalService value in the worker runtime, so the delete silently
	// no-ops (PLT-2501: the product stayed in the master after "削除する").
	const sdk = getServerGraphqlSdk(session, tenantId as string)
	await sdk.deleteProduct({ id: productId as string })
	revalidatePath(`/${tenantId}/library/products`)
}
