import type { Session } from 'next-auth'
import type { GraphQLClientRequestHeaders } from './graphql-request'
import {
	getModeFromOperatorId,
	getPlatformIdForMode,
	isKnownOperatorId,
} from './mode'
import { isTenantUlid, resolveTenantOperatorId } from './tenantPath'

function bearerToken(headers: GraphQLClientRequestHeaders) {
	const authorization = headers.Authorization ?? headers.authorization
	const match = authorization?.match(/^Bearer\s+(.+)$/i)
	return match?.[1]
}

export function createTenantHeaderResolver(session: Session) {
	return async function resolveTenantHeaders(
		headers: GraphQLClientRequestHeaders,
	): Promise<GraphQLClientRequestHeaders> {
		const operatorId = headers['x-operator-id']
		if (!operatorId || isTenantUlid(operatorId)) {
			return headers
		}

		const resolvedOperatorId = await resolveTenantOperatorId(
			{
				...session,
				accessToken: session.accessToken ?? bearerToken(headers) ?? '',
			},
			operatorId,
		)
		if (!isKnownOperatorId(resolvedOperatorId)) {
			return {
				...headers,
				'x-operator-id': resolvedOperatorId,
			}
		}

		return {
			...headers,
			'x-platform-id': getPlatformIdForMode(
				getModeFromOperatorId(resolvedOperatorId),
			),
			'x-operator-id': resolvedOperatorId,
		}
	}
}
