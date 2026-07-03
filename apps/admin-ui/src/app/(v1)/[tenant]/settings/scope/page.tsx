import { authWithCheck } from 'app/auth'
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from 'components/ui/breadcrumb'
import { PageHeader } from 'components/ui/page-shell'
import { MainLayout, V1Layout } from 'components/v1-layout'
import { getServerModePrefix } from 'lib/mode'
import type { Route } from 'next'
import Link from 'next/link'
import { GaScopeSummary } from '../../_components/ga-scope/ga-scope-summary'

export const metadata = {
	title: '対応範囲について | TACHYON Field',
	description: 'TACHYON Field ERP GA版の対応範囲を確認します。',
}

export default async function ScopePage({
	params,
}: {
	params: Promise<{ tenant: string }>
}) {
	await authWithCheck()
	const { tenant } = await params
	const prefix = getServerModePrefix(tenant)

	return (
		<V1Layout
			current='scope'
			tenant={tenant}
			breadcrumbs={
				<Breadcrumb>
					<BreadcrumbList>
						<BreadcrumbItem>
							<BreadcrumbLink asChild>
								<Link href={`${prefix}/${tenant}/settings` as Route}>
									設定
								</Link>
							</BreadcrumbLink>
						</BreadcrumbItem>
						<BreadcrumbSeparator />
						<BreadcrumbItem>
							<BreadcrumbPage>対応範囲について</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>
			}
		>
			<MainLayout>
				<div className='container mx-auto space-y-6'>
					<PageHeader
						title='対応範囲について'
						description='TACHYON Field ERP GA版で対応する機能と、現時点でGAネイティブ機能の範囲外となる領域を確認します。'
					/>
					<GaScopeSummary showLongCopy />
				</div>
			</MainLayout>
		</V1Layout>
	)
}
