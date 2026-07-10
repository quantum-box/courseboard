import { Badge } from 'components/ui/badge'
import { Button } from 'components/ui/button'
import { MainLayout, V1Layout } from 'components/v1-layout'
import {
	CalendarClockIcon,
	CalendarDaysIcon,
	ChevronLeftIcon,
	ChevronRightIcon,
	ListIcon,
	SlidersHorizontalIcon,
} from 'lucide-react'
import type { Route } from 'next'
import Link from 'next/link'
import type React from 'react'
import {
	type ReservationData,
	type ReservationResourceData,
	type ReservationTypeData,
	type StaffMemberData,
	fetchReservationResourcesAction,
	fetchReservationTypesAction,
	fetchReservationsAction,
	fetchStaffMembersAction,
	releaseExpiredReservationHoldsAction,
} from './action'
import { ReservationListTable } from './reservation-list-table'
import {
	ReservationOperationsSummary,
	buildReservationOperationsMetrics,
} from './reservation-operations-summary'
import { ReservationReleaseExpiredHoldsForm } from './reservation-release-expired-holds-form'

const yen = new Intl.NumberFormat('ja-JP', {
	style: 'currency',
	currency: 'JPY',
	maximumFractionDigits: 0,
})

const statusLabels: Record<string, string> = {
	requested: '承認待ち',
	payment_pending: '決済待ち',
	confirmed: '確定',
	change_requested: '変更依頼',
	cancel_requested: '取消依頼',
	cancelled: '取消済み',
	rejected: '却下',
	no_show: '無断不参加',
	completed: '完了',
	waiting: '待機',
	admin_review: '管理者確認',
	suspended: '受付停止',
}

type ReservationView = 'list' | 'day' | 'week'

function normalizeReservationView(value?: string): ReservationView {
	return value === 'day' || value === 'week' ? value : 'list'
}

function normalizePageParam(value?: string): number {
	const page = Number(value)
	return Number.isInteger(page) && page > 0 ? page : 1
}

function parseDateParam(value?: string): Date {
	if (!value) {
		return new Date()
	}
	const [year, month, day] = value.split('-').map(Number)
	if (!year || !month || !day) {
		return new Date()
	}
	const date = new Date(year, month - 1, day)
	return Number.isNaN(date.getTime()) ? new Date() : date
}

function formatDateParam(value: Date): string {
	const year = value.getFullYear()
	const month = String(value.getMonth() + 1).padStart(2, '0')
	const day = String(value.getDate()).padStart(2, '0')
	return `${year}-${month}-${day}`
}

function addDays(value: Date, days: number): Date {
	const date = new Date(value)
	date.setDate(date.getDate() + days)
	return date
}

function isSameLocalDate(value: string, target: Date): boolean {
	const date = new Date(value)
	return (
		!Number.isNaN(date.getTime()) &&
		date.getFullYear() === target.getFullYear() &&
		date.getMonth() === target.getMonth() &&
		date.getDate() === target.getDate()
	)
}

function buildReservationsHref(
	tenant: string,
	{
		date,
		page,
		status,
		view,
	}: {
		date?: string
		page?: number
		status: string
		view: ReservationView
	},
) {
	const params = new URLSearchParams()
	params.set('status', status)
	if (view !== 'list') {
		params.set('view', view)
	}
	if (date && view !== 'list') {
		params.set('date', date)
	}
	if (view === 'list' && page && page > 1) {
		params.set('page', String(page))
	}
	return `/${tenant}/reservations?${params.toString()}` as Route
}

function formatCalendarDate(value: Date): string {
	return value.toLocaleDateString('ja-JP', {
		month: '2-digit',
		day: '2-digit',
		weekday: 'short',
	})
}

function formatReservationDateParts(startsAt: string, endsAt: string) {
	const start = new Date(startsAt)
	const end = new Date(endsAt)
	if (Number.isNaN(start.getTime())) {
		return {
			date: startsAt,
			timeRange: '日時を確認',
			weekday: '',
		}
	}

	const date = start.toLocaleDateString('ja-JP', {
		month: '2-digit',
		day: '2-digit',
	})
	const weekday = start.toLocaleDateString('ja-JP', {
		weekday: 'short',
	})
	const startTime = start.toLocaleTimeString('ja-JP', {
		hour: '2-digit',
		minute: '2-digit',
	})
	const endTime = Number.isNaN(end.getTime())
		? ''
		: end.toLocaleTimeString('ja-JP', {
				hour: '2-digit',
				minute: '2-digit',
			})

	return {
		date,
		timeRange: endTime ? `${startTime}-${endTime}` : startTime,
		weekday,
	}
}

