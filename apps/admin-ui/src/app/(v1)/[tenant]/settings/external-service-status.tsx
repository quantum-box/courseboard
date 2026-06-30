'use client'

import { Badge } from 'components/ui/badge'
import { Button } from 'components/ui/button'
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from 'components/ui/card'
import { useToast } from 'components/ui/use-toast'
import { useAdminI18n } from 'lib/admin-i18n'
import {
	CheckCircleIcon,
	CloudIcon,
	CreditCardIcon,
	CpuIcon,
	GlobeIcon,
	Loader2Icon,
	RefreshCwIcon,
	XCircleIcon,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import {
	type ExternalServiceStatus,
	type ProviderStatus,
	type SquareSyncResult,
	fetchExternalServiceStatusAction,
	syncProductsAction,
} from './action'
import { ExternalServiceFetchError } from './external-service-fetch-error'

const MAX_VISIBLE_ERRORS = 5

function getProviderTypeLabel(type: string, t: ReturnType<typeof useAdminI18n>['t']): string {
	switch (type) {
		case 'ai':
			return 'AI'
		case 'payment':
			return t('external.payment')
		case 'web':
			return 'Web'
		case 'crm':
			return 'CRM'
		default:
			return type
	}
}

function getProviderTypeIcon(type: string) {
	switch (type) {
		case 'ai':
			return CpuIcon
		case 'payment':
			return CreditCardIcon
		case 'web':
			return GlobeIcon
		default:
			return CloudIcon
	}
}

function getDefinedAtLabel(
	definedAt: string | null,
	t: ReturnType<typeof useAdminI18n>['t'],
): string {
	switch (definedAt) {
		case 'OPERATOR':
			return t('external.tenant')
		case 'PLATFORM':
			return t('external.platform')
		case 'HOST':
			return t('external.host')
		default:
			return t('external.notConfigured')
	}
}

function getDefinedAtVariant(
	definedAt: string | null,
): 'default' | 'secondary' | 'outline' {
	switch (definedAt) {
		case 'OPERATOR':
			return 'default'
		case 'PLATFORM':
		case 'HOST':
			return 'secondary'
		default:
			return 'outline'
	}
}

function ProviderRow({ provider }: { provider: ProviderStatus }) {
	const { t } = useAdminI18n()
	const Icon = getProviderTypeIcon(provider.providerType)
	const isConfigured = provider.definedAt !== null

	return (
		<div className='flex items-center justify-between py-3 border-b last:border-b-0'>
			<div className='flex items-center gap-3'>
				<Icon className='h-5 w-5 text-muted-foreground' />
				<div>
					<p className='text-sm font-medium'>{provider.name}</p>
					<p className='text-xs text-muted-foreground'>
						{getProviderTypeLabel(provider.providerType, t)}
					</p>
				</div>
			</div>
			<div className='flex items-center gap-2'>
				{isConfigured ? (
					<>
						<CheckCircleIcon className='h-4 w-4 text-green-500' />
						<Badge variant={getDefinedAtVariant(provider.definedAt)}>
							{getDefinedAtLabel(provider.definedAt, t)}
						</Badge>
					</>
				) : (
					<>
						<XCircleIcon className='h-4 w-4 text-gray-400' />
						<Badge variant='outline'>{t('external.notConfigured')}</Badge>
					</>
				)}
			</div>
		</div>
	)
}

function SyncStatusMessage({
	status,
	message,
	result,
}: {
	status: 'idle' | 'syncing' | 'success' | 'error'
	message?: string
	result?: SquareSyncResult
}) {
	const { t } = useAdminI18n()
	if (status === 'idle') return null

	const visibleErrors = result?.errors.slice(0, MAX_VISIBLE_ERRORS) ?? []
	const remainingErrors = Math.max(
		(result?.errors.length ?? 0) - visibleErrors.length,
		0,
	)

	return (
		<div
			className={`mt-3 p-3 rounded-lg text-sm ${
				status === 'syncing'
					? 'bg-blue-50 text-blue-700'
					: status === 'success'
						? 'bg-green-50 text-green-700'
						: 'bg-red-50 text-red-700'
			}`}
		>
			{status === 'syncing' && (
				<span className='flex items-center gap-2'>
					<Loader2Icon className='h-4 w-4 animate-spin' />
					{t('external.syncing')}
				</span>
			)}
			{status === 'success' && (
				<div className='space-y-2'>
					{message && <p>{message}</p>}
					{result && (
						<dl className='grid grid-cols-3 gap-2 text-xs'>
							<div>
								<dt className='text-muted-foreground'>{t('external.products')}</dt>
								<dd className='font-medium'>{result.syncedProducts}</dd>
							</div>
							<div>
								<dt className='text-muted-foreground'>
									{t('external.variants')}
								</dt>
								<dd className='font-medium'>{result.syncedVariants}</dd>
							</div>
							<div>
								<dt className='text-muted-foreground'>{t('external.skipped')}</dt>
								<dd className='font-medium'>{result.skipped}</dd>
							</div>
						</dl>
					)}
					{visibleErrors.length > 0 && (
						<div className='text-xs text-red-700'>
							<p className='font-medium mb-1'>{t('external.errorDetails')}</p>
							<ul className='list-disc pl-4 space-y-0.5'>
								{visibleErrors.map(err => (
									<li key={`${err.objectId}-${err.kind}`}>
										<span className='font-mono'>{err.objectId}</span> [
										{err.kind}]{err.message ? `: ${err.message}` : ''}
									</li>
								))}
								{remainingErrors > 0 && (
									<li>
										{t('external.moreErrors')} {remainingErrors}
									</li>
								)}
							</ul>
						</div>
					)}
				</div>
			)}
			{status === 'error' && (message || t('external.syncFailed'))}
		</div>
	)
}

export function ExternalServiceStatusCard({
	tenantId,
	initialData,
	initialError,
}: {
	tenantId: string
	initialData: ExternalServiceStatus | null
	initialError?: string
}) {
	const { t } = useAdminI18n()
	const { toast } = useToast()
	const [data, setData] = useState<ExternalServiceStatus | null>(initialData)
	const [loadError, setLoadError] = useState<string | undefined>(initialError)
	const [loading, setLoading] = useState(false)
	const [syncStatus, setSyncStatus] = useState<
		'idle' | 'syncing' | 'success' | 'error'
	>('idle')
	const [syncMessage, setSyncMessage] = useState<string>()
	const [syncResult, setSyncResult] = useState<SquareSyncResult>()

	useEffect(() => {
		if (!initialError) return
		toast({
			variant: 'destructive',
			title: t('external.fetchFailed'),
			description: initialError,
		})
	}, [initialError, toast, t])

	const refreshStatus = useCallback(async () => {
		setLoading(true)
		try {
			const result = await fetchExternalServiceStatusAction(tenantId)
			if (result.success && result.data) {
				setData(result.data)
				setLoadError(undefined)
			} else {
				const message =
					result.message ??
					t('external.fetchRetry')
				setLoadError(message)
				toast({
					variant: 'destructive',
					title: t('external.fetchFailed'),
					description: message,
				})
			}
		} catch {
			const message = t('external.fetchNetwork')
			setLoadError(message)
			toast({
				variant: 'destructive',
				title: t('external.fetchFailed'),
				description: message,
			})
		} finally {
			setLoading(false)
		}
	}, [tenantId, toast, t])

	const handleSync = useCallback(async () => {
		setSyncStatus('syncing')
		setSyncMessage(undefined)
		setSyncResult(undefined)
		try {
			const result = await syncProductsAction(tenantId)
			if (result.success) {
				setSyncStatus('success')
				setSyncMessage(result.message)
				setSyncResult(result.data)
			} else {
				setSyncStatus('error')
				setSyncMessage(result.message)
			}
		} catch {
			setSyncStatus('error')
			setSyncMessage(t('external.syncError'))
		}
	}, [tenantId, t])

	const paymentProviders =
		data?.providers.filter(p => p.providerType === 'payment') ?? []
	const aiProviders = data?.providers.filter(p => p.providerType === 'ai') ?? []
	const otherProviders =
		data?.providers.filter(
			p => p.providerType !== 'payment' && p.providerType !== 'ai',
		) ?? []
	const oauthProviders = data?.connectedOAuthProviders ?? []

	return (
		<div className='space-y-4'>
			<Card>
				<CardHeader>
					<div className='flex items-center justify-between'>
						<div>
							<CardTitle>{t('external.title')}</CardTitle>
							<CardDescription>{t('external.description')}</CardDescription>
						</div>
						<Button
							variant='outline'
							size='sm'
							onClick={refreshStatus}
							disabled={loading}
						>
							{loading ? (
								<Loader2Icon className='h-4 w-4 animate-spin' />
							) : (
								<RefreshCwIcon className='h-4 w-4' />
							)}
							<span className='ml-1.5'>{t('external.refresh')}</span>
						</Button>
					</div>
				</CardHeader>
				<CardContent>
					{!data ? (
						<ExternalServiceFetchError
							loadError={loadError}
							loading={loading}
							onRefresh={refreshStatus}
						/>
					) : (
						<div className='space-y-6'>
							{loadError ? (
								<div className='rounded-lg border border-destructive/30 bg-destructive/5 p-3'>
									<p className='text-sm text-destructive'>{loadError}</p>
								</div>
							) : null}

							{oauthProviders.length > 0 && (
								<div>
									<h3 className='text-sm font-medium mb-2'>
										{t('external.oauth')}
									</h3>
									<div className='flex flex-wrap gap-2'>
										{oauthProviders.map(name => (
											<Badge key={name} variant='default'>
												<CheckCircleIcon className='h-3 w-3 mr-1' />
												{name}
											</Badge>
										))}
									</div>
								</div>
							)}

							{paymentProviders.length > 0 && (
								<div>
									<h3 className='text-sm font-medium mb-2'>
										{t('external.paymentServices')}
									</h3>
									<div className='rounded-lg border'>
										{paymentProviders.map(p => (
											<ProviderRow key={p.name} provider={p} />
										))}
									</div>
								</div>
							)}

							{aiProviders.length > 0 && (
								<div>
									<h3 className='text-sm font-medium mb-2'>
										{t('external.aiServices')}
									</h3>
									<div className='rounded-lg border'>
										{aiProviders.map(p => (
											<ProviderRow key={p.name} provider={p} />
										))}
									</div>
								</div>
							)}

							{otherProviders.length > 0 && (
								<div>
									<h3 className='text-sm font-medium mb-2'>
										{t('external.otherServices')}
									</h3>
									<div className='rounded-lg border'>
										{otherProviders.map(p => (
											<ProviderRow key={p.name} provider={p} />
										))}
									</div>
								</div>
							)}

							{data.providers.length === 0 && (
								<p className='text-sm text-muted-foreground'>
									{t('external.noServices')}
								</p>
							)}
						</div>
					)}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>{t('external.squareSyncTitle')}</CardTitle>
					<CardDescription>{t('external.squareSyncDescription')}</CardDescription>
				</CardHeader>
				<CardContent>
					<div className='flex items-center gap-3'>
						<Button onClick={handleSync} disabled={syncStatus === 'syncing'}>
							{syncStatus === 'syncing' ? (
								<Loader2Icon className='h-4 w-4 animate-spin mr-2' />
							) : (
								<RefreshCwIcon className='h-4 w-4 mr-2' />
							)}
							{t('external.squareSyncButton')}
						</Button>
					</div>
					<SyncStatusMessage
						status={syncStatus}
						message={syncMessage}
						result={syncResult}
					/>
				</CardContent>
			</Card>
		</div>
	)
}
