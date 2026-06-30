import { CouponsList } from 'app/(v1)/[tenant]/store/coupons/_components/coupons-list'
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbList,
	BreadcrumbPage,
} from 'components/ui/breadcrumb'
import { HelpPanel } from 'components/ui/help-panel'
import { Skeleton } from 'components/ui/skeleton'
import { MainLayout, V1Layout } from 'components/v1-layout'
import { Suspense } from 'react'

export const metadata = {
	title: 'クーポン管理 | TACHYON Field',
	description: 'クーポンコードの発行・管理ページです。',
}

export default async function CouponsPage({
	searchParams: { page },
	params: { tenant },
}: {
	searchParams: { page?: string }
	params: { tenant: string }
}) {
	return (
		<V1Layout
			current='coupons'
			tenant={tenant}
			breadcrumbs={
				<Breadcrumb>
					<BreadcrumbList>
						<BreadcrumbItem>
							<BreadcrumbPage>クーポン管理</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>
			}
		>
			<MainLayout>
				<HelpPanel
					storageKey='store-coupons'
					title='クーポン管理の使い方'
					summary='クーポンコードの発行・割引設定・無効化の手順'
					sections={[
						{
							title: 'クーポン管理とは',
							content:
								'顧客がチェックアウト時に入力するクーポンコードを発行・管理するページです。割引率または固定割引額を設定できます。',
						},
						{
							title: 'クーポンの作成方法',
							content:
								'1. 右上の「クーポンを作成」ボタンをクリックする\n2. クーポンコード（半角英数字）を入力する\n3. 割引タイプ（パーセンテージ / 固定額）を選択する\n4. 割引値を入力する（例: 20% OFFなら "20" を入力）\n5. 「作成」をクリックして完了',
						},
						{
							title: '割引タイプについて',
							content:
								'・パーセンテージ: 注文金額から指定した割合を割り引きます（例: 20%OFF）\n・固定額: 注文金額から指定した金額を割り引きます（例: 1,000円OFF）',
						},
						{
							title: 'クーポンの無効化',
							content:
								'使用を停止したいクーポンは「無効化」ボタンから無効にできます。無効化されたクーポンは顧客が使用できなくなります。',
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
					<CouponsList searchParams={{ page }} tenant={tenant} />
				</Suspense>
			</MainLayout>
		</V1Layout>
	)
}
