'use server'

import { joinServerBackendPath } from 'lib/serverBackendUrl'
import { authWithCheck } from 'app/auth'
import { fetchCloudAppExtensions } from 'lib/cloud-app-extensions'
import { fetchJsonWithRetry, fetchWithRetry } from 'lib/reliable-fetch'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

const PLATFORM_ID =
	process.env.NEXT_PUBLIC_PLATFORM_ID || 'tn_01hjjn348rn3t49zz6hvmfq67p'
const RESERVATION_NOTIFICATION_EXTENSION_KEY = 'reservation-notifications'
const MAX_MUTATION_LOG_BODY_LENGTH = 120
const CLOUD_APP_APPLICATION_PRESETS: Record<
	string,
	{ appName: string; path: string }
> = {
	dog_run: {
		appName: 'tachyonfield-restaurant',
		path: '/presets/dog-run/intake',
	},
}

export type ReservationData = {
	id: string
	reservationNumber: string
	reservationTypeId: string
	resourceId?: string | null
	assignedStaffIds: string[]
	customerId?: string | null
	customerName?: string | null
	customerEmail?: string | null
	customerPhone?: string | null
	status: string
	paymentStatus: string
	startsAt: string
	endsAt: string
	priceAmount: number
	depositAmount: number
	paidAmount: number
	currency: string
	checkoutUrl?: string | null
	policySnapshotJson?: Record<string, unknown> | null
	customFieldsJson?: Record<string, unknown> | null
	internalNotes?: string | null
	createdAt: string
}

export type ExtensionApplicationCourseData = {
	code: string
	label: string
	startTime: string
	endTime: string
	pricesByDogCount: Record<string, number>
	currency?: string
}

export type ExtensionApplicationFieldData = {
	key: string
	label: string
	type: 'text' | 'date' | 'select' | 'email' | 'tel'
	required?: boolean
	options?: Array<{ value: string; label: string }>
}

export type ExtensionApplicationSubjectGroupData = {
	key: string
	label: string
	singularLabel: string
	countLabel: string
	maxCount: number
	certificateLabel: string
	fields: ExtensionApplicationFieldData[]
}

export type ExtensionApplicationConsentItemData = {
	key: string
	label: string
	required: boolean
}

export type ExtensionApplicationPresentationData = {
	badgeLabel: string
	publicTitle: string
	publicDescription: string
	kioskTitle: string
	kioskDescription: string
	submitLabel: string
	disabledTitle: string
	disabledDescription: string
}

export type ExtensionApplicationConfigData = {
	maxDogCount: number
	termsVersion: string
	vaccineCertificateRequiredOnFirstVisit: boolean
	courses: ExtensionApplicationCourseData[]
	formPresentation: ExtensionApplicationPresentationData
	consentItems: ExtensionApplicationConsentItemData[]
	subjectGroups: ExtensionApplicationSubjectGroupData[]
}

export type ReservationNotificationKind =
	| 'confirmation'
	| 'reminder'
	| 'change_cancellation'

export type ReservationNotificationTemplate = {
	enabled: boolean
	autoSend: boolean
	subject: string
	body: string
}

export type ReservationNotificationSettings = Record<
	ReservationNotificationKind,
	ReservationNotificationTemplate
>

export type StaffMemberData = {
	id: string
	name: string
	employmentType?: string
	active: boolean
}

export type StaffShiftData = {
	id: string
	staffId: string
	date: string
	startTime: string
	endTime: string
	shiftType: string
	notes?: string | null
}

export type ReservationMutationActionState = {
	status: 'idle' | 'error' | 'success'
	message?: string
	statusCode?: number
}

export type ReservationTypeData = {
	id: string
	code: string
	name: string
	resourceModel: string
	paymentPolicyJson?: Record<string, unknown> | null
	policyHooksJson?: Record<string, unknown> | null
}

export type ReservationResourceData = {
	id: string
	name: string
	resourceType: string
	resourceModel: string
	capacity: number
}

async function reservationFetch(
	path: string,
	tenant: string,
	init?: RequestInit,
) {
	const session = await authWithCheck()
	const url = joinServerBackendPath(path)
	return fetchWithRetry(url, {
		...init,
		onNonOkResponse: logFieldApiNonOkResponse,
		headers: {
			'Content-Type': 'application/json',
			'x-platform-id': PLATFORM_ID,
			'x-operator-id': tenant,
			Authorization: `Bearer ${session.accessToken}`,
			...(init?.headers ?? {}),
		},
	})
}

