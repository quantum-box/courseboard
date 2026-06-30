'use client'

import { Input } from 'components/ui/input'
import { Label } from 'components/ui/label'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from 'components/ui/select'
import type { OAuthProviderInfo, PlatformSquareConfig } from './page'

export type IntegrationData = {
	squareMode: 'manual' | 'copy' | 'platform' | 'skip'
	squareApiKey?: string
	squareLocationId?: string
	squareWebhookSignatureKey?: string
	copySourceTenantId?: string
	/** OAuth providers selected to connect after tenant creation */
	selectedOAuthProviders: string[]
}

// PLT-925-P1: Stripe is intentionally excluded — online EC checkout
// uses Square as the SSoT. Stripe remains the provider for B2B
// quote-driven flows and toC SaaS subscription billing only.
const PROVIDER_LABELS: Record<string, string> = {
	square: 'Square',
	hubspot: 'HubSpot',
	github: 'GitHub',
	linear: 'Linear',
	notion: 'Notion',
	airtable: 'Airtable',
	slack: 'Slack',
	discord: 'Discord',
}

type Props = {
	data: IntegrationData
	onChange: (data: IntegrationData) => void
	existingTenants: { id: string; name: string }[]
	platformSquareConfig: PlatformSquareConfig
	oauthProviders: OAuthProviderInfo[]
}

