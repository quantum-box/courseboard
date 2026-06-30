import { getServerModePrefix } from 'lib/mode'
import { redirect } from 'next/navigation'

export default async function ProductsRedirectPage({
	params,
}: {
	params: Promise<{ tenant: string }>
}) {
	const { tenant } = await params
	const modePrefix = getServerModePrefix(tenant)

	redirect(`${modePrefix}/${tenant}/library/products`)
}
