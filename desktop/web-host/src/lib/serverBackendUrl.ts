import { getRuntimeEnv } from './runtime-env'

const DEFAULT_BACKEND_URL = 'http://0.0.0.0:50056'

export const getServerBackendBaseUrl = () =>
	(
		getRuntimeEnv('TACHYON_FIELD_API_URL') ??
		getRuntimeEnv('BACKEND_API_URL') ??
		getRuntimeEnv('NEXT_PUBLIC_BACKEND_API_URL') ??
		DEFAULT_BACKEND_URL
	).replace(/\/+$/, '')

export function joinServerBackendPath(path: string) {
	const normalizedPath = `/${path.replace(/^\/+/, '')}`
	return `${getServerBackendBaseUrl()}${normalizedPath}`
}