async function reservationFetchJson<T>(path: string, tenant: string) {
	const result = await reservationFetchJsonResult<T>(path, tenant)
	if (!result.ok) {
		return { success: false as const, message: result.error.message }
	}
	return { success: true as const, data: result.data }
}

async function reservationFetchJsonResult<T>(
	path: string,
	tenant: string,
	init?: RequestInit,
) {
	const session = await authWithCheck()
	const url = joinServerBackendPath(path)
	return fetchJsonWithRetry<T>(url, {
		...init,
		onNonOkResponse: logFieldApiNonOkResponse,
		headers: {
			'Content-Type': 'application/json',
			'x-platform-id': PLATFORM_ID,
			'x-operator-id': tenant,
			Authorization: `Bearer ${session.accessToken}`,
			...(init?.headers ?? {}),
		},
	})
}

function logFieldApiNonOkResponse(event: {
	body: string
	headers: Headers
	status: number
	url: string
}) {
	console.warn('field_api_mutation_non_ok', {
		status: event.status,
		host: safeUrlHost(event.url),
		cfRay: event.headers.get('cf-ray') ?? undefined,
		bodyPreview: event.body
			.replace(/\s+/g, ' ')
			.trim()
			.slice(0, MAX_MUTATION_LOG_BODY_LENGTH),
	})
}

function safeUrlHost(url: string): string {
	try {
		return new URL(url).host
	} catch {
		return 'invalid-url'
	}
}

const reservationMutationSuccessState: ReservationMutationActionState = {
	status: 'success',
}

function reservationMutationErrorState(
	statusCode?: number,
): ReservationMutationActionState {
	return {
		status: 'error',
		statusCode,
		message: reservationMutationErrorMessage(statusCode),
	}
}

function reservationMutationErrorMessage(statusCode?: number) {
	if (statusCode === 403) {
		return 'この操作に必要な権限/スコープが不足しています'
	}
	if (typeof statusCode === 'number' && statusCode >= 500) {
		return '一時的に利用できません。時間をおいて再試行してください'
	}
	return '処理に失敗しました。入力内容を確認して、時間をおいて再試行してください'
}

const defaultReservationNotificationSettings: ReservationNotificationSettings =
	{
		confirmation: {
			enabled: true,
			autoSend: true,
			subject: '予約確認: {{reservationNumber}}',
			body: '{{customerName}} 様\n\nご予約を承りました。\n予約番号: {{reservationNumber}}\n日時: {{startsAt}}\n\n当日はお気をつけてお越しください。',
		},
		reminder: {
			enabled: true,
			autoSend: false,
			subject: '明日のご予約リマインダー: {{reservationNumber}}',
			body: '{{customerName}} 様\n\n明日のご予約のリマインダーです。\n予約番号: {{reservationNumber}}\n日時: {{startsAt}}\n\nご来店をお待ちしております。',
		},
		change_cancellation: {
			enabled: true,
			autoSend: true,
			subject: '予約変更・キャンセルのご案内: {{reservationNumber}}',
			body: '{{customerName}} 様\n\nご予約の変更またはキャンセルに関するご案内です。\n予約番号: {{reservationNumber}}\n現在の状態: {{status}}\n\nご不明点があれば店舗までお問い合わせください。',
		},
	}

function normalizeReservationNotificationSettings(
	value: unknown,
): ReservationNotificationSettings {
	const record =
		value && typeof value === 'object'
			? (value as Record<string, Record<string, unknown>>)
			: {}
	return {
		confirmation: normalizeReservationNotificationTemplate(
			record.confirmation,
			defaultReservationNotificationSettings.confirmation,
		),
		reminder: normalizeReservationNotificationTemplate(
			record.reminder,
			defaultReservationNotificationSettings.reminder,
		),
		change_cancellation: normalizeReservationNotificationTemplate(
			record.change_cancellation,
			defaultReservationNotificationSettings.change_cancellation,
		),
	}
}

function normalizeReservationNotificationTemplate(
	value: Record<string, unknown> | undefined,
	fallback: ReservationNotificationTemplate,
): ReservationNotificationTemplate {
	return {
		enabled:
			typeof value?.enabled === 'boolean' ? value.enabled : fallback.enabled,
		autoSend:
			typeof value?.autoSend === 'boolean' ? value.autoSend : fallback.autoSend,
		subject:
			typeof value?.subject === 'string' && value.subject.trim()
				? value.subject
				: fallback.subject,
		body:
			typeof value?.body === 'string' && value.body.trim()
				? value.body
				: fallback.body,
	}
}

