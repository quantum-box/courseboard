import { auth } from 'app/auth'
import fetchTenants from 'lib/tenantFetcher'
import { redirect } from 'next/navigation'
import { PLATFORM_ID, getPlatformSdk } from 'lib/graphqlClient'
import { CreateTenantWizard } from './create-tenant-wizard'

export type PlatformSquareConfig = {
	available: boolean
	environment?: string
}

export type OAuthProviderInfo = {
	provider: string
	clientId: string
	redirectUri: string
}

async function fetchPlatformSquareConfig(
	accessToken?: string,
): Promise<PlatformSquareConfig> {
	try {
		const sdk = getPlatformSdk(accessToken)
		const { platformManifestTemplate } = await sdk.GetPlatformManifestTemplate()
		const template = JSON.parse(platformManifestTemplate.value)
		const providers: {
			name: string
			provider_type: string
			config?: Record<string, unknown>
		}[] = template?.spec?.providers ?? []
		const square = providers.find(
			p => p.name === 'square' && p.provider_type === 'integration',
		)
		if (square?.config) {
			return {
				available: true,
				environment: (square.config.environment as string) ?? undefined,
			}
		}
	} catch {
		// Platform manifest not available — skip
	}
	return { available: false }
}

async function fetchOAuthProviders(
	accessToken?: string,
): Promise<OAuthProviderInfo[]> {
	try {
		const sdk = getPlatformSdk(accessToken)
		const { oauthConfigs } = await sdk.GetOAuthConfigs()
		return oauthConfigs.map(c => ({
			provider: c.provider,
			clientId: c.clientId,
			redirectUri: c.redirectUri,
		}))
	} catch {
		return []
	}
}

export default async function CreateTenantPage() {
	const session = await auth()
	if (!session) {
		redirect('/auth/sign_in')
	}

	const [tenants, platformSquare, oauthProviders] = await Promise.all([
		fetchTenants(session),
		fetchPlatformSquareConfig(session.accessToken ?? undefined),
		fetchOAuthProviders(session.accessToken ?? undefined),
	])
	const squareOAuthAvailable = oauthProviders.some(
		provider => provider.provider === 'square',
	)

	return (
		<CreateTenantWizard
			platformId={PLATFORM_ID}
			existingTenants={tenants.map(t => ({ id: t.id, name: t.name }))}
			platformSquareConfig={{
				...platformSquare,
				available: platformSquare.available || squareOAuthAvailable,
			}}
			oauthProviders={oauthProviders}
		/>
	)
}
