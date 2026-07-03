'use server'

import { joinServerBackendPath } from 'lib/serverBackendUrl'
import { authWithCheck } from 'app/auth'
import {
	GOLF_COURSE_EXTENSION_KEY,
	isReservationProductConfigExtension,
} from 'lib/extension-admin-registry'
import { fetchJsonWithRetry, fetchWithRetry } from 'lib/reliable-fetch'
import { revalidatePath } from 'next/cache'

const PLATFORM_ID =
	process.env.NEXT_PUBLIC_PLATFORM_ID || 'tn_01hjjn348rn3t49zz6hvmfq67p'

export type ExtensionStatusData = {
	tenantId: string
	extensionKey: string
	name: string
	description?: string | null
	industry: string
	version: string
	registryStatus: string
	manifestJson?: Record<string, unknown> | null
	capabilitiesJson?: Record<string, unknown> | null
	uiContributionsJson?: Record<string, unknown> | null
	policyHooksJson?: Record<string, unknown> | null
	tenantStatus?: 'enabled' | 'disabled' | null
	enabledAt?: string | null
	disabledAt?: string | null
	configVersion?: number | null
	configJson?: Record<string, unknown> | null
	validation: {
		valid: boolean
		errors: string[]
	}
	updatedAt?: string | null
}

export type ExtensionAuditEventData = {
	id: string
	extensionKey: string
	eventType: string
	actorId?: string | null
	version?: string | null
	statusAfter: string
	createdAt: string
}

async function extensionFetch(
	path: string,
	tenant: string,
	init?: RequestInit,
) {
	const session = await authWithCheck()
	return fetchWithRetry(joinServerBackendPath(path), {
		...init,
		headers: {
			'Content-Type': 'application/json',
			'x-platform-id': PLATFORM_ID,
			'x-operator-id': tenant,
			Authorization: `Bearer ${session.accessToken}`,
			...(init?.headers ?? {}),
		},
	})
}

async function extensionFetchJson<T>(path: string, tenant: string) {
	const session = await authWithCheck()
	const result = await fetchJsonWithRetry<T>(joinServerBackendPath(path), {
		headers: {
			'Content-Type': 'application/json',
			'x-platform-id': PLATFORM_ID,
			'x-operator-id': tenant,
			Authorization: `Bearer ${session.accessToken}`,
		},
	})
	if (!result.ok)
		return { success: false as const, message: result.error.message }
	return { success: true as const, data: result.data }
}

export async function fetchExtensionStatusesAction(tenant: string) {
	const result = await extensionFetchJson<{ items: ExtensionStatusData[] }>(
		'/v1/erp/extensions/status',
		tenant,
	)
	return result.success
		? { success: true as const, data: result.data.items }
		: result
}

export async function fetchExtensionAuditAction(tenant: string) {
	const result = await extensionFetchJson<{ items: ExtensionAuditEventData[] }>(
		'/v1/erp/extensions/audit?limit=10',
		tenant,
	)
	return result.success
		? { success: true as const, data: result.data.items }
		: result
}

export async function enableExtensionAction(
	tenant: string,
	extensionKey: string,
) {
	const res = await extensionFetch(
		`/v1/erp/extensions/${extensionKey}/enable`,
		tenant,
		{
			method: 'POST',
			body: JSON.stringify({}),
		},
	)
	if (!res.ok) throw new Error(res.error.message)
	revalidatePath(`/${tenant}/extensions`)
}

export async function disableExtensionAction(
	tenant: string,
	extensionKey: string,
) {
	const res = await extensionFetch(
		`/v1/erp/extensions/${extensionKey}/disable`,
		tenant,
		{
			method: 'POST',
			body: JSON.stringify({}),
		},
	)
	if (!res.ok) throw new Error(res.error.message)
	revalidatePath(`/${tenant}/extensions`)
}

export async function updateExtensionConfigAction(
	tenant: string,
	extensionKey: string,
	formData: FormData,
) {
	const configJson =
		isReservationProductConfigExtension(extensionKey) &&
		formData.get('reservationProductConfigForm') === 'true'
			? buildReservationProductConfig(formData)
			: formData.get('applicationIntakeConfigForm') === 'true'
				? buildApplicationIntakeConfig(formData)
				: parseRawConfig(formData)

	const res = await extensionFetch(
		`/v1/erp/extensions/${extensionKey}/config`,
		tenant,
		{
			method: 'PATCH',
			body: JSON.stringify({
				scopeType: 'tenant',
				configJson,
			}),
		},
	)
	if (!res.ok) throw new Error(res.error.message)
	revalidatePath(`/${tenant}/extensions`)
}

