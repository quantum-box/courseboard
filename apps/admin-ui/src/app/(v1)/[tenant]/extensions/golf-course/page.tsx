import { Badge } from 'components/ui/badge'
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
import { getServerModePrefix } from 'lib/mode'
import {
	ArrowLeftIcon,
	CalendarCheckIcon,
	ChevronRightIcon,
	FileTextIcon,
	FlagIcon,
	TrendingUpIcon,
	UsersIcon,
} from 'lucide-react'
import type { Route } from 'next'
import Link from 'next/link'
import { fetchExtensionStatusesAction } from '../action'

export const metadata = {
	title: 'ゴルフアプリ | TACHYON Field',
	description: 'Golf course app on TACHYON Field OS.',
}

export default async function GolfCourseExtensionPortalPage({
	params: { tenant },
}: {
	params: { tenant: string }
}) {
	const prefix = getServerModePrefix(tenant)
	const extensionsHref = `${prefix}/${tenant}/extensions` as Route
	const statusesResult = await fetchExtensionStatusesAction(tenant)
	const extension = statusesResult.success
		? statusesResult.data.find(
				item => item.extensionKey === GOLF_COURSE_EXTENSION_KEY,
			)
		: null
	const enabled = extension?.tenantStatus === 'enabled'
	const valid = extension?.validation.valid ?? true

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
								<Link href={extensionsHref}>アプリ</Link>
							</BreadcrumbLink>
						</BreadcrumbItem>
						<BreadcrumbSeparator />
						<BreadcrumbItem>
							<BreadcrumbPage>ゴルフアプリ</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>
			}
		>
			<MainLayout>
				<div className='grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start'>
					<div className='min-w-0 space-y-1'>
						<h1 className='text-2xl font-semibold'>ゴルフアプリ</h1>
						<p className='max-w-3xl text-sm text-muted-foreground'>
							TACHYON Field OS
							にゴルフ場運用を追加し、公開予約の商品、キャディ運用、月次精算を管理します。
						</p>
					</div>
					<Button asChild variant='outline' className='w-full lg:w-auto'>
						<Link href={extensionsHref}>
							<ArrowLeftIcon className='mr-2 h-4 w-4' />
							アプリ一覧へ戻る
						</Link>
					</Button>
				</div>

				<section className='grid gap-3 rounded-md border bg-background p-4 sm:grid-cols-3'>
					<StatusMetric label='状態' value={enabled ? '有効' : '無効'} />
					<StatusMetric
						label='設定'
						value={
							extension?.configVersion ? `v${extension.configVersion}` : '-'
						}
					/>
					<StatusMetric label='検証' value={valid ? 'OK' : '要確認'} />
				</section>

				{extension && !valid ? (
					<div className='rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive'>
						<p className='font-medium'>設定の確認事項があります</p>
						<p className='mt-1 leading-6'>
							{extension.validation.errors[0] ??
								'アプリ設定を確認してください。'}
						</p>
					</div>
				) : null}

				<section className='overflow-hidden rounded-md border bg-background'>
					<div className='border-b px-4 py-3'>
						<h2 className='text-base font-semibold'>管理メニュー</h2>
						<p className='mt-1 text-sm text-muted-foreground'>
							日々の運用で使う画面へ移動します。設定と実績確認をここに集約します。
						</p>
					</div>
					<div className='divide-y'>
						<PortalRow
							href={`${prefix}/${tenant}${golfCourseAdminPaths.courses}`}
							icon={FlagIcon}
							title='コース管理'
							description='ゴルフ場コースのマスタを登録・編集します。対応可能コース・枠管理の基礎データです。'
							meta='マスタ'
						/>
						<PortalRow
							href={`${prefix}/${tenant}${golfCourseAdminPaths.reservationProducts}`}
							icon={FlagIcon}
							title='予約商品・販売カレンダー'
							description='商品マスタの商品を公開予約に出し、曜日・除外日・予約枠を管理します。'
							meta='公開予約'
						/>
						<PortalRow
							href={`${prefix}/${tenant}${golfCourseAdminPaths.caddies}`}
							icon={UsersIcon}
							title='キャディ管理'
							description='キャディのプロフィール、割当、勤怠スナップショット、給与連携CSVを確認します。'
							meta='運用'
						/>
						<PortalRow
							href={`${prefix}/${tenant}${golfCourseAdminPaths.settlement}`}
							icon={FileTextIcon}
							title='月次精算'
							description='予約売上、キャディ費用、キャンセル料、Square 照合を月次で確認します。'
							meta='月次'
						/>
						<PortalRow
							href={`${prefix}/${tenant}${golfCourseAdminPaths.budgets}`}
							icon={TrendingUpIcon}
							title='予算マスタ'
							description='コース別・日別の目標売上・客単価・キャディ付き比率を管理します。'
							meta='マスタ'
						/>
						<PortalRow
							href={`${prefix}/${tenant}/reservations`}
							icon={CalendarCheckIcon}
							title='予約一覧'
							description='当日の受付、決済待ち、担当未割当、来場処理の対象を確認します。'
							meta='共通'
						/>
					</div>
				</section>
			</MainLayout>
		</V1Layout>
	)
}

function StatusMetric({ label, value }: { label: string; value: string }) {
	return (
		<div className='min-w-0'>
			<p className='text-xs font-medium text-muted-foreground'>{label}</p>
			<p className='mt-1 truncate text-lg font-semibold'>{value}</p>
		</div>
	)
}

function PortalRow({
	description,
	href,
	icon: Icon,
	meta,
	title,
}: {
	description: string
	href: string
	icon: typeof FlagIcon
	meta: string
	title: string
}) {
	return (
		<Link
			href={href as Route}
			className='grid min-w-0 gap-3 px-4 py-4 transition hover:bg-muted/40 sm:grid-cols-[2.25rem_minmax(0,1fr)_auto_auto] sm:items-center'
		>
			<div className='flex h-9 w-9 items-center justify-center rounded-md bg-muted text-muted-foreground'>
				<Icon className='h-4 w-4' />
			</div>
			<div className='min-w-0'>
				<div className='flex flex-wrap items-center gap-2'>
					<h3 className='text-sm font-semibold'>{title}</h3>
					<Badge variant='secondary'>{meta}</Badge>
				</div>
				<p className='mt-1 text-sm leading-6 text-muted-foreground'>
					{description}
				</p>
			</div>
			<span className='hidden text-xs text-muted-foreground sm:inline'>
				開く
			</span>
			<ChevronRightIcon className='hidden h-4 w-4 text-muted-foreground sm:block' />
		</Link>
	)
}
