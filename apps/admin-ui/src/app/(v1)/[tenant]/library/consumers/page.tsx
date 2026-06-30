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
import { PageHeader } from 'components/ui/page-shell'
import { MainLayout, V1Layout } from 'components/v1-layout'
import type { GqlCustomer } from 'gen/graphql'
import { getGraphqlSdk } from 'lib/graphqlClient'
import { getServerModePrefix } from 'lib/mode'
import type { Route } from 'next'
import Link from 'next/link'
import { ConsumerList } from './_components/consumer-list'

export const metadata = {
	title: 'コンシューマー | TACHYON Field',
	description: 'コンシューマー一覧ページです。',
}

export default async function ConsumersPage({
	searchParams: { email },
	params: { tenant },
}: {
	searchParams: { email?: string }
	params: { tenant: string }
}) {
	const session = await authWithCheck()
	const sdk = getGraphqlSdk(session, tenant)
	const prefix = getServerModePrefix(tenant)
	let customers: GqlCustomer[] = []
	let hasMore = false

	try {
		const result = await sdk.consumerCustomersForAdmin({
			email: email || undefined,
			limit: 100,
		})
		customers = result.customers.data
		hasMore = result.customers.hasMore
	} catch {
		// New tenant may not have consumer customer data yet.
	}

	return (
		<V1Layout
			current='consumers'
			tenant={tenant}
			breadcrumbs={
				<Breadcrumb>
					<BreadcrumbList>
						<BreadcrumbItem>
							<BreadcrumbLink asChild>
								<Link href={`${prefix}/${tenant}/library` as Route}>
									ライブラリー
								</Link>
							</BreadcrumbLink>
						</BreadcrumbItem>
						<BreadcrumbSeparator />
						<BreadcrumbItem>
							<BreadcrumbPage>コンシューマー</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>
			}
		>
			<MainLayout>
				<PageHeader
					title='コンシューマー'
					description='購入や予約を行う個人顧客を確認します'
				/>
				<HelpPanel
					storageKey='library-consumers'
					title='コンシューマー管理の使い方'
					summary='個人顧客の確認・問い合わせ対応の手順'
					sections={[
						{
							title: 'コンシューマーとは',
							content:
								'EC注文や予約など、店舗や公開ページで購入・申込を行う個人顧客です。取引先とは分けて確認します。',
						},
						{
							title: '確認できる情報',
							content:
								'氏名、メールアドレス、電話番号、補足メモを一覧で確認できます。注文履歴は「販売」内のEC注文から確認します。',
						},
					]}
				/>
				<ConsumerList customers={customers} hasMore={hasMore} />
			</MainLayout>
		</V1Layout>
	)
}
