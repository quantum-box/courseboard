import type { Session } from 'next-auth'
import { cache } from 'react'
import { getKnownOperatorName } from './mode'
import { getServerGraphqlSdk } from './serverGraphqlClient'

export const fetchTenantName = cache(async function fetchTenantName(
	session: Session,
	tenant: string,
): Promise<string | null> {
	const knownName = getKnownOperatorName(tenant)
	if (knownName) return knownName

	try {
		const sdk = getServerGraphqlSdk(session, tenant)
		const { operator } = await sdk.accountMenuContent({ id: tenant })
		return operator?.operatorName ?? operator?.name ?? null
	} catch {
		return null
	}
})
