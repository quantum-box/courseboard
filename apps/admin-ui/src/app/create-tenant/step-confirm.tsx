'use client'

import { Badge } from 'components/ui/badge'
import type { BasicInfoData } from './step-basic-info'
import type { IntegrationData } from './step-integration'
import type { ManifestData } from './step-manifest'
import type { OAuthProviderInfo, PlatformSquareConfig } from './page'

const PROVIDER_LABELS: Record<string, string> = {
	square: 'Square',
	hubspot: 'HubSpot',
	stripe: 'Stripe',
	github: 'GitHub',
	linear: 'Linear',
	notion: 'Notion',
	airtable: 'Airtable',
	slack: 'Slack',
	discord: 'Discord',
}

type Props = {
	basicInfo: BasicInfoData
	manifestData: ManifestData
	integrationData: IntegrationData
	existingTenants: { id: string; name: string }[]
	platformSquareConfig: PlatformSquareConfig
	oauthProviders: OAuthProviderInfo[]
}

export function StepConfirm({
	basicInfo,
	manifestData,
	integrationData,
	existingTenants,
	platformSquareConfig,
	oauthProviders,
}: Props) {
	const copySourceName = existingTenants.find(
		t => t.id === integrationData.copySourceTenantId,
	)?.name

	const selectedProviderNames = integrationData.selectedOAuthProviders.map(
		p => PROVIDER_LABELS[p] ?? p,
	)

	return (
		<div className='grid gap-6'>
			<p className='text-sm text-muted-foreground'>
				以下の内容でテナントを作成します。確認してください。
			</p>

			{/* Basic Info */}
			<div className='rounded-md border border-zinc-200 p-4'>
				<h3 className='mb-3 text-sm font-semibold'>テナント情報</h3>
				<dl className='grid gap-2 text-sm'>
					<div className='flex justify-between'>
						<dt className='text-muted-foreground'>組織名</dt>
						<dd className='font-medium'>{basicInfo.operatorName}</dd>
					</div>
					{basicInfo.operatorAlias && (
						<div className='flex justify-between'>
							<dt className='text-muted-foreground'>エイリアス</dt>
							<dd className='font-medium'>{basicInfo.operatorAlias}</dd>
						</div>
					)}
					<div className='flex justify-between'>
						<dt className='text-muted-foreground'>オーナー設定</dt>
						<dd className='font-medium'>現在のユーザー</dd>
					</div>
				</dl>
			</div>

			{/* Manifest */}
			<div className='rounded-md border border-zinc-200 p-4'>
				<h3 className='mb-3 text-sm font-semibold'>基本設定</h3>
				<dl className='grid gap-2 text-sm'>
					<div className='flex justify-between'>
						<dt className='text-muted-foreground'>Square環境</dt>
						<dd>
							{(() => {
								const env =
									integrationData.squareMode === 'platform' &&
									platformSquareConfig.environment
										? platformSquareConfig.environment
										: manifestData.squareEnvironment
								return (
									<Badge
										variant={env === 'production' ? 'default' : 'secondary'}
										className={
											env === 'production'
												? 'bg-emerald-600 text-white'
												: 'bg-amber-100 text-amber-800'
										}
									>
										{env === 'production' ? 'Production' : 'Sandbox'}
									</Badge>
								)
							})()}
						</dd>
					</div>
				</dl>
			</div>

			{/* Integration */}
			<div className='rounded-md border border-zinc-200 p-4'>
				<h3 className='mb-3 text-sm font-semibold'>外部サービス連携</h3>
				<dl className='grid gap-2 text-sm'>
					<div className='flex justify-between'>
						<dt className='text-muted-foreground'>Square連携</dt>
						<dd className='font-medium'>
							{integrationData.squareMode === 'skip' && 'スキップ（後で設定）'}
							{integrationData.squareMode === 'manual' && 'APIキーを手動入力'}
							{integrationData.squareMode === 'platform' &&
								'親テナントのOAuth設定を使用'}
							{integrationData.squareMode === 'copy' &&
								`${copySourceName ?? integrationData.copySourceTenantId} からコピー`}
						</dd>
					</div>
					{integrationData.squareMode === 'platform' &&
						platformSquareConfig.environment && (
							<div className='flex justify-between'>
								<dt className='text-muted-foreground'>Platform環境</dt>
								<dd className='font-medium'>
									{platformSquareConfig.environment === 'production'
										? 'Production'
										: 'Sandbox'}
								</dd>
							</div>
						)}
					{integrationData.squareMode === 'manual' && (
						<>
							<div className='flex justify-between'>
								<dt className='text-muted-foreground'>API Key</dt>
								<dd className='font-medium'>
									{'*'.repeat(8)}...
									{integrationData.squareApiKey?.slice(-4)}
								</dd>
							</div>
							<div className='flex justify-between'>
								<dt className='text-muted-foreground'>Location ID</dt>
								<dd className='font-medium'>
									{integrationData.squareLocationId}
								</dd>
							</div>
						</>
					)}
					{selectedProviderNames.length > 0 && (
						<div className='flex justify-between'>
							<dt className='text-muted-foreground'>OAuth連携（作成後）</dt>
							<dd className='flex flex-wrap gap-1'>
								{selectedProviderNames.map(name => (
									<Badge
										key={name}
										variant='secondary'
										className='bg-blue-100 text-blue-800'
									>
										{name}
									</Badge>
								))}
							</dd>
						</div>
					)}
				</dl>
			</div>

			{selectedProviderNames.length > 0 && (
				<p className='rounded-md bg-blue-50 px-4 py-2 text-xs text-blue-700'>
					テナント作成後、選択したOAuthサービスの認証画面に順次リダイレクトされます。
				</p>
			)}
		</div>
	)
}
