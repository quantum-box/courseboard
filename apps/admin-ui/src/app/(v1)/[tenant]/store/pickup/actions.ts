'use server'

import { authWithCheck } from 'app/auth'
import { getGraphqlSdk } from 'lib/graphqlClient'

export async function executePickupAction(
	tenant: string,
	orderId: string,
	action: 'ready' | 'pickup' | 'cancel',
): Promise<{ error?: string } | undefined> {
	try {
		const session = await authWithCheck()
		const sdk = getGraphqlSdk(session, tenant)

		switch (action) {
			case 'ready':
				await sdk.readyOrder({ orderId })
				break
			case 'pickup':
				await sdk.pickupOrder({ orderId })
				break
			case 'cancel':
				await sdk.cancelOrder({ orderId })
				break
		}
	} catch (e) {
		return { error: e instanceof Error ? e.message : 'Action failed' }
	}
}
