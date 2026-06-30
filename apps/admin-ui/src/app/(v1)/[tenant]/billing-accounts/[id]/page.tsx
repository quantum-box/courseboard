import { authWithCheck } from 'app/auth'
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from 'components/ui/card'
import { MainLayout, V1Layout } from 'components/v1-layout'
import { notFound } from 'next/navigation'
import { fetchBillingAccountAction, fetchOperatorsAction } from '../action'
import { BillingAccountDetail } from './billing-account-detail'

export default async function BillingAccountDetailPage({
	params: { tenant, id },
}: {
	params: { tenant: string; id: string }
}) {
	await authWithCheck()

	const accountResult = await fetchBillingAccountAction(id)
	if (!accountResult.success || !accountResult.data) {
		notFound()
	}

	const operatorsResult = await fetchOperatorsAction(id)
	const operators =
		operatorsResult.success && operatorsResult.data ? operatorsResult.data : []

	return (
		<V1Layout current='billing-accounts' tenant={tenant}>
			<MainLayout>
				<div className='container mx-auto space-y-6'>
					<h1 className='text-xl sm:text-2xl font-bold'>請求アカウント詳細</h1>

					<Card>
						<CardHeader>
							<CardTitle>基本情報</CardTitle>
							<CardDescription>
								請求アカウントの名前を編集できます
							</CardDescription>
						</CardHeader>
						<CardContent>
							<BillingAccountDetail
								account={accountResult.data}
								operators={operators}
							/>
						</CardContent>
					</Card>
				</div>
			</MainLayout>
		</V1Layout>
	)
}
