import { createPhotonSyncRuntimeConfig } from './config'
import {
	assertSameTenantScope,
	createDisabledPhotonSyncRuntime,
} from './disabled-runtime'
import type {
	PhotonSyncDomain,
	LocalProjectionStore,
	PendingOperation,
	PhotonSyncRuntime,
	PhotonSyncRuntimeConfig,
	PhotonSyncTenantScope,
	ReadThroughResult,
} from './types'

export type InitPhotonSyncRuntimeInput = {
	config: Parameters<typeof createPhotonSyncRuntimeConfig>[0]
	store?: LocalProjectionStore
}

export function initPhotonSyncRuntime(
	input: InitPhotonSyncRuntimeInput,
): PhotonSyncRuntime {
	const result = createPhotonSyncRuntimeConfig(input.config)
	if (!result.ok) {
		return createDisabledPhotonSyncRuntime({
			reason: result.reason,
			errorSummary: result.errorSummary,
			namespace: result.namespace,
		})
	}

	if (!input.store) {
		return createDisabledPhotonSyncRuntime({
			reason: 'storage_init_failed',
			errorSummary:
				'Photon sync runtime storage adapter is not configured in this phase',
			namespace: result.config.namespace,
		})
	}

	return createReadProjectionRuntime(result.config, input.store)
}

function createReadProjectionRuntime(
	config: PhotonSyncRuntimeConfig,
	store: LocalProjectionStore,
): PhotonSyncRuntime {
	const scope = {
		platformId: config.platformId,
		tenantId: config.tenantId,
		actorUserId: config.actorUserId,
	}

	return {
		state: {
			enabled: true,
			mode: config.mode === 'disabled' ? 'read_projection' : config.mode,
			namespace: config.namespace,
			schemaVersion: config.schemaVersion,
		},
		assertTenantScope(actual: PhotonSyncTenantScope) {
			assertSameTenantScope(scope, actual)
		},
		async readThrough<T>(
			domain: PhotonSyncDomain,
			readRemote: () => Promise<T>,
			project?: (data: T) => Promise<void>,
		): Promise<ReadThroughResult<T>> {
			if (!config.enabledDomains.includes(domain)) {
				return {
					source: 'remote',
					data: await readRemote(),
					projected: false,
				}
			}

			const data = await readRemote()
			if (project) {
				await project(data)
			}
			return {
				source: 'remote',
				data,
				projected: Boolean(project),
			}
		},
		async enqueue(operation: PendingOperation) {
			assertSameTenantScope(scope, operation)
			if (config.mode === 'read_projection') {
				throw new Error(
					'Photon sync runtime is in read_projection mode; pending writes are disabled',
				)
			}
			await store.enqueue(operation)
		},
	}
}
