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
import { getGraphqlSdk } from 'lib/graphqlClient'
import { getServerModePrefix } from 'lib/mode'
import type { Route } from 'next'
import Link from 'next/link'

export const metadata = {
	title: '見積詳細 / ライブラリ',
	description: '見積詳細ページです。',
}

export default async function QuoteDetailPage({
	searchParams: { filter, query },
	params: { tenant },
}: {
	searchParams: {
		filter?: string
		query?: string
	}
	params: { tenant: string }
}) {
	const session = await authWithCheck()
	const sdk = getGraphqlSdk(session, tenant)
	const { quotes } = await sdk.QuotesList()
	const mp = getServerModePrefix(tenant)
	return (
		<V1Layout
			current='library'
			tenant={tenant}
			breadcrumbs={
				<Breadcrumb>
					<BreadcrumbList>
						<BreadcrumbItem>
							<BreadcrumbLink asChild>
								<Link href={`${mp}/${tenant}/library` as Route}>
									ライブラリー
								</Link>
							</BreadcrumbLink>
						</BreadcrumbItem>
						<BreadcrumbSeparator />
						<BreadcrumbItem>
							<BreadcrumbPage>見積</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>
			}
		>
			<MainLayout>
				<p>みつもりs</p>
			</MainLayout>
		</V1Layout>
	)
}
