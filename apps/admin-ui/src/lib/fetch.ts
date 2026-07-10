import aspida from '@aspida/fetch'
import api from 'gen/api/$api'
import { getBackendBaseUrl } from './backendUrl'
import { PLATFORM_ID } from './graphqlClient'

export const client = (token?: string, operatorId?: string) => {
	const headers: Record<string, string> = {
		'x-platform-id': PLATFORM_ID,
	}
	if (operatorId) {
		headers['x-operator-id'] = operatorId
	}
	if (token) {
		headers.Authorization = `Bearer ${token}`
	}
	const endpoint = getBackendBaseUrl()
	return api(
		aspida(fetch, {
			baseURL: endpoint,
			headers,
		}),
	)
}
