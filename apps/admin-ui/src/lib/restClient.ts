import aspida from '@aspida/fetch'
import api from 'gen/api/$api'
import { getBackendBaseUrl } from './backendUrl'

export const PLATFORM_ID =
	process.env.NEXT_PUBLIC_PLATFORM_ID || 'tn_01hjjn348rn3t49zz6hvmfq67p'

export const ENDPOINT = getBackendBaseUrl()

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
