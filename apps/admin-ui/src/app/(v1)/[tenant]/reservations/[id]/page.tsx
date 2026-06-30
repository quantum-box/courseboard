import { Badge } from 'components/ui/badge'
import { Button } from 'components/ui/button'
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from 'components/ui/breadcrumb'
import { MainLayout, V1Layout } from 'components/v1-layout'
import type { Route } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import type React from 'react'
import {
	cancelReservationWithPolicyAction,
	fetchReservationAction,
	fetchStaffMembersAction,
	fetchStaffShiftsByStaffAction,
	issueReservationSquareInvoiceAction,
	sendReservationNotificationAction,
	updateReservationStaffAction,
	updateReservationStatusAction,
	type ReservationData,
	type ReservationNotificationKind,
} from '../action'
import { ReservationAttendanceControl } from '../reservation-attendance-control'
import { ReservationCancellationControl } from '../reservation-cancellation-control'
import { ReservationCheckInPanel } from '../reservation-check-in-panel'
import { ReservationCustomerLink } from '../reservation-customer-link'
import { ReservationNotificationPanel } from '../reservation-notification-panel'
import { ReservationPaymentSummaryContent } from '../reservation-payment-summary'
import { ReservationPaymentRetryControl } from '../reservation-payment-retry-control'
import { ReservationStaffAssignmentControl } from '../reservation-staff-assignment-control'

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

function formatDateTime(value: string): string {
	const date = new Date(value)
	if (Number.isNaN(date.getTime())) {
		return value
	}
	return date.toLocaleString('ja-JP', {
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
	})
}

function policyLabels(policy?: Record<string, unknown> | null) {
	const cancellation = String(policy?.cancellationPolicy ?? 'full_refund')
	const prepayment = policy?.prepaymentPolicy ?? policy?.prepaymentType
	const required = Number(policy?.requiredPaymentAmount ?? 0)
	const cancellationLabels: Record<string, string> = {
		full_refund: '全額返金',
		fee_deducted: '手数料差引',
		no_refund: '返金なし',
	}
	return {
		payment:
			prepayment === 'deposit'
				? `デポジット ${yen.format(required)}`
				: prepayment === 'none'
					? '事前決済なし'
					: `全額前払い ${yen.format(required)}`,
		cancellation: cancellationLabels[cancellation] ?? cancellation,
	}
}

