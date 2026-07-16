export type TachyonFieldMode = 'sandbox' | 'production'

export const OPERATOR_IDS = {
	sandbox: 'tn_01hy91qw3362djx6z9jerr34v4',
	production: 'tn_01j91h09tpj5ehwbwfwfxpak2b',
} as const

export const OPERATOR_NAMES = {
	sandbox: 'TACHYON Field Sandbox',
	production: 'TACHYON Field Production',
} as const

export const PLATFORM_IDS = {
	sandbox: 'tn_01hjryxysgey07h5jz5wagqj0m',
	production: 'tn_01hjjn348rn3t49zz6hvmfq67p',
} as const

export function getModeFromSearchParams(
	searchParams?: Record<string, string | string[] | undefined>,
): TachyonFieldMode {
	return searchParams?._mode === 'sandbox' ? 'sandbox' : 'production'
}

export function getModeFromPathname(pathname: string): TachyonFieldMode {
	return pathname.startsWith('/sandbox') ? 'sandbox' : 'production'
}

export function getOperatorIdForMode(mode: TachyonFieldMode): string {
	return OPERATOR_IDS[mode]
}

export function getOperatorNameForMode(mode: TachyonFieldMode): string {
	return OPERATOR_NAMES[mode]
}

export function getKnownOperatorName(operatorId: string): string | null {
	if (operatorId === OPERATOR_IDS.sandbox) {
		return OPERATOR_NAMES.sandbox
	}
	if (operatorId === OPERATOR_IDS.production) {
		return OPERATOR_NAMES.production
	}
	return null
}

export function getPlatformIdForMode(mode: TachyonFieldMode): string {
	return PLATFORM_IDS[mode]
}

/**
 * Check if the operator ID is a known sandbox or production operator.
 */
export function isKnownOperatorId(operatorId: string): boolean {
	return (
		operatorId === OPERATOR_IDS.sandbox ||
		operatorId === OPERATOR_IDS.production
	)
}

/**
 * Detect mode from operator (tenant) ID.
 * Returns 'sandbox' if the operator matches the known sandbox ID,
 * otherwise 'production'.
 */
export function getModeFromOperatorId(operatorId: string): TachyonFieldMode {
	return operatorId === OPERATOR_IDS.sandbox ? 'sandbox' : 'production'
}

/**
 * Get the mode prefix for server-side link construction.
 * Returns '/sandbox' for sandbox operators, '' for production.
 */
export function getServerModePrefix(operatorId: string): string {
	return getModeFromOperatorId(operatorId) === 'sandbox' ? '/sandbox' : ''
}

export function getPathWithMode(path: string, mode: TachyonFieldMode): string {
	const cleanPath = path.startsWith('/sandbox')
		? path.replace(/^\/sandbox/, '') || '/'
		: path
	return mode === 'sandbox'
		? `/sandbox${cleanPath === '/' ? '' : cleanPath}`
		: cleanPath
}

export function getTogglePath(pathname: string): string {
	const cleanPath = pathname.startsWith('/sandbox')
		? pathname.replace(/^\/sandbox/, '') || '/'
		: pathname

	// Detect tenant ID from URL to determine actual mode
	const tenantMatch = cleanPath.match(/\/(tn_[a-z0-9]+)/)
	const currentTenantId = tenantMatch?.[1]

	// Determine mode from both URL prefix and tenant ID.
	// Tenant ID is the source of truth when it matches a known operator,
	// because server-rendered links may lose the /sandbox prefix.
	let currentMode = getModeFromPathname(pathname)
	if (currentTenantId === OPERATOR_IDS.sandbox) {
		currentMode = 'sandbox'
	} else if (currentTenantId === OPERATOR_IDS.production) {
		currentMode = 'production'
	}

	const targetMode = currentMode === 'sandbox' ? 'production' : 'sandbox'
	const targetOperatorId = OPERATOR_IDS[targetMode]
	const newPath = cleanPath.replace(/\/(tn_[a-z0-9]+)/, `/${targetOperatorId}`)

	return getPathWithMode(newPath, targetMode)
}
