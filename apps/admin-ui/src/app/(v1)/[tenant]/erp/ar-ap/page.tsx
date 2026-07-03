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
import { ArApPage } from './_components/ar-ap-page'

export const metadata = {
	title: '売掛・買掛 | TACHYON Field',
	description: '売掛金、買掛金、滞留、入金予定、支払予定を確認します。',
}

export default async function ArApRoute({
	params: { tenant },
	searchParams,
}: {
	params: {
		tenant: string
	}
	searchParams?: {
		itemId?: string
		item_id?: string
	}
}) {
	const session = await authWithCheck()
	const mp = getServerModePrefix(tenant)
	const drilldownItemId = searchParams?.itemId ?? searchParams?.item_id

	return (
		<V1Layout
			current='ar-ap'
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
							<BreadcrumbPage>売掛・買掛</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>
			}
		>
			<MainLayout>
				<ArApPage
					tenant={tenant}
					accessToken={session.accessToken}
					initialItemId={drilldownItemId}
				/>
			</MainLayout>
		</V1Layout>
	)
}