export async function updateReservationProductConfigAction(
	tenant: string,
	formData: FormData,
) {
	return updateExtensionConfigAction(
		tenant,
		GOLF_COURSE_EXTENSION_KEY,
		formData,
	)
}

function parseRawConfig(formData: FormData) {
	const rawConfig = String(formData.get('configJson') ?? '').trim()
	if (!rawConfig) throw new Error('Config JSON is required')

	try {
		return JSON.parse(rawConfig)
	} catch {
		throw new Error('Config must be valid JSON')
	}
}

function buildApplicationIntakeConfig(formData: FormData) {
	const base = parseOptionalJsonObject(formData.get('baseConfigJson')) ?? {}
	const basePresentation = objectRecord(base.formPresentation) ?? {}
	const baseSubjectGroups = Array.isArray(base.subjectGroups)
		? (base.subjectGroups as Record<string, unknown>[])
		: []
	const subjectGroup = {
		...(baseSubjectGroups[0] ?? {}),
		key: String(
			formData.get('subject_key') ?? baseSubjectGroups[0]?.key ?? 'subjects',
		),
		label: requiredText(formData.get('subject_label'), '利用対象'),
		singularLabel: requiredText(formData.get('subject_singularLabel'), '対象'),
		countLabel: requiredText(formData.get('subject_countLabel'), '数量'),
		maxCount: normalizeInteger(formData.get('subject_maxCount'), 2),
		certificateLabel: requiredText(
			formData.get('subject_certificateLabel'),
			'必要書類を確認済み',
		),
		fields: Array.isArray(baseSubjectGroups[0]?.fields)
			? baseSubjectGroups[0].fields
			: [],
	}
	const maxCount = Math.max(1, Math.min(12, Number(subjectGroup.maxCount) || 2))
	const courses = [0, 1, 2, 3]
		.map(index => buildApplicationCourse(formData, index, maxCount))
		.filter(
			(
				course,
			): course is NonNullable<ReturnType<typeof buildApplicationCourse>> =>
				Boolean(course),
		)
	const consentItems = [0, 1, 2, 3, 4, 5, 6, 7]
		.map(index => {
			const key = requiredText(
				formData.get(`consent_${index}_key`),
				`consent_${index + 1}`,
			)
			const label = String(formData.get(`consent_${index}_label`) ?? '').trim()
			if (!label) return null
			return {
				key,
				label,
				required: formData.get(`consent_${index}_required`) === 'on',
			}
		})
		.filter((item): item is { key: string; label: string; required: boolean } =>
			Boolean(item),
		)

	return {
		...base,
		maxDogCount: maxCount,
		termsVersion: requiredText(formData.get('termsVersion'), '2026-05-30'),
		vaccineCertificateRequiredOnFirstVisit:
			formData.get('vaccineCertificateRequiredOnFirstVisit') === 'on',
		courses: courses.length > 0 ? courses : base.courses,
		formPresentation: {
			...basePresentation,
			badgeLabel: requiredText(
				formData.get('presentation_badgeLabel'),
				String(basePresentation.badgeLabel ?? 'Application'),
			),
			publicTitle: requiredText(
				formData.get('presentation_publicTitle'),
				String(basePresentation.publicTitle ?? '利用申込'),
			),
			publicDescription: requiredText(
				formData.get('presentation_publicDescription'),
				String(basePresentation.publicDescription ?? ''),
			),
			kioskTitle: requiredText(
				formData.get('presentation_kioskTitle'),
				String(basePresentation.kioskTitle ?? 'iPad受付'),
			),
			kioskDescription: requiredText(
				formData.get('presentation_kioskDescription'),
				String(basePresentation.kioskDescription ?? ''),
			),
			submitLabel: requiredText(
				formData.get('presentation_submitLabel'),
				String(basePresentation.submitLabel ?? '申込する'),
			),
			disabledTitle: requiredText(
				formData.get('presentation_disabledTitle'),
				String(basePresentation.disabledTitle ?? '受付は現在利用できません'),
			),
			disabledDescription: requiredText(
				formData.get('presentation_disabledDescription'),
				String(basePresentation.disabledDescription ?? ''),
			),
		},
		consentItems: consentItems.length > 0 ? consentItems : base.consentItems,
		subjectGroups: [subjectGroup, ...baseSubjectGroups.slice(1)],
	}
}

