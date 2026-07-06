import type { AdminMessageKey } from './admin-i18n'

export const GOLF_COURSE_EXTENSION_KEY = 'golf_course'

export const golfCourseAdminPaths = {
	portal: '/extensions/golf-course',
	courses: '/extensions/golf-course/courses',
	reservationProducts: '/extensions/golf-course/reservation-products',
	caddies: '/extensions/golf-course/caddies',
	settlement: '/extensions/golf-course/settlement',
	budgets: '/extensions/golf-course/budgets',
	policy: '/extensions/golf-course/policy',
} as const

export const golfCourseApiPaths = {
	courses: '/v1/erp/extensions/golf-course/courses',
	course: (id: string) =>
		`/v1/erp/extensions/golf-course/courses/${encodeURIComponent(id)}`,
	reservationProducts: '/v1/erp/extensions/golf-course/reservation-products',
	reservationProduct: (serviceId: string) =>
		`/v1/erp/extensions/golf-course/reservation-products/${encodeURIComponent(serviceId)}`,
	reservationProductSlots: (serviceId: string) =>
		`/v1/erp/extensions/golf-course/reservation-products/${encodeURIComponent(serviceId)}/slots`,
	caddieProfiles: '/v1/erp/extensions/golf-course/caddie-profiles',
	caddieAssignments: '/v1/erp/extensions/golf-course/caddie-assignments',
	caddieRecommendations:
		'/v1/erp/extensions/golf-course/caddie-recommendations?playerCount=4&includeRookiePairing=true&limit=5',
	caddiePayrollSummary: (yearMonth: string) =>
		`/v1/erp/extensions/golf-course/caddie-payroll-summary?yearMonth=${encodeURIComponent(yearMonth)}`,
	caddiePayrollSummaryCsv: (yearMonth: string) =>
		`/v1/erp/extensions/golf-course/caddie-payroll-summary/export.csv?yearMonth=${encodeURIComponent(yearMonth)}`,
	caddieAttendanceSnapshot: (date?: string) =>
		`/v1/erp/extensions/golf-course/caddie-attendance-snapshot${date ? `?date=${encodeURIComponent(date)}` : ''}`,
	caddieProfile: (id: string) =>
		`/v1/erp/extensions/golf-course/caddie-profiles/${encodeURIComponent(id)}`,
	monthlySettlement: (yearMonth: string) =>
		`/v1/erp/extensions/golf-course/monthly-settlement?yearMonth=${encodeURIComponent(yearMonth)}`,
	monthlySettlementCsv: (yearMonth: string) =>
		`/v1/erp/extensions/golf-course/monthly-settlement/export.csv?yearMonth=${encodeURIComponent(yearMonth)}`,
} as const

type ExtensionAdminSurface = {
	extensionKey: string
	titleKey: AdminMessageKey
	descriptionKey: AdminMessageKey
	managementPath: string
	managementLabel: string
	usesReservationProductConfigForm: boolean
}

const extensionAdminSurfaces: Record<string, ExtensionAdminSurface> = {
	[GOLF_COURSE_EXTENSION_KEY]: {
		extensionKey: GOLF_COURSE_EXTENSION_KEY,
		titleKey: 'extensions.productSettings',
		descriptionKey: 'extensions.productDescription',
		managementPath: golfCourseAdminPaths.portal,
		managementLabel: 'ゴルフアプリを開く',
		usesReservationProductConfigForm: true,
	},
}

export function getExtensionAdminSurface(extensionKey: string) {
	return extensionAdminSurfaces[extensionKey] ?? null
}

export function isReservationProductConfigExtension(extensionKey: string) {
	return (
		getExtensionAdminSurface(extensionKey)?.usesReservationProductConfigForm ??
		false
	)
}

export function getExtensionDisplayKeys(extensionKey: string) {
	const surface = getExtensionAdminSurface(extensionKey)
	return surface
		? {
				titleKey: surface.titleKey,
				descriptionKey: surface.descriptionKey,
			}
		: null
}
