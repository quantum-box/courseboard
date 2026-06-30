import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ReservationData } from './action'
import { ReservationAttendanceControl } from './reservation-attendance-control'
import { ReservationCancellationControl } from './reservation-cancellation-control'
import {
	ReservationCheckInPanel,
	buildReservationCheckInSummary,
} from './reservation-check-in-panel'
import { ReservationCustomerLink } from './reservation-customer-link'
import {
	ReservationNotificationPanel,
	buildReservationNotificationItems,
} from './reservation-notification-panel'
import {
	ReservationOperationsSummary,
	buildReservationOperationsMetrics,
} from './reservation-operations-summary'
import {
	ReservationPaymentPendingHint,
	ReservationPaymentSummaryContent,
} from './reservation-payment-summary'
import { ReservationNotificationSettingsPanel } from './reservation-notification-settings'
import { ReservationStaffAssignmentControl } from './reservation-staff-assignment-control'

async function noopReservationAction() {
	return { status: 'success' as const }
}

const baseReservation: ReservationData = {
	id: 'rsv_test',
	reservationNumber: 'RSV-20260526-001',
	reservationTypeId: 'rtype_lesson',
	resourceId: 'res_room',
	assignedStaffIds: [],
	customerId: 'cust_reservation',
	customerName: '山田 太郎',
	customerEmail: 'taro@example.test',
	customerPhone: '09000000000',
	status: 'payment_pending',
	paymentStatus: 'unpaid',
	startsAt: '2026-05-26T10:00:00.000Z',
	endsAt: '2026-05-26T11:00:00.000Z',
	priceAmount: 12000,
	depositAmount: 3000,
	paidAmount: 0,
	currency: 'JPY',
	checkoutUrl: 'https://square.example/checkout',
	policySnapshotJson: {
		prepaymentPolicy: 'deposit',
		requiredPaymentAmount: 3000,
		cancellationPolicy: 'fee_deducted',
	},
	internalNotes: null,
	createdAt: '2026-05-26T09:00:00.000Z',
}

describe('reservation admin payment summary', () => {
	it('renders open Square checkout action and outstanding deposit', () => {
		const html = renderToStaticMarkup(
			<div>
				<ReservationPaymentSummaryContent reservation={baseReservation} />
				<ReservationPaymentPendingHint reservation={baseReservation} />
			</div>,
		)

		expect(html).toContain('未決済')
		expect(html).toContain('未回収')
		expect(html).toContain('￥3,000')
		expect(html).toContain('支払いリンクを開く')
		expect(html).toContain('https://square.example/checkout')
		expect(html).toContain('支払いリンクがある場合は顧客へ再案内できます')
	})

	it('does not render checkout action for paid reservations', () => {
		const html = renderToStaticMarkup(
			<ReservationPaymentSummaryContent
				reservation={{
					...baseReservation,
					status: 'confirmed',
					paymentStatus: 'paid',
					paidAmount: 12000,
				}}
			/>,
		)

		expect(html).toContain('入金済み')
		expect(html).toContain('入金')
		expect(html).not.toContain('支払いリンクを開く')
		expect(html).not.toContain('未回収')
	})

	it('shows cancellation fee payment link label when fee_due with checkoutUrl', () => {
		const html = renderToStaticMarkup(
			<ReservationPaymentSummaryContent
				reservation={{
					...baseReservation,
					status: 'cancelled',
					paymentStatus: 'fee_due',
					checkoutUrl: 'https://square.example/fee-link',
					paidAmount: 0,
					depositAmount: 5000,
					policySnapshotJson: {
						prepaymentPolicy: 'deposit',
						requiredPaymentAmount: 3000,
						cancellationPolicy: 'fee_deducted',
					},
				}}
			/>,
		)

		expect(html).toContain('手数料請求')
		expect(html).toContain('キャンセル料支払いリンクを開く')
		expect(html).toContain('https://square.example/fee-link')
	})
})