export async function fetchReservationsAction(tenant: string, status?: string) {
	const search = status && status !== 'all' ? `?status=${status}` : ''
	const result = await reservationFetchJson<{ items: ReservationData[] }>(
		`/v1/erp/reservations${search}`,
		tenant,
	)
	return result.success
		? { success: true as const, data: result.data.items }
		: result
}

export async function fetchReservationAction(tenant: string, id: string) {
	const result = await reservationFetchJson<ReservationData>(
		`/v1/erp/reservations/${id}`,
		tenant,
	)
	if (result.success) {
		return result
	}

	const listResult = await fetchReservationsAction(tenant)
	if (!listResult.success) {
		return result
	}
	const reservation = listResult.data.find(item => item.id === id)
	return reservation
		? { success: true as const, data: reservation }
		: { success: false as const, message: result.message }
}

export async function fetchReservationNotificationSettingsAction(
	tenant: string,
) {
	const result = await reservationFetchJsonResult<{ configJson?: unknown }>(
		`/v1/erp/extensions/${RESERVATION_NOTIFICATION_EXTENSION_KEY}/config`,
		tenant,
	)
	if (!result.ok) {
		if (result.error.status === 404) {
			return {
				success: true as const,
				data: defaultReservationNotificationSettings,
			}
		}
		return { success: false as const, message: result.error.message }
	}
	return {
		success: true as const,
		data: normalizeReservationNotificationSettings(result.data.configJson),
	}
}

export async function fetchReservationTypesAction(tenant: string) {
	const result = await reservationFetchJson<{ items: ReservationTypeData[] }>(
		'/v1/erp/reservation-types',
		tenant,
	)
	return result.success
		? { success: true as const, data: result.data.items }
		: result
}

export async function fetchReservationResourcesAction(tenant: string) {
	const result = await reservationFetchJson<{
		items: ReservationResourceData[]
	}>('/v1/erp/resources', tenant)
	return result.success
		? { success: true as const, data: result.data.items }
		: result
}

export async function fetchExtensionApplicationConfigAction(
	tenant: string,
	extensionKey: string,
) {
	const result = await reservationFetchJsonResult<{ configJson?: unknown }>(
		`/v1/erp/extensions/${encodeURIComponent(extensionKey)}/config?scopeType=tenant`,
		tenant,
	)
	const preset = await fetchCloudAppApplicationPreset(tenant, extensionKey)
	if (!result.ok) {
		return {
			success: true as const,
			data: normalizeExtensionApplicationConfig(
				extensionKey,
				mergeApplicationConfigPreset(
					defaultExtensionApplicationConfig(extensionKey),
					preset,
				),
			),
			enabled: false,
		}
	}
	return {
		success: true as const,
		data: normalizeExtensionApplicationConfig(
			extensionKey,
			mergeApplicationConfigPreset(result.data.configJson, preset),
		),
		enabled: true,
	}
}

export async function fetchStaffMembersAction(tenant: string) {
	const result = await reservationFetchJson<{ items: StaffMemberData[] }>(
		'/v1/erp/hrm/staff',
		tenant,
	)
	return result.success
		? { success: true as const, data: result.data.items }
		: result
}

export async function fetchStaffShiftsByStaffAction(
	tenant: string,
	staffIds: string[],
) {
	const uniqueStaffIds = Array.from(new Set(staffIds)).filter(Boolean).sort()
	const entries = await Promise.all(
		uniqueStaffIds.map(async staffId => {
			const result = await reservationFetchJson<{ items: StaffShiftData[] }>(
				`/v1/erp/hrm/staff/${staffId}/shifts`,
				tenant,
			)
			return [staffId, result] as const
		}),
	)
	const shiftsByStaffId: Record<string, StaffShiftData[]> = {}
	const unavailableStaffIds: string[] = []
	for (const [staffId, result] of entries) {
		if (result.success) {
			shiftsByStaffId[staffId] = result.data.items
		} else {
			shiftsByStaffId[staffId] = []
			unavailableStaffIds.push(staffId)
		}
	}
	return { shiftsByStaffId, unavailableStaffIds }
}

export async function updateReservationStatusAction(
	tenant: string,
	id: string,
	status: string,
): Promise<ReservationMutationActionState> {
	const res = await reservationFetch(`/v1/erp/reservations/${id}`, tenant, {
		method: 'PATCH',
		body: JSON.stringify({ status }),
	})
	if (!res.ok) {
		return reservationMutationErrorState(res.error.status)
	}
	revalidatePath(`/${tenant}/reservations`)
	revalidatePath(`/${tenant}/reservations/${id}`)
	return reservationMutationSuccessState
}

