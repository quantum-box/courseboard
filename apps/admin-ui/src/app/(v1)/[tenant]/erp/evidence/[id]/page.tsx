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
import { notFound } from 'next/navigation'
import { fetchEvidenceDetailAction } from '../actions'
import { EvidenceDetailPage } from '../_components/evidence-detail-page'

export const metadata = {
	title: '証憑詳細 | バクうれ',
}

export default async function EvidenceDetailRoute({
	params: { tenant, id },
}: {
	params: {
		tenant: string
		id: string
	}
}) {
	const mp = getServerModePrefix(tenant)
	const result = await fetchEvidenceDetailAction(tenant, id)

	if (!result.success || !result.data) {
		notFound()
	}

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
							<BreadcrumbLink asChild>
								<Link href={`${mp}/${tenant}/erp/evidence` as Route}>証憑</Link>
							</BreadcrumbLink>
						</BreadcrumbItem>
						<BreadcrumbSeparator />
						<BreadcrumbItem>
							<BreadcrumbPage>{id}</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>
			}
		>
			<MainLayout>
				<EvidenceDetailPage tenant={tenant} initialDetail={result.data} />
			</MainLayout>
		</V1Layout>
	)
}
