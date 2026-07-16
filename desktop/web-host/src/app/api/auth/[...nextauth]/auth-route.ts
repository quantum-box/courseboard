import { Auth, skipCSRFCheck } from '@auth/core'
import { createAuthConfig, resolveAuthUrl } from 'app/auth'
import {
	createAuthActionRequest,
	createCanonicalAuthRequest,
	resolveSigninProviderActionOptions,
} from './auth-route-core'

type AuthRouteInstrumentationOptions = Parameters<typeof createAuthConfig>[0]

export async function handleAuthCoreRequest(
	request: Request,
	instrumentation?: AuthRouteInstrumentationOptions,
) {
	const authUrl = resolveAuthUrl(request)
	return Auth(
		createCanonicalAuthRequest(request, { authUrl }),
		createAuthConfig(instrumentation, { authUrl }),
	)
}

export async function handleSigninProviderRequest(
	request: Request,
	instrumentation?: AuthRouteInstrumentationOptions,
) {
	const options = await resolveSigninProviderActionOptions(request)
	if (!options) {
		return undefined
	}

	const authUrl = resolveAuthUrl(request)
	return Auth(
		createAuthActionRequest(request, {
			authUrl,
			callbackUrl: options.callbackUrl,
			searchParams: options.searchParams,
		}),
		{ ...createAuthConfig(instrumentation, { authUrl }), skipCSRFCheck },
	)
}
