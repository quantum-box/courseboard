export type PhotonSyncRuntimeMode =
	| 'disabled'
	| 'read_projection'
	| 'pending_writes'
	| 'collab_crdt'

export type PhotonSyncDisabledReason =
	| 'disabled'
	| 'invalid_config'
	| 'unsupported_environment'
	| 'storage_init_failed'
	| 'migration_failed'

export type PhotonSyncDomain =
	| 'erp.orders'
	| 'erp.inventory'
	| 'erp.clients'
	| 'erp.vendors'
	| 'erp.purchase_orders'
	| 'photon.documents'
	| 'photon.files'
	| 'photon.workflow'
	| 'photon.chat'

export type PhotonSyncOperationStatus =
	| 'queued'
	| 'flushing'
	| 'acked'
	| 'rejected'
	| 'retry_wait'
	| 'dead_letter'
	| 'compensated'

export type PhotonSyncMutationType =
	| 'create'
	| 'update'
	| 'status_change'
	| 'delete'
	| 'convert'

export type PhotonSyncTenantScope = {
	platformId: string
	tenantId: string
	actorUserId: string
}

export type PhotonSyncRuntimeConfig = PhotonSyncTenantScope & {
	enabled: boolean
	mode: PhotonSyncRuntimeMode
	appBuild: string
	schemaVersion: number
	namespace: string
	enabledDomains: PhotonSyncDomain[]
}

export type PhotonSyncRuntimeState =
	| {
			enabled: true
			mode: Exclude<PhotonSyncRuntimeMode, 'disabled'>
			namespace: string
			schemaVersion: number
	  }
	| {
			enabled: false
			mode: 'disabled'
			namespace?: string
			reason: PhotonSyncDisabledReason
			errorSummary?: string
	  }

export type LocalProjectionEntity<TProjection = unknown> = PhotonSyncTenantScope & {
	entityType: PhotonSyncDomain
	entityId: string
	serverVersion?: string
	serverUpdatedAt?: string
	projection: TProjection
	yjsDocKey?: string
	pendingState: 'clean' | 'pending' | 'conflicted'
	lastSeenAt: string
}

export type PendingOperationPayload = Record<string, unknown>

export type PendingOperation = PhotonSyncTenantScope & {
	operationId: string
	entityType: PhotonSyncDomain
	entityId?: string
	mutationType: PhotonSyncMutationType
	payload: PendingOperationPayload
	payloadRedactionVersion: number
	baseVersion?: string
	baseVector?: Record<string, unknown>
	idempotencyKey: string
	status: PhotonSyncOperationStatus
	retryCount: number
	createdAt: string
	updatedAt: string
	nextRetryAt?: string
	acknowledgedAt?: string
	errorSummary?: string
}

export type ReadThroughResult<T> =
	| {
			source: 'remote'
			data: T
			projected: boolean
	  }
	| {
			source: 'local_projection'
			data: T
			projected: true
	  }

export type LocalProjectionStore = {
	project<TProjection>(
		entity: LocalProjectionEntity<TProjection>,
	): Promise<void>
	read<TProjection>(
		scope: PhotonSyncTenantScope,
		entityType: PhotonSyncDomain,
		entityId: string,
	): Promise<LocalProjectionEntity<TProjection> | null>
	enqueue(operation: PendingOperation): Promise<void>
}

export type PhotonSyncRuntime = {
	state: PhotonSyncRuntimeState
	assertTenantScope(scope: PhotonSyncTenantScope): void
	readThrough<T>(
		domain: PhotonSyncDomain,
		readRemote: () => Promise<T>,
		project?: (data: T) => Promise<void>,
	): Promise<ReadThroughResult<T>>
	enqueue(operation: PendingOperation): Promise<void>
}