describe('reservation admin cancellation control', () => {
	it('renders reason, cancellation fee, and refund amount fields', () => {
		const html = renderToStaticMarkup(
			<ReservationCancellationControl
				action={noopReservationAction}
				reservation={{
					...baseReservation,
					paymentStatus: 'fee_due',
					depositAmount: 5000,
					paidAmount: 1000,
				}}
			/>,
		)

		expect(html).toContain('キャンセル理由')
		expect(html).toContain('name="reason"')
		expect(html).toContain('name="cancellationFeeAmount"')
		expect(html).toContain('value="4000"')
		expect(html).toContain('name="refundAmount"')
		expect(html).toContain('取消処理')
	})

	it('disables cancellation controls after cancellation', () => {
		const html = renderToStaticMarkup(
			<ReservationCancellationControl
				action={noopReservationAction}
				reservation={{
					...baseReservation,
					status: 'cancelled',
				}}
			/>,
		)

		expect(html).toContain('disabled=""')
	})

	it('shows cancellation policy hint and payment auto-link note for fee_deducted policy', () => {
		const html = renderToStaticMarkup(
			<ReservationCancellationControl
				action={noopReservationAction}
				reservation={{
					...baseReservation,
					policySnapshotJson: {
						prepaymentPolicy: 'deposit',
						requiredPaymentAmount: 3000,
						cancellationPolicy: 'fee_deducted',
					},
				}}
			/>,
		)

		expect(html).toContain('取消ポリシー:')
		expect(html).toContain('手数料差引・決済リンク自動生成')
	})

	it('shows full_refund policy hint without fee note', () => {
		const html = renderToStaticMarkup(
			<ReservationCancellationControl
				action={noopReservationAction}
				reservation={{
					...baseReservation,
					policySnapshotJson: {
						prepaymentPolicy: 'deposit',
						requiredPaymentAmount: 3000,
						cancellationPolicy: 'full_refund',
					},
				}}
			/>,
		)

		expect(html).toContain('取消ポリシー:')
		expect(html).toContain('全額返金')
		expect(html).not.toContain('決済リンク自動生成')
	})
})

describe('reservation admin attendance control', () => {
	it('renders check-in completion and no-show actions separately from cancellation', () => {
		const html = renderToStaticMarkup(
			<ReservationAttendanceControl
				confirmAction={noopReservationAction}
				completeAction={noopReservationAction}
				noShowAction={noopReservationAction}
				reservation={{
					...baseReservation,
					status: 'confirmed',
				}}
			/>,
		)

		expect(html).toContain('来場処理')
		expect(html).toContain('受付/完了')
		expect(html).toContain('無断不参加')
		expect(html).toContain('取消やキャンセル料回収とは分けて記録します')
		expect(html).not.toContain('キャンセル理由')
	})

	it('highlights no-show reservations with operator guidance', () => {
		const html = renderToStaticMarkup(
			<ReservationAttendanceControl
				confirmAction={noopReservationAction}
				completeAction={noopReservationAction}
				noShowAction={noopReservationAction}
				reservation={{
					...baseReservation,
					status: 'no_show',
				}}
			/>,
		)

		expect(html).toContain('無断不参加として記録済みです')
		expect(html).toContain('キャンセル料回収が必要な場合')
	})
})

describe('reservation admin check-in panel', () => {
	it('classifies upcoming, ready, in-progress, and overdue reservations', () => {
		expect(
			buildReservationCheckInSummary(
				{
					...baseReservation,
					status: 'confirmed',
					startsAt: '2026-05-26T10:00:00.000Z',
					endsAt: '2026-05-26T11:00:00.000Z',
				},
				new Date('2026-05-26T08:30:00.000Z'),
			).label,
		).toBe('本日予定')
		expect(
			buildReservationCheckInSummary(
				{
					...baseReservation,
					status: 'confirmed',
					startsAt: '2026-05-26T10:00:00.000Z',
					endsAt: '2026-05-26T11:00:00.000Z',
				},
				new Date('2026-05-26T09:30:00.000Z'),
			).label,
		).toBe('受付準備')
		expect(
			buildReservationCheckInSummary(
				{
					...baseReservation,
					status: 'confirmed',
					startsAt: '2026-05-26T10:00:00.000Z',
					endsAt: '2026-05-26T11:00:00.000Z',
				},
				new Date('2026-05-26T10:30:00.000Z'),
			).label,
		).toBe('受付中')
		expect(
			buildReservationCheckInSummary(
				{
					...baseReservation,
					status: 'confirmed',
					startsAt: '2026-05-26T10:00:00.000Z',
					endsAt: '2026-05-26T11:00:00.000Z',
				},
				new Date('2026-05-26T11:30:00.000Z'),
			).label,
		).toBe('完了確認')
	})

	it('separates payment, approval, closed, and invalid data states', () => {
		expect(
			buildReservationCheckInSummary(
				{
					...baseReservation,
					status: 'payment_pending',
				},
				new Date('2026-05-26T10:30:00.000Z'),
			).label,
		).toBe('決済確認')
		expect(
			buildReservationCheckInSummary(
				{
					...baseReservation,
					status: 'requested',
				},
				new Date('2026-05-26T10:30:00.000Z'),
			).label,
		).toBe('承認確認')
		expect(
			buildReservationCheckInSummary(
				{
					...baseReservation,
					status: 'completed',
				},
				new Date('2026-05-26T10:30:00.000Z'),
			).label,
		).toBe('受付完了')
		expect(
			buildReservationCheckInSummary(
				{
					...baseReservation,
					startsAt: 'not-a-date',
				},
				new Date('2026-05-26T10:30:00.000Z'),
			).label,
		).toBe('日時確認')
	})

	it('renders operator guidance for same-day check-in', () => {
		const html = renderToStaticMarkup(
			<ReservationCheckInPanel
				reservation={{
					...baseReservation,
					status: 'confirmed',
					startsAt: '2026-05-26T10:00:00.000Z',
					endsAt: '2026-05-26T11:00:00.000Z',
				}}
				now={new Date('2026-05-26T10:30:00.000Z')}
			/>,
		)

		expect(html).toContain('受付状態')
		expect(html).toContain('受付中')
		expect(html).toContain('来場済みであれば受付/完了を記録してください')
	})
})

