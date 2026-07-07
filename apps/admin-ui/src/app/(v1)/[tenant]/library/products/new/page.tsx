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
import { getServerModePrefix } from 'lib/mode'
import type { Route } from 'next'
import Link from 'next/link'

export default async function NewProductPage({
	params: { tenant },
}: {
	params: { tenant: string }
}) {
	const session = await authWithCheck()
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
								<Link href={`${mp}/${tenant}/library/products` as Route}>
									製品
								</Link>
							</BreadcrumbLink>
						</BreadcrumbItem>
						<BreadcrumbSeparator />
						<BreadcrumbItem>
							<BreadcrumbPage>新規製品作成</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>
			}
		>
			<Provider {...getUrqlProviderProps(tenant, session.accessToken)}>
				<ProductDetails
					backLink={`${mp}/${tenant}/library/products` as Route}
					tenantId={tenant}
				/>
			</Provider>
		</V1Layout>
	)
}