export default async function ReservationsAdminPage({
	params: { tenant },
	searchParams: { date, page: rawPage, status = 'all', view: rawView },
}: {
	params: { tenant: string }
	searchParams: { date?: string; page?: string; status?: string; view?: string }
}) {
	const view = normalizeReservationView(rawView)
	const page = normalizePageParam(rawPage)
	const selectedDate = parseDateParam(date)
	const [
		reservationsResult,
		staffResult,
		reservationTypesResult,
		reservationResourcesResult,
	] = await Promise.all([
		fetchReservationsAction(tenant, status),
		fetchStaffMembersAction(tenant),
		fetchReservationTypesAction(tenant),
		fetchReservationResourcesAction(tenant),
	])
	const reservations = reservationsResult.success ? reservationsResult.data : []
	const staff = staffResult.success ? staffResult.data : []
	const reservationTypes = reservationTypesResult.success
		? reservationTypesResult.data
		: []
	const reservationResources = reservationResourcesResult.success
		? reservationResourcesResult.data
		: []

	return (
		<V1Layout current='reservations' tenant={tenant}>
			<MainLayout className='touch-pan-y overflow-visible'>
				<div className='grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start'>
					<div className='min-w-0'>
						<h1 className='text-2xl font-semibold'>予約管理</h1>
						<p className='mt-1 text-sm text-muted-foreground'>
							当日の受付、決済待ち、担当未割当を確認します。
						</p>
					</div>
					<div className='grid gap-2 sm:grid-cols-2 lg:justify-end'>
						<Button asChild variant='outline' className='w-full lg:w-auto'>
							<Link href={`/${tenant}/reservations/settings` as Route}>
								<SlidersHorizontalIcon className='mr-2 h-4 w-4' />
								予約設定
							</Link>
						</Button>
						<ReservationReleaseExpiredHoldsForm
							action={async () => {
								'use server'
								return releaseExpiredReservationHoldsAction(tenant)
							}}
						/>
					</div>
				</div>
				<nav aria-label='予約状態フィルタ' className='min-w-0 border-b pb-3'>
					<div className='flex gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0'>
						{[
							'all',
							'payment_pending',
							'confirmed',
							'waiting',
							'admin_review',
							'no_show',
							'change_requested',
							'cancelled',
							'suspended',
							'completed',
						].map(value => (
							<Button
								key={value}
								variant={status === value ? 'default' : 'outline'}
								size='sm'
								asChild
							>
								<Link
									href={buildReservationsHref(tenant, {
										date: formatDateParam(selectedDate),
										status: value,
										view,
									})}
								>
									{value === 'all' ? 'すべて' : statusLabels[value]}
								</Link>
							</Button>
						))}
					</div>
				</nav>
				{reservationsResult.success ? (
					<ReservationOperationsSummary
						reservations={reservations}
						tenant={tenant}
					/>
				) : null}
				<section className='min-w-0 rounded-lg border bg-background'>
					<div className='grid gap-3 border-b p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start sm:p-6'>
						<div>
							<h2 className='text-base font-semibold'>予約ビュー</h2>
							<p className='mt-1 text-sm text-muted-foreground'>
								一覧は運用キュー、日別と週は時間帯の重なりを確認します。
							</p>
						</div>
						<div className='grid gap-2 sm:grid-cols-[auto_auto] sm:items-center lg:justify-end'>
							<ReservationViewSwitcher
								date={formatDateParam(selectedDate)}
								status={status}
								tenant={tenant}
								view={view}
							/>
							<p className='text-sm text-muted-foreground sm:text-right'>
								{reservations.length}件
							</p>
						</div>
					</div>
					<div className='min-w-0 p-4 sm:p-6'>
						{reservationsResult.success ? (
							<ReservationViewContent
								reservations={reservations}
								selectedDate={selectedDate}
								page={page}
								reservationResources={reservationResources}
								reservationTypes={reservationTypes}
								staff={staff}
								status={status}
								tenant={tenant}
								view={view}
							/>
						) : (
							<p className='text-sm text-destructive'>
								{reservationsResult.message ?? '予約一覧を取得できませんでした'}
							</p>
						)}
					</div>
				</section>
			</MainLayout>
		</V1Layout>
	)
}

