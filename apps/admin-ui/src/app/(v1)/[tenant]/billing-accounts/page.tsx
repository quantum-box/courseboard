import { authWithCheck } from 'app/auth'
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from 'components/ui/card'
import { PageHeader } from 'components/ui/page-shell'
import { MainLayout, V1Layout } from 'components/v1-layout'
import { type BillingAccountData, fetchBillingAccountsAction } from './action'
import { BillingAccountList } from './billing-account-list'

export default async function BillingAccountsPage({
	params: { tenant },
}: {
	params: { tenant: string }
}) {
	await authWithCheck()

	let billingAccounts: BillingAccountData[] = []
	const result = await fetchBillingAccountsAction()
	if (result.success && result.data) {
		billingAccounts = result.data
	}

	return (
		<V1Layout current='billing-accounts' tenant={tenant}>
			<MainLayout>
				<div className='grid gap-6'>
					<PageHeader
						title='請求アカウント管理'
						description='請求アカウントとオペレーターの紐付けを管理します'
					/>
					<Card>
						<CardHeader>
							<CardTitle>請求アカウント</CardTitle>
							<CardDescription>
								請求アカウントを管理し、オペレーターを紐付けます
							</CardDescription>
						</CardHeader>
						<CardContent>
							<BillingAccountList
								billingAccounts={billingAccounts}
								tenantId={tenant}
							/>
						</CardContent>
					</Card>
				</div>
			</MainLayout>
		</V1Layout>
	)
}
