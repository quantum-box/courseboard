'use client'
import { Button } from 'components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from 'components/ui/card'
import { TachyonFieldLogo } from 'components/tachyon-field-logo'
import { NewOperatorOwnerMethod } from 'gen/graphql'
import {
	ArrowLeft,
	ArrowRight,
	Check,
	ExternalLink,
	Loader2,
} from 'lucide-react'
import type { Route } from 'next'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import {
	checkOperatorAliasAvailabilityAction,
	createTenantWithManifestAction,
	getOAuthAuthorizationUrl,
} from './action'
import type { OAuthProviderInfo, PlatformSquareConfig } from './page'
import {
	type AliasValidationState,
	type BasicInfoData,
	StepBasicInfo,
} from './step-basic-info'
import { StepConfirm } from './step-confirm'
import { type IntegrationData, StepIntegration } from './step-integration'
import { type ManifestData, StepManifest } from './step-manifest'

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

const STEPS = [
	{ label: 'テナント情報', description: '基本情報を入力' },
	{ label: '基本設定', description: 'コマース設定' },
	{ label: '外部サービス連携', description: 'Square等の設定' },
	{ label: '確認・作成', description: '内容を確認して作成' },
] as const
type WizardProps = {
	platformId: string
	existingTenants: { id: string; name: string }[]
	platformSquareConfig: PlatformSquareConfig
	oauthProviders: OAuthProviderInfo[]
}
export function CreateTenantWizard({
	platformId,
	existingTenants,
	platformSquareConfig,
	oauthProviders,
}: WizardProps) {
	const router = useRouter()
	const [currentStep, setCurrentStep] = useState(0)
	const [isSubmitting, setIsSubmitting] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [result, setResult] = useState<{
		operatorId: string
		warning?: string
	} | null>(null)
	const [basicInfo, setBasicInfo] = useState<BasicInfoData>({
		operatorName: '',
		operatorAlias: '',
		ownerMethod: NewOperatorOwnerMethod.Inherit,
	})
	const [aliasValidation, setAliasValidation] = useState<AliasValidationState>({
		status: 'idle',
	})
	const [manifestData, setManifestData] = useState<ManifestData>({
		squareEnvironment: 'sandbox',
	})
	const [integrationData, setIntegrationData] = useState<IntegrationData>({
		squareMode: 'skip',
		selectedOAuthProviders: [],
	})
	const effectiveSelectedOAuthProviders =
		integrationData.squareMode === 'platform'
			? Array.from(
					new Set([...integrationData.selectedOAuthProviders, 'square']),
				)
			: integrationData.selectedOAuthProviders
	const normalizedAlias = basicInfo.operatorAlias.trim()

	useEffect(() => {
		const aliasPattern = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/
		if (!normalizedAlias) {
			setAliasValidation({ status: 'idle' })
			return
		}
		if (normalizedAlias.length < 3) {
			setAliasValidation({
				status: 'error',
				message: 'エイリアスは3文字以上で入力してください',
			})
			return
		}
		if (normalizedAlias.length > 40) {
			setAliasValidation({
				status: 'error',
				message: 'エイリアスは40文字以内で入力してください',
			})
			return
		}
		if (!aliasPattern.test(normalizedAlias)) {
			setAliasValidation({
				status: 'error',
				message:
					'エイリアスは英小文字・数字・ハイフンのみ使用でき、先頭と末尾にハイフンは使用できません',
			})
			return
		}
		if (normalizedAlias.includes('--')) {
			setAliasValidation({
				status: 'error',
				message: 'ハイフンを連続して使用することはできません',
			})
			return
		}

		let cancelled = false
		setAliasValidation({ status: 'checking' })

		const timeoutId = window.setTimeout(async () => {
			try {
				const result = await checkOperatorAliasAvailabilityAction({
					operatorAlias: normalizedAlias,
				})

				if (cancelled) return

				if (result.available) {
					setAliasValidation({ status: 'available' })
				} else if (result.errorCode === 'INVALID_FORMAT') {
					setAliasValidation({
						status: 'error',
						message: 'エイリアスの形式が不正です',
					})
				} else {
					setAliasValidation({
						status: 'duplicate',
						message: result.message ?? 'このエイリアスは既に使用されています',
					})
				}
			} catch {
				if (cancelled) return
				setAliasValidation({
					status: 'error',
					message:
						'エイリアスの確認に失敗しました。しばらくしてから再度お試しください。',
				})
			}
		}, 400)

		return () => {
			cancelled = true
			window.clearTimeout(timeoutId)
		}
	}, [normalizedAlias])

	const canGoNext = (): boolean => {
		if (currentStep === 0) {
			return (
				basicInfo.operatorName.trim() !== '' &&
				(aliasValidation.status === 'idle' ||
					aliasValidation.status === 'available')
			)
		}
		if (currentStep === 1) return true
		if (currentStep === 2) {
			if (integrationData.squareMode === 'manual') {
				return !!(
					integrationData.squareApiKey && integrationData.squareLocationId
				)
			}
			if (integrationData.squareMode === 'copy') {
				return !!integrationData.copySourceTenantId
			}
			return true
		}
		return true
	}
	const handleSubmit = async () => {
		setIsSubmitting(true)
		setError(null)
		try {
			const res = await createTenantWithManifestAction({
				operator: {
					platformId,
					operatorName: basicInfo.operatorName.trim(),
					operatorAlias: basicInfo.operatorAlias.trim() || undefined,
					newOperatorOwnerMethod: basicInfo.ownerMethod,
					newOperatorOwnerId: '',
				},
				manifest: {
					squareMode: integrationData.squareMode,
					squareConfig:
						integrationData.squareMode === 'manual'
							? {
									apiKey: integrationData.squareApiKey ?? '',
									locationId: integrationData.squareLocationId ?? '',
									webhookSignatureKey:
										integrationData.squareWebhookSignatureKey ?? '',
									environment: manifestData.squareEnvironment,
								}
							: undefined,
					copySourceTenantId:
						integrationData.squareMode === 'copy'
							? integrationData.copySourceTenantId
							: undefined,
					platformEnvironment: undefined,
				},
			})
			if (!res.success) {
				setError(res.message ?? 'テナント作成に失敗しました')
				return
			}
			setResult({
				operatorId: res.operatorId!,
				warning: res.message,
			})
		} catch (err) {
			setError(err instanceof Error ? err.message : 'エラーが発生しました')
		} finally {
			setIsSubmitting(false)
		}
	}
	if (result) {
		return (
			<WizardShell>
				<CompletionScreen
					result={result}
					selectedOAuthProviders={effectiveSelectedOAuthProviders}
					router={router}
				/>
			</WizardShell>
		)
	}
	return (
		<WizardShell>
			{/* Stepper - compact on mobile */}
			<div className='mx-auto mb-6 max-w-3xl sm:mb-8'>
				{/* Mobile: simple step indicator */}
				<div className='mb-4 flex items-center justify-center gap-2 sm:hidden'>
					<span className='text-sm font-medium text-zinc-900'>
						ステップ {currentStep + 1} / {STEPS.length}
					</span>
					<span className='text-sm text-zinc-500'>
						— {STEPS[currentStep].label}
					</span>
				</div>
				<div className='mb-2 flex justify-center gap-1.5 sm:hidden'>
					{STEPS.map((step, i) => (
						<div
							key={step.label}
							className={`h-1.5 max-w-[60px] flex-1 rounded-full ${
								i < currentStep
									? 'bg-emerald-600'
									: i === currentStep
										? 'bg-zinc-900'
										: 'bg-zinc-200'
							}`}
						/>
					))}
				</div>
				{/* Desktop: full stepper */}
				<div className='hidden items-center justify-between sm:flex'>
					{STEPS.map((step, i) => (
						<div key={step.label} className='flex flex-1 items-center'>
							<div className='flex flex-col items-center'>
								<div
									className={`flex h-10 w-10 items-center justify-center rounded-full border-2 text-sm font-medium transition-colors ${
										i < currentStep
											? 'border-emerald-600 bg-emerald-600 text-white'
											: i === currentStep
												? 'border-zinc-900 bg-zinc-900 text-white'
												: 'border-zinc-300 bg-white text-zinc-400'
									}`}
								>
									{i < currentStep ? <Check className='h-5 w-5' /> : i + 1}
								</div>
								<div className='mt-2 text-center'>
									<p
										className={`text-xs font-medium ${
											i <= currentStep ? 'text-zinc-900' : 'text-zinc-400'
										}`}
									>
										{step.label}
									</p>
									<p className='text-xs text-zinc-400'>{step.description}</p>
								</div>
							</div>
							{i < STEPS.length - 1 && (
								<div
									className={`mx-2 h-0.5 flex-1 ${
										i < currentStep ? 'bg-emerald-600' : 'bg-zinc-200'
									}`}
								/>
							)}
						</div>
					))}
				</div>
			</div>
			{/* Step Content */}
			<Card className='mx-auto max-w-2xl'>
				<CardHeader>
					<CardTitle>{STEPS[currentStep].label}</CardTitle>
				</CardHeader>
				<CardContent>
					{currentStep === 0 && (
						<StepBasicInfo
							data={basicInfo}
							onChange={setBasicInfo}
							aliasValidation={aliasValidation}
						/>
					)}
					{currentStep === 1 && (
						<StepManifest data={manifestData} onChange={setManifestData} />
					)}
					{currentStep === 2 && (
						<StepIntegration
							data={integrationData}
							onChange={setIntegrationData}
							existingTenants={existingTenants}
							platformSquareConfig={platformSquareConfig}
							oauthProviders={oauthProviders}
						/>
					)}
					{currentStep === 3 && (
						<StepConfirm
							basicInfo={basicInfo}
							manifestData={manifestData}
							integrationData={{
								...integrationData,
								selectedOAuthProviders: effectiveSelectedOAuthProviders,
							}}
							existingTenants={existingTenants}
							platformSquareConfig={platformSquareConfig}
							oauthProviders={oauthProviders}
						/>
					)}
					{error && (
						<p className='mt-4 rounded-md bg-red-50 px-4 py-2 text-sm text-red-700'>
							{error}
						</p>
					)}
				</CardContent>
			</Card>
			{/* Navigation */}
			<div className='mx-auto mt-6 flex max-w-2xl justify-between'>
				<Button
					variant='outline'
					onClick={() => {
						if (currentStep === 0) {
							router.push('/' as Route)
						} else {
							setCurrentStep(s => s - 1)
						}
					}}
				>
					<ArrowLeft className='mr-2 h-4 w-4' />
					{currentStep === 0 ? 'キャンセル' : '戻る'}
				</Button>
				{currentStep < STEPS.length - 1 ? (
					<Button
						onClick={() => setCurrentStep(s => s + 1)}
						disabled={!canGoNext()}
					>
						次へ
						<ArrowRight className='ml-2 h-4 w-4' />
					</Button>
				) : (
					<Button onClick={handleSubmit} disabled={isSubmitting}>
						{isSubmitting && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
						テナントを作成
					</Button>
				)}
			</div>
		</WizardShell>
	)
}

function CompletionScreen({
	result,
	selectedOAuthProviders,
	router,
}: {
	result: { operatorId: string; warning?: string }
	selectedOAuthProviders: string[]
	router: ReturnType<typeof useRouter>
}) {
	const [connectingProvider, setConnectingProvider] = useState<string | null>(
		null,
	)
	const [oauthError, setOauthError] = useState<string | null>(null)
	const [connectedProviders, setConnectedProviders] = useState<string[]>([])

	const pendingProviders = selectedOAuthProviders.filter(
		p => !connectedProviders.includes(p),
	)

	const handleStartOAuth = async (provider: string) => {
		setConnectingProvider(provider)
		setOauthError(null)
		try {
			const res = await getOAuthAuthorizationUrl({
				provider,
				operatorId: result.operatorId,
			})
			if (res.success && res.url) {
				window.location.href = res.url
			} else {
				setOauthError(res.message ?? 'OAuth認証URLの取得に失敗しました')
				setConnectingProvider(null)
			}
		} catch {
			setOauthError('OAuth認証の開始に失敗しました')
			setConnectingProvider(null)
		}
	}

	const handleSkipOAuth = (provider: string) => {
		setConnectedProviders(prev => [...prev, provider])
	}

	return (
		<Card className='mx-auto max-w-2xl'>
			<CardContent className='pt-6'>
				<div className='flex flex-col items-center gap-4 py-8'>
					<div className='flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100'>
						<Check className='h-8 w-8 text-emerald-600' />
					</div>
					<h2 className='text-xl font-semibold'>テナントを作成しました</h2>
					<p className='text-sm text-muted-foreground'>
						Tenant ID: {result.operatorId}
					</p>
					{result.warning && (
						<p className='rounded-md bg-amber-50 px-4 py-2 text-sm text-amber-700'>
							{result.warning}
						</p>
					)}

					{/* OAuth connection section */}
					{pendingProviders.length > 0 && (
						<div className='mt-4 w-full max-w-md'>
							<h3 className='mb-3 text-center text-sm font-semibold'>
								外部サービスとのOAuth連携
							</h3>
							<p className='mb-4 text-center text-xs text-muted-foreground'>
								選択したサービスのOAuth認証を開始します。外部サービスの認証画面にリダイレクトされます。
							</p>
							<div className='grid gap-2'>
								{pendingProviders.map(provider => (
									<div
										key={provider}
										className='flex items-center justify-between rounded-md border border-zinc-200 p-3'
									>
										<span className='text-sm font-medium'>
											{PROVIDER_LABELS[provider] ?? provider}
										</span>
										<div className='flex gap-2'>
											<Button
												variant='ghost'
												size='sm'
												onClick={() => handleSkipOAuth(provider)}
												disabled={connectingProvider !== null}
											>
												スキップ
											</Button>
											<Button
												size='sm'
												onClick={() => handleStartOAuth(provider)}
												disabled={connectingProvider !== null}
											>
												{connectingProvider === provider ? (
													<Loader2 className='mr-1 h-3 w-3 animate-spin' />
												) : (
													<ExternalLink className='mr-1 h-3 w-3' />
												)}
												認証を開始
											</Button>
										</div>
									</div>
								))}
							</div>
							{oauthError && (
								<p className='mt-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700'>
									{oauthError}
								</p>
							)}
						</div>
					)}

					{connectedProviders.length > 0 && pendingProviders.length === 0 && (
						<p className='text-xs text-muted-foreground'>
							OAuth連携の設定が完了しました。後からテナント設定で変更できます。
						</p>
					)}

					<div className='flex gap-3 pt-4'>
						<Button variant='outline' asChild>
							<Link href={'/' as Route}>テナント一覧に戻る</Link>
						</Button>
						<Button
							onClick={() => {
								router.push(`/${result.operatorId}/home` as Route)
							}}
						>
							テナントを開く
						</Button>
					</div>
				</div>
			</CardContent>
		</Card>
	)
}

function WizardShell({ children }: { children: React.ReactNode }) {
	return (
		<div className='flex min-h-screen w-full'>
			{/* Left branding panel */}
			<div className='hidden w-80 shrink-0 flex-col justify-between bg-zinc-900 p-10 lg:flex'>
				<TachyonFieldLogo tone='dark' markClassName='h-8' />
				<div className='flex flex-col gap-2'>
					<p className='text-lg font-normal text-white'>新規テナントを作成</p>
					<p className='text-sm font-normal text-white/60'>
						ウィザード形式で設定を進めます
					</p>
				</div>
			</div>
			{/* Main content */}
			<div className='flex flex-1 flex-col bg-gradient-to-br from-zinc-50 to-zinc-100'>
				<header className='flex items-center justify-between border-b border-zinc-200 px-6 py-4 lg:px-10'>
					<TachyonFieldLogo className='lg:hidden' markClassName='h-6' />
					<div className='hidden lg:block' />
					<Button variant='ghost' size='sm' asChild>
						<Link href={'/' as Route}>テナント一覧に戻る</Link>
					</Button>
				</header>
				<main className='flex-1 px-6 py-8 lg:px-10'>{children}</main>
			</div>
		</div>
	)
}
