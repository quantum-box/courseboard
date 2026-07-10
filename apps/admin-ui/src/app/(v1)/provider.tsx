'use client'

import {
	UrqlProvider,
	cacheExchange,
	createClient,
	fetchExchange,
	ssrExchange,
} from '@urql/next'
import {
	GRAPHQL_JSON_ACCEPT,
	resolveUrqlClientUrl,
} from 'lib/browserGraphqlProxy'
import { ENDPOINT } from 'lib/graphqlClient'
import { useState } from 'react'

export default function Provider({
	children,
	operatorId,
	accessToken,
	platformId,
}: React.PropsWithChildren<{
	operatorId?: string
	accessToken?: string | null
	platformId: string
}>) {
	const [{ client, ssr }] = useState(() => {
		const ssr = ssrExchange({
			isClient: true,
		})
		const client = createClient({
			// In the browser, go through the same-origin /api/graphql proxy
			// (server → internalService Field API). Direct browser calls to the
			// public Field API URL fail deterministically because urql's default
			// Accept advertises text/event-stream, which the public txcloud edge
			// rejects with "501 Origin does not support SSE" (PLT-2501).
			url: resolveUrqlClientUrl(ENDPOINT, typeof window !== 'undefined'),
			exchanges: [cacheExchange, ssr, fetchExchange],
			suspense: true,
			fetchOptions: {
				headers: {
					// Override urql's default Accept (which includes
					// text/event-stream) — the Field API only returns JSON.
					accept: GRAPHQL_JSON_ACCEPT,
					'x-platform-id': platformId,
					...(accessToken && {
						Authorization: `Bearer ${accessToken}`,
					}),
					...(operatorId && { 'x-operator-id': operatorId }),
				},
			},
		})

		return { client, ssr }
	})

	return (
		<UrqlProvider client={client} ssr={ssr}>
			{children}
		</UrqlProvider>
	)
}
