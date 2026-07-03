import { auth } from 'app/auth'
import { redirect } from 'next/navigation'
import type { TachyonFieldMode } from './mode'
import { getGraphqlSdk } from './graphqlClient'

export const getSdkWithAuth = async (tenant_id: string, mode?: TachyonFieldMode) => {
	const session = await auth()
	if (!session) {
		redirect('/auth/sign_in')
	}
	return getGraphqlSdk(session, tenant_id, mode)
}
