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
import { getGraphqlSdk } from 'lib/graphqlClient'
import { getServerModePrefix } from 'lib/mode'
import type { Route } from 'next'
import Link from 'next/link'
import { ClientsList } from './_components/clients-list'
import { createClientAction } from './action'

export const metadata = {
	title: '取引先一覧 / ライブラリ',
	description: '取引先一覧ページです。',
}

export default async function ClientsPage({
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
	let data: Awaited<ReturnType<typeof sdk.clientListPage>>['clients'] = []
	try {
		const result = await sdk.clientListPage()
		data = result.clients ?? []
	} catch {
		// New tenant may not have client data yet
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
							<BreadcrumbPage>取引先</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>
			}
		>
			<MainLayout>
				<PageHeader
					title='取引先'
					description='顧客・仕入先とCRM連携に使う取引先情報を管理します'
				/>
				<HelpPanel
					storageKey='library-clients'
					title='取引先管理の使い方'
					summary='顧客・仕入先の登録・CRM連携の手順'
					sections={[
						{
							title: '取引先とは',
							content:
								'TACHYON Fieldの「取引先」は、販売先（顧客）や仕入先など、ビジネス上の関係先を管理する機能です。HubSpot CRMと連携してデータを同期できます。',
						},
						{
							title: '取引先の登録',
							content:
								'1. 「新規取引先」ボタンをクリックする\n2. 会社名・担当者名・連絡先を入力する\n3. 取引先の種別（顧客/仕入先/パートナー）を選択する\n4. 「保存」をクリックして登録完了',
						},
						{
							title: 'HubSpot連携',
							content:
								'HubSpotと連携している場合、取引先情報は自動的にHubSpot CRMと同期されます。CRM側で更新した情報もTACHYON Fieldに反映されます。\n連携設定は「設定」ページから行えます。',
						},
						{
							title: '見積書の作成',
							content:
								'取引先の詳細ページから直接見積書を作成できます。「見積を作成」ボタンをクリックすると、その取引先宛の見積フォームが開きます。',
						},
					]}
				/>
				<ClientsList
					searchParams={{ filter, query }}
					data={data}
					tenantId={tenant}
					createClientAction={createClientAction.bind(null, tenant)}
				/>
			</MainLayout>
		</V1Layout>
	)
}
