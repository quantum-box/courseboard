import { authWithCheck, isAdminRole } from 'app/auth'
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from 'components/ui/card'
import { PageHeader } from 'components/ui/page-shell'
import { MainLayout, V1Layout } from 'components/v1-layout'
import { notFound } from 'next/navigation'
import { fetchAuditLogsAction } from './actions'
import { AuditLogViewer } from './_components/audit-log-viewer'

export default async function AuditLogsPage({
	params: { tenant },
	searchParams,
}: {
	params: { tenant: string }
	searchParams?: {
		resourceType?: string
		resourceId?: string
		action?: string
	}
}) {
	const session = await authWithCheck()

	if (!isAdminRole(session.user.role)) {
		notFound()
	}

	const initialFilter = {
		limit: 50,
		resourceType: searchParams?.resourceType,
		resourceId: searchParams?.resourceId,
		action: searchParams?.action,
	}
	const result = await fetchAuditLogsAction(tenant, initialFilter)
	const initialItems = result.success && result.data ? result.data.items : []
	const initialNextCursor =
		result.success && result.data ? result.data.nextCursor : null

	return (
		<V1Layout current='audit-logs' tenant={tenant}>
			<MainLayout>
				<div className='grid gap-6'>
					<PageHeader
						title='監査ログ'
						description='テナント内の作成、更新、削除、入出庫などの操作履歴を確認します'
					/>

					<Card>
						<CardHeader>
							<CardTitle>操作履歴</CardTitle>
							<CardDescription>
								期間、リソース、操作、Actor ID で絞り込めます。
							</CardDescription>
						</CardHeader>
						<CardContent>
							<AuditLogViewer
								tenantId={tenant}
								initialItems={initialItems}
								initialNextCursor={initialNextCursor}
								initialFilter={{
									resourceType: searchParams?.resourceType,
									resourceId: searchParams?.resourceId,
									action: searchParams?.action,
								}}
							/>
						</CardContent>
					</Card>
				</div>
			</MainLayout>
		</V1Layout>
	)
}
