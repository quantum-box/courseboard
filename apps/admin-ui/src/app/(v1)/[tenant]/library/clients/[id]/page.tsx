import { authWithCheck } from 'app/auth'
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from 'components/ui/breadcrumb'
import { V1Layout } from 'components/v1-layout'
import { getGraphqlSdk } from 'lib/graphqlClient'
import { getServerModePrefix } from 'lib/mode'
import type { Route } from 'next'
import Link from 'next/link'

import { ClientDetail } from './_components'
import { fetchCustomer360Action } from './customer-360-action'

export default async function ClientDetailsPage({
	params: { id, tenant },
}: {
	params: { id: string; tenant: string }
}) {
	const session = await authWithCheck()
	const sdk = getGraphqlSdk(session, tenant)
	const { client } = await sdk.clientDetail({ id })
	const customer360 = await fetchCustomer360Action(tenant, {
		id: client.id,
		name: client.name,
	})
	const mp = getServerModePrefix(tenant)

	return (
		<V1Layout
			current='library'
			tenant={tenant}
			breadcrumbs={
				<Breadcrumb>
					<BreadcrumbList>
						<BreadcrumbItem>
							<BreadcrumbLink asChild>
								<Link href={`${mp}/${tenant}/library` as Route}>
									ライブラリー
								</Link>
							</BreadcrumbLink>
						</BreadcrumbItem>
						<BreadcrumbSeparator />
						<BreadcrumbItem>
							<BreadcrumbLink asChild>
								<Link href={`${mp}/${tenant}/library/clients` as Route}>
									取引先
								</Link>
							</BreadcrumbLink>
						</BreadcrumbItem>
						<BreadcrumbSeparator />
						<BreadcrumbItem>
							<BreadcrumbPage>{client.name}</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>
			}
		>
			<ClientDetail
				data={client}
				backLink={`${mp}/${tenant}/library/clients` as Route}
				tenantId={tenant}
				customer360={customer360.data}
				customer360Error={customer360.success ? undefined : customer360.message}
			/>
		</V1Layout>
	)
}
