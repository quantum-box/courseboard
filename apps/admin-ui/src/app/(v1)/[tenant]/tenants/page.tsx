import { authWithCheck } from 'app/auth'
import { TenantPickerClient } from 'components/tenant-picker-client'
import { MainLayout, V1Layout } from 'components/v1-layout'

export default async function TenantsPage({
	params: { tenant },
}: {
	params: { tenant: string }
}) {
	await authWithCheck()

	return (
		<V1Layout current='tenants' tenant={tenant}>
			<MainLayout>
				<div className='w-full max-w-xl'>
					<h1 className='mb-6 text-lg font-semibold text-zinc-900'>
						テナントを選択
					</h1>
					<TenantPickerClient />
					<p className='mt-4 text-xs text-zinc-400'>
						プラットフォーム配下のすべてのテナントが表示されます
					</p>
				</div>
			</MainLayout>
		</V1Layout>
	)
}
