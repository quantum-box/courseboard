import { getServerModePrefix } from 'lib/mode'
import type { Route } from 'next'
import { redirect } from 'next/navigation'

export default function ErpReportsRedirectRoute({
	params: { tenant },
}: {
	params: {
		tenant: string
	}
}) {
	const prefix = getServerModePrefix(tenant)
	redirect(`${prefix}/${tenant}/reports` as Route)
}