export async function releaseExpiredReservationHoldsAction(
	tenant: string,
): Promise<ReservationMutationActionState> {
	const res = await reservationFetch(
		'/v1/erp/reservations/payment-holds/release-expired',
		tenant,
		{
			method: 'POST',
			body: JSON.stringify({ limit: 100 }),
		},
	)
	if (!res.ok) {
		return reservationMutationErrorState(res.error.status)
	}
	revalidatePath(`/${tenant}/reservations`)
	return reservationMutationSuccessState
}

export async function createExtensionApplicationKioskReservationAction(
	tenant: string,
	extensionKey: string,
	_prevState: ReservationMutationActionState,
	formData: FormData,
): Promise<ReservationMutationActionState> {
	const typesResult = await fetchReservationTypesAction(tenant)
	if (!typesResult.success) {
		return reservationMutationErrorState()
	}
	const reservationType = typesResult.data.find(
		type => type.code === extensionKey,
	)
	if (!reservationType) {
		return {
			status: 'error',
			message: 'この受付フォームは現在有効化されていません',
		}
	}
	const config = (
		await fetchExtensionApplicationConfigAction(tenant, extensionKey)
	).data
	const subjectCount = normalizeSubjectCount(formData.get('subjectCount'))
	const startsAt = String(formData.get('startsAt') || '')
	const starts = new Date(startsAt)
	const durationMinutes = Number(formData.get('durationMinutes') || 60)
	const ends = new Date(starts.getTime() + durationMinutes * 60_000)
	const course = selectApplicationCourse(config, starts)
	const priceAmount = applicationPrice(course, subjectCount)
	const res = await reservationFetch('/v1/erp/reservations', tenant, {
		method: 'POST',
		body: JSON.stringify({
			reservationTypeId: reservationType.id,
			resourceId: String(formData.get('resourceId') || '') || undefined,
			customerName: String(formData.get('customerName') || ''),
			customerEmail: String(formData.get('customerEmail') || ''),
			customerPhone: String(formData.get('customerPhone') || ''),
			startsAt: starts.toISOString(),
			endsAt: ends.toISOString(),
			timezone: 'Asia/Tokyo',
			quantity: subjectCount,
			priceAmount,
			depositAmount: 0,
			prepaymentPolicy: 'full_required',
			currency: course.currency ?? 'JPY',
			customFields: extensionApplicationCustomFieldsFromForm(
				formData,
				extensionKey,
				config,
				course,
				subjectCount,
			),
			notes: String(formData.get('notes') || '') || undefined,
			successUrl: String(formData.get('successUrl') || '') || undefined,
			cancelUrl: String(formData.get('cancelUrl') || '') || undefined,
		}),
	})
	if (!res.ok) {
		return reservationMutationErrorState(res.error.status)
	}
	revalidatePath(`/${tenant}/reservations`)
	redirect(`/${tenant}/reservations?status=payment_pending`)
}

export async function issueReservationBillingLinkAction(
	tenant: string,
	id: string,
): Promise<ReservationMutationActionState> {
	const res = await reservationFetch(
		`/v1/erp/reservations/${id}/billing-link`,
		tenant,
		{
			method: 'POST',
			body: JSON.stringify({}),
		},
	)
	if (!res.ok) {
		return reservationMutationErrorState(res.error.status)
	}
	revalidatePath(`/${tenant}/reservations`)
	revalidatePath(`/${tenant}/reports/cancellation-fees`)
	return reservationMutationSuccessState
}

export async function issueReservationSquareInvoiceAction(
	tenant: string,
	id: string,
): Promise<ReservationMutationActionState> {
	const result = await reservationFetchJsonResult<{
		checkoutUrl: string
		reusedExistingInvoice: boolean
	}>(`/v1/erp/reservations/${id}/billing-invoice`, tenant, {
		method: 'POST',
		body: JSON.stringify({}),
	})
	if (!result.ok) {
		return reservationMutationErrorState(result.error.status)
	}
	revalidatePath(`/${tenant}/reservations`)
	revalidatePath(`/${tenant}/reservations/${id}`)
	revalidatePath(`/${tenant}/reports/cancellation-fees`)
	return reservationMutationSuccessState
}

