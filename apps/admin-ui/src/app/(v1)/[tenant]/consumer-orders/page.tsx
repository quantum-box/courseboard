import { ConsumerOrderList } from 'app/(v1)/[tenant]/consumer-orders/_components/consumer-order-list'
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbList,
	BreadcrumbPage,
} from 'components/ui/breadcrumb'
import { HelpPanel } from 'components/ui/help-panel'
import { PageHeader } from 'components/ui/page-shell'
import { Skeleton } from 'components/ui/skeleton'
import { MainLayout, V1Layout } from 'components/v1-layout'
import { Suspense } from 'react'

export const metadata = {
	title: '受注管理 | TACHYON Field',
	description: '受注管理ページです。',
}

export default async function ConsumerOrdersPage({
	searchParams: { page, status },
	params: { tenant },
}: {
	searchParams: { page?: string; status?: string }
	params: { tenant: string }
}) {
	return (
		<V1Layout
			current='consumer-orders'
			tenant={tenant}
			breadcrumbs={
				<Breadcrumb>
					<BreadcrumbList>
						<BreadcrumbItem>
							<BreadcrumbPage>受注管理</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>
			}
		>
			<MainLayout>
				<PageHeader
					title='受注管理'
					description='EC注文のステータス、受取方法、対応状況を確認します'
				/>
				<HelpPanel
					storageKey='consumer-orders'
					title='受注管理の使い方'
					summary='注文一覧の確認・ステータス管理の手順'
					sections={[
						{
							title: '受注管理とは',
							content:
								'顧客から受け付けた注文を一覧で管理するページです。注文ごとの詳細確認、ステータスの更新、対応状況の把握ができます。',
						},
						{
							title: 'ステータスの種類',
							content:
								'・新規受注: 注文が入ったばかりの状態\n・処理中: 対応作業が進行中の状態\n・発送済: 商品を発送した状態\n・完了: 取引が完結した状態\n・キャンセル: 注文がキャンセルされた状態',
						},
						{
							title: '注文の対応フロー',
							content:
								'1. 新規受注を確認する\n2. 注文詳細をクリックして内容を確認する\n3. 在庫や配送状況を確認する\n4. ステータスを「処理中」に更新して作業を開始する\n5. 発送が完了したら「発送済」に更新する\n6. 顧客への引き渡しが完了したら「完了」にする',
						},
						{
							title: '絞り込み・検索',
							content:
								'ページ上部のフィルターでステータスや日付範囲を絞り込めます。特定の注文を素早く見つけるには検索バーをご利用ください。',
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
					<ConsumerOrderList searchParams={{ page, status }} tenant={tenant} />
				</Suspense>
			</MainLayout>
		</V1Layout>
	)
}
