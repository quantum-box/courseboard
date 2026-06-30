import { authWithCheck } from 'app/auth'
import { Badge } from 'components/ui/badge'
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from 'components/ui/breadcrumb'
import { Button } from 'components/ui/button'
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from 'components/ui/card'
import { PageHeader } from 'components/ui/page-shell'
import { MainLayout, V1Layout } from 'components/v1-layout'
import { getServerModePrefix } from 'lib/mode'
import {
	AlertCircleIcon,
	FingerprintIcon,
	LinkIcon,
	ShieldCheckIcon,
} from 'lucide-react'
import type { Route } from 'next'
import Link from 'next/link'
import type { ComponentType } from 'react'

export const metadata = {
	title: 'アカウントセキュリティ | TACHYON Field',
	description: 'パスキー登録とGoogle連携の設定状態を確認します。',
}

type SecurityCapability = {
	title: string
	description: string
	status: string
	actionLabel: string
	endpointHint: string
	icon: ComponentType<{ className?: string }>
}

const securityCapabilities: SecurityCapability[] = [
	{
		title: 'パスキー登録',
		description:
			'端末に紐づくパスキーを登録し、フィッシング耐性のあるサインインを準備します。',
		status:
			'PLT-1615 の WebAuthn 登録 API が未提供のため、登録操作は無効化しています。',
		actionLabel: 'パスキーを登録',
		endpointHint:
			'Cognito StartWebAuthnRegistration / CompleteWebAuthnRegistration',
		icon: FingerprintIcon,
	},
	{
		title: 'Google 連携',
		description:
			'この管理アカウントに Google を追加のサインイン手段として連携します。',
		status:
			'PLT-1615 の provider link API が未提供のため、連携操作は無効化しています。',
		actionLabel: 'Google と連携',
		endpointHint: 'POST /auth/v1beta/link-provider',
		icon: LinkIcon,
	},
]

export default async function AccountSecurityPage({
	params: { tenant },
}: {
	params: { tenant: string }
}) {
	const session = await authWithCheck()
	const prefix = getServerModePrefix(tenant)

	return (
		<V1Layout
			current='account-security'
			tenant={tenant}
			breadcrumbs={
				<Breadcrumb>
					<BreadcrumbList>
						<BreadcrumbItem>
							<BreadcrumbLink asChild>
								<Link href={`${prefix}/${tenant}/settings` as Route}>設定</Link>
							</BreadcrumbLink>
						</BreadcrumbItem>
						<BreadcrumbSeparator />
						<BreadcrumbItem>
							<BreadcrumbPage>アカウントセキュリティ</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>
			}
		>
			<MainLayout>
				<div className='container mx-auto space-y-6'>
					<PageHeader
						title='アカウントセキュリティ'
						description='PLT-1615 の backend API 完成後に、パスキー登録と Google 連携を接続するための画面骨格です。'
						actions={<Badge variant='outline'>UI skeleton</Badge>}
					/>

					<Card className='border-amber-200 bg-amber-50/60'>
						<CardContent className='flex gap-3 p-4 text-sm text-amber-950'>
							<AlertCircleIcon className='mt-0.5 h-4 w-4 shrink-0' />
							<div>
								<p className='font-medium'>Backend dependency</p>
								<p className='mt-1'>
									パスキー登録と provider 連携は PLT-1615
									に依存しています。この画面では実 API を呼び出しません。
								</p>
							</div>
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle className='flex items-center gap-2 text-base'>
								<ShieldCheckIcon className='h-5 w-5 text-primary' />
								アカウント状態
							</CardTitle>
							<CardDescription>
								将来の API 呼び出しで利用する管理アカウントのセッション情報です。
							</CardDescription>
						</CardHeader>
						<CardContent className='grid gap-3 sm:grid-cols-3'>
							<StatusField label='メール' value={session.user.email ?? 'Unknown'} />
							<StatusField
								label='ユーザー名'
								value={session.user.username ?? session.user.id ?? 'Unknown'}
							/>
							<StatusField label='ロール' value={session.user.role ?? 'GENERAL'} />
						</CardContent>
					</Card>

					<div className='grid gap-4 lg:grid-cols-2'>
						{securityCapabilities.map(capability => (
							<SecurityCapabilityCard
								key={capability.title}
								capability={capability}
							/>
						))}
					</div>
				</div>
			</MainLayout>
		</V1Layout>
	)
}

function StatusField({ label, value }: { label: string; value: string }) {
	return (
		<div className='rounded-md border bg-muted/20 px-3 py-2'>
			<p className='text-xs font-medium uppercase text-muted-foreground'>
				{label}
			</p>
			<p className='mt-1 truncate text-sm font-medium'>{value}</p>
		</div>
	)
}

function SecurityCapabilityCard({
	capability,
}: {
	capability: SecurityCapability
}) {
	const Icon = capability.icon

	return (
		<Card>
			<CardHeader>
				<div className='flex items-start justify-between gap-3'>
					<div className='space-y-1'>
						<CardTitle className='flex items-center gap-2 text-base'>
							<Icon className='h-5 w-5 text-primary' />
							{capability.title}
						</CardTitle>
						<CardDescription>{capability.description}</CardDescription>
					</div>
					<Badge variant='secondary'>Coming soon</Badge>
				</div>
			</CardHeader>
			<CardContent className='space-y-4'>
				<div className='rounded-md border border-dashed bg-muted/20 p-3'>
					<p className='text-sm font-medium'>未設定</p>
					<p className='mt-1 text-sm text-muted-foreground'>
						{capability.status}
					</p>
					<p className='mt-2 text-xs text-muted-foreground'>
						将来接続: <code>{capability.endpointHint}</code>
					</p>
				</div>
				<Button type='button' disabled className='w-full sm:w-auto'>
					{capability.actionLabel}
				</Button>
			</CardContent>
		</Card>
	)
}