function buildApplicationCourse(
	formData: FormData,
	index: number,
	maxCount: number,
) {
	const label = String(formData.get(`course_${index}_label`) ?? '').trim()
	if (!label) return null
	const code = requiredText(
		formData.get(`course_${index}_code`),
		`course_${index + 1}`,
	)
	const pricesByDogCount = Object.fromEntries(
		Array.from({ length: maxCount }, (_, offset) => {
			const count = offset + 1
			return [
				String(count),
				normalizeNonNegativeInteger(
					formData.get(`course_${index}_price_${count}`),
					0,
				),
			]
		}),
	)
	return {
		code,
		label,
		startTime: requiredText(formData.get(`course_${index}_startTime`), '10:00'),
		endTime: requiredText(formData.get(`course_${index}_endTime`), '15:00'),
		pricesByDogCount,
		currency: requiredText(formData.get(`course_${index}_currency`), 'JPY'),
	}
}

function parseOptionalJsonObject(value: FormDataEntryValue | null) {
	if (typeof value !== 'string' || !value.trim()) return null
	try {
		const parsed: unknown = JSON.parse(value)
		return objectRecord(parsed)
	} catch {
		return null
	}
}

function objectRecord(value: unknown) {
	return value && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null
}

function requiredText(value: FormDataEntryValue | null, fallback: string) {
	const text = typeof value === 'string' ? value.trim() : ''
	return text || fallback
}

function buildReservationProductConfig(formData: FormData) {
	const reservationProducts = buildReservationProducts(formData)
	const primaryProduct = reservationProducts[0]
	const primaryDepositRatio =
		primaryProduct?.prepaymentPolicy === 'full_required' ||
		primaryProduct?.prepaymentPolicy === 'none'
			? 0
			: (primaryProduct?.depositRatio ?? 0.3)

	return {
		publicProductName: primaryProduct?.name ?? '標準予約プラン',
		publicProductDescription:
			primaryProduct?.description ??
			'日時と人数を指定して予約できる標準プランです。',
		reservationProducts,
		defaultDurationMinutes: primaryProduct?.durationMinutes ?? 60,
		cartPolicy: 'optional',
		defaultHoles: 18,
		maxPlayersPerTeeTime: 4,
		memberGuestPricing: {
			memberDepositRatio: primaryDepositRatio,
			guestDepositRatio: primaryDepositRatio,
		},
	}
}

function buildReservationProducts(formData: FormData) {
	const productCount = normalizeNonNegativeInteger(
		formData.get('productCount'),
		0,
	)

	return Array.from({ length: productCount }, (_, index) => index)
		.map(index => {
			const catalogProduct = parseCatalogProductRef(
				formData.get(`product_${index}_catalogProduct`),
			)
			if (!catalogProduct) return null

			const description = String(
				formData.get(`product_${index}_description`) ?? '',
			).trim()
			const priceAmount = catalogProduct.priceAmount
			const prepaymentPolicy = normalizePrepaymentPolicy(
				formData.get(`product_${index}_prepaymentPolicy`),
			)
			const bookingMode = normalizeBookingMode(
				formData.get(`product_${index}_bookingMode`),
			)
			const durationMinutes = normalizeInteger(
				formData.get(`product_${index}_durationMinutes`),
				60,
			)
			const depositRatio =
				prepaymentPolicy === 'full_required' || prepaymentPolicy === 'none'
					? 0
					: normalizeRatio(
							formData.get(`product_${index}_depositRatioPercent`),
							30,
						)

			return {
				id: `product_${catalogProduct.id}`,
				enabled: formData.get(`product_${index}_enabled`) === 'on',
				productId: catalogProduct.id,
				reservationTypeId:
					requiredText(
						formData.get(`product_${index}_reservationTypeId`),
						'',
					) || undefined,
				name: catalogProduct.name,
				description,
				bookingMode,
				durationMinutes,
				priceAmount,
				prepaymentPolicy,
				depositRatio,
				availability: buildReservationProductAvailability(formData, index),
				slots:
					bookingMode === 'slot'
						? buildReservationProductSlots(formData, index, durationMinutes)
						: [],
				formFields: ['partySize', 'contact', 'notes'],
			}
		})
		.filter(
			(product): product is NonNullable<typeof product> =>
				product?.enabled === true,
		)
}

function buildReservationProductAvailability(
	formData: FormData,
	productIndex: number,
) {
	const weekdays = formData
		.getAll(`product_${productIndex}_availability_weekday`)
		.map(value => Number(value))
		.filter(value => Number.isInteger(value) && value >= 0 && value <= 6)

	return {
		startDate: normalizeDateText(
			formData.get(`product_${productIndex}_availability_startDate`),
		),
		endDate: normalizeDateText(
			formData.get(`product_${productIndex}_availability_endDate`),
		),
		weekdays,
		includedDates: parseDateList(
			formData.get(`product_${productIndex}_availability_includedDates`),
		),
		excludedDates: parseDateList(
			formData.get(`product_${productIndex}_availability_excludedDates`),
		),
	}
}