export async function cancelReservationWithPolicyAction(
	tenant: string,
	id: string,
	formData?: FormData,
): Promise<ReservationMutationActionState> {
	const feeValue = String(formData?.get('cancellationFeeAmount') ?? '').trim()
	const refundValue = String(formData?.get('refundAmount') ?? '').trim()
	const reason =
		String(formData?.get('reason') ?? '').trim() ||
		'admin cancellation from reservations list'
	const cancellationFeeAmount = feeValue === '' ? undefined : Number(feeValue)
	const refundAmount = refundValue === '' ? undefined : Number(refundValue)
	const res = await reservationFetch(
		`/v1/erp/reservations/${id}/cancel`,
		tenant,
		{
			method: 'POST',
			body: JSON.stringify({
				reason,
				cancellationFeeAmount:
					typeof cancellationFeeAmount === 'number' &&
					Number.isFinite(cancellationFeeAmount)
						? Math.max(0, Math.trunc(cancellationFeeAmount))
						: undefined,
				refundAmount:
					typeof refundAmount === 'number' && Number.isFinite(refundAmount)
						? Math.max(0, Math.trunc(refundAmount))
						: undefined,
			}),
		},
	)
	if (!res.ok) {
		return reservationMutationErrorState(res.error.status)
	}
	revalidatePath(`/${tenant}/reservations`)
	revalidatePath(`/${tenant}/reservations/${id}`)
	revalidatePath(`/${tenant}/reports/cancellation-fees`)
	return reservationMutationSuccessState
}

export async function updateReservationStaffAction(
	tenant: string,
	id: string,
	formData: FormData,
): Promise<ReservationMutationActionState> {
	const assignedStaffIds = formData
		.getAll('assignedStaffIds')
		.map(value => String(value))
		.filter(Boolean)
	const res = await reservationFetch(`/v1/erp/reservations/${id}`, tenant, {
		method: 'PATCH',
		body: JSON.stringify({ assignedStaffIds }),
	})
	if (!res.ok) {
		return reservationMutationErrorState(res.error.status)
	}
	revalidatePath(`/${tenant}/reservations`)
	revalidatePath(`/${tenant}/reservations/${id}`)
	return reservationMutationSuccessState
}

export async function sendReservationNotificationAction(
	tenant: string,
	id: string,
	kind: ReservationNotificationKind,
	currentInternalNotes?: string | null,
): Promise<ReservationMutationActionState> {
	const settingsResult =
		await fetchReservationNotificationSettingsAction(tenant)
	if (!settingsResult.success) {
		return reservationMutationErrorState()
	}
	const template = settingsResult.data[kind]
	if (!template.enabled) {
		return {
			status: 'error',
			message: 'この通知テンプレートは無効です',
		}
	}
	const res = await reservationFetch(
		`/v1/erp/reservations/${id}/notifications`,
		tenant,
		{
			method: 'POST',
			body: JSON.stringify({
				kind,
				subjectTemplate: template.subject,
				bodyTemplate: template.body,
			}),
		},
	)
	if (!res.ok) {
		const note = [
			currentInternalNotes?.trim(),
			`[reservation-notification kind=${kind} status=failed at=${new Date().toISOString()}]`,
		]
			.filter(Boolean)
			.join('\n')
		await reservationFetch(`/v1/erp/reservations/${id}`, tenant, {
			method: 'PATCH',
			body: JSON.stringify({ internalNotes: note }),
		})
		return reservationMutationErrorState(res.error.status)
	}
	revalidatePath(`/${tenant}/reservations`)
	revalidatePath(`/${tenant}/reservations/${id}`)
	return reservationMutationSuccessState
}

export async function saveReservationNotificationSettingsAction(
	tenant: string,
	formData: FormData,
): Promise<ReservationMutationActionState> {
	const settings = normalizeReservationNotificationSettings({
		confirmation: templateFromForm(formData, 'confirmation'),
		reminder: templateFromForm(formData, 'reminder'),
		change_cancellation: templateFromForm(formData, 'change_cancellation'),
	})
	const manifest = reservationNotificationExtensionManifest(settings)
	const register = await reservationFetch('/v1/erp/extensions', tenant, {
		method: 'POST',
		body: JSON.stringify(manifest),
	})
	if (!register.ok) {
		return reservationMutationErrorState(register.error.status)
	}
	const enable = await reservationFetch(
		`/v1/erp/extensions/${RESERVATION_NOTIFICATION_EXTENSION_KEY}/enable`,
		tenant,
		{
			method: 'POST',
			body: JSON.stringify({ configJson: settings }),
		},
	)
	if (!enable.ok) {
		return reservationMutationErrorState(enable.error.status)
	}
	const save = await reservationFetch(
		`/v1/erp/extensions/${RESERVATION_NOTIFICATION_EXTENSION_KEY}/config`,
		tenant,
		{
			method: 'PATCH',
			body: JSON.stringify({
				scopeType: 'tenant',
				configJson: settings,
			}),
		},
	)
	if (!save.ok) {
		return reservationMutationErrorState(save.error.status)
	}
	revalidatePath(`/${tenant}/reservations`)
	revalidatePath(`/${tenant}/reservations/settings`)
	return reservationMutationSuccessState
}

