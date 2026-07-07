import { ProductsList } from 'app/(v1)/[tenant]/library/products/_components/products-list'
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
import { Skeleton } from 'components/ui/skeleton'
import { MainLayout, V1Layout } from 'components/v1-layout'
import { getServerModePrefix } from 'lib/mode'
import type { Route } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'

export const metadata = {
	title: '製品カタログ一覧 | ライブラリ',
	description: '製品カタログ一覧ページです。',
}

export default async function ProductsPage({
	searchParams: { filter, query },
	params: { tenant },
}: {
	searchParams: {
		filter?: string
		query?: string
	}
	params: {
		tenant: string
	}
}) {
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
							<BreadcrumbPage>製品</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>
			}
		>
			<MainLayout>
				<PageHeader
					title='製品'
					description='販売・仕入れに使う商品情報、価格、公開状態を管理します'
				/>
				<HelpPanel
					storageKey='library-products'
					title='製品管理の使い方'
					summary='製品の登録・価格設定・在庫管理の手順'
					sections={[
						{
							title: '製品管理とは',
							content:
								'販売・仕入れする商品の情報を一元管理するページです。商品名・価格・在庫数・カテゴリなどを登録・編集できます。',
						},
						{
							title: '製品の登録方法',
							content:
								'1. 右上の「新規製品」ボタンをクリックする\n2. 製品名・説明・価格を入力する\n3. カテゴリと在庫数を設定する\n4. 必要に応じて画像をアップロードする\n5. 「保存」をクリックして登録完了',
						},
						{
							title: '価格設定',
							content:
								'製品ごとに「通常価格」「卸売価格」「特別価格」を設定できます。取引先（顧客）の種別に応じて異なる価格を適用することが可能です。',
						},
						{
							title: '在庫管理との連携',
							content:
								'製品詳細ページで在庫数の確認・更新ができます。詳細な在庫履歴は「在庫管理」ページからご確認ください。',
						},
					]}
				/>
				<Suspense
					fallback={
						<>
							<Skeleton className='h-[20px] rounded-full' />
							<Skeleton className='h-[20px] rounded-full' />
							<Skeleton className='h-[20px] rounded-full' />
						</>
					}
				>
					<ProductsList searchParams={{ filter, query }} tenant={tenant} />
				</Suspense>
			</MainLayout>
		</V1Layout>
	)
}
