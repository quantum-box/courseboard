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
import { SalesLedgerInputPage } from '../_components/sales-ledger-page'

export const metadata = {
	title: '売上入力 | TACHYON Field',
	description: 'レジ締め日時で売上明細の手動入力とOCRレシートからの台帳確定を行います。',
}

export default async function SalesLedgerInputRoute({
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
			current='sales-ledger'
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
							<BreadcrumbLink asChild>
								<Link href={`${mp}/${tenant}/erp/sales-ledger` as Route}>
									売上台帳
								</Link>
							</BreadcrumbLink>
						</BreadcrumbItem>
						<BreadcrumbSeparator />
						<BreadcrumbItem>
							<BreadcrumbPage>売上入力</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>
			}
		>
			<MainLayout>
				<SalesLedgerInputPage
					tenant={tenant}
					accessToken={session.accessToken}
				/>
			</MainLayout>
		</V1Layout>
	)
}
