import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbList,
	BreadcrumbPage,
} from 'components/ui/breadcrumb'
import { Card } from 'components/ui/card'
import { HelpPanel } from 'components/ui/help-panel'
import { V1Layout } from 'components/v1-layout'
import type { Route } from 'next'
import Link from 'next/link'

export const metadata = {
	title: 'ライブラリー',
	description: 'ライブラリーページです。',
}

export default function LibraryPage({
	params: { tenant },
}: {
	params: { tenant: string }
}) {
	return (
		<V1Layout
			current='library'
			tenant={tenant}
			breadcrumbs={
				<Breadcrumb>
					<BreadcrumbList>
						<BreadcrumbItem>
							<BreadcrumbPage>ライブラリー</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>
			}
		>
			<main className='container mx-auto px-4 py-8'>
				<div className='mb-6'>
					<HelpPanel
						storageKey='library'
						title='ライブラリーの使い方'
						summary='製品・取引先・見積の統合管理'
						sections={[
							{
								title: 'ライブラリーとは',
								content:
									'TACHYON Fieldの中核となるデータ管理機能です。製品情報、取引先（顧客・仕入先）、見積書を一元管理できます。',
							},
							{
								title: '主要機能の概要',
								content:
									'📦 製品一覧: 販売・仕入れ商品の価格・在庫・仕様を管理します\n🤝 取引先: 顧客・仕入先の連絡先と取引履歴を管理します\n📄 見積: 取引先向けの見積書を作成・送付・管理します',
							},
							{
								title: '業務フローの例',
								content:
									'1. 製品を登録して価格・仕様を設定する\n2. 取引先（顧客）を登録する\n3. 顧客向けに見積書を作成して送付する\n4. 見積が承認されたら受注管理へ移行する',
							},
						]}
					/>
				</div>
				<div className='grid gap-6 md:grid-cols-2 lg:grid-cols-3'>
					{[
						{
							title: '製品一覧',
							description:
								'製品の詳細情報を管理し、新規作成、閲覧、更新、削除が可能です。価格設定や在庫管理も行えます。',
							href: 'library/products',
							icon: '📦',
						},
						{
							title: '取引先',
							description:
								'取引先の詳細情報を管理し、新規登録、情報更新、取引履歴の確認ができます。顧客関係管理（CRM）との連携も可能です。',
							href: 'library/clients',
							icon: '🤝',
						},
						{
							title: '見積',
							description:
								'見積書の作成、管理、編集が可能です。過去の見積履歴の閲覧、テンプレートの使用、承認フローの設定なども行えます。',
							href: 'library/quotes',
							icon: '📄',
						},
					].map(link => (
						<Link key={link.href} href={link.href as Route}>
							<Card className='transition-all duration-300 hover:shadow-lg hover:-translate-y-1 h-full flex flex-col'>
								<div className='p-6 flex flex-col flex-grow'>
									<div className='flex items-center mb-4'>
										<span className='text-3xl mr-3'>{link.icon}</span>
										<h2 className='text-2xl font-semibold'>{link.title}</h2>
									</div>
									<p className='text-gray-600 flex-grow'>{link.description}</p>
								</div>
							</Card>
						</Link>
					))}
				</div>
			</main>
		</V1Layout>
	)
}
