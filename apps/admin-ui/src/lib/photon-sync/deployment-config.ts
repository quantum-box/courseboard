import { getBackendBaseUrl } from 'lib/backendUrl'
import { getRuntimeEnv } from 'lib/runtime-env'
import type { PhotonSyncRuntimeMode } from './types'

export type PhotonDeploymentMode = 'local' | 'preview' | 'cloud'
export type PhotonSyncBackend = 'rust-server' | 'cloudflare-durable-object'
export type PhotonAppServerBackend = 'rust-server' | 'external-api'

export type PhotonEndpointConfig = {
	apiBaseUrl: string
	graphqlUrl: string
	restBaseUrl: string
	enginePushUrl: string
	enginePullUrl: string
	liveWebSocketUrl?: string
	agentStreamUrl: string
	agentToolResultUrl: string
}

export type PhotonDeploymentConfig = {
	enabled: boolean
	deploymentMode: PhotonDeploymentMode
	runtimeMode: PhotonSyncRuntimeMode
	tenantId: string
	tenantName: string
	workspaceId: string
	workspaceName: string
	appServerBackend: PhotonAppServerBackend
	syncBackend: PhotonSyncBackend
	endpoints: PhotonEndpointConfig
	warnings: string[]
}

type ResolvePhotonDeploymentConfigInput = {
	tenantId: string
	workspaceId?: string
}

const DEFAULT_CLOUD_TENANT_ID = 'tn_01hjjn348rn3t49zz6hvmfq67p'
const DEFAULT_TENANT_NAME = 'TACHYON Field'
const DEFAULT_WORKSPACE_ID = 'erp'
const DEFAULT_WORKSPACE_NAME = 'TACHYON Field ERP'
const DEFAULT_LOCAL_API_BASE_URL = 'http://localhost:50056'
const DEFAULT_AGENT_STREAM_PATH = '/api/agent/chat/stream'
const DEFAULT_AGENT_TOOL_RESULT_PATH = '/api/agent/tool-results'
const DEFAULT_ENGINE_PUSH_PATH = '/api/engine/push'
const DEFAULT_ENGINE_PULL_PATH = '/api/engine/pull'

