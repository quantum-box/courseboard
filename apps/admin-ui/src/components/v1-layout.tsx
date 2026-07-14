import { fetchExtensionStatusesAction } from 'app/(v1)/[tenant]/extensions/action'
import { authWithCheck } from 'app/auth'
import type { MenuOptions } from 'components/side-menu'
import { V1AdminShell } from 'components/v1-admin-shell'
import { GOLF_COURSE_EXTENSION_KEY } from 'lib/extension-admin-registry'
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

	// ゴルフ拡張が有効なテナントでのみ、サイドバーにゴルフ機能を表示する。
	// 未有効テナント（他ワークスペース等）でゴルフ画面へ誘導すると 400 になるため。
	// 判定に失敗した場合は表示側に倒す（ゴルフ運用が主目的のアプリのため）。
	const statusesResult = await fetchExtensionStatusesAction(tenant)
	const isGolfEnabled = statusesResult.success
		? statusesResult.data.some(
				item =>
					item.extensionKey === GOLF_COURSE_EXTENSION_KEY &&
					item.tenantStatus === 'enabled',
			)
		: true

	return (
		<V1AdminShell
			breadcrumbs={Breadcrumbs}
			current={current}
			isGolfEnabled={isGolfEnabled}
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