export function StepIntegration({
	data,
	onChange,
	existingTenants,
	platformSquareConfig,
	oauthProviders,
}: Props) {
	const selectableOAuthProviders = oauthProviders.filter(
		provider => provider.provider !== 'square',
	)

	const update = (partial: Partial<IntegrationData>) => {
		onChange({ ...data, ...partial })
	}

	const handleSquareModeChange = (mode: IntegrationData['squareMode']) => {
		const selectedOAuthProviders =
			mode === 'platform'
				? Array.from(new Set([...data.selectedOAuthProviders, 'square']))
				: data.selectedOAuthProviders.filter(provider => provider !== 'square')

		onChange({
			...data,
			squareMode: mode,
			selectedOAuthProviders,
		})
	}

	const toggleOAuthProvider = (provider: string) => {
		const current = data.selectedOAuthProviders
		const next = current.includes(provider)
			? current.filter(p => p !== provider)
			: [...current, provider]
		update({ selectedOAuthProviders: next })
	}

	return (
		<div className='grid gap-6'>
			{/* Square integration (legacy manual/copy/platform modes) */}
			<div className='grid gap-4'>
				<p className='text-sm text-muted-foreground'>
					Square決済サービスとの連携方法を選択します。後から設定ページで変更することも可能です。
				</p>

				<div className='grid gap-2'>
					<Label>Square連携方法</Label>
					<Select
						value={data.squareMode}
						onValueChange={v =>
							handleSquareModeChange(v as IntegrationData['squareMode'])
						}
					>
						<SelectTrigger>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value='skip'>スキップ（後で設定する）</SelectItem>
							{platformSquareConfig.available && (
								<SelectItem value='platform'>
									親テナントのOAuth設定を使用
								</SelectItem>
							)}
							<SelectItem value='manual'>
								手動入力（APIキーを直接入力）
							</SelectItem>
							{existingTenants.length > 0 && (
								<SelectItem value='copy'>既存テナントからコピー</SelectItem>
							)}
						</SelectContent>
					</Select>
				</div>

				{data.squareMode === 'platform' && (
					<div className='grid gap-2 rounded-md border border-emerald-200 bg-emerald-50/50 p-4'>
						<p className='text-sm font-medium text-emerald-800'>
							親テナントに設定済みのSquare OAuth認証情報を使用します
						</p>
						{platformSquareConfig.environment && (
							<p className='text-xs text-emerald-600'>
								環境:{' '}
								{platformSquareConfig.environment === 'production'
									? 'Production'
									: 'Sandbox'}
							</p>
						)}
						<p className='text-xs text-muted-foreground'>
							テナント作成後にSquareのOAuth認証を開始します。個別のAPIキー入力は不要です。
						</p>
					</div>
				)}

				{data.squareMode === 'manual' && (
					<div className='grid gap-4 rounded-md border border-zinc-200 bg-zinc-50/50 p-4'>
						<div className='grid gap-2'>
							<Label htmlFor='squareApiKey'>Square API Key *</Label>
							<Input
								id='squareApiKey'
								type='password'
								placeholder='sq0atp-...'
								value={data.squareApiKey ?? ''}
								onChange={e => update({ squareApiKey: e.target.value })}
							/>
						</div>
						<div className='grid gap-2'>
							<Label htmlFor='squareLocationId'>Location ID *</Label>
							<Input
								id='squareLocationId'
								placeholder='L...'
								value={data.squareLocationId ?? ''}
								onChange={e =>
									update({
										squareLocationId: e.target.value,
									})
								}
							/>
						</div>
						<div className='grid gap-2'>
							<Label htmlFor='squareWebhookSignatureKey'>
								Webhook Signature Key
							</Label>
							<Input
								id='squareWebhookSignatureKey'
								type='password'
								value={data.squareWebhookSignatureKey ?? ''}
								onChange={e =>
									update({
										squareWebhookSignatureKey: e.target.value,
									})
								}
							/>
							<p className='text-xs text-muted-foreground'>
								Webhookを使用する場合に設定します（省略可）
							</p>
						</div>
					</div>
				)}

				{data.squareMode === 'copy' && (
					<div className='grid gap-4 rounded-md border border-zinc-200 bg-zinc-50/50 p-4'>
						<div className='grid gap-2'>
							<Label>コピー元テナント</Label>
							<Select
								value={data.copySourceTenantId ?? 'none'}
								onValueChange={v =>
									update({
										copySourceTenantId: v === 'none' ? undefined : v,
									})
								}
							>
								<SelectTrigger>
									<SelectValue placeholder='テナントを選択' />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value='none' disabled>
										テナントを選択
									</SelectItem>
									{existingTenants.map(t => (
										<SelectItem key={t.id} value={t.id}>
											{t.name} ({t.id})
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							<p className='text-xs text-muted-foreground'>
								選択したテナントのSquare設定をコピーします
							</p>
						</div>
					</div>
				)}
			</div>

			{/* OAuth provider connections (post-creation) */}
			<div className='grid gap-3'>
				<div className='grid gap-1'>
					<Label>OAuth連携（テナント作成後に認証）</Label>
					<p className='text-xs text-muted-foreground'>
						選択したサービスはテナント作成後にOAuth認証フローを開始します。
						Platformに設定がないサービスはこの一覧に表示されません。
					</p>
				</div>
				{selectableOAuthProviders.length > 0 ? (
					<div className='grid gap-2'>
						{selectableOAuthProviders.map(p => {
							const checked = data.selectedOAuthProviders.includes(p.provider)
							return (
								<div
									key={p.provider}
									className={`flex cursor-pointer items-center gap-3 rounded-md border p-3 transition-colors hover:bg-zinc-50 ${
										checked
											? 'border-emerald-300 bg-emerald-50/50'
											: 'border-zinc-200'
									}`}
									onClick={() => toggleOAuthProvider(p.provider)}
									onKeyDown={e => {
										if (e.key === 'Enter' || e.key === ' ') {
											toggleOAuthProvider(p.provider)
										}
									}}
									role='checkbox'
									aria-checked={checked}
									tabIndex={0}
								>
									<div
										className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
											checked
												? 'border-emerald-600 bg-emerald-600 text-white'
												: 'border-zinc-300'
										}`}
									>
										{checked && (
											<svg
												className='h-3 w-3'
												fill='none'
												viewBox='0 0 24 24'
												stroke='currentColor'
												strokeWidth={3}
											>
												<title>selected</title>
												<path
													strokeLinecap='round'
													strokeLinejoin='round'
													d='M5 13l4 4L19 7'
												/>
											</svg>
										)}
									</div>
									<div className='grid gap-0.5'>
										<span className='text-sm font-medium'>
											{PROVIDER_LABELS[p.provider] ?? p.provider}
										</span>
										<span className='text-xs text-muted-foreground'>
											OAuth認証で接続
										</span>
									</div>
								</div>
							)
						})}
					</div>
				) : (
					<div className='rounded-md border border-zinc-200 bg-zinc-50/50 p-3'>
						<p className='text-sm text-muted-foreground'>
							PlatformにOAuthプロバイダーが設定されていません。設定後にこの画面でOAuth連携を選択できるようになります。
						</p>
					</div>
				)}
			</div>
		</div>
	)
}