function templateFromForm(
	formData: FormData,
	kind: ReservationNotificationKind,
): ReservationNotificationTemplate {
	return {
		enabled: formData.get(`${kind}.enabled`) === 'on',
		autoSend: formData.get(`${kind}.autoSend`) === 'on',
		subject: String(formData.get(`${kind}.subject`) ?? '').trim(),
		body: String(formData.get(`${kind}.body`) ?? '').trim(),
	}
}

function reservationNotificationExtensionManifest(
	settings: ReservationNotificationSettings,
) {
	return {
		extensionKey: RESERVATION_NOTIFICATION_EXTENSION_KEY,
		name: 'Reservation notifications',
		description:
			'Customer reservation confirmation and reminder email templates.',
		industry: 'field-operations',
		version: '1.0.0',
		manifestJson: {
			capabilities: ['reservation.notification.email'],
			triggers: [
				'reservation.confirmed',
				'reservation.reminder.previous_day',
				'reservation.changed_or_cancelled',
			],
		},
		configSchemaJson: {
			type: 'object',
			properties: {
				confirmation: notificationTemplateSchema(),
				reminder: notificationTemplateSchema(),
				change_cancellation: notificationTemplateSchema(),
			},
		},
		defaultConfigJson: defaultReservationNotificationSettings,
		capabilitiesJson: {
			notifications: ['email'],
		},
		uiContributionsJson: {
			fieldadmin: {
				route: 'reservations',
				panel: 'reservation-notification-settings',
			},
		},
		policyHooksJson: {
			notificationContext: settings,
		},
		deterministicOrder: 420,
	}
}

function notificationTemplateSchema() {
	return {
		type: 'object',
		properties: {
			enabled: { type: 'boolean' },
			autoSend: { type: 'boolean' },
			subject: { type: 'string', minLength: 1 },
			body: { type: 'string', minLength: 1 },
		},
		required: ['enabled', 'autoSend', 'subject', 'body'],
	}
}

function defaultExtensionApplicationConfig(
	extensionKey = 'application',
): ExtensionApplicationConfigData {
	return {
		maxDogCount: 2,
		termsVersion: '2026-05-30',
		vaccineCertificateRequiredOnFirstVisit: true,
		courses: [
			{
				code: 'day',
				label: '1日利用コース',
				startTime: '10:00',
				endTime: '15:00',
				pricesByDogCount: { '1': 1600, '2': 2600 },
				currency: 'JPY',
			},
			{
				code: 'evening',
				label: '夕方利用コース',
				startTime: '15:00',
				endTime: '18:00',
				pricesByDogCount: { '1': 1400, '2': 2200 },
				currency: 'JPY',
			},
		],
		formPresentation: {
			badgeLabel: 'Application',
			publicTitle: '利用申込',
			publicDescription:
				'利用前の確認事項、申込者情報、対象情報を入力してください。料金はコースと数量から自動計算されます。',
			kioskTitle: 'iPad受付',
			kioskDescription:
				'店頭iPadで利用申込、同意事項、対象情報を入力し、決済待ち予約として登録します。',
			submitLabel: '申込して決済へ進む',
			disabledTitle: '受付はまだ有効化されていません',
			disabledDescription: '店舗スタッフへお声がけください。',
		},
		consentItems: [
			{
				key: 'termsConfirmed',
				label: '利用条件と施設ルールを確認しました。',
				required: true,
			},
			{
				key: 'healthConfirmed',
				label: '利用対象の健康状態に問題がないことを確認しました。',
				required: true,
			},
			{
				key: 'supervisionAccepted',
				label:
					'施設内では対象から目を離さず、トラブルが発生した場合は当事者同士で解決します。',
				required: true,
			},
			{
				key: 'outsideItemRuleAccepted',
				label: '持ち込み品は周囲に注意して使用し、他のお客様に配慮します。',
				required: true,
			},
		],
		subjectGroups: [
			{
				key: 'subjects',
				label: '利用対象',
				singularLabel: '対象',
				countLabel: '数量',
				maxCount: 2,
				certificateLabel: '必要書類を確認済み',
				fields: [
					{ key: 'name', label: '名前', type: 'text', required: true },
					{ key: 'category', label: '種別', type: 'text', required: true },
					{ key: 'age', label: '年齢', type: 'text' },
					{
						key: 'sex',
						label: '性別',
						type: 'select',
						required: true,
						options: [
							{ value: 'male', label: 'オス' },
							{ value: 'female', label: 'メス' },
						],
					},
					{ key: 'birthday', label: '誕生日', type: 'date' },
					{
						key: 'certificateDate',
						label: '証明書確認日',
						type: 'date',
						required: true,
					},
					{ key: 'certificateExpiresAt', label: '有効期限', type: 'date' },
				],
			},
		],
	}
}

