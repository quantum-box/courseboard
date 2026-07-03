'use client'

import {
	UrqlProvider,
	cacheExchange,
	createClient,
	fetchExchange,
	ssrExchange,
} from '@urql/next'
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
			url: `${ENDPOINT}/v1/graphql`,
			exchanges: [cacheExchange, ssr, fetchExchange],
			suspense: true,
			fetchOptions: {
				headers: {
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
