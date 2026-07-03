import { cacheExchange, createClient, fetchExchange } from 'urql'
import { getBackendBaseUrl } from './backendUrl'
import { PLATFORM_ID } from './graphqlClient'
// import  { get}from "gen/graphql-urql"

export const urqlClient = ({
	accessToken,
	operatorId,
}: {
	accessToken?: string
	operatorId?: string
}) =>
	createClient({
		url: `${getBackendBaseUrl()}/v1/graphql`,
		exchanges: [cacheExchange, fetchExchange],
		fetchOptions: {
			headers: {
				'x-platform-id': PLATFORM_ID,
				...(accessToken && { Authorization: `Bearer ${accessToken}` }),
				...(operatorId && { 'x-operator-id': operatorId }),
			},
		},
	})
