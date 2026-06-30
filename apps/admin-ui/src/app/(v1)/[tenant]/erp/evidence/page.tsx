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
import { searchEvidenceAction } from './actions'
import {
	type EvidenceSearchParams,
	resolveEvidenceDrilldownFilter,
} from './drilldown-filter'
import { EvidenceSearchPage } from './_components/evidence-search-page'

export const metadata = {
	title: '証憑 | バクうれ',
	description: 'ERP証憑の検索、OCRレビュー状態、監査履歴、リンクを確認します。',
}

export default async function EvidenceRoute({
	params,
	searchParams,
}: {
	params: Promise<{ tenant: string }>
	searchParams?: Promise<EvidenceSearchParams>
}) {
	const { tenant } = await params
	const query = (await searchParams) ?? {}
	const mp = getServerModePrefix(tenant)
	const initialFilter = resolveEvidenceDrilldownFilter(query)
	const result = await searchEvidenceAction(tenant, {
		...initialFilter,
		limit: 50,
		offset: 0,
		sortBy: 'transaction_date',
		sortDirection: 'desc',
	})

	return (
		<V1Layout
			current='evidence'
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
							<BreadcrumbPage>証憑</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>
			}
		>
			<MainLayout>
				<EvidenceSearchPage
					tenant={tenant}
					initialItems={result.data?.items ?? []}
					initialLimit={result.data?.limit ?? 50}
					initialOffset={result.data?.offset ?? 0}
					initialSortBy={result.data?.sortBy ?? 'transaction_date'}
					initialSortDirection={result.data?.sortDirection ?? 'desc'}
					initialFilter={initialFilter}
					initialMessage={result.success ? undefined : result.message}
				/>
			</MainLayout>
		</V1Layout>
	)
}
