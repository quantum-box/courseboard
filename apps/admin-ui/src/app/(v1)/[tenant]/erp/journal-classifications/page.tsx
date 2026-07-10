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
import { JournalClassificationPage } from './_components/journal-classification-page'

export const metadata = {
	title: '仕訳候補レビュー | TACHYON Field',
	description: 'Agent が生成した仕訳分類候補を確認・承認します。',
}

export default async function JournalClassificationsRoute({
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
			current='journal-classifications'
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
							<BreadcrumbPage>仕訳候補レビュー</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>
			}
		>
			<MainLayout>
				<JournalClassificationPage
					tenant={tenant}
					accessToken={session.accessToken}
				/>
			</MainLayout>
		</V1Layout>
	)
}