export function resolvePhotonDeploymentConfig(
	input: ResolvePhotonDeploymentConfigInput,
): PhotonDeploymentConfig {
	const warnings: string[] = []
	const deploymentMode = resolveDeploymentMode(readEnv('VITE_PHOTON_DEPLOYMENT_MODE'))
	const defaultApiBaseUrl =
		deploymentMode === 'local'
			? getBackendBaseUrl() || DEFAULT_LOCAL_API_BASE_URL
			: undefined
	const apiBaseUrl =
		readEnv('VITE_PHOTON_API_BASE_URL') ??
		readEnv('TACHYON_FIELD_API_URL') ??
		readEnv('NEXT_PUBLIC_BACKEND_API_URL') ??
		defaultApiBaseUrl ??
		''
	const tenantId =
		readEnv('VITE_PHOTON_TENANT_ID') ||
		readEnv('NEXT_PUBLIC_PLATFORM_ID') ||
		DEFAULT_CLOUD_TENANT_ID
	const workspaceId =
		readEnv('VITE_PHOTON_WORKSPACE_ID') || input.workspaceId || DEFAULT_WORKSPACE_ID
	const syncBackend = resolveSyncBackend(
		deploymentMode,
		readEnv('VITE_PHOTON_SYNC_BACKEND'),
	)
	const appServerBackend = resolveAppServerBackend(
		readEnv('VITE_PHOTON_APP_SERVER_BACKEND'),
	)
	const enginePushPath =
		readEnv('VITE_PHOTON_ENGINE_PUSH_PATH') || DEFAULT_ENGINE_PUSH_PATH
	const enginePullPath =
		readEnv('VITE_PHOTON_ENGINE_PULL_PATH') || DEFAULT_ENGINE_PULL_PATH
	const liveWebSocketUrl = readEnv('VITE_PHOTON_SYNC_WS_URL')
	const enabled = parseEnabledFlag(readEnv('VITE_PHOTON_SYNC_ENABLED'), true)

	if (!input.tenantId?.trim()) {
		warnings.push('operator tenant is missing; Photon sync registration is skipped')
	}
	if (syncBackend === 'cloudflare-durable-object' && !liveWebSocketUrl) {
		warnings.push(
			'VITE_PHOTON_SYNC_WS_URL is missing; Photon Live will stay local-only',
		)
	}
	if (appServerBackend === 'external-api' && !apiBaseUrl) {
		warnings.push('VITE_PHOTON_API_BASE_URL is missing; ERP API sync is disabled')
	}

	return {
		enabled: enabled && warnings.every(warning => !warning.includes('disabled')),
		deploymentMode,
		runtimeMode: resolveRuntimeMode(readEnv('VITE_PHOTON_RUNTIME_MODE')),
		tenantId,
		tenantName: readEnv('VITE_PHOTON_TENANT_NAME') || DEFAULT_TENANT_NAME,
		workspaceId,
		workspaceName:
			readEnv('VITE_PHOTON_WORKSPACE_NAME') || DEFAULT_WORKSPACE_NAME,
		appServerBackend,
		syncBackend,
		endpoints: {
			apiBaseUrl,
			graphqlUrl: joinUrl(apiBaseUrl, '/v1/graphql'),
			restBaseUrl: joinUrl(apiBaseUrl, '/v1'),
			enginePushUrl: joinUrl(apiBaseUrl, enginePushPath),
			enginePullUrl: joinUrl(apiBaseUrl, enginePullPath),
			liveWebSocketUrl,
			agentStreamUrl: joinUrl(
				apiBaseUrl,
				readEnv('VITE_PHOTON_AGENT_STREAM_URL') || DEFAULT_AGENT_STREAM_PATH,
			),
			agentToolResultUrl: joinUrl(
				apiBaseUrl,
				readEnv('VITE_PHOTON_AGENT_TOOL_RESULT_PATH') ||
					DEFAULT_AGENT_TOOL_RESULT_PATH,
			),
		},
		warnings,
	}
}

function readEnv(name: string) {
	return getRuntimeEnv(name) || process.env[name]
}

function resolveDeploymentMode(
	value: string | undefined,
): PhotonDeploymentMode {
	if (value === 'local' || value === 'preview' || value === 'cloud') {
		return value
	}
	return 'local'
}

function resolveRuntimeMode(value: string | undefined): PhotonSyncRuntimeMode {
	if (
		value === 'disabled' ||
		value === 'read_projection' ||
		value === 'pending_writes' ||
		value === 'collab_crdt'
	) {
		return value
	}
	return 'read_projection'
}

function resolveSyncBackend(
	deploymentMode: PhotonDeploymentMode,
	value: string | undefined,
): PhotonSyncBackend {
	if (value === 'rust-server' || value === 'cloudflare-durable-object') {
		return value
	}
	return deploymentMode === 'cloud' || deploymentMode === 'preview'
		? 'cloudflare-durable-object'
		: 'rust-server'
}

function resolveAppServerBackend(
	value: string | undefined,
): PhotonAppServerBackend {
	return value === 'external-api' ? 'external-api' : 'rust-server'
}

function parseEnabledFlag(value: string | undefined, fallback: boolean) {
	if (value === undefined) return fallback
	return value === 'true' || value === '1'
}

function joinUrl(baseUrl: string, path: string) {
	if (/^https?:\/\//.test(path) || /^wss?:\/\//.test(path)) return path
	const normalizedBase = baseUrl.replace(/\/$/, '')
	const normalizedPath = path.startsWith('/') ? path : `/${path}`
	return `${normalizedBase}${normalizedPath}`
}
