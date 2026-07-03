'use client'

import { Badge } from 'components/ui/badge'
import type { DataTableColumn } from 'components/ui/data-table'
import { DataTable } from 'components/ui/data-table'
import { CalendarClockIcon } from 'lucide-react'
import type { Route } from 'next'
import type {
	ReservationData,
	ReservationResourceData,
	ReservationTypeData,
	StaffMemberData,
} from './action'

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

const paymentStatusLabels: Record<string, string> = {
	not_required: '不要',
	unpaid: '未決済',
	partial: '一部入金',
	paid: '入金済み',
	failed: '決済失敗',
	cancelled: '決済取消',
	refund_pending: '返金待ち',
	refunded: '返金済み',
	fee_due: '手数料請求',
	fee_paid: '手数料入金済み',
}

export function ReservationListTable({
	initialPage,
	reservations,
	reservationResources = [],
	reservationTypes = [],
	staff,
	tenant,
}: {
	initialPage: number
	reservations: ReservationData[]
	reservationResources?: ReservationResourceData[]
	reservationTypes?: ReservationTypeData[]
	staff: StaffMemberData[]
	tenant: string
}) {
	const columns = buildReservationColumns(
		staff,
		reservationTypes,
		reservationResources,
	)

	return (
		<DataTable
			columns={columns}
			data={reservations}
			emptyMessage='予約はありません。'
			getRowHref={reservation =>
				`/${tenant}/reservations/${reservation.id}` as Route
			}
			getRowId={reservation => reservation.id}
			initialPage={initialPage}
			tableClassName='min-w-[1180px]'
		/>
	)
}