describe('reservation admin customer CRM link', () => {
	it('links reservations with email to the filtered consumer master', () => {
		const html = renderToStaticMarkup(
			<ReservationCustomerLink
				reservation={baseReservation}
				tenant='tenant_test'
			/>,
		)

		expect(html).toContain('山田 太郎')
		expect(html).toContain(
			'/tenant_test/library/consumers?email=taro%40example.test',
		)
		expect(html).toContain('taro@example.test')
		expect(html).toContain('09000000000')
		expect(html).toContain('cust_reservation')
		expect(html).toContain('コンシューマーで確認')
	})

	it('renders deterministic customer fallback without a consumer link', () => {
		const html = renderToStaticMarkup(
			<ReservationCustomerLink
				reservation={{
					...baseReservation,
					customerId: null,
					customerName: null,
					customerEmail: null,
				}}
				tenant='tenant_test'
			/>,
		)

		expect(html).toContain('09000000000')
		expect(html).not.toContain('/tenant_test/library/consumers')
		expect(html).not.toContain('コンシューマーで確認')
	})
})

describe('reservation admin notification panel', () => {
	it('renders confirmation, reminder, change/cancellation states and resend actions', () => {
		const html = renderToStaticMarkup(
			<ReservationNotificationPanel
				actionForKind={() => noopReservationAction}
				reservation={{
					...baseReservation,
					internalNotes:
						'[reservation-notification kind=confirmation status=sent at=2026-05-26T09:30:00.000Z]',
				}}
			/>,
		)

		expect(html).toContain('通知状態')
		expect(html).toContain('予約確認')
		expect(html).toContain('前日リマインダー')
		expect(html).toContain('変更/キャンセル')
		expect(html).toContain('送信済み')
		expect(html).toContain('未送信')
		expect(html).toContain('再送')
		expect(html).toContain('送信')
	})

	it('blocks notification actions when customer contact is missing', () => {
		const reservation = {
			...baseReservation,
			customerEmail: null,
			customerPhone: null,
		}
		const items = buildReservationNotificationItems(reservation)
		const html = renderToStaticMarkup(
			<ReservationNotificationPanel
				actionForKind={() => noopReservationAction}
				reservation={reservation}
			/>,
		)

		expect(items.every(item => item.status === 'blocked')).toBe(true)
		expect(html).toContain('送信不可')
		expect(html).toContain('メールまたは電話番号が未登録')
		expect(html).toContain('disabled=""')
	})
})

describe('reservation admin notification settings', () => {
	it('renders email templates and automatic trigger controls', () => {
		const html = renderToStaticMarkup(
			<ReservationNotificationSettingsPanel
				action={noopReservationAction}
				settings={{
					confirmation: {
						enabled: true,
						autoSend: true,
						subject: '予約確認: {{reservationNumber}}',
						body: '予約番号 {{reservationNumber}}',
					},
					reminder: {
						enabled: true,
						autoSend: false,
						subject: '前日リマインダー',
						body: '明日のご予約です',
					},
					change_cancellation: {
						enabled: false,
						autoSend: true,
						subject: '変更/キャンセル通知',
						body: '現在の状態 {{status}}',
					},
				}}
			/>,
		)

		expect(html).toContain('予約通知テンプレート')
		expect(html).toContain('予約確認メール')
		expect(html).toContain('前日リマインダー')
		expect(html).toContain('変更/キャンセル通知')
		expect(html).toContain('自動送信トリガーを有効化')
		expect(html).toContain('name="confirmation.subject"')
		expect(html).toContain('name="reminder.autoSend"')
		expect(html).toContain('{{reservationNumber}}')
		expect(html).toContain('通知設定を保存')
	})
})

