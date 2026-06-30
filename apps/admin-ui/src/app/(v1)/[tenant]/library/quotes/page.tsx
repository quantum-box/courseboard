import { QuotesList } from 'app/(v1)/[tenant]/library/quotes/_components/quotes-list'
import Provider from 'app/(v1)/provider'
import { getUrqlProviderProps } from 'app/(v1)/urql-provider-props'
import { authWithCheck } from 'app/auth'
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from 'components/ui/breadcrumb'
import { HelpPanel } from 'components/ui/help-panel'
import { MainLayout, V1Layout } from 'components/v1-layout'
import { getGraphqlSdk } from 'lib/graphqlClient'
import { getServerModePrefix } from 'lib/mode'
import type { Route } from 'next'
import Link from 'next/link'

export const metadata = {
	title: '見積一覧 / ライブラリ',
	description: '見積一覧ページです。',
}

export default async function ProductsPage({
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
	let quotes: Awaited<ReturnType<typeof sdk.QuotesList>>['quotes'] = []
	try {
		const result = await sdk.QuotesList()
		quotes = result.quotes ?? []
	} catch {
		// New tenant may not have quotes data yet
	}
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
				<HelpPanel
					storageKey='library-quotes'
					title='見積管理の使い方'
					summary='見積書の作成・送付・承認フローの手順'
					sections={[
						{
							title: '見積管理とは',
							content:
								'取引先向けの見積書を作成・管理するページです。見積の作成から承認、受注への転換までの一連のフローをここで管理します。',
						},
						{
							title: '見積書の作成手順',
							content:
								'1. 「新規見積」ボタンをクリックする\n2. 取引先（顧客）を選択する\n3. 見積に含める製品を追加して数量・価格を設定する\n4. 有効期限・支払い条件を設定する\n5. 「保存」または「送付」をクリックする',
						},
						{
							title: '見積ステータスの種類',
							content:
								'・下書き: 作成中で未送付の見積\n・送付済: 顧客に送付した見積\n・承認済: 顧客が承認した見積\n・受注済: 受注管理に転換された見積\n・失注: 顧客が承認しなかった見積',
						},
						{
							title: '受注への転換',
							content:
								'見積が承認されたら、見積詳細ページの「受注に転換」ボタンをクリックすると、受注管理に自動的に引き継がれます。',
						},
					]}
				/>
				<Provider {...getUrqlProviderProps(tenant, session.accessToken)}>
					<QuotesList
						searchParams={{ filter, query }}
						data={quotes}
						tenantId={tenant}
					/>
				</Provider>
			</MainLayout>
		</V1Layout>
	)
}
