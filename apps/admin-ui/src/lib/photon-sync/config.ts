import type {
	PhotonSyncDisabledReason,
	PhotonSyncDomain,
	PhotonSyncRuntimeConfig,
	PhotonSyncRuntimeMode,
	PhotonSyncTenantScope,
} from './types'

const DEFAULT_SCHEMA_VERSION = 1
const DEFAULT_APP_BUILD = 'courseboard-admin-ui'
const NAMESPACE_PREFIX = 'courseboard-admin-ui:photon'
const KNOWN_DOMAINS: PhotonSyncDomain[] = [
	'erp.orders',
	'erp.inventory',
	'erp.clients',
	'erp.vendors',
	'erp.purchase_orders',
	'photon.documents',
	'photon.files',
	'photon.workflow',
	'photon.chat',
]

export type CreatePhotonSyncRuntimeConfigInput = PhotonSyncTenantScope & {
	enabled?: string | boolean
	mode?: PhotonSyncRuntimeMode
	appBuild?: string
	schemaVersion?: number
	enabledDomains?: PhotonSyncDomain[]
}

export type PhotonSyncConfigResult =
	| { ok: true; config: PhotonSyncRuntimeConfig }
	| {
			ok: false
			reason: PhotonSyncDisabledReason
			errorSummary: string
			namespace?: string
	  }

export function createPhotonSyncRuntimeConfig(
	input: CreatePhotonSyncRuntimeConfigInput,
): PhotonSyncConfigResult {
	const namespace = buildPhotonSyncNamespace({
		platformId: input.platformId,
		tenantId: input.tenantId,
		actorUserId: input.actorUserId,
		schemaVersion: input.schemaVersion ?? DEFAULT_SCHEMA_VERSION,
	})

	const validation = validateScope(input)
	if (!validation.ok) {
		return {
			ok: false,
			reason: 'invalid_config',
			errorSummary: validation.errorSummary,
			namespace,
		}
	}

	const enabled = parseEnabledSwitch(input.enabled)
	if (!enabled) {
		return {
			ok: false,
			reason: 'disabled',
			errorSummary: 'Photon sync runtime is disabled',
			namespace,
		}
	}

	const mode = input.mode ?? 'read_projection'
	if (mode === 'disabled') {
		return {
			ok: false,
			reason: 'disabled',
			errorSummary: 'Photon sync runtime mode is disabled',
			namespace,
		}
	}

	const enabledDomains = normalizeDomains(input.enabledDomains)
	return {
		ok: true,
		config: {
			platformId: input.platformId,
			tenantId: input.tenantId,
			actorUserId: input.actorUserId,
			enabled,
			mode,
			appBuild: input.appBuild ?? DEFAULT_APP_BUILD,
			schemaVersion: input.schemaVersion ?? DEFAULT_SCHEMA_VERSION,
			namespace,
			enabledDomains,
		},
	}
}

export function buildPhotonSyncNamespace(
	scope: PhotonSyncTenantScope & { schemaVersion?: number },
) {
	const schemaVersion = scope.schemaVersion ?? DEFAULT_SCHEMA_VERSION
	return [
		NAMESPACE_PREFIX,
		`v${schemaVersion}`,
		encodeNamespacePart(scope.platformId),
		encodeNamespacePart(scope.tenantId),
		encodeNamespacePart(scope.actorUserId),
	].join(':')
}

function parseEnabledSwitch(value: string | boolean | undefined) {
	if (typeof value === 'boolean') return value
	return value === 'true' || value === '1'
}

function validateScope(scope: PhotonSyncTenantScope) {
	const missing = [
		['platformId', scope.platformId],
		['tenantId', scope.tenantId],
		['actorUserId', scope.actorUserId],
	].filter(([, value]) => !value || String(value).trim().length === 0)

	if (missing.length > 0) {
		return {
			ok: false as const,
			errorSummary: `Missing Photon sync scope: ${missing
				.map(([key]) => key)
				.join(', ')}`,
		}
	}

	return { ok: true as const }
}

function normalizeDomains(domains: PhotonSyncDomain[] | undefined) {
	if (!domains?.length) return KNOWN_DOMAINS
	return domains.filter(domain => KNOWN_DOMAINS.includes(domain))
}

function encodeNamespacePart(value: string) {
	return encodeURIComponent(value.trim())
}
