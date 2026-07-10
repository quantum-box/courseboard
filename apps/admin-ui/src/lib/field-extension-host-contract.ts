export const FIELD_EXTENSION_HOST_QUERY_KEYS = {
	tenant: 'tenant',
	extensionAppName: 'extensionAppName',
	surface: 'surface',
	proxyBase: 'proxyBase',
} as const

export type FieldExtensionHostSurface = 'ui' | 'kiosk'

export type FieldExtensionHostContext = {
	tenant: string
	extensionAppName: string
	surface: FieldExtensionHostSurface
	proxyBase: string
}

export const FIELD_EXTENSION_IFRAME_SANDBOX = [
	'allow-forms',
	'allow-popups',
	'allow-popups-to-escape-sandbox',
	'allow-same-origin',
	'allow-scripts',
] as const

export const FIELD_EXTENSION_IFRAME_SANDBOX_POLICY =
	FIELD_EXTENSION_IFRAME_SANDBOX.join(' ')

export const FIELD_EXTENSION_HOST_MESSAGE_SOURCE =
	'tachyonfield-extension' as const

export const FIELD_EXTENSION_HOST_MESSAGE_EVENTS = {
	ready: 'ready',
	resize: 'resize',
	error: 'error',
	reload: 'reload',
} as const

export type FieldExtensionHostMessageEvent =
	(typeof FIELD_EXTENSION_HOST_MESSAGE_EVENTS)[keyof typeof FIELD_EXTENSION_HOST_MESSAGE_EVENTS]

type FieldExtensionHostMessageBase = {
	source: typeof FIELD_EXTENSION_HOST_MESSAGE_SOURCE
	event: FieldExtensionHostMessageEvent
	tenant: string
	extensionAppName: string
	surface: FieldExtensionHostSurface
}

export type FieldExtensionHostReadyMessage = FieldExtensionHostMessageBase & {
	event: typeof FIELD_EXTENSION_HOST_MESSAGE_EVENTS.ready
}

export type FieldExtensionHostResizeMessage = FieldExtensionHostMessageBase & {
	event: typeof FIELD_EXTENSION_HOST_MESSAGE_EVENTS.resize
	height: number
}

export type FieldExtensionHostErrorMessage = FieldExtensionHostMessageBase & {
	event: typeof FIELD_EXTENSION_HOST_MESSAGE_EVENTS.error
	message: string
	code?: string
}

export type FieldExtensionHostReloadMessage = FieldExtensionHostMessageBase & {
	event: typeof FIELD_EXTENSION_HOST_MESSAGE_EVENTS.reload
}

export type FieldExtensionHostMessage =
	| FieldExtensionHostReadyMessage
	| FieldExtensionHostResizeMessage
	| FieldExtensionHostErrorMessage
	| FieldExtensionHostReloadMessage

export const FIELD_EXTENSION_PERMISSION_CONTEXT = 'field' as const

export const FIELD_EXTENSION_PERMISSION_ACTIONS = {
	listExtensions: 'field:ListExtensions',
	manageExtensions: 'field:ManageExtensions',
	listReservations: 'field:ListReservations',
	manageReservations: 'field:ManageReservations',
} as const

export type FieldExtensionPermissionAction =
	(typeof FIELD_EXTENSION_PERMISSION_ACTIONS)[keyof typeof FIELD_EXTENSION_PERMISSION_ACTIONS]

export const FIELD_EXTENSION_REQUIRED_PERMISSIONS = {
	hostContextRead: [FIELD_EXTENSION_PERMISSION_ACTIONS.listExtensions],
	proxyRead: [
		FIELD_EXTENSION_PERMISSION_ACTIONS.listExtensions,
		FIELD_EXTENSION_PERMISSION_ACTIONS.listReservations,
	],
	proxyWrite: [
		FIELD_EXTENSION_PERMISSION_ACTIONS.listExtensions,
		FIELD_EXTENSION_PERMISSION_ACTIONS.manageReservations,
	],
	lifecycleManage: [FIELD_EXTENSION_PERMISSION_ACTIONS.manageExtensions],
} as const satisfies Record<string, readonly FieldExtensionPermissionAction[]>

export function buildFieldExtensionHostContext(
	extensionAppName: string,
	tenant: string,
	surface: FieldExtensionHostSurface,
): FieldExtensionHostContext {
	return {
		tenant,
		extensionAppName,
		surface,
		proxyBase: `/api/extensions/${extensionAppName}`,
	}
}

export function appendFieldExtensionHostContext(
	baseUrl: string,
	context: FieldExtensionHostContext,
): string {
	const url = new URL(baseUrl)
	url.searchParams.set(FIELD_EXTENSION_HOST_QUERY_KEYS.tenant, context.tenant)
	url.searchParams.set(
		FIELD_EXTENSION_HOST_QUERY_KEYS.extensionAppName,
		context.extensionAppName,
	)
	url.searchParams.set(FIELD_EXTENSION_HOST_QUERY_KEYS.surface, context.surface)
	url.searchParams.set(
		FIELD_EXTENSION_HOST_QUERY_KEYS.proxyBase,
		context.proxyBase,
	)
	return url.toString()
}