export default async function ReservationDetailPage({
	params: { tenant, id },
}: {
	params: { tenant: string; id: string }
}) {
	const [reservationResult, staffResult] = await Promise.all([
		fetchReservationAction(tenant, id),
		fetchStaffMembersAction(tenant),
	])
	if (!reservationResult.success) {
		notFound()
	}

	const reservation = reservationResult.data
	const staff = staffResult.success ? staffResult.data : []
	const assignedStaffIds = reservation.assignedStaffIds.filter(Boolean)
	const { shiftsByStaffId, unavailableStaffIds } =
		assignedStaffIds.length > 0
			? await fetchStaffShiftsByStaffAction(tenant, assignedStaffIds)
			: { shiftsByStaffId: {}, unavailableStaffIds: [] }
	const policy = policyLabels(reservation.policySnapshotJson)

	return (
		<V1Layout
			current='reservations'
			tenant={tenant}
			breadcrumbs={
				<Breadcrumb>
					<BreadcrumbList>
						<BreadcrumbItem>
							<BreadcrumbLink asChild>
								<Link href={`/${tenant}/reservations` as Route}>予約管理</Link>
							</BreadcrumbLink>
						</BreadcrumbItem>
						<BreadcrumbSeparator />
						<BreadcrumbItem>
							<BreadcrumbPage>{reservation.reservationNumber}</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>
			}
		>
			<MainLayout>
				<div className='grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start'>
					<div className='min-w-0'>
						<div className='flex flex-wrap items-center gap-2'>
							<h1 className='text-2xl font-semibold'>
								{reservation.reservationNumber}
							</h1>
							<Badge variant='outline'>
								{statusLabels[reservation.status] ?? reservation.status}
							</Badge>
						</div>
						<p className='mt-1 text-sm text-muted-foreground'>
							予約の受付、担当、通知、取消処理をまとめて管理します。
						</p>
					</div>
					<Button asChild variant='outline'>
						<Link href={`/${tenant}/reservations` as Route}>一覧へ戻る</Link>
					</Button>
				</div>

				<div className='grid gap-3 md:grid-cols-4'>
					<StatusTile
						label='来店日時'
						value={formatDateTime(reservation.startsAt)}
						description={`${formatDateTime(reservation.endsAt)} まで`}
					/>
					<StatusTile
						label='決済'
						value={
							paymentStatusLabels[reservation.paymentStatus] ??
							reservation.paymentStatus
						}
						description={`入金 ${yen.format(reservation.paidAmount)}`}
					/>
					<StatusTile
						label='金額'
						value={yen.format(reservation.priceAmount)}
						description={`事前決済 ${yen.format(reservation.depositAmount)}`}
					/>
					<StatusTile
						label='担当'
						value={
							reservation.assignedStaffIds.length > 0
								? `${reservation.assignedStaffIds.length}名`
								: '未割当'
						}
						description='担当割当はこの詳細で変更します'
					/>
				</div>

				<div className='grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]'>
					<section className='min-w-0 rounded-lg border bg-background'>
						<DetailSection
							description='顧客、日時、金額、受付状態を確認します。'
							title='予約情報'
						>
							<div className='grid gap-3 md:grid-cols-2'>
								<InfoRow
									label='顧客'
									value={
										<ReservationCustomerLink
											reservation={reservation}
											tenant={tenant}
										/>
									}
								/>
								<InfoRow
									label='連絡先'
									value={
										reservation.customerEmail ??
										reservation.customerPhone ??
										'未登録'
									}
								/>
								<InfoRow label='予約ID' value={reservation.id} />
								<InfoRow
									label='作成日時'
									value={formatDateTime(reservation.createdAt)}
								/>
							</div>
							<ReservationCheckInPanel reservation={reservation} />
						</DetailSection>

						<DetailSection
							description='支払い案内、請求リンク、取消ポリシーを確認します。'
							title='決済とポリシー'
						>
							<ReservationPaymentSummaryContent reservation={reservation} />
							<ReservationPaymentRetryControl
								invoiceAction={async () => {
									'use server'
									return issueReservationSquareInvoiceAction(
										tenant,
										reservation.id,
									)
								}}
								refundAction={async () => {
									'use server'
									return cancelReservationWithPolicyAction(
										tenant,
										reservation.id,
									)
								}}
								reservation={reservation}
							/>
							<div className='grid gap-2 rounded-md border bg-muted/20 p-3 text-sm'>
								<InfoRow label='支払い条件' value={policy.payment} />
								<InfoRow label='取消ポリシー' value={policy.cancellation} />
							</div>
						</DetailSection>

						<ApplicationReservationDetail reservation={reservation} />
					</section>

					<aside className='min-w-0 rounded-lg border bg-background'>
						<DetailSection title='担当と来場処理'>
							<ReservationStaffAssignmentControl
								action={async (_state, formData) => {
									'use server'
									return updateReservationStaffAction(tenant, id, formData)
								}}
								reservation={reservation}
								shiftsByStaffId={shiftsByStaffId}
								staff={staff}
								unavailableShiftStaffIds={unavailableStaffIds}
							/>
							<ReservationAttendanceControl
								confirmAction={async () => {
									'use server'
									return updateReservationStatusAction(tenant, id, 'confirmed')
								}}
								completeAction={async () => {
									'use server'
									return updateReservationStatusAction(tenant, id, 'completed')
								}}
								noShowAction={async () => {
									'use server'
									return updateReservationStatusAction(tenant, id, 'no_show')
								}}
								reservation={reservation}
							/>
						</DetailSection>

						<DetailSection title='通知'>
							<ReservationNotificationPanel
								actionForKind={buildNotificationActionForKind(
									tenant,
									reservation,
								)}
								reservation={reservation}
							/>
						</DetailSection>

						<DetailSection
							description='キャンセル料や返金額を確定して取消を記録します。'
							title='取消処理'
						>
							<ReservationCancellationControl
								action={async (_state, formData) => {
									'use server'
									return cancelReservationWithPolicyAction(tenant, id, formData)
								}}
								reservation={reservation}
							/>
						</DetailSection>
					</aside>
				</div>
			</MainLayout>
		</V1Layout>
	)
}