function ReservationViewSwitcher({
	date,
	status,
	tenant,
	view,
}: {
	date: string
	status: string
	tenant: string
	view: ReservationView
}) {
	const views: {
		icon: React.ComponentType<{ className?: string }>
		label: string
		value: ReservationView
	}[] = [
		{ icon: ListIcon, label: 'リスト', value: 'list' },
		{ icon: CalendarClockIcon, label: '日別', value: 'day' },
		{ icon: CalendarDaysIcon, label: '週', value: 'week' },
	]

	return (
		<nav
			aria-label='予約ビュー切替'
			className='inline-grid grid-cols-3 rounded-md border bg-muted/20 p-1'
		>
			{views.map(item => {
				const Icon = item.icon
				return (
					<Button
						asChild
						key={item.value}
						size='sm'
						variant={view === item.value ? 'default' : 'ghost'}
					>
						<Link
							href={buildReservationsHref(tenant, {
								date,
								status,
								view: item.value,
							})}
						>
							<Icon className='mr-2 h-4 w-4' />
							{item.label}
						</Link>
					</Button>
				)
			})}
		</nav>
	)
}

function ReservationViewContent({
	reservations,
	selectedDate,
	page,
	reservationResources,
	reservationTypes,
	staff,
	status,
	tenant,
	view,
}: {
	reservations: ReservationData[]
	selectedDate: Date
	page: number
	reservationResources: ReservationResourceData[]
	reservationTypes: ReservationTypeData[]
	staff: StaffMemberData[]
	status: string
	tenant: string
	view: ReservationView
}) {
	if (view === 'day') {
		return (
			<ReservationDayView
				reservations={reservations}
				selectedDate={selectedDate}
				staff={staff}
				status={status}
				tenant={tenant}
			/>
		)
	}
	if (view === 'week') {
		return (
			<ReservationWeekView
				reservations={reservations}
				selectedDate={selectedDate}
				staff={staff}
				status={status}
				tenant={tenant}
			/>
		)
	}
	return (
		<ReservationTable
			page={page}
			reservations={reservations}
			reservationResources={reservationResources}
			reservationTypes={reservationTypes}
			staff={staff}
			tenant={tenant}
		/>
	)
}

function ReservationCalendarNav({
	mode,
	selectedDate,
	status,
	tenant,
}: {
	mode: Exclude<ReservationView, 'list'>
	selectedDate: Date
	status: string
	tenant: string
}) {
	const step = mode === 'week' ? 7 : 1
	const previousDate = formatDateParam(addDays(selectedDate, -step))
	const nextDate = formatDateParam(addDays(selectedDate, step))
	const today = formatDateParam(new Date())

	return (
		<div className='grid gap-3 border-b pb-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center'>
			<div>
				<p className='text-base font-semibold'>
					{mode === 'week'
						? `${formatCalendarDate(selectedDate)} から7日間`
						: formatCalendarDate(selectedDate)}
				</p>
				<p className='mt-1 text-sm text-muted-foreground'>
					{mode === 'week'
						? '日別の予約数と時間帯を俯瞰します。'
						: '同日の来店順と担当を確認します。'}
				</p>
			</div>
			<div className='grid grid-cols-[1fr_1fr_1fr] gap-2 sm:w-auto'>
				<Button asChild size='sm' variant='outline'>
					<Link
						href={buildReservationsHref(tenant, {
							date: previousDate,
							status,
							view: mode,
						})}
					>
						<ChevronLeftIcon className='h-4 w-4' />
						<span className='sr-only'>前へ</span>
					</Link>
				</Button>
				<Button asChild size='sm' variant='outline'>
					<Link
						href={buildReservationsHref(tenant, {
							date: today,
							status,
							view: mode,
						})}
					>
						今日
					</Link>
				</Button>
				<Button asChild size='sm' variant='outline'>
					<Link
						href={buildReservationsHref(tenant, {
							date: nextDate,
							status,
							view: mode,
						})}
					>
						<ChevronRightIcon className='h-4 w-4' />
						<span className='sr-only'>次へ</span>
					</Link>
				</Button>
			</div>
		</div>
	)
}

