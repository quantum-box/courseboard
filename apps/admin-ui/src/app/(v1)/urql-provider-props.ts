import { getModeFromOperatorId, getPlatformIdForMode } from 'lib/mode'

export function getUrqlProviderProps(
	tenant: string,
	accessToken?: string | null,
) {
	return {
		operatorId: tenant,
		accessToken,
		platformId: getPlatformIdForMode(getModeFromOperatorId(tenant)),
	}
}
