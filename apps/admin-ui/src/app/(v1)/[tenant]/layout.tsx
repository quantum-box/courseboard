import { authWithCheck } from 'app/auth'
import { AgentChatFloating } from 'app/(v1)/agent-chat-floating'
import { ClientOnly } from 'components/client-only'
import { isTenantUlid, resolveTenantPathSegment } from 'lib/tenantPath'
import { notFound, redirect } from 'next/navigation'

export default async function TenantLayout({
	children,
	params,
}: {
	children: React.ReactNode
	params: Promise<{ tenant: string }>
}) {
	const { tenant } = await params
	const session = await authWithCheck()
	const resolvedTenant = await resolveTenantPathSegment(session, tenant)
	if (!resolvedTenant) {
		notFound()
	}
	if (!isTenantUlid(tenant)) {
		// Pages and server actions forward the raw URL segment as
		// x-operator-id, which the backend only accepts as a tenant id
		// (a slug segment makes every ERP call fail with an opaque
		// Tachyon auth 400). Never render under an alias segment; send
		// it to the canonical id-based URL instead.
		redirect(`/${resolvedTenant.id}/home`)
	}

	return (
		<>
			{children}
			<ClientOnly>
				<AgentChatFloating
					accessToken={session.accessToken ?? ''}
					tenantId={resolvedTenant.id}
					userId={session.user?.id}
				/>
			</ClientOnly>
		</>
	)
}
