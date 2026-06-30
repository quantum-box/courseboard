import { ImportsList } from 'components/imports-list'
import { HelpPanel } from 'components/ui/help-panel'
import { PageHeader } from 'components/ui/page-shell'
import { MainLayout, V1Layout } from 'components/v1-layout'
import { fetchBridgeDefinitionsAction } from './actions'

export const metadata = {
	title: 'TACHYON Field Bridge',
	description: '外部データとFieldの業務世界モデルを橋渡しします。',
}

export default async function UploadPage({
	searchParams: { filter, query },
	params: { tenant },
}: {
	searchParams: { filter: string; query: string }
	params: { tenant: string }
}) {
	const definitionsResult = await fetchBridgeDefinitionsAction(tenant)
	const definitions =
		definitionsResult.data?.items.map(item => ({
			id: item.id,
			name: item.name,
			status: item.status === 'active' ? ('有効' as const) : ('無効' as const),
			createdAt: item.createdAt,
			sourceType: item.sourceType,
			targetObject: item.targetObject,
		})) ?? []

	return (
		<V1Layout current='imports' tenant={tenant}>
			<MainLayout>
				<PageHeader
					title='TACHYON Field Bridge'
					description='外部CSV、銀行明細、POS、会計SaaS exportをFieldの台帳・証憑・業務objectへ意味づけます'
				/>
				<HelpPanel
					storageKey='tachyon-field-bridge'
					title='Bridgeの使い方'
					summary='外部データをBridge Ontologyへ対応づけ、下書きとして安全に取り込みます'
					sections={[
						{
							title: 'TACHYON Field Bridgeとは',
							content:
								'外部システムから出力されたファイルやAPIデータを、Fieldの業務object、property、actionへ対応づけるAIP-readyな橋渡しコンポーネントです。',
						},
						{
							title: '対応source',
							content:
								'・CSV: SBI銀行、POS、商品、顧客、注文、売上/仕入データ\n・Excel: 損益計算書、予算、会計SaaS export\n・メール/API: 店舗報告や外部connectorからの構造化データ',
						},
						{
							title: 'Bridge手順',
							content:
								'1. Bridge Definitionを作成する\n2. source列とBridge Ontology Objectのpropertyを対応づける\n3. mapping候補を確認して承認する\n4. プレビューで正規化後objectとエラーを確認する\n5. 実行して台帳などのdraftを作成する',
						},
						{
							title: 'エラーが発生した場合',
							content:
								'Bridge Runのerror reportで行番号、source値、target property、変換エラーを確認し、mappingまたは元データを修正して再プレビューしてください。',
						},
					]}
				/>
				<ImportsList
					searchParams={{ filter, query }}
					tenantId={tenant}
					data={definitions}
					errorMessage={definitionsResult.message}
				/>
			</MainLayout>
		</V1Layout>
	)
}
