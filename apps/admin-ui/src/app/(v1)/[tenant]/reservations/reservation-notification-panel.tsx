'use client'

import * as React from 'react'
import { Badge } from 'components/ui/badge'
import { Button } from 'components/ui/button'
import { useFormState } from 'react-dom'
import type { ReservationData, ReservationNotificationKind } from './action'
import {
	ReservationMutationErrorAlert,
	initialReservationMutationActionState,
	type ReservationMutationFormAction,
} from './reservation-mutation-action-state'

type NotificationStatus = 'sent' | 'failed' | 'not_sent' | 'blocked'

type NotificationItem = {
	kind: ReservationNotificationKind
	label: string
	description: string
	status: NotificationStatus
	statusLabel: string
	lastSentAt: string | null
	blockedReason?: string
}

const notificationDefinitions: Array<
	Pick<NotificationItem, 'kind' | 'label' | 'description'>
> = [
	{
		kind: 'confirmation',
		label: '予約確認',
		description: '予約確定後に日時・決済案内を送ります。',
	},
	{
		kind: 'reminder',
		label: '前日リマインダー',
		description: '来店前日の持ち物・到着案内を送ります。',
	},
	{
		kind: 'change_cancellation',
		label: '変更/キャンセル',
		description: '変更依頼・取消時の次アクションを送ります。',
	},
]

const markerPattern =
	/\[reservation-notification\s+kind=([a-z_]+)\s+status=([a-z_]+)\s+at=([^\s\]]+)/g

function formatNotificationDate(value: string | null) {
	if (!value) {
		return null
	}
	const date = new Date(value)
	if (Number.isNaN(date.getTime())) {
		return value
	}
	return date.toLocaleString('ja-JP', {
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
	})
}

function hasReachableContact(reservation: ReservationData) {
	return Boolean(reservation.customerEmail || reservation.customerPhone)
}

export function buildReservationNotificationItems(
	reservation: ReservationData,
): NotificationItem[] {
	const latestByKind = new Map<
		ReservationNotificationKind,
		{ status: string; at: string }
	>()
	const notes = reservation.internalNotes ?? ''
	markerPattern.lastIndex = 0
	let match = markerPattern.exec(notes)
	while (match) {
		const kind = match[1] as ReservationNotificationKind
		if (!notificationDefinitions.some(item => item.kind === kind)) {
			match = markerPattern.exec(notes)
			continue
		}
		latestByKind.set(kind, { status: match[2], at: match[3] })
		match = markerPattern.exec(notes)
	}

	return notificationDefinitions.map(definition => {
		const latest = latestByKind.get(definition.kind)
		const blockedReason = hasReachableContact(reservation)
			? undefined
			: 'メールまたは電話番号が未登録'
		const rawStatus = latest?.status
		const status: NotificationStatus = blockedReason
			? 'blocked'
			: rawStatus === 'sent'
				? 'sent'
				: rawStatus === 'failed'
					? 'failed'
					: 'not_sent'
		const statusLabel =
			status === 'sent'
				? '送信済み'
				: status === 'failed'
					? '失敗'
					: status === 'blocked'
						? '送信不可'
						: '未送信'
		return {
			...definition,
			status,
			statusLabel,
			lastSentAt: latest?.at ?? null,
			blockedReason,
		}
	})
}

function statusVariant(status: NotificationStatus) {
	if (status === 'sent') return 'secondary'
	if (status === 'failed') return 'destructive'
	return 'outline'
}

export function ReservationNotificationPanel({
	actionForKind,
	reservation,
	size = 'default',
}: {
	actionForKind: (
		kind: ReservationNotificationKind,
	) => ReservationMutationFormAction
	reservation: ReservationData
	size?: 'default' | 'sm'
}) {
	const items = buildReservationNotificationItems(reservation)
	const compact = size === 'sm'

	return (
		<div className='rounded-md border p-3'>
			<div className='mb-3'>
				<p className='text-sm font-medium'>通知状態</p>
				<p className='text-xs text-muted-foreground'>
					予約確認・前日リマインダー・変更/キャンセル通知の送信状況です。
				</p>
			</div>
			<div className='grid gap-2'>
				{items.map(item => (
					<div
						key={item.kind}
						className='grid gap-2 rounded-md bg-muted/20 p-2 text-xs'
					>
						<div className='flex items-start justify-between gap-2'>
							<div>
								<p className='font-medium text-foreground'>{item.label}</p>
								{compact ? null : (
									<p className='text-muted-foreground'>{item.description}</p>
								)}
								{item.lastSentAt ? (
									<p className='text-muted-foreground'>
										最終送信 {formatNotificationDate(item.lastSentAt)}
									</p>
								) : null}
								{item.blockedReason ? (
									<p className='text-destructive'>{item.blockedReason}</p>
								) : null}
							</div>
							<Badge variant={statusVariant(item.status)}>
								{item.statusLabel}
							</Badge>
						</div>
						<NotificationActionForm
							action={actionForKind(item.kind)}
							disabled={item.status === 'blocked'}
							item={item}
						/>
					</div>
				))}
			</div>
		</div>
	)
}

function NotificationActionForm({
	action,
	disabled,
	item,
}: {
	action: ReservationMutationFormAction
	disabled: boolean
	item: NotificationItem
}) {
	const [state, formAction] = useFormState(
		action,
		initialReservationMutationActionState,
	)

	return (
		<form action={formAction} className='grid gap-2'>
			<ReservationMutationErrorAlert
				state={state}
				title={`${item.label}通知の送信に失敗しました`}
			/>
			<Button
				type='submit'
				size='sm'
				variant={item.status === 'sent' ? 'outline' : 'default'}
				disabled={disabled}
			>
				{item.status === 'sent' ? '再送' : '送信'}
			</Button>
		</form>
	)
}
