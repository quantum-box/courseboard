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
import { ReceiptOcrPage } from './_components/receipt-ocr-page'

export const metadata = {
	title: 'レシートOCR | TACHYON Field',
	description: '売上・仕入レシートをOCRで読み取り、構造化します。',
}

export default async function ReceiptsPage({
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
			current='receipts'
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
							<BreadcrumbPage>レシートOCR</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>
			}
		>
			<MainLayout>
				<ReceiptOcrPage tenant={tenant} accessToken={session.accessToken} />
			</MainLayout>
		</V1Layout>
	)
}