function StatusTile({
	description,
	label,
	value,
}: {
	description: string
	label: string
	value: string
}) {
	return (
		<div className='rounded-md border bg-background p-3'>
			<p className='text-xs font-medium text-muted-foreground'>{label}</p>
			<p className='mt-1 truncate text-base font-semibold'>{value}</p>
			<p className='mt-1 truncate text-xs text-muted-foreground'>
				{description}
			</p>
		</div>
	)
}

function InfoRow({
	label,
	value,
}: {
	label: string
	value: React.ReactNode
}) {
	return (
		<div className='grid gap-1 text-sm'>
			<p className='text-xs font-medium text-muted-foreground'>{label}</p>
			<div className='min-w-0 break-words'>{value}</div>
		</div>
	)
}

function DetailSection({
	children,
	description,
	title,
}: {
	children: React.ReactNode
	description?: string
	title: string
}) {
	return (
		<section className='grid gap-4 border-b p-4 last:border-b-0 sm:p-6'>
			<div>
				<h2 className='text-base font-semibold'>{title}</h2>
				{description ? (
					<p className='mt-1 text-sm text-muted-foreground'>{description}</p>
				) : null}
			</div>
			<div className='grid gap-4'>{children}</div>
		</section>
	)
}

function ApplicationReservationDetail({
	reservation,
}: {
	reservation: ReservationData
}) {
	const fields = reservation.customFieldsJson
	if (!fields || Object.keys(fields).length === 0) {
		return null
	}

	const subjectNames = applicationSubjectNames(fields)
	const subjectCount = Number(
		fields.subjectCount ?? fields.dogCount ?? subjectNames.length,
	)
	const courseLabel = String(
		fields.courseLabel ?? fields.applicationKind ?? '申込情報',
	)
	const certificateStatus =
		fields.certificateStatus === 'checked' ||
		fields.staffVaccineCertificateChecked === true
			? '証明書確認済み'
			: '証明書未確認'

	return (
		<DetailSection
			description='受付フォーム由来の補足情報です。予約本体とは分けて扱います。'
			title='申込情報'
		>
			<div className='grid gap-3 md:grid-cols-3'>
				<InfoRow label='コース' value={courseLabel} />
				<InfoRow
					label='対象数'
					value={
						Number.isFinite(subjectCount) ? subjectCount : subjectNames.length
					}
				/>
				<InfoRow label='証明確認' value={certificateStatus} />
			</div>
			{subjectNames.length > 0 ? (
				<InfoRow label='対象' value={subjectNames.join(' / ')} />
			) : null}
			<details>
				<summary className='cursor-pointer rounded-md border px-3 py-2 text-sm font-medium text-muted-foreground transition hover:bg-muted'>
					申込データを表示
				</summary>
				<pre className='mt-3 max-h-80 overflow-auto rounded-md border bg-muted/20 p-3 text-xs'>
					{JSON.stringify(fields, null, 2)}
				</pre>
			</details>
		</DetailSection>
	)
}

function applicationSubjectNames(fields: Record<string, unknown>) {
	if (Array.isArray(fields.subjectNames)) {
		return fields.subjectNames.map(String).filter(Boolean)
	}
	const subjects = Array.isArray(fields.subjects)
		? fields.subjects
		: Array.isArray(fields.dogs)
			? fields.dogs
			: []
	return subjects
		.map(subject =>
			subject && typeof subject === 'object'
				? String((subject as Record<string, unknown>).name ?? '').trim()
				: '',
		)
		.filter(Boolean)
}

function buildNotificationActionForKind(
	tenant: string,
	reservation: ReservationData,
) {
	return (kind: ReservationNotificationKind) => async () => {
		'use server'
		return sendReservationNotificationAction(
			tenant,
			reservation.id,
			kind,
			reservation.internalNotes,
		)
	}
}