function ReservationDayView({
	reservations,
	selectedDate,
	staff,
	status,
	tenant,
}: {
	reservations: ReservationData[]
	selectedDate: Date
	staff: StaffMemberData[]
	status: string
	tenant: string
}) {
	const dayReservations = reservations
		.filter(reservation => isSameLocalDate(reservation.startsAt, selectedDate))
		.sort(compareReservationsByStart)

	return (
		<div className='grid gap-4'>
			<ReservationCalendarNav
				mode='day'
				selectedDate={selectedDate}
				status={status}
				tenant={tenant}
			/>
			<ReservationDailyReport
				reservations={reservations}
				selectedDate={selectedDate}
				tenant={tenant}
			/>
			{dayReservations.length === 0 ? (
				<div className='rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground'>
					この日の予約はありません。
				</div>
			) : (
				<div className='min-w-0 overflow-hidden rounded-lg border'>
					{dayReservations.map(reservation => (
						<ReservationTimelineRow
							key={reservation.id}
							reservation={reservation}
							staff={staff}
							tenant={tenant}
						/>
					))}
				</div>
			)}
		</div>
	)
}

function ReservationDailyReport({
	reservations,
	selectedDate,
	tenant,
}: {
	reservations: ReservationData[]
	selectedDate: Date
	tenant: string
}) {
	const metrics = buildReservationOperationsMetrics(reservations, selectedDate)
	const date = formatDateParam(selectedDate)
	const items = [
		{
			label: '予約',
			value: `${metrics.todayReservations}件`,
		},
		{
			label: '担当割当済み',
			value: `${metrics.todayAssigned}件`,
		},
		{
			label: '担当未割当',
			value: `${metrics.todayUnassigned}件`,
		},
		{
			label: '完了待ち',
			value: `${metrics.awaitingCompletion}件`,
		},
		{
			label: '売上見込',
			value: yen.format(metrics.todayRevenueAmount),
		},
	]

	return (
		<section
			aria-label='選択日の予約レポート'
			className='grid gap-3 rounded-lg border bg-muted/20 p-3 sm:p-4'
		>
			<div className='grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center'>
				<div>
					<h3 className='text-sm font-semibold'>日次状況</h3>
					<p className='mt-1 text-sm text-muted-foreground'>
						{formatCalendarDate(selectedDate)} の受付、担当、売上見込です。
					</p>
				</div>
				<div className='grid gap-2 sm:grid-cols-[auto] lg:justify-end'>
					<Button asChild size='sm'>
						<Link
							href={`/${tenant}/reports/sales?preset=7d&date=${date}` as Route}
						>
							売上レポート
						</Link>
					</Button>
				</div>
			</div>
			<div className='grid gap-2 sm:grid-cols-2 xl:grid-cols-5'>
				{items.map(item => (
					<div key={item.label} className='rounded-md border bg-background p-3'>
						<p className='text-xs font-medium text-muted-foreground'>
							{item.label}
						</p>
						<p className='mt-1 text-lg font-semibold'>{item.value}</p>
					</div>
				))}
			</div>
		</section>
	)
}

