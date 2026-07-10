import { authWithCheck } from 'app/auth'
import { LanguageSettingsCard } from 'components/language-settings-card'
import { Button } from 'components/ui/button'
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from 'components/ui/card'
import { MainLayout, V1Layout } from 'components/v1-layout'
import { T } from 'lib/admin-i18n'
import { getServerModePrefix } from 'lib/mode'
import {
	FileTextIcon,
	InfoIcon,
	KeyRoundIcon,
	ShieldCheckIcon,
} from 'lucide-react'
import Link from 'next/link'
import React from 'react'
import { fetchExternalServiceStatusAction } from './action'
import { ExternalServiceStatusCard } from './external-service-status'

export default async function SettingsPage({
	params: { tenant },
}: {
	params: { tenant: string }
}) {
	await authWithCheck()

	const serviceStatus = await fetchExternalServiceStatusAction(tenant)
	const prefix = getServerModePrefix(tenant)

	return (
		<V1Layout current='settings' tenant={tenant}>
			<MainLayout>
				<div className='container mx-auto space-y-4'>
					<h1 className='text-xl sm:text-2xl font-bold mb-4 sm:mb-6'>
						<T k='settings.title' />
					</h1>

					<ExternalServiceStatusCard
						tenantId={tenant}
						initialData={
							serviceStatus.success ? (serviceStatus.data ?? null) : null
						}
						initialError={
							serviceStatus.success ? undefined : serviceStatus.message
						}
					/>

					<LanguageSettingsCard />

					<Card>
						<CardHeader>
							<CardTitle>PDFテンプレート設定</CardTitle>
							<CardDescription>
								見積書・請求書のテンプレート、ロゴ、社印をテナント別に管理します。
							</CardDescription>
						</CardHeader>
						<CardContent>
							<Button asChild variant='outline'>
								<Link href={`${prefix}/${tenant}/settings/document-pdf`}>
									<FileTextIcon className='h-4 w-4 mr-2' />
									PDFテンプレートを設定
								</Link>
							</Button>
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>
								<T k='settings.securityTitle' />
							</CardTitle>
							<CardDescription>
								<T k='settings.securityDescription' />
							</CardDescription>
						</CardHeader>
						<CardContent>
							<Button asChild variant='outline'>
								<Link href={`${prefix}/${tenant}/settings/security`}>
									<KeyRoundIcon className='h-4 w-4 mr-2' />
									<T k='settings.securityButton' />
								</Link>
							</Button>
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>
								<T k='settings.scopeTitle' />
							</CardTitle>
							<CardDescription>
								<T k='settings.scopeDescription' />
							</CardDescription>
						</CardHeader>
						<CardContent>
							<Button asChild variant='outline'>
								<Link href={`${prefix}/${tenant}/settings/scope`}>
									<InfoIcon className='h-4 w-4 mr-2' />
									<T k='settings.scopeButton' />
								</Link>
							</Button>
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>
								<T k='settings.erpTitle' />
							</CardTitle>
							<CardDescription>
								<T k='settings.erpDescription' />
							</CardDescription>
						</CardHeader>
						<CardContent>
							<Button asChild variant='outline'>
								<Link href={`${prefix}/${tenant}/settings/erp-rollout`}>
									<ShieldCheckIcon className='h-4 w-4 mr-2' />
									<T k='settings.erpButton' />
								</Link>
							</Button>
						</CardContent>
					</Card>
				</div>
			</MainLayout>
		</V1Layout>
	)
}
