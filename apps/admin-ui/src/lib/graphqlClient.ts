import aspida from '@aspida/fetch'
import api from 'gen/api/$api'
import { getSdk } from 'gen/graphql'
import type { Session } from 'next-auth'
import { getBackendBaseUrl } from './backendUrl'
import { GraphQLClient } from './graphql-request'
import { createTenantHeaderResolver } from './graphqlTenantHeaders'
import {
	type TachyonFieldMode,
	getModeFromOperatorId,
	getPlatformIdForMode,
	isKnownOperatorId,
} from './mode'

export const PLATFORM_ID =
	process.env.NEXT_PUBLIC_PLATFORM_ID || 'tn_01hjjn348rn3t49zz6hvmfq67p'

export const ENDPOINT = getBackendBaseUrl()

export const getPlatformSdk = (accessToken?: string) => {
	const platformId = PLATFORM_ID
	const endpoint = getBackendBaseUrl()
	if (accessToken) {
		return getSdk(
			new GraphQLClient(`${endpoint}/v1/graphql`, {
				headers: {
					'x-platform-id': platformId,
					'x-operator-id': platformId,
					Authorization: `Bearer ${accessToken}`,
				},
			}),
		)
	}
	return getSdk(
		new GraphQLClient(`${endpoint}/v1/graphql`, {
			headers: {
				'x-platform-id': platformId,
				'x-operator-id': platformId,
			},
		}),
	)
}

export const getPlatformSdkForMode = (
	mode: TachyonFieldMode,
	accessToken?: string,
) => {
	const platformId = getPlatformIdForMode(mode)
	const endpoint = getBackendBaseUrl()
	if (accessToken) {
		return getSdk(
			new GraphQLClient(`${endpoint}/v1/graphql`, {
				headers: {
					'x-platform-id': platformId,
					'x-operator-id': platformId,
					Authorization: `Bearer ${accessToken}`,
				},
			}),
		)
	}
	return getSdk(
		new GraphQLClient(`${endpoint}/v1/graphql`, {
			headers: {
				'x-platform-id': platformId,
				'x-operator-id': platformId,
			},
		}),
	)
}

const createGraphqlClient = (
	session: Session,
	tenant_id: string,
	mode?: TachyonFieldMode,
) => {
	// Only use mode-aware platform ID for known sandbox/production operators.
	// For unknown operators, fall back to the default PLATFORM_ID.
	let platformId: string
	if (mode) {
		platformId = getPlatformIdForMode(mode)
	} else if (isKnownOperatorId(tenant_id)) {
		platformId = getPlatformIdForMode(getModeFromOperatorId(tenant_id))
	} else {
		platformId = PLATFORM_ID
	}
	const endpoint = getBackendBaseUrl()
	return new GraphQLClient(`${endpoint}/v1/graphql`, {
		headers: {
			'x-platform-id': platformId,
			'x-operator-id': tenant_id,
			Authorization: `Bearer ${session.accessToken}`,
		},
		resolveHeaders: createTenantHeaderResolver(session),
	})
}

export const getGraphqlSdk = (
	session: Session,
	tenant_id: string,
	mode?: TachyonFieldMode,
) => {
	return getSdk(createGraphqlClient(session, tenant_id, mode))
}

export const restClient = (token?: string) => {
	const endpoint = getBackendBaseUrl()
	return api(
		aspida(fetch, {
			baseURL: `${endpoint}`,
			headers: {
				'x-platform-id': PLATFORM_ID,
				Authorization: `Bearer ${token}`,
			},
		}),
	)
}

export type ApiError = {
	response: {
		errors: {
			message: string
			extensions: {
				code: string
			}
		}[]
	}
}
