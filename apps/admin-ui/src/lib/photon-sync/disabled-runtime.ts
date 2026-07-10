import type {
	PendingOperation,
	PhotonSyncDisabledReason,
	PhotonSyncRuntime,
	PhotonSyncTenantScope,
	ReadThroughResult,
} from './types'

export function createDisabledPhotonSyncRuntime(options: {
	reason: PhotonSyncDisabledReason
	errorSummary?: string
	namespace?: string
}): PhotonSyncRuntime {
	return {
		state: {
			enabled: false,
			mode: 'disabled',
			reason: options.reason,
			errorSummary: options.errorSummary,
			namespace: options.namespace,
		},
		assertTenantScope() {
			return
		},
		async readThrough<T>(
			_domain: never,
			readRemote: () => Promise<T>,
		): Promise<ReadThroughResult<T>> {
			return {
				source: 'remote',
				data: await readRemote(),
				projected: false,
			}
		},
		async enqueue(operation: PendingOperation) {
			throw new Error(
				`Photon sync runtime is disabled; refusing to enqueue ${operation.operationId}`,
			)
		},
	}
}

export function assertSameTenantScope(
	expected: PhotonSyncTenantScope,
	actual: PhotonSyncTenantScope,
) {
	const mismatches = (
		['platformId', 'tenantId', 'actorUserId'] as const
	).filter(key => expected[key] !== actual[key])

	if (mismatches.length > 0) {
		throw new Error(
			`Photon sync tenant scope mismatch: ${mismatches.join(', ')}`,
		)
	}
}
