import { authWithCheck } from 'app/auth'
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from 'components/ui/breadcrumb'
import { Button } from 'components/ui/button'
import { MainLayout, V1Layout } from 'components/v1-layout'
import {
	GOLF_COURSE_EXTENSION_KEY,
	golfCourseAdminPaths,
} from 'lib/extension-admin-registry'
import { getGraphqlSdk } from 'lib/graphqlClient'
import { libraryMasterErrorDetails } from 'lib/library-master-errors'
import { getServerModePrefix } from 'lib/mode'
import { ArrowLeftIcon, CalendarDaysIcon, ClockIcon, CreditCardIcon, PackageIcon } from 'lucide-react'
import type { Route } from 'next'
import Link from 'next/link'
import { fetchReservationTypesAction } from '../../../reservations/action'
import {
	fetchExtensionStatusesAction,
	updateReservationProductConfigAction,
} from '../../action'
import { ReservationProductConfigForm } from '../../extension-status-card'
import { fetchGolfReservationProductsAction } from './golf-product-action'
import { GolfProductConfigForm } from './golf-product-form'
import { fetchGolfProductSlotsAction } from './golf-product-slots-action'
import { GolfProductSlotsForm } from './golf-product-slots-form'

export const metadata = {
	title: 'ゴルフ予約商品設定 | TACHYON Field',
}

export default async function ReservationProductsPage({
	params: { tenant },
}: {
	params: { tenant: string }
}) {
	const prefix = getServerModePrefix(tenant)
	const golfAppHref =
		`${prefix}/${tenant}${golfCourseAdminPaths.portal}` as Route
	const statusesResult = await fetchExtensionStatusesAction(tenant)
	const extension = statusesResult.success
		? statusesResult.data.find(
				item => item.extensionKey === GOLF_COURSE_EXTENSION_KEY,
			)
		: null
	const catalogProductsResult = await fetchCatalogProducts(tenant)
	const reservationTypesResult = await fetchReservationTypesAction(tenant)
	const reservationTypes = reservationTypesResult.success
		? reservationTypesResult.data
		: []
	const golfProductsResult = await fetchGolfReservationProductsAction(tenant)
	const golfProducts = golfProductsResult.success ? golfProductsResult.data : []
	const golfProductSlotsMap = Object.fromEntries(
		await Promise.all(
			golfProducts.map(async p => {
				const r = await fetchGolfProductSlotsAction(
					tenant,
					p.reservationServiceId,
				)
				return [p.reservationServiceId, r.success ? r.data : []] as const
			}),
		),
	)

	return (
		<V1Layout
			current='extensions'
			tenant={tenant}
			breadcrumbs={
				<Breadcrumb>
					<BreadcrumbList>
						<BreadcrumbItem>
							<BreadcrumbLink asChild>
								<Link href={`${prefix}/${tenant}/home` as Route}>ホーム</Link>
							</BreadcrumbLink>
						</BreadcrumbItem>
						<BreadcrumbSeparator />
						<BreadcrumbItem>
							<BreadcrumbLink asChild>
								<Link href={`${prefix}/${tenant}/extensions` as Route}>
									アプリ
								</Link>
							</BreadcrumbLink>
						</BreadcrumbItem>
						<BreadcrumbSeparator />
						<BreadcrumbItem>
							<BreadcrumbLink asChild>
								<Link href={golfAppHref}>ゴルフアプリ</Link>
							</BreadcrumbLink>
						</BreadcrumbItem>
						<BreadcrumbSeparator />
						<BreadcrumbItem>
							<BreadcrumbPage>ゴルフ予約商品設定</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>
			}
		>
			<MainLayout className='touch-pan-y overflow-visible pb-8'>
				<div className='flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between'>
					<div>
						<h1 className='text-2xl font-semibold'>ゴルフ予約商品設定</h1>
						<p className='mt-1 max-w-3xl text-sm text-muted-foreground'>
							ゴルフ場の公開予約に出す商品、プレープラン、受付条件を管理します。
						</p>
					</div>
					<Button asChild variant='outline'>
						<Link href={golfAppHref}>
							<ArrowLeftIcon className='mr-2 h-4 w-4' />
							ゴルフアプリへ戻る
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
									商品名と価格は商品マスタを正とし、ゴルフ予約の受付条件だけをここで管理します。
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
									プレープランごとに必須、任意、現地払いを切り替えます。
								</p>
							</div>
						</div>
					</div>
					{extension ? (
						<ReservationProductConfigForm
							config={toReservationProductConfig(extension.configJson)}
							catalogProducts={catalogProductsResult.products}
							catalogProductsError={catalogProductsResult.error}
							reservationTypes={reservationTypes}
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

				<section className='grid gap-4'>
					<div className='flex items-start gap-3 rounded-md border bg-muted/30 p-4'>
						<div className='flex h-9 w-9 items-center justify-center rounded-md bg-background text-muted-foreground'>
							<ClockIcon className='h-4 w-4' />
						</div>
						<div>
							<h2 className='text-base font-semibold'>
								ゴルフプレー区分・ホール数設定
							</h2>
							<p className='mt-1 text-sm text-muted-foreground'>
								各予約サービスのプレー区分（キャディ付き／セルフ）・ホール数・所要時間を設定します。
							</p>
						</div>
					</div>
					{golfProducts.length > 0 ? (
						<div className='grid gap-2'>
							{golfProducts.map(product => (
								<GolfProductConfigForm
									key={product.reservationServiceId}
									tenant={tenant}
									serviceId={product.reservationServiceId}
									serviceName={product.reservationServiceId}
									existing={product}
								/>
							))}
						</div>
					) : (
						<p className='text-sm text-muted-foreground'>
							ゴルフプレー設定が登録されている予約サービスはありません。
						</p>
					)}
				</section>

				<section className='grid gap-4'>
					<div className='flex items-start gap-3 rounded-md border bg-muted/30 p-4'>
						<div className='flex h-9 w-9 items-center justify-center rounded-md bg-background text-muted-foreground'>
							<CalendarDaysIcon className='h-4 w-4' />
						</div>
						<div>
							<h2 className='text-base font-semibold'>
								時間帯×曜日×枠数スロット設定
							</h2>
							<p className='mt-1 text-sm text-muted-foreground'>
								商品ごとに受付できる時間帯・曜日・最大組数／人数を設定します。0は制限なしを意味します。
							</p>
						</div>
					</div>
					{golfProducts.length > 0 ? (
						<div className='grid gap-3'>
							{golfProducts.map(product => (
								<div
									key={product.reservationServiceId}
									className='rounded-md border bg-background p-4'
								>
									<h3 className='mb-3 text-sm font-semibold'>
										{product.reservationServiceId}
									</h3>
									<GolfProductSlotsForm
										tenant={tenant}
										serviceId={product.reservationServiceId}
										initialSlots={
											golfProductSlotsMap[product.reservationServiceId] ?? []
										}
										playType={product.playType}
									/>
								</div>
							))}
						</div>
					) : (
						<p className='text-sm text-muted-foreground'>
							スロット設定対象の商品がありません。先にプレー区分設定を行ってください。
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
		return {
			products: (response.products?.items ?? []).map(product => ({
				id: product.id,
				name: product.publicationName || product.name,
				listPrice: product.listPrice,
			})),
			error: null,
		}
	} catch (error) {
		const details = libraryMasterErrorDetails(error)
		return {
			products: [],
			error:
				details?.message ??
				'商品マスタを読み込めませんでした。Field API と Tachyon API の接続状態を確認してください。',
		}
	}
}
