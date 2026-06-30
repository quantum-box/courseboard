import { Button } from 'components/ui/button'
import {
	Card,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from 'components/ui/card'

import { Skeleton } from 'components/ui/skeleton'
import { Suspense } from 'react'
import { DetailOrderCard } from './detail-order'
import { MonthlyCard } from './monthly-card'
import { OrderList } from './order-list'
import { WeeklyCard } from './weekly-card'

export async function RecentOrders({
	tenantId,
	currentOrderId,
}: {
	tenantId: string
	currentOrderId?: string
}) {
	return (
		<main className='grid flex-1 items-start gap-4 p-4 sm:px-6 sm:py-0 md:gap-8 lg:grid-cols-3 xl:grid-cols-3'>
			<div className='grid auto-rows-max items-start gap-4 md:gap-8 lg:col-span-2'>
				<div className='grid gap-4 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4'>
					<Card className='sm:col-span-2'>
						<CardHeader className='pb-3'>
							<CardTitle>あなたの注文</CardTitle>
							<CardDescription className='max-w-lg text-balance leading-relaxed'>
								シームレスな管理と洞察に満ちた分析のための動的な注文ダッシュボードをご紹介します。
							</CardDescription>
						</CardHeader>
						<CardFooter>
							<Button>新規注文を作成</Button>
						</CardFooter>
					</Card>
					<Suspense fallback={<Skeleton className='h-40 w-full rounded-xl' />}>
						<WeeklyCard tenantId={tenantId} />
					</Suspense>
					<Suspense fallback={<Skeleton className='h-40 w-full rounded-xl' />}>
						<MonthlyCard tenantId={tenantId} />
					</Suspense>
				</div>
				<Suspense fallback={<Skeleton className='h-40 w-full rounded-xl' />}>
					<OrderList tenant_id={tenantId} />
				</Suspense>
			</div>
			<div>
				<DetailOrderCard id={currentOrderId} tenantId={tenantId} />
			</div>
		</main>
	)
}
