import { getServerModePrefix } from 'lib/mode'
import type { Route } from 'next'
import { redirect } from 'next/navigation'

export default function ErpIndexRoute({
	params: { tenant },
}: {
	params: {
		tenant: string
	}
}) {
	const mp = getServerModePrefix(tenant)
	redirect(`${mp}/${tenant}/erp/dashboard` as Route)
}
