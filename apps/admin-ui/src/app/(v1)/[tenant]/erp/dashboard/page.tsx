import { authWithCheck } from 'app/auth'
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from 'components/ui/breadcrumb'
import { MainLayout, V1Layout } from 'components/v1-layout'
import { getServerModePrefix } from 'lib/mode'
import type { Route } from 'next'
import Link from 'next/link'
import { ProfitDashboardPage } from './_components/profit-dashboard-page'

export const metadata = {
	title: 'ERPダッシュボード | TACHYON Field',
	description: '売上、原価、粗利、粗利率を可視化します。',
}

export default async function ProfitDashboardRoute({
	params: { tenant },
}: {
	params: {
		tenant: string
	}
}) {
	const session = await authWithCheck()
	const mp = getServerModePrefix(tenant)

	return (
		<V1Layout
			current='erp-dashboard'
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
							<BreadcrumbPage>ERPダッシュボード</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>
			}
		>
			<MainLayout>
				<ProfitDashboardPage
					tenant={tenant}
					accessToken={session.accessToken}
				/>
			</MainLayout>
		</V1Layout>
	)
}
