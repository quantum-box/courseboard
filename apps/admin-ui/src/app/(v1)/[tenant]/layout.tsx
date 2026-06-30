import { authWithCheck } from 'app/auth'
import { AgentChatFloating } from 'app/(v1)/agent-chat-floating'
import { ClientOnly } from 'components/client-only'
import { resolveTenantPathSegment } from 'lib/tenantPath'
import { notFound } from 'next/navigation'

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
