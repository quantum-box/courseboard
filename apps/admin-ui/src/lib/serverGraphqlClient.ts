import { getSdk } from 'gen/graphql'
import type { Session } from 'next-auth'
import { GraphQLClient } from './graphql-request'
import { createTenantHeaderResolver } from './graphqlTenantHeaders'
import {
	type TachyonFieldMode,
	PLATFORM_IDS,
	getModeFromOperatorId,
	getPlatformIdForMode,
	isKnownOperatorId,
} from './mode'
import { joinServerBackendPath } from './serverBackendUrl'

const DEFAULT_PLATFORM_ID = PLATFORM_IDS.production

const createServerGraphqlClient = (
	session: Session,
	tenantId: string,
	mode?: TachyonFieldMode,
) => {
	let platformId: string
	if (mode) {
		platformId = getPlatformIdForMode(mode)
	} else if (isKnownOperatorId(tenantId)) {
		platformId = getPlatformIdForMode(getModeFromOperatorId(tenantId))
	} else {
		platformId = DEFAULT_PLATFORM_ID
	}

	return new GraphQLClient(joinServerBackendPath('/v1/graphql'), {
		headers: {
			'x-platform-id': platformId,
			'x-operator-id': tenantId,
			Authorization: `Bearer ${session.accessToken}`,
		},
		resolveHeaders: createTenantHeaderResolver(session),
	})
}

export const getServerGraphqlSdk = (
	session: Session,
	tenantId: string,
	mode?: TachyonFieldMode,
) => getSdk(createServerGraphqlClient(session, tenantId, mode))