function buildReservationColumns(
	staff: StaffMemberData[],
	reservationTypes: ReservationTypeData[],
	reservationResources: ReservationResourceData[],
): DataTableColumn<ReservationData>[] {
	const reservationTypeById = new Map(
		reservationTypes.map(item => [item.id, item]),
	)
	const resourceById = new Map(
		reservationResources.map(item => [item.id, item]),
	)

	return [
		{
			accessorKey: 'reservationNumber',
			header: '予約 / 顧客',
			cell: ({ row }) => (
				<div className='min-w-0'>
					<div className='flex items-center gap-2'>
						<Badge variant='outline'>
							{statusLabels[row.original.status] ?? row.original.status}
						</Badge>
						<p className='truncate font-semibold'>
							{row.original.reservationNumber}
						</p>
					</div>
					<div className='mt-2'>
						<ReservationCustomerSummary reservation={row.original} />
					</div>
				</div>
			),
			meta: {
				cellClassName: 'min-w-[220px]',
			},
		},
		{
			accessorKey: 'startsAt',
			header: '日時',
			cell: ({ row }) => <ReservationDateCell reservation={row.original} />,
			meta: {
				cellClassName: 'min-w-[170px]',
			},
		},
		{
			id: 'operation',
			header: '運用',
			cell: ({ row }) => (
				<ReservationOperationCell
					reservation={row.original}
					reservationType={reservationTypeById.get(
						row.original.reservationTypeId,
					)}
					resource={
						row.original.resourceId
							? resourceById.get(row.original.resourceId)
							: undefined
					}
				/>
			),
			meta: {
				cellClassName: 'min-w-[220px]',
			},
		},
		{
			accessorKey: 'paymentStatus',
			header: '決済',
			cell: ({ row }) => <ReservationPaymentCell reservation={row.original} />,
			meta: {
				cellClassName: 'min-w-[180px]',
			},
		},
		{
			id: 'staff',
			header: '担当',
			cell: ({ row }) => (
				<AssignedStaffSummary reservation={row.original} staff={staff} />
			),
			meta: {
				cellClassName: 'min-w-[190px]',
			},
		},
		{
			accessorKey: 'priceAmount',
			header: '金額',
			cell: ({ row }) => (
				<p className='font-semibold tabular-nums'>
					{yen.format(row.original.priceAmount)}
				</p>
			),
			meta: {
				cellClassName: 'min-w-[160px] text-right',
				headerClassName: 'text-right',
			},
		},
	]
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

function ReservationOperationCell({
	reservation,
	reservationType,
	resource,
}: {
	reservation: ReservationData
	reservationType?: ReservationTypeData
	resource?: ReservationResourceData
}) {
	const chips = reservationOperationChips(reservation.customFieldsJson ?? {})

	return (
		<div className='min-w-0 text-sm'>
			<p className='truncate font-medium'>
				{reservationType?.name ?? reservation.reservationTypeId}
			</p>
			<p className='mt-1 truncate text-xs text-muted-foreground'>
				{resource?.name ?? reservation.resourceId ?? 'リソース未設定'}
			</p>
			{chips.length > 0 ? (
				<div className='mt-2 flex flex-wrap gap-1'>
					{chips.map(chip => (
						<Badge key={chip} variant='secondary'>
							{chip}
						</Badge>
					))}
				</div>
			) : null}
		</div>
	)
}

function reservationOperationChips(fields: Record<string, unknown>) {
	const candidates = [
		['slotLabel', '枠'],
		['slotName', '枠'],
		['productName', '商品'],
		['planName', 'プラン'],
		['partySize', '人数'],
	]
	return candidates
		.map(([key, label]) => {
			const value = fields[key]
			if (typeof value !== 'string' && typeof value !== 'number') return null
			const text = String(value).trim()
			return text ? `${label}: ${text}` : null
		})
		.filter((value): value is string => Boolean(value))
		.slice(0, 3)
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

function ReservationDateCell({
	reservation,
}: {
	reservation: ReservationData
}) {
	const date = formatReservationDateParts(
		reservation.startsAt,
		reservation.endsAt,
	)

	return (
		<div className='min-w-0'>
			<div className='flex items-start justify-between gap-3'>
				<div className='min-w-0'>
					<p className='text-[11px] font-medium text-muted-foreground'>
						来店日
					</p>
					<p className='mt-0.5 break-all text-base font-semibold leading-none tabular-nums'>
						{date.date}
					</p>
				</div>
				{date.weekday ? (
					<span className='shrink-0 rounded-md bg-muted px-2 py-1 text-[11px] font-semibold text-muted-foreground'>
						{date.weekday}
					</span>
				) : null}
			</div>
			<div className='mt-2 flex items-center gap-1.5 text-sm font-medium tabular-nums'>
				<CalendarClockIcon className='h-4 w-4 shrink-0 text-muted-foreground' />
				<span className='truncate'>{date.timeRange}</span>
			</div>
		</div>
	)
}

function AssignedStaffSummary({
	reservation,
	staff,
}: {
	reservation: ReservationData
	staff: StaffMemberData[]
}) {
	const staffById = new Map(staff.map(member => [member.id, member]))
	const assignedMembers = reservation.assignedStaffIds
		.map(staffId => staffById.get(staffId)?.name ?? `未登録: ${staffId}`)
		.filter(Boolean)

	if (assignedMembers.length === 0) {
		return (
			<div className='text-sm'>
				<p className='text-xs font-medium text-muted-foreground'>
					担当スタッフ
				</p>
				<p className='mt-1 text-muted-foreground'>未割当</p>
			</div>
		)
	}

	return (
		<div className='text-sm'>
			<p className='text-xs font-medium text-muted-foreground'>担当スタッフ</p>
			<div className='mt-2 flex flex-wrap gap-1'>
				{assignedMembers.map(name => (
					<Badge key={name} variant='secondary'>
						{name}
					</Badge>
				))}
			</div>
		</div>
	)
}

function paymentStatusTone(
	status: string,
): 'default' | 'secondary' | 'outline' {
	if (status === 'paid' || status === 'fee_paid') {
		return 'default'
	}
	if (status === 'not_required' || status === 'refunded') {
		return 'secondary'
	}
	return 'outline'
}

function reservationPaymentShortfall(reservation: ReservationData): number {
	const dueAmount =
		reservation.depositAmount > 0
			? reservation.depositAmount
			: reservation.priceAmount
	return Math.max(dueAmount - reservation.paidAmount, 0)
}

function ReservationPaymentCell({
	reservation,
}: {
	reservation: ReservationData
}) {
	const shortfall = reservationPaymentShortfall(reservation)
	const showShortfall =
		shortfall > 0 &&
		['unpaid', 'partial', 'failed', 'cancelled', 'fee_due'].includes(
			reservation.paymentStatus,
		)

	return (
		<div className='grid gap-1 text-sm'>
			<div className='flex flex-wrap items-center gap-2'>
				<Badge variant={paymentStatusTone(reservation.paymentStatus)}>
					{paymentStatusLabels[reservation.paymentStatus] ??
						reservation.paymentStatus}
				</Badge>
			</div>
			{showShortfall ? (
				<p className='text-xs text-destructive'>
					未回収 {yen.format(shortfall)}
				</p>
			) : null}
			<p className='text-xs text-muted-foreground'>
				入金 {yen.format(reservation.paidAmount)}
			</p>
		</div>
	)
}
