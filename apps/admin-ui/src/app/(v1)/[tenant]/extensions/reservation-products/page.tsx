import { authWithCheck } from 'app/auth'
import { Button } from 'components/ui/button'
import { MainLayout, V1Layout } from 'components/v1-layout'
import { getGraphqlSdk } from 'lib/graphqlClient'
import { getServerModePrefix } from 'lib/mode'
import { ArrowLeftIcon, CreditCardIcon, PackageIcon } from 'lucide-react'
import type { Route } from 'next'
import Link from 'next/link'
import {
	fetchExtensionStatusesAction,
	updateReservationProductConfigAction,
} from '../action'
import { ReservationProductConfigForm } from '../extension-status-card'

export const metadata = {
	title: '予約対応商品設定 | TACHYON Field',
}

export default async function ReservationProductsPage({
	params: { tenant },
}: {
	params: { tenant: string }
}) {
	const prefix = getServerModePrefix(tenant)
	const statusesResult = await fetchExtensionStatusesAction(tenant)
	const extension = statusesResult.success
		? statusesResult.data.find(item => item.extensionKey === 'golf_course')
		: null
	const catalogProducts = await fetchCatalogProducts(tenant)

	return (
		<V1Layout current='extensions' tenant={tenant}>
			<MainLayout>
				<div className='flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between'>
					<div>
						<h1 className='text-2xl font-semibold'>予約対応商品設定</h1>
						<p className='mt-1 max-w-3xl text-sm text-muted-foreground'>
							商品マスタの商品を予約フォームに出すか、所要時間や入力項目とあわせて管理します。
						</p>
					</div>
					<Button asChild variant='outline'>
						<Link href={`${prefix}/${tenant}/extensions` as Route}>
							<ArrowLeftIcon className='mr-2 h-4 w-4' />
							予約設定へ戻る
						</Link>
					</Button>
				</div>

				<section className='grid gap-4'>
					<div className='grid gap-3 rounded-md border bg-muted/30 p-4 md:grid-cols-2'>
						<div className='flex items-start gap-3'>
							<div className='flex h-9 w-9 items-center justify-center rounded-md bg-background text-muted-foreground'>
								<PackageIcon className='h-4 w-4' />
							</div>
							<div>
								<h2 className='text-base font-semibold'>予約に出す商品</h2>
								<p className='mt-1 text-sm text-muted-foreground'>
									商品名と価格は商品マスタを正とし、予約受付条件だけをここで管理します。
								</p>
							</div>
						</div>
						<div className='flex items-start gap-3'>
							<div className='flex h-9 w-9 items-center justify-center rounded-md bg-background text-muted-foreground'>
								<CreditCardIcon className='h-4 w-4' />
							</div>
							<div>
								<h2 className='text-base font-semibold'>予約時決済</h2>
								<p className='mt-1 text-sm text-muted-foreground'>
									プランごとに必須、任意、現地払いを切り替えます。
								</p>
							</div>
						</div>
					</div>
					{extension ? (
						<ReservationProductConfigForm
							config={toReservationProductConfig(extension.configJson)}
							catalogProducts={catalogProducts}
							catalogProductsHref={
								`${prefix}/${tenant}/library/products` as Route
							}
							updateConfigAction={updateReservationProductConfigAction.bind(
								null,
								tenant,
							)}
						/>
					) : (
						<p className='text-sm text-destructive'>
							予約商品設定を読み込めませんでした。
						</p>
					)}
				</section>
			</MainLayout>
		</V1Layout>
	)
}

function toReservationProductConfig(config?: Record<string, unknown> | null) {
	if (!config) return null

	return {
		publicProductName: config.publicProductName,
		publicProductDescription: config.publicProductDescription,
		reservationProducts: config.reservationProducts,
		defaultDurationMinutes: config.defaultDurationMinutes,
		memberGuestPricing: config.memberGuestPricing,
	}
}

async function fetchCatalogProducts(tenant: string) {
	try {
		const session = await authWithCheck()
		const sdk = getGraphqlSdk(session, tenant)
		const response = await sdk.getProuctsForAdmin({ limit: 100, offset: 0 })
		return (response.products?.items ?? []).map(product => ({
			id: product.id,
			name: product.publicationName || product.name,
			listPrice: product.listPrice,
		}))
	} catch {
		return []
	}
}