async function fetchCloudAppApplicationPreset(
	tenant: string,
	extensionKey: string,
): Promise<unknown> {
	const preset = CLOUD_APP_APPLICATION_PRESETS[extensionKey]
	if (!preset) return null

	const registry = await fetchCloudAppExtensions(tenant)
	if (!registry.ok) return null

	const extension = registry.extensions.find(
		item => item.appName === preset.appName,
	)
	if (!extension) return null

	const result = await fetchJsonWithRetry<unknown>(
		`${extension.apiBaseUrl}${preset.path}`,
		{
			headers: { 'Content-Type': 'application/json' },
		},
	)
	return result.ok ? result.data : null
}

function mergeApplicationConfigPreset(base: unknown, preset: unknown): unknown {
	const baseRecord = objectRecord(base)
	const presetRecord = objectRecord(preset)
	if (!presetRecord) return base
	if (!baseRecord) return preset

	const merged: Record<string, unknown> = {
		...baseRecord,
		...presetRecord,
	}
	merged.formPresentation = {
		...objectRecord(baseRecord.formPresentation),
		...objectRecord(presetRecord.formPresentation),
	}

	if (
		Array.isArray(baseRecord.subjectGroups) &&
		Array.isArray(presetRecord.subjectGroups)
	) {
		const baseGroups = baseRecord.subjectGroups
		merged.subjectGroups = presetRecord.subjectGroups.map((group, index) => {
			const baseGroup = objectRecord(baseGroups[index])
			const presetGroup = objectRecord(group)
			return {
				...baseGroup,
				...presetGroup,
				fields: presetGroup?.fields ?? baseGroup?.fields,
			}
		})
	}

	return merged
}

function objectRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null
}

function normalizeExtensionApplicationConfig(
	extensionKey: string,
	value: unknown,
): ExtensionApplicationConfigData {
	const fallback = defaultExtensionApplicationConfig(extensionKey)
	const record =
		value && typeof value === 'object' && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: {}
	const courses = Array.isArray(record.courses)
		? record.courses
				.map(course => normalizeApplicationCourse(course))
				.filter((course): course is ExtensionApplicationCourseData =>
					Boolean(course),
				)
		: []
	return {
		maxDogCount: normalizePositiveInteger(
			record.maxDogCount,
			fallback.maxDogCount,
		),
		termsVersion: String(record.termsVersion ?? fallback.termsVersion),
		vaccineCertificateRequiredOnFirstVisit:
			typeof record.vaccineCertificateRequiredOnFirstVisit === 'boolean'
				? record.vaccineCertificateRequiredOnFirstVisit
				: fallback.vaccineCertificateRequiredOnFirstVisit,
		courses: courses.length > 0 ? courses : fallback.courses,
		formPresentation: normalizePresentation(
			record.formPresentation,
			fallback.formPresentation,
		),
		consentItems: Array.isArray(record.consentItems)
			? (record.consentItems as ExtensionApplicationConsentItemData[])
			: fallback.consentItems,
		subjectGroups: Array.isArray(record.subjectGroups)
			? (record.subjectGroups as ExtensionApplicationSubjectGroupData[])
			: fallback.subjectGroups,
	}
}