describe('reservation admin staff assignment control', () => {
	it('renders assigned staff names, inactive state, and assignment select', () => {
		const html = renderToStaticMarkup(
			<ReservationStaffAssignmentControl
				action={noopReservationAction}
				reservation={{
					...baseReservation,
					assignedStaffIds: ['staff_active', 'staff_inactive'],
				}}
				shiftsByStaffId={{
					staff_active: [
						{
							id: 'shift_active',
							staffId: 'staff_active',
							date: '2026-05-26',
							startTime: '09:00',
							endTime: '18:00',
							shiftType: 'regular',
						},
					],
					staff_inactive: [
						{
							id: 'shift_inactive',
							staffId: 'staff_inactive',
							date: '2026-05-26',
							startTime: '13:00',
							endTime: '18:00',
							shiftType: 'regular',
						},
					],
				}}
				staff={[
					{
						id: 'staff_active',
						name: '佐藤 花子',
						employmentType: 'full_time',
						active: true,
					},
					{
						id: 'staff_inactive',
						name: '鈴木 一郎',
						employmentType: 'contractor',
						active: false,
					},
				]}
			/>,
		)

		expect(html).toContain('担当スタッフ')
		expect(html).toContain('佐藤 花子')
		expect(html).toContain('鈴木 一郎')
		expect(html).toContain('停止中')
		expect(html).toContain('シフト内')
		expect(html).toContain('シフト外')
		expect(html).toContain('name="assignedStaffIds"')
		expect(html).toContain('担当を保存')
	})

	it('distinguishes missing and unavailable staff shift data', () => {
		const html = renderToStaticMarkup(
			<ReservationStaffAssignmentControl
				action={noopReservationAction}
				reservation={{
					...baseReservation,
					assignedStaffIds: ['staff_missing_shift', 'staff_unavailable'],
				}}
				shiftsByStaffId={{ staff_missing_shift: [] }}
				staff={[
					{
						id: 'staff_missing_shift',
						name: '田中 次郎',
						employmentType: 'part_time',
						active: true,
					},
					{
						id: 'staff_unavailable',
						name: '高橋 三郎',
						employmentType: 'contractor',
						active: true,
					},
				]}
				unavailableShiftStaffIds={['staff_unavailable']}
			/>,
		)

		expect(html).toContain('田中 次郎')
		expect(html).toContain('高橋 三郎')
		expect(html).toContain('シフト未登録')
		expect(html).toContain('シフト確認不可')
	})

	it('shows a deterministic empty state when no staff members are registered', () => {
		const html = renderToStaticMarkup(
			<ReservationStaffAssignmentControl
				action={noopReservationAction}
				reservation={baseReservation}
				staff={[]}
			/>,
		)

		expect(html).toContain('未割当')
		expect(html).toContain('スタッフ未登録です')
		expect(html).toContain('disabled=""')
	})
})

describe('reservation admin operations summary', () => {
	it('builds mobile field operations metrics for dispatch and daily reporting', () => {
		expect(
			buildReservationOperationsMetrics(
				[
					baseReservation,
					{
						...baseReservation,
						id: 'rsv_confirmed',
						status: 'confirmed',
						paymentStatus: 'paid',
						assignedStaffIds: ['staff_active'],
						priceAmount: 18000,
					},
					{
						...baseReservation,
						id: 'rsv_cancelled',
						status: 'cancelled',
						paymentStatus: 'refund_pending',
						priceAmount: 9000,
					},
					{
						...baseReservation,
						id: 'rsv_no_show',
						status: 'no_show',
						paymentStatus: 'fee_due',
						startsAt: '2026-05-25T10:00:00.000Z',
					},
				],
				new Date('2026-05-26T00:00:00.000Z'),
			),
		).toMatchObject({
			todayReservations: 3,
			paymentPending: 1,
			todayAssigned: 1,
			todayUnassigned: 1,
			cancelled: 1,
			noShow: 1,
			awaitingCompletion: 2,
			todayRevenueAmount: 30000,
		})
	})

	it('renders same-day operation counters and status filter links', () => {
		const html = renderToStaticMarkup(
			<ReservationOperationsSummary
				tenant='tenant_test'
				now={new Date('2026-05-26T00:00:00.000Z')}
				reservations={[
					baseReservation,
					{
						...baseReservation,
						id: 'rsv_confirmed',
						status: 'confirmed',
						paymentStatus: 'paid',
						assignedStaffIds: ['staff_active'],
					},
					{
						...baseReservation,
						id: 'rsv_no_show',
						status: 'no_show',
						paymentStatus: 'fee_due',
						startsAt: '2026-05-25T10:00:00.000Z',
					},
					{
						...baseReservation,
						id: 'rsv_completed',
						status: 'completed',
						paymentStatus: 'paid',
						assignedStaffIds: ['staff_active'],
					},
				]}
			/>,
		)

		expect(html).toContain('予約当日オペレーションサマリ')
		expect(html).toContain('本日予約')
		expect(html).toContain('未決済')
		expect(html).toContain('本日未割当')
		expect(html).toContain('完了待ち')
		expect(html).toContain('/tenant_test/reservations?status=payment_pending')
		expect(html).toContain('担当確認が必要')
	})
})
