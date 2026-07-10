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
import { PurchaseLedgerPage } from './_components/purchase-ledger-page'

export const metadata = {
	title: '仕入台帳 | TACHYON Field',
	description: '仕入・原価明細の記録・集計・CSV出力を行います。',
}

export default async function PurchaseLedgerRoute({
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
			current='purchase-ledger'
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
							<BreadcrumbPage>仕入台帳</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>
			}
		>
			<MainLayout>
				<PurchaseLedgerPage tenant={tenant} accessToken={session.accessToken} />
			</MainLayout>
		</V1Layout>
	)
}
