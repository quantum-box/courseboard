import { getTachyonFieldErpRolloutStatus } from 'app/(v1)/[tenant]/procurement/_lib/erp-api'
import { authWithCheck } from 'app/auth'
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from 'components/ui/breadcrumb'
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from 'components/ui/card'
import { MainLayout, V1Layout } from 'components/v1-layout'
import { getServerModePrefix } from 'lib/mode'

function statusLabel(enabled: boolean) {
	return enabled ? 'Enabled' : 'Disabled'
}

function modeLabel(mode: 'disabled' | 'allowlist' | 'all') {
	switch (mode) {
		case 'all':
			return 'All tenants'
		case 'disabled':
			return 'Disabled'
		case 'allowlist':
			return 'Allowlist'
	}
}

export default async function ErpRolloutPage({
	params,
}: {
	params: Promise<{ tenant: string }>
}) {
	await authWithCheck()
	const { tenant } = await params
	const prefix = getServerModePrefix(tenant)
	const result = await getTachyonFieldErpRolloutStatus(tenant)
	const status = result.item

	return (
		<V1Layout
			current='erp-rollout'
			tenant={tenant}
			breadcrumbs={
				<Breadcrumb>
					<BreadcrumbList>
						<BreadcrumbItem>
							<BreadcrumbLink href={`${prefix}/${tenant}/settings`}>
								Settings
							</BreadcrumbLink>
						</BreadcrumbItem>
						<BreadcrumbSeparator />
						<BreadcrumbItem>
							<BreadcrumbPage>ERP Rollout</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>
			}
		>
			<MainLayout>
				<div className='container mx-auto space-y-4'>
					<div>
						<h1 className='text-xl sm:text-2xl font-bold'>ERP rollout</h1>
						<p className='mt-1 text-sm text-muted-foreground'>
							テナント単位のERP段階展開状態を確認します。
						</p>
					</div>

					{result.errorMessage ? (
						<Card>
							<CardHeader>
								<CardTitle>状態を取得できません</CardTitle>
								<CardDescription>{result.errorMessage}</CardDescription>
							</CardHeader>
						</Card>
					) : null}

					<Card>
						<CardHeader>
							<CardTitle>
								{status ? statusLabel(status.enabled) : 'Unknown'}
							</CardTitle>
							<CardDescription>FIELD_ERP_GA_ROLLOUT_MODE</CardDescription>
						</CardHeader>
						<CardContent>
							<div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-3'>
								<div>
									<div className='text-xs text-muted-foreground'>Tenant</div>
									<div className='mt-1 break-all text-sm font-medium'>
										{status?.tenantId ?? tenant}
									</div>
								</div>
								<div>
									<div className='text-xs text-muted-foreground'>Mode</div>
									<div className='mt-1 text-sm font-medium'>
										{status ? modeLabel(status.mode) : 'Unknown'}
									</div>
								</div>
								<div>
									<div className='text-xs text-muted-foreground'>
										Env allowlist
									</div>
									<div className='mt-1 text-sm font-medium'>
										{status?.allowlisted ? 'Enabled' : 'Disabled'}
									</div>
								</div>
							</div>

							<div className='mt-5'>
								<div className='text-xs text-muted-foreground'>
									Applied sources
								</div>
								<div className='mt-2 flex flex-wrap gap-2'>
									{status?.sources.length ? (
										status.sources.map(source => (
											<span
												key={source}
												className='rounded border px-2 py-1 text-xs'
											>
												{source}
											</span>
										))
									) : (
										<span className='text-sm text-muted-foreground'>
											No active rollout source
										</span>
									)}
								</div>
							</div>
						</CardContent>
					</Card>
				</div>
			</MainLayout>
		</V1Layout>
	)
}
