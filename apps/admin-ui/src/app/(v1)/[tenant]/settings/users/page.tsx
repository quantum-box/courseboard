import { authWithCheck } from 'app/auth'
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from 'components/ui/card'
import { MainLayout, V1Layout } from 'components/v1-layout'
import { fetchErpUsersAction } from './actions'
import { UserManagement } from './user-management'

export default async function UsersPage({
	params: { tenant },
}: {
	params: { tenant: string }
}) {
	await authWithCheck()

	const result = await fetchErpUsersAction(tenant)
	const users = result.success ? (result.data ?? []) : []

	return (
		<V1Layout current='users' tenant={tenant}>
			<MainLayout>
				<div className='container mx-auto'>
					<h1 className='text-xl sm:text-2xl font-bold mb-4 sm:mb-6'>
						メンバー管理
					</h1>
					<Card>
						<CardHeader>
							<CardTitle>ユーザー管理</CardTitle>
							<CardDescription>
								TACHYON Fieldにアクセスできるメンバーの招待、ロール付与、変更、削除を管理します
							</CardDescription>
						</CardHeader>
						<CardContent>
							<UserManagement tenantId={tenant} initialUsers={users} />
						</CardContent>
					</Card>
				</div>
			</MainLayout>
		</V1Layout>
	)
}
