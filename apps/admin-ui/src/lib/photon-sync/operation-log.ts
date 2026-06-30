import type {
	PendingOperation,
	PendingOperationPayload,
	PhotonSyncDomain,
	PhotonSyncMutationType,
	PhotonSyncTenantScope,
} from './types'

const REDACTION_VERSION = 1
const REDACTED = '[redacted]'
const SENSITIVE_KEY_PATTERN =
	/(authorization|access[_-]?token|refresh[_-]?token|secret|api[_-]?key|password|credential|signed[_-]?url)/i
const MAX_ERROR_SUMMARY_LENGTH = 500

export type CreatePendingOperationInput = PhotonSyncTenantScope & {
	operationId: string
	entityType: PhotonSyncDomain
	entityId?: string
	mutationType: PhotonSyncMutationType
	payload: PendingOperationPayload
	baseVersion?: string
	baseVector?: Record<string, unknown>
	idempotencyKey: string
	now?: string
}

export function createPendingOperation(
	input: CreatePendingOperationInput,
): PendingOperation {
	const now = input.now ?? new Date().toISOString()
	return {
		platformId: input.platformId,
		tenantId: input.tenantId,
		actorUserId: input.actorUserId,
		operationId: input.operationId,
		entityType: input.entityType,
		entityId: input.entityId,
		mutationType: input.mutationType,
		payload: redactPayload(input.payload),
		payloadRedactionVersion: REDACTION_VERSION,
		baseVersion: input.baseVersion,
		baseVector: input.baseVector,
		idempotencyKey: input.idempotencyKey,
		status: 'queued',
		retryCount: 0,
		createdAt: now,
		updatedAt: now,
	}
}

export function redactPayload<T>(payload: T): T {
	if (Array.isArray(payload)) {
		return payload.map(item => redactPayload(item)) as T
	}

	if (!payload || typeof payload !== 'object') {
		return payload
	}

	return Object.fromEntries(
		Object.entries(payload as Record<string, unknown>).map(([key, value]) => [
			key,
			SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : redactPayload(value),
		]),
	) as T
}

export function trimErrorSummary(error: unknown): string {
	const raw = error instanceof Error ? error.message : String(error)
	return raw.trim().slice(0, MAX_ERROR_SUMMARY_LENGTH)
}
