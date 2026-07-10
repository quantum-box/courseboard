import type { PhotonSyncRuntimeConfig } from './types'

export function buildPhotonSyncLeaderLockName(
	config: Pick<PhotonSyncRuntimeConfig, 'namespace'>,
) {
	return `${config.namespace}:flush`
}

export function buildPhotonSyncBroadcastChannelName(
	config: Pick<PhotonSyncRuntimeConfig, 'namespace'>,
) {
	return `${config.namespace}:events`
}

export function supportsWebLocks() {
	return typeof navigator !== 'undefined' && 'locks' in navigator
}
