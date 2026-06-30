import { Badge } from 'components/ui/badge'
import React from 'react'
import type { ReservationData } from './action'

type CheckInTone = 'default' | 'secondary' | 'outline' | 'destructive'

export type ReservationCheckInSummary = {
	label: string
	detail: string
	tone: CheckInTone
}

const CLOSED_STATUS_LABELS: Record<string, ReservationCheckInSummary> = {
	cancelled: {
		label: '受付対象外',
		detail: '取消済みです。返金やキャンセル料の後処理を確認してください。',
		tone: 'secondary',
	},
	completed: {
		label: '受付完了',
		detail: '来場処理は完了済みです。',
		tone: 'secondary',
	},
	no_show: {
		label: '無断不参加',
		detail: '無断不参加として記録済みです。後処理を確認してください。',
		tone: 'destructive',
	},
}

function minutesBetween(left: Date, right: Date): number {
	return Math.round((left.getTime() - right.getTime()) / 60_000)
}

export function buildReservationCheckInSummary(
	reservation: ReservationData,
	now = new Date(),
): ReservationCheckInSummary {
	const closed = CLOSED_STATUS_LABELS[reservation.status]
	if (closed) {
		return closed
	}

	const startsAt = new Date(reservation.startsAt)
	const endsAt = new Date(reservation.endsAt)
	if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
		return {
			label: '日時確認',
			detail: '予約日時を解釈できません。予約データを確認してください。',
			tone: 'destructive',
		}
	}

	const minutesUntilStart = minutesBetween(startsAt, now)
	const minutesAfterEnd = minutesBetween(now, endsAt)
	const sameDay =
		startsAt.getFullYear() === now.getFullYear() &&
		startsAt.getMonth() === now.getMonth() &&
		startsAt.getDate() === now.getDate()

	if (
		reservation.status === 'requested' ||
		reservation.status === 'change_requested'
	) {
		return {
			label: '承認確認',
			detail: '受付前に予約内容の承認または変更対応が必要です。',
			tone: 'outline',
		}
	}

	if (reservation.status === 'payment_pending') {
		return {
			label: '決済確認',
			detail: '受付前に事前決済または支払い案内の状況を確認してください。',
			tone: 'outline',
		}
	}

	if (!sameDay && minutesUntilStart > 0) {
		return {
			label: '予定前',
			detail: '当日受付の対象ではありません。',
			tone: 'secondary',
		}
	}

	if (minutesUntilStart > 60) {
		return {
			label: '本日予定',
			detail: '開始 60 分前から受付準備の対象です。',
			tone: 'secondary',
		}
	}

	if (minutesUntilStart > 0) {
		return {
			label: '受付準備',
			detail: `開始まで約 ${minutesUntilStart} 分です。担当とリソースを確認してください。`,
			tone: 'default',
		}
	}

	if (minutesAfterEnd <= 0) {
		return {
			label: '受付中',
			detail: '来場済みであれば受付/完了を記録してください。',
			tone: 'default',
		}
	}

	return {
		label: '完了確認',
		detail:
			'予約時間を過ぎています。来場済みなら受付/完了、未着なら無断不参加を記録してください。',
		tone: 'destructive',
	}
}

export function ReservationCheckInPanel({
	compact = false,
	reservation,
	now,
}: {
	compact?: boolean
	reservation: ReservationData
	now?: Date
}) {
	const summary = buildReservationCheckInSummary(reservation, now)

	if (compact) {
		return (
			<div
				aria-label={`${summary.label}: ${summary.detail}`}
				className='mt-2 flex items-center gap-2'
				title={summary.detail}
			>
				<Badge className='shrink-0 whitespace-nowrap' variant={summary.tone}>
					{summary.label}
				</Badge>
				<span className='sr-only'>{summary.detail}</span>
			</div>
		)
	}

	return (
		<div className='grid gap-1 rounded-md border bg-muted/30 p-3 text-sm'>
			<div className='flex items-center justify-between gap-2'>
				<p className='text-xs font-medium text-muted-foreground'>受付状態</p>
				<Badge variant={summary.tone}>{summary.label}</Badge>
			</div>
			<p className='text-xs text-muted-foreground'>{summary.detail}</p>
		</div>
	)
}
