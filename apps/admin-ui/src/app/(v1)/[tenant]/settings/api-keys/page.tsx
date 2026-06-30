import { authWithCheck } from 'app/auth'
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from 'components/ui/card'
import { MainLayout, V1Layout } from 'components/v1-layout'
import { type ApiKeyData, fetchApiKeysAction } from './action'
import { ApiKeyList } from './api-key-list'

export default async function ApiKeysPage({
	params: { tenant },
}: {
	params: { tenant: string }
}) {
	await authWithCheck()

	let apiKeys: ApiKeyData[] = []
	const result = await fetchApiKeysAction(tenant)
	if (result.success && result.data) {
		apiKeys = result.data
	}

	return (
		<V1Layout current='api-keys' tenant={tenant}>
			<MainLayout>
				<div className='container mx-auto'>
					<h1 className='text-xl sm:text-2xl font-bold mb-4 sm:mb-6'>
						APIキー管理
					</h1>
					<Card>
						<CardHeader>
							<CardTitle>APIキー</CardTitle>
							<CardDescription>
								公開決済で使うAPIキーを管理します。
							</CardDescription>
						</CardHeader>
						<CardContent>
							<ApiKeyList apiKeys={apiKeys} tenantId={tenant} />
						</CardContent>
					</Card>
				</div>
			</MainLayout>
		</V1Layout>
	)
}