export function parseFieldExtensionHostContext(
	input: URLSearchParams | Record<string, string | null | undefined>,
): FieldExtensionHostContext | null {
	const searchParams =
		input instanceof URLSearchParams
			? input
			: new URLSearchParams(
					Object.entries(input).flatMap(([key, value]) =>
						value == null || value === '' ? [] : [[key, value]],
					),
				)

	const tenant = searchParams.get(FIELD_EXTENSION_HOST_QUERY_KEYS.tenant)
	const extensionAppName = searchParams.get(
		FIELD_EXTENSION_HOST_QUERY_KEYS.extensionAppName,
	)
	const surface = searchParams.get(FIELD_EXTENSION_HOST_QUERY_KEYS.surface)
	const proxyBase = searchParams.get(FIELD_EXTENSION_HOST_QUERY_KEYS.proxyBase)

	if (!tenant || !extensionAppName || !surface || !proxyBase) {
		return null
	}
	if (surface !== 'ui' && surface !== 'kiosk') {
		return null
	}
	if (!proxyBase.startsWith('/api/extensions/')) {
		return null
	}

	return {
		tenant,
		extensionAppName,
		surface,
		proxyBase,
	}
}

export function buildFieldExtensionProxyRequestUrl(
	context: FieldExtensionHostContext,
	path: string,
	query = '',
): string {
	const normalizedPath = path.replace(/^\/+/, '')
	const url = new URL(
		`${context.proxyBase}/${normalizedPath}`,
		'http://field-extension-host.local',
	)
	const queryString = query.startsWith('?') ? query.slice(1) : query
	if (queryString) {
		url.search = queryString
	}
	url.searchParams.set('tenant', context.tenant)
	return `${url.pathname}${url.search}`
}

export function isFieldExtensionAllowedMessageOrigin(
	messageOrigin: string,
	iframeUrl: string,
): boolean {
	try {
		return new URL(messageOrigin).origin === new URL(iframeUrl).origin
	} catch {
		return false
	}
}

export function parseFieldExtensionHostMessage(
	data: unknown,
	expectedContext?: FieldExtensionHostContext,
): FieldExtensionHostMessage | null {
	if (!isRecord(data)) {
		return null
	}

	if (data.source !== FIELD_EXTENSION_HOST_MESSAGE_SOURCE) {
		return null
	}
	const context = parseFieldExtensionMessageContext(data, expectedContext)
	if (!context) {
		return null
	}

	switch (data.event) {
		case FIELD_EXTENSION_HOST_MESSAGE_EVENTS.ready:
			return {
				source: FIELD_EXTENSION_HOST_MESSAGE_SOURCE,
				event: FIELD_EXTENSION_HOST_MESSAGE_EVENTS.ready,
				...context,
			}
		case FIELD_EXTENSION_HOST_MESSAGE_EVENTS.resize: {
			const height = data.height
			if (
				typeof height !== 'number' ||
				!Number.isFinite(height) ||
				height < 320 ||
				height > 4000
			) {
				return null
			}
			return {
				source: FIELD_EXTENSION_HOST_MESSAGE_SOURCE,
				event: FIELD_EXTENSION_HOST_MESSAGE_EVENTS.resize,
				...context,
				height,
			}
		}
		case FIELD_EXTENSION_HOST_MESSAGE_EVENTS.error: {
			const message = data.message
			const code = data.code
			if (!isNonEmptyString(message, 500)) {
				return null
			}
			if (code !== undefined && !isNonEmptyString(code, 120)) {
				return null
			}
			return {
				source: FIELD_EXTENSION_HOST_MESSAGE_SOURCE,
				event: FIELD_EXTENSION_HOST_MESSAGE_EVENTS.error,
				...context,
				message,
				...(code ? { code } : {}),
			}
		}
		case FIELD_EXTENSION_HOST_MESSAGE_EVENTS.reload:
			return {
				source: FIELD_EXTENSION_HOST_MESSAGE_SOURCE,
				event: FIELD_EXTENSION_HOST_MESSAGE_EVENTS.reload,
				...context,
			}
		default:
			return null
	}
}

function parseFieldExtensionMessageContext(
	data: Record<string, unknown>,
	expectedContext?: FieldExtensionHostContext,
): Pick<
	FieldExtensionHostContext,
	'tenant' | 'extensionAppName' | 'surface'
> | null {
	const { tenant, extensionAppName, surface } = data
	if (
		!isNonEmptyString(tenant, 160) ||
		!isNonEmptyString(extensionAppName, 160) ||
		(surface !== 'ui' && surface !== 'kiosk')
	) {
		return null
	}
	if (
		expectedContext &&
		(tenant !== expectedContext.tenant ||
			extensionAppName !== expectedContext.extensionAppName ||
			surface !== expectedContext.surface)
	) {
		return null
	}
	return { tenant, extensionAppName, surface }
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown, maxLength: number): value is string {
	return typeof value === 'string' && value.length > 0 && value.length <= maxLength
}
