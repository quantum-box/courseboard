import { PickupOrderList } from 'app/(v1)/[tenant]/store/pickup/_components/pickup-order-list'
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
	title: '店舗受取管理 | TACHYON Field',
	description: '店舗受取注文の管理ページです。',
}

export default async function StorePickupPage({
	searchParams: { page, status },
	params: { tenant },
}: {
	searchParams: { page?: string; status?: string }
	params: { tenant: string }
}) {
	return (
		<V1Layout
			current='store-pickup'
			tenant={tenant}
			breadcrumbs={
				<Breadcrumb>
					<BreadcrumbList>
						<BreadcrumbItem>
							<BreadcrumbPage>店舗受取管理</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>
			}
		>
			<MainLayout>
				<PageHeader
					title='店舗受取管理'
					description='店頭受取注文の準備状況と引き渡し状況を確認します'
				/>
				<HelpPanel
					storageKey='store-pickup'
					title='店舗受取管理の使い方'
					summary='店頭受取注文の確認・引き渡し手順'
					sections={[
						{
							title: '店舗受取管理とは',
							content:
								'顧客が店頭で商品を受け取る「店舗受取」注文を管理するページです。オンラインで注文した商品を来店時に引き渡す際に使用します。',
						},
						{
							title: '受取ステータスの種類',
							content:
								'・受取待ち: 商品が準備でき、顧客の来店を待っている状態\n・受取完了: 顧客が来店して商品を受け取った状態\n・キャンセル: 注文がキャンセルされた状態',
						},
						{
							title: '引き渡し手順',
							content:
								'1. 顧客が来店したら注文番号または予約名で検索する\n2. 該当の注文行をクリックして詳細を確認する\n3. 本人確認後に商品を引き渡す\n4. 「受取完了」ボタンをクリックしてステータスを更新する',
						},
						{
							title: '注文の準備',
							content:
								'「受取待ち」の注文は事前に商品を準備しておく必要があります。準備が完了したら「準備完了」のステータスに更新すると、顧客への通知メールが自動送信されます。',
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
					<PickupOrderList searchParams={{ page, status }} tenant={tenant} />
				</Suspense>
			</MainLayout>
		</V1Layout>
	)
}
