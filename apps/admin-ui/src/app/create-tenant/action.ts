'use server'

import { authWithCheck } from 'app/auth'
import type { CreateOperatorInput } from 'gen/graphql'
import { getTachyonApiBaseUrl } from 'lib/backendUrl'
import { PLATFORM_ID, getPlatformSdk } from 'lib/graphqlClient'
import { headers } from 'next/headers'

type ActionResult = {
	success: boolean
	message?: string
	operatorId?: string
}

type AliasAvailabilityResult = {
	available: boolean
	message?: string
	errorCode?: string
}

export async function createTenantWithManifestAction(input: {
	operator: CreateOperatorInput
	manifest: {
		squareMode: 'manual' | 'copy' | 'platform' | 'skip'
		squareConfig?: {
			apiKey: string
			locationId: string
			webhookSignatureKey: string
			environment: string
		}
		copySourceTenantId?: string
		platformEnvironment?: string
	}
}): Promise<ActionResult> {
	const session = await authWithCheck()
	const platformSdk = getPlatformSdk(session.accessToken ?? undefined)

	// Step 1: Create operator
	let operatorId: string
	try {
		const { createOperator } = await platformSdk.CreateOperator({
			input: input.operator,
		})
		operatorId = createOperator.id
	} catch (err: unknown) {
		const message =
			err instanceof Error ? err.message : 'Failed to create operator'
		console.error('Failed to create operator:', message)
		return { success: false, message }
	}

	// Step 2: Save a ProjectConfig for the new tenant. The field API expects
	// every operator tenant to have one, even when setup is skipped.
	try {
		if (
			input.manifest.squareMode === 'copy' &&
			input.manifest.copySourceTenantId
		) {
			await platformSdk.CopyOperatorManifest({
				input: {
					apiVersion: 'apps.tachy.one/v1alpha',
					kind: 'ProjectConfig',
					metadata: {
						name: 'default',
						operatorId: operatorId,
					},
					spec: JSON.stringify({ providers: [] }),
				},
			})
		} else {
			const manifestJson = JSON.stringify({
				apiVersion: 'apps.tachy.one/v1alpha',
				kind: 'ProjectConfig',
				metadata: {
					name: 'default',
					tenantId: operatorId,
				},
				spec:
					input.manifest.squareMode === 'manual' &&
					input.manifest.squareConfig
						? {
								providers: [
									{
										name: 'square',
										provider_type: 'payment',
										config: {
											api_key: input.manifest.squareConfig.apiKey,
											location_id: input.manifest.squareConfig.locationId,
											webhook_signature_key:
												input.manifest.squareConfig.webhookSignatureKey,
											environment: input.manifest.squareConfig.environment,
										},
									},
								],
							}
						: {},
			})

			await platformSdk.SaveManifest({
				input: {
					tenantId: operatorId,
					manifest: manifestJson,
				},
			})
		}
	} catch (err: unknown) {
		const message =
			err instanceof Error ? err.message : 'Failed to save manifest'
		console.error('Failed to save manifest:', message)
		// Operator was created but manifest failed - still return success with warning
		return {
			success: true,
			operatorId,
			message: `テナントは作成されましたが、コマース設定の保存に失敗しました: ${message}`,
		}
	}

	return { success: true, operatorId }
}

export async function checkOperatorAliasAvailabilityAction(input: {
	operatorAlias: string
}): Promise<AliasAvailabilityResult> {
	const session = await authWithCheck()
	const alias = input.operatorAlias.trim()

	if (!alias) {
		return { available: true }
	}

	const platformSdk = getPlatformSdk(session.accessToken ?? undefined)

	const { checkAliasAvailability } = await platformSdk.CheckAliasAvailability({
		alias,
	})

	return {
		available: checkAliasAvailability.available,
		message: checkAliasAvailability.message ?? undefined,
		errorCode: checkAliasAvailability.errorCode ?? undefined,
	}
}

export async function getOAuthAuthorizationUrl(input: {
	provider: string
	operatorId: string
}): Promise<{ success: boolean; url?: string; message?: string }> {
	const session = await authWithCheck()

	try {
		const integration = await findIntegrationByProvider(
			input.provider,
			input.operatorId,
			session.accessToken ?? '',
		)

		if (!integration) {
			return {
				success: false,
				message: `OAuth provider "${input.provider}" is not available`,
			}
		}

		const authUrl = await connectIntegration(
			integration.id,
			input.operatorId,
			session.accessToken ?? '',
		)

		return { success: true, url: authUrl }
	} catch (err: unknown) {
		const message =
			err instanceof Error ? err.message : 'Failed to get OAuth configuration'
		return { success: false, message }
	}
}

type IntegrationListItem = {
	id: string
	provider: string
	requires_oauth: boolean
}

async function findIntegrationByProvider(
	provider: string,
	operatorId: string,
	accessToken: string,
): Promise<IntegrationListItem | undefined> {
	const res = await fetch(`${getTachyonApiBaseUrl()}/v1/integrations`, {
		headers: buildIntegrationHeaders(accessToken, operatorId),
	})

	if (!res.ok) {
		throw new Error(`Failed to load integrations: ${res.status}`)
	}

	const body = (await res.json()) as {
		integrations: IntegrationListItem[]
	}

	return body.integrations.find(
		integration =>
			integration.provider === provider && integration.requires_oauth,
	)
}

async function connectIntegration(
	integrationId: string,
	operatorId: string,
	accessToken: string,
): Promise<string> {
	const requestHeaders = headers()
	const origin = getRequestOrigin(requestHeaders)

	const res = await fetch(
		`${getTachyonApiBaseUrl()}/v1/integrations/${integrationId}/connect`,
		{
			method: 'POST',
			headers: {
				...buildIntegrationHeaders(accessToken, operatorId),
				...(origin ? { Origin: origin } : {}),
			},
		},
	)

	if (!res.ok) {
		const message = await res.text()
		throw new Error(
			message || `Failed to start OAuth connection: ${res.status}`,
		)
	}

	const body = (await res.json()) as {
		authorization_url: string
	}
	return body.authorization_url
}

function buildIntegrationHeaders(
	accessToken: string,
	operatorId: string,
): HeadersInit {
	return {
		Authorization: `Bearer ${accessToken}`,
		'x-operator-id': operatorId,
		'x-platform-id': PLATFORM_ID,
	}
}

function getRequestOrigin(headerStore: Headers): string | undefined {
	const origin = headerStore.get('origin')
	if (origin) return origin

	const referer = headerStore.get('referer')
	if (!referer) return undefined

	try {
		return new URL(referer).origin
	} catch {
		return undefined
	}
}