function normalizeApplicationCourse(
	value: unknown,
): ExtensionApplicationCourseData | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null
	const record = value as Record<string, unknown>
	const prices =
		record.pricesByDogCount &&
		typeof record.pricesByDogCount === 'object' &&
		!Array.isArray(record.pricesByDogCount)
			? Object.fromEntries(
					Object.entries(record.pricesByDogCount).map(([key, price]) => [
						key,
						Number(price),
					]),
				)
			: {}
	const course = {
		code: String(record.code ?? '').trim(),
		label: String(record.label ?? '').trim(),
		startTime: String(record.startTime ?? '').trim(),
		endTime: String(record.endTime ?? '').trim(),
		pricesByDogCount: prices,
		currency: String(record.currency ?? 'JPY'),
	}
	return course.code && course.label && isTimeText(course.startTime)
		? course
		: null
}

function extensionApplicationCustomFieldsFromForm(
	formData: FormData,
	extensionKey: string,
	config: ExtensionApplicationConfigData,
	course: ExtensionApplicationCourseData,
	subjectCount: number,
) {
	const group = config.subjectGroups[0]
	const subjects = [0, 1]
		.slice(0, subjectCount)
		.map(index =>
			Object.fromEntries(
				group.fields.map(field => [
					field.key,
					String(formData.get(`subject_${index}_${field.key}`) || ''),
				]),
			),
		)
	const subjectNames = subjects
		.map(subject => String(subject.name ?? '').trim())
		.filter(Boolean)
	const certificateChecked =
		formData.get('staffVaccineCertificateChecked') === 'on'
	return {
		applicationKind: extensionKey,
		subjectCount,
		subjectGroupKey: group.key,
		subjectGroupLabel: group.label,
		subjectNames,
		certificateStatus: certificateChecked ? 'checked' : 'unchecked',
		courseCode: course.code,
		courseLabel: course.label,
		courseStartTime: course.startTime,
		courseEndTime: course.endTime,
		ownerKana: String(formData.get('ownerKana') || ''),
		ownerGender: String(formData.get('ownerGender') || 'unspecified'),
		ownerAddress: String(formData.get('ownerAddress') || ''),
		subjects,
		[group.key]: subjects,
		termsAcceptedVersion: config.termsVersion,
		...Object.fromEntries(
			config.consentItems.map(item => [
				item.key,
				formData.get(item.key) === 'on',
			]),
		),
		staffVaccineCertificateChecked: certificateChecked,
		staffMemo: String(formData.get('staffMemo') || ''),
	}
}

function selectApplicationCourse(
	config: ExtensionApplicationConfigData,
	startsAt: Date,
) {
	const minutes = startsAt.getHours() * 60 + startsAt.getMinutes()
	return (
		config.courses.find(course => {
			const start = timeToMinutes(course.startTime)
			const end = timeToMinutes(course.endTime)
			return start <= minutes && minutes < end
		}) ?? config.courses[0]
	)
}

function applicationPrice(
	course: ExtensionApplicationCourseData,
	subjectCount: number,
) {
	const price = Number(course.pricesByDogCount[String(subjectCount)])
	return Number.isFinite(price) && price >= 0 ? Math.round(price) : 0
}

function normalizeSubjectCount(value: FormDataEntryValue | null) {
	const parsed = Number(value)
	return Number.isFinite(parsed)
		? Math.min(2, Math.max(1, Math.round(parsed)))
		: 1
}

function normalizePresentation(
	value: unknown,
	fallback: ExtensionApplicationPresentationData,
): ExtensionApplicationPresentationData {
	const record =
		value && typeof value === 'object' && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: {}
	return {
		badgeLabel: stringOrFallback(record.badgeLabel, fallback.badgeLabel),
		publicTitle: stringOrFallback(record.publicTitle, fallback.publicTitle),
		publicDescription: stringOrFallback(
			record.publicDescription,
			fallback.publicDescription,
		),
		kioskTitle: stringOrFallback(record.kioskTitle, fallback.kioskTitle),
		kioskDescription: stringOrFallback(
			record.kioskDescription,
			fallback.kioskDescription,
		),
		submitLabel: stringOrFallback(record.submitLabel, fallback.submitLabel),
		disabledTitle: stringOrFallback(
			record.disabledTitle,
			fallback.disabledTitle,
		),
		disabledDescription: stringOrFallback(
			record.disabledDescription,
			fallback.disabledDescription,
		),
	}
}

function stringOrFallback(value: unknown, fallback: string) {
	return typeof value === 'string' && value.trim() ? value : fallback
}

function normalizePositiveInteger(value: unknown, fallback: number) {
	const parsed = Number(value)
	return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback
}

function isTimeText(value: string) {
	return /^\d{2}:\d{2}$/.test(value)
}

function timeToMinutes(value: string) {
	const [hours, minutes] = value.split(':').map(Number)
	return hours * 60 + minutes
}
