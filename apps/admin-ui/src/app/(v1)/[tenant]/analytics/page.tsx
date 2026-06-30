import { getServerModePrefix } from 'lib/mode'
import type { Route } from 'next'
import { redirect } from 'next/navigation'

export default function AnalyticsRedirectRoute({
	params: { tenant },
}: {
	params: {
		tenant: string
	}
}) {
	const prefix = getServerModePrefix(tenant)
	redirect(`${prefix}/${tenant}/reports/sales` as Route)
}
