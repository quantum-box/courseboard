import { authWithCheck } from 'app/auth'
import type { MenuOptions } from 'components/side-menu'
import { V1AdminShell } from 'components/v1-admin-shell'
import { getKnownOperatorName, getServerModePrefix } from 'lib/mode'
import { cn } from 'lib/utils'
import type { Session } from 'next-auth'

export async function V1Layout({
	children,
	current,
	breadcrumbs: Breadcrumbs,
	tenant,
	session: providedSession,
	tenantName: providedTenantName,
}: {
	children: React.ReactNode
	breadcrumbs?: React.ReactNode
	current?: MenuOptions
	session?: Session
	tenant: string
	tenantName?: string | null
}) {
	const session = providedSession ?? (await authWithCheck())
	const tenantName = providedTenantName ?? getKnownOperatorName(tenant)
	const username =
		session.user.username?.trim() || session.user.id?.trim() || null
	const modePrefix = getServerModePrefix(tenant)

	return (
		<V1AdminShell
			breadcrumbs={Breadcrumbs}
			current={current}
			modePrefix={modePrefix}
			tenant={tenant}
			tenantName={tenantName}
			username={username}
			userRole={session.user.role}
		>
			{children}
		</V1AdminShell>
	)
}

export function MainLayout({
	children,
	className,
}: {
	children: React.ReactNode
	className?: string
}) {
	return (
		<main
			className={cn(
				'grid min-w-0 flex-1 items-start gap-3 overflow-x-hidden px-3 py-3 sm:gap-4 sm:px-6 sm:py-4 md:gap-8',
				className,
			)}
		>
			{children}
		</main>
	)
}