function buildReservationProductSlots(
	formData: FormData,
	productIndex: number,
	defaultDurationMinutes: number,
) {
	return [0, 1, 2]
		.map(slotIndex => {
			const startsAt = String(
				formData.get(`product_${productIndex}_slot_${slotIndex}_startsAt`) ??
					'',
			).trim()
			if (!startsAt) return null
			const repeatsWeekly =
				formData.get(
					`product_${productIndex}_slot_${slotIndex}_repeatsWeekly`,
				) === 'on'
			const label = String(
				formData.get(`product_${productIndex}_slot_${slotIndex}_label`) ?? '',
			).trim()
			const durationMinutes = normalizeInteger(
				formData.get(
					`product_${productIndex}_slot_${slotIndex}_durationMinutes`,
				),
				defaultDurationMinutes,
			)
			const remainingQuantity = normalizeOptionalNonNegativeInteger(
				formData.get(
					`product_${productIndex}_slot_${slotIndex}_remainingQuantity`,
				),
			)
			return {
				id: `plan_${productIndex + 1}_slot_${slotIndex + 1}`,
				label: label || formatSlotLabel(startsAt),
				startsAt,
				startTime: formatSlotStartTime(startsAt),
				durationMinutes,
				remainingQuantity,
				repeatsWeekly,
			}
		})
		.filter((slot): slot is NonNullable<typeof slot> => slot !== null)
}

function parseCatalogProductRef(value: FormDataEntryValue | null) {
	if (typeof value !== 'string' || !value.trim()) return null

	try {
		const parsed: unknown = JSON.parse(value)
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
			return null
		}
		const record = parsed as Record<string, unknown>
		const id = typeof record.id === 'string' ? record.id.trim() : ''
		const name = typeof record.name === 'string' ? record.name.trim() : ''
		const priceAmount = Number(record.priceAmount)
		if (!id || !name) return null
		return {
			id,
			name,
			priceAmount: Number.isFinite(priceAmount) ? Math.max(0, priceAmount) : 0,
		}
	} catch {
		return null
	}
}

function normalizeInteger(value: FormDataEntryValue | null, fallback: number) {
	const parsed = Number(value)
	return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback
}

function normalizeNonNegativeInteger(
	value: FormDataEntryValue | null,
	fallback: number,
) {
	const parsed = Number(value)
	return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : fallback
}

function normalizeOptionalNonNegativeInteger(value: FormDataEntryValue | null) {
	if (typeof value !== 'string' || !value.trim()) return undefined
	const parsed = Number(value)
	return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : undefined
}

function normalizeDateText(value: FormDataEntryValue | null) {
	if (typeof value !== 'string') return undefined
	const text = value.trim()
	return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : undefined
}

function parseDateList(value: FormDataEntryValue | null) {
	if (typeof value !== 'string') return []
	return Array.from(
		new Set(
			value
				.split(/[\s,、]+/)
				.map(item => item.trim())
				.filter(item => /^\d{4}-\d{2}-\d{2}$/.test(item)),
		),
	)
}

function normalizeRatio(
	value: FormDataEntryValue | null,
	fallbackPercent: number,
) {
	const parsed = Number(value)
	const percent =
		Number.isFinite(parsed) && parsed >= 0 ? parsed : fallbackPercent
	return Math.round(percent) / 100
}

function normalizeBookingMode(value: FormDataEntryValue | null) {
	return value === 'slot' ? 'slot' : 'time'
}

function normalizePrepaymentPolicy(value: FormDataEntryValue | null) {
	if (typeof value !== 'string') return 'deposit_required'
	if (
		['deposit_required', 'full_required', 'optional', 'none'].includes(value)
	) {
		return value
	}
	return 'deposit_required'
}

function formatSlotLabel(startsAt: string) {
	const date = new Date(startsAt)
	if (Number.isNaN(date.getTime())) return startsAt
	const hours = String(date.getHours()).padStart(2, '0')
	const minutes = String(date.getMinutes()).padStart(2, '0')
	return `${hours}:${minutes}`
}

function formatSlotStartTime(startsAt: string) {
	const date = new Date(startsAt)
	if (Number.isNaN(date.getTime())) {
		const match = startsAt.match(/T(\d{2}:\d{2})/)
		return match?.[1] ?? ''
	}
	const hours = String(date.getHours()).padStart(2, '0')
	const minutes = String(date.getMinutes()).padStart(2, '0')
	return `${hours}:${minutes}`
}
