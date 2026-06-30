import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from 'components/ui/breadcrumb'
import { Button } from 'components/ui/button'
import { MainLayout, V1Layout } from 'components/v1-layout'
import { getServerModePrefix } from 'lib/mode'
import type { Route } from 'next'
import Link from 'next/link'
import {
	approveSaasChangeRequestAction,
	createSaasChangeRequestAction,
	fetchSaasSubscriptionWorkspaceAction,
	returnSaasChangeRequestAction,
} from './action'
import { SaasSubscriptionWorkspace } from './saas-subscription-workspace'

export const metadata = {
	title: 'SaaS契約管理 | TACHYON Field',
	description:
		'SaaS契約、プラン変更申請、利用理由、承認フロー、請求見通しを管理します。',
}

export default async function SaasSubscriptionsPage({
	params: { tenant },
}: {
	params: { tenant: string }
}) {
	const mp = getServerModePrefix(tenant)
	const result = await fetchSaasSubscriptionWorkspaceAction(tenant)
	const data = result.data ?? {
		requests: [],
		subscriptions: [],
		summary: {
			monthlyTotalYen: 0,
			pendingDeltaYen: 0,
			renewalReviewCount: 0,
			subscriptionCount: 0,
		},
	}

	return (
		<V1Layout
			current='saas-subscriptions'
			tenant={tenant}
			breadcrumbs={
				<Breadcrumb>
					<BreadcrumbList>
						<BreadcrumbItem>
							<BreadcrumbLink asChild>
								<Link href={`${mp}/${tenant}/home` as Route}>ホーム</Link>
							</BreadcrumbLink>
						</BreadcrumbItem>
						<BreadcrumbSeparator />
						<BreadcrumbItem>
							<BreadcrumbPage>SaaS契約管理</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>
			}
		>
			<MainLayout>
				<div className='grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start'>
					<div>
						<h1 className='text-2xl font-semibold tracking-normal'>
							SaaS契約管理
						</h1>
						<p className='text-sm text-muted-foreground'>
							SaaS契約、プラン変更の理由、承認フロー、請求見通しをまとめて確認します。
						</p>
					</div>
					<div className='grid gap-2 sm:grid-cols-2 lg:flex lg:justify-end'>
						<Button variant='outline' asChild>
							<Link href={`${mp}/${tenant}/billing` as Route}>請求管理</Link>
						</Button>
						<Button type='button'>契約を追加</Button>
					</div>
				</div>

				{result.success ? null : (
					<div className='rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive'>
						{result.message ?? 'SaaS契約管理データの取得に失敗しました'}
					</div>
				)}

				<SaasSubscriptionWorkspace
					approveRequest={approveSaasChangeRequestAction.bind(null, tenant)}
					createRequest={createSaasChangeRequestAction.bind(null, tenant)}
					requests={data.requests}
					returnRequest={returnSaasChangeRequestAction.bind(null, tenant)}
					subscriptions={data.subscriptions}
					summary={data.summary}
				/>
			</MainLayout>
		</V1Layout>
	)
}