function ReservationWeekView({
	reservations,
	selectedDate,
	staff,
	status,
	tenant,
}: {
	reservations: ReservationData[]
	selectedDate: Date
	staff: StaffMemberData[]
	status: string
	tenant: string
}) {
	const days = Array.from({ length: 7 }, (_, index) =>
		addDays(selectedDate, index),
	)

	return (
		<div className='grid gap-4'>
			<ReservationCalendarNav
				mode='week'
				selectedDate={selectedDate}
				status={status}
				tenant={tenant}
			/>
			<div className='grid min-w-0 overflow-hidden rounded-lg border lg:grid-cols-7'>
				{days.map(day => {
					const dayReservations = reservations
						.filter(reservation => isSameLocalDate(reservation.startsAt, day))
						.sort(compareReservationsByStart)
					return (
						<section
							aria-label={`${formatCalendarDate(day)}の予約`}
							className='min-w-0 border-b p-3 last:border-b-0 lg:border-b-0 lg:border-r lg:last:border-r-0'
							key={formatDateParam(day)}
						>
							<div className='flex items-center justify-between gap-2'>
								<h3 className='text-sm font-semibold'>
									{formatCalendarDate(day)}
								</h3>
								<Badge variant='secondary'>{dayReservations.length}件</Badge>
							</div>
							<div className='mt-3 grid gap-2'>
								{dayReservations.length === 0 ? (
									<p className='rounded-md border border-dashed px-3 py-4 text-center text-xs text-muted-foreground'>
										予約なし
									</p>
								) : null}
								{dayReservations.map(reservation => (
									<Link
										className='grid gap-1 rounded-md border bg-background p-2 text-sm transition hover:bg-muted/50'
										href={`/${tenant}/reservations/${reservation.id}` as Route}
										key={reservation.id}
									>
										<span className='font-medium tabular-nums'>
											{formatReservationTimeRange(reservation)}
										</span>
										<span className='truncate text-xs'>
											{reservation.customerName ??
												reservation.reservationNumber}
										</span>
										<span className='truncate text-xs text-muted-foreground'>
											{assignedStaffText(reservation, staff)}
										</span>
									</Link>
								))}
							</div>
						</section>
					)
				})}
			</div>
		</div>
	)
}

function ReservationTimelineRow({
	reservation,
	staff,
	tenant,
}: {
	reservation: ReservationData
	staff: StaffMemberData[]
	tenant: string
}) {
	const href = `/${tenant}/reservations/${reservation.id}` as Route

	return (
		<Link
			className='grid gap-3 border-b p-3 transition last:border-b-0 hover:bg-muted/50 md:grid-cols-[140px_minmax(0,1fr)_150px] md:items-center'
			href={href}
		>
			<div className='text-sm'>
				<p className='font-semibold tabular-nums'>
					{formatReservationTimeRange(reservation)}
				</p>
				<p className='mt-1 text-xs text-muted-foreground'>
					{reservation.reservationNumber}
				</p>
			</div>
			<div className='min-w-0'>
				<div className='flex flex-wrap items-center gap-2'>
					<Badge variant='outline'>
						{statusLabels[reservation.status] ?? reservation.status}
					</Badge>
					<ReservationCustomerSummary reservation={reservation} />
				</div>
				<p className='mt-1 truncate text-xs text-muted-foreground'>
					{assignedStaffText(reservation, staff)}
				</p>
			</div>
			<div className='text-sm md:text-right'>
				<p className='font-semibold'>{yen.format(reservation.priceAmount)}</p>
				<p className='text-xs text-muted-foreground'>
					入金 {yen.format(reservation.paidAmount)}
				</p>
			</div>
		</Link>
	)
}

function ReservationTable({
	page,
	reservations,
	reservationResources,
	reservationTypes,
	staff,
	tenant,
}: {
	page: number
	reservations: ReservationData[]
	reservationResources: ReservationResourceData[]
	reservationTypes: ReservationTypeData[]
	staff: StaffMemberData[]
	tenant: string
}) {
	return (
		<ReservationListTable
			initialPage={page}
			reservations={reservations}
			reservationResources={reservationResources}
			reservationTypes={reservationTypes}
			staff={staff}
			tenant={tenant}
		/>
	)
}

function ReservationCustomerSummary({
	reservation,
}: {
	reservation: ReservationData
}) {
	const label =
		reservation.customerName ??
		reservation.customerEmail ??
		reservation.customerPhone ??
		'顧客未設定'

	return <p className='min-w-0 truncate font-medium'>{label}</p>
}

function compareReservationsByStart(
	left: ReservationData,
	right: ReservationData,
) {
	return new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime()
}

function formatReservationTimeRange(reservation: ReservationData): string {
	return formatReservationDateParts(reservation.startsAt, reservation.endsAt)
		.timeRange
}

function assignedStaffText(
	reservation: ReservationData,
	staff: StaffMemberData[],
): string {
	const staffById = new Map(staff.map(member => [member.id, member.name]))
	const names = reservation.assignedStaffIds
		.map(staffId => staffById.get(staffId) ?? `未登録: ${staffId}`)
		.filter(Boolean)
	return names.length > 0 ? names.join(' / ') : '未割当'
}
