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
import { getServerGraphqlSdk } from 'lib/serverGraphqlClient'
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
	// Server-resolved (internalService) Field API — same as reservation SSR
	// (#36). The client-facing getGraphqlSdk resolves the public URL, which is
	// not reliably reachable from worker subrequests (PLT-2501 follow-up).
	const sdk = getServerGraphqlSdk(session, tenant)
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
	} catch (error) {
		// Leave a trace before collapsing every failure into a 404 — a fetch
		// error is not "product does not exist" (PLT-2501).
		console.error('productDetail failed; rendering notFound', error)
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
