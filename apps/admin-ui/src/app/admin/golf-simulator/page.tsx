import { auth } from 'app/auth'
import fetchTenants from 'lib/tenantFetcher'
import type { Route } from 'next'
import { redirect } from 'next/navigation'

export default async function GolfSimulatorAdminRedirect() {
	const session = await auth()
	if (!session) {
		redirect('/auth/sign_in')
	}

	const tenants = await fetchTenants(session)
	const tenant = tenants[0]
	if (!tenant) {
		redirect('/')
	}

	const prefix = tenant.mode === 'sandbox' ? '/sandbox' : ''
	redirect(`${prefix}/${tenant.id}/golf-simulator` as Route)
}
