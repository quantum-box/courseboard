'use server'

import { authWithCheck } from 'app/auth'
import type { CreateOperatorInput } from 'gen/graphql'
import { getSdk } from 'gen/graphql'
import { getBackendBaseUrl } from 'lib/backendUrl'
import { GraphQLClient } from 'lib/graphql-request'
import { PLATFORM_ID, getPlatformSdk } from 'lib/graphqlClient'

type ActionResult = {
	success: boolean
	message?: string
	operatorId?: string
}

export async function createOperatorAction(
	input: CreateOperatorInput,
): Promise<ActionResult> {
	const session = await authWithCheck()
	const sdk = getPlatformSdk(session.accessToken ?? undefined)

	let operatorId: string
	try {
		const { createOperator } = await sdk.CreateOperator({ input })
		operatorId = createOperator.id
	} catch (err: unknown) {
		const message =
			err instanceof Error ? err.message : 'Failed to create operator'
		console.error('Failed to create operator:', message)
		return { success: false, message }
	}

	// Create default ProjectConfig manifest for the new operator
	try {
		const operatorSdk = getSdk(
			new GraphQLClient(`${getBackendBaseUrl()}/v1/graphql`, {
				headers: {
					'x-platform-id': PLATFORM_ID,
					'x-operator-id': operatorId,
					Authorization: `Bearer ${session.accessToken}`,
				},
			}),
		)

		await operatorSdk.CopyOperatorManifest({
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
	} catch (err: unknown) {
		console.error(
			'Failed to create default manifest:',
			err instanceof Error ? err.message : err,
		)
		// Operator was created but manifest failed - return success with warning
		return {
			success: true,
			operatorId,
			message:
				'テナントは作成されましたが、デフォルト設定の作成に失敗しました。',
		}
	}

	return { success: true, operatorId }
}

export async function deleteOperatorAction(id: string): Promise<ActionResult> {
	const session = await authWithCheck()
	const sdk = getPlatformSdk(session.accessToken ?? undefined)

	try {
		await sdk.DeleteOperator({ id })
		return { success: true }
	} catch (err: unknown) {
		const message =
			err instanceof Error ? err.message : 'Failed to delete operator'
		console.error('Failed to delete operator:', message)
		return { success: false, message }
	}
}
