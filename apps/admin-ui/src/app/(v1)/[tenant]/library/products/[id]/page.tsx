import { ProductDetails } from 'app/(v1)/[tenant]/library/products/_components/product-detail'
import Provider from 'app/(v1)/provider'
import { getUrqlProviderProps } from 'app/(v1)/urql-provider-props'
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
import { notFound } from 'next/navigation'

export default async function ProductDetailsPage({
	params: { id, tenant },
}: {
	params: { id: string; tenant: string }
}) {
	const session = await authWithCheck()
	const sdk = getGraphqlSdk(session, tenant)
	const mp = getServerModePrefix(tenant)

	let product: Awaited<ReturnType<typeof sdk.productDetail>>['product'] | null =
		null
	let payment_providers: Awaited<
		ReturnType<typeof sdk.productDetail>
	>['payment_providers'] = []

	try {
		const result = await sdk.productDetail({ productId: id })
		product = result.product
		payment_providers = result.payment_providers ?? []
	} catch {
		notFound()
	}

	if (!product) {
		notFound()
	}

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
								<Link href={`${mp}/${tenant}/library/products` as Route}>
									製品
								</Link>
							</BreadcrumbLink>
						</BreadcrumbItem>
						<BreadcrumbSeparator />
						<BreadcrumbItem>
							<BreadcrumbPage>{product.name}</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>
			}
		>
			<Provider {...getUrqlProviderProps(tenant, session.accessToken)}>
				<ProductDetails
					data={product}
					backLink={`${mp}/${tenant}/library/products` as Route}
					tenantId={tenant}
					paymentProviders={payment_providers}
				/>
			</Provider>
		</V1Layout>
	)
}
