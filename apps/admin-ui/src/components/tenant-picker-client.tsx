'use client'

import { TenantPickerList } from 'components/tenant-picker-list'
import { getRootTenantOptions } from 'app/root-tenant-redirect'
import { OPERATOR_IDS, PLATFORM_IDS, type TachyonFieldMode } from 'lib/mode'
import {
	FIELD_ADMIN_TENANT_ACCESS_ACTION,
	dedupeTenants,
	normalizeTenantListResponse,
	withTenantMode,
	type Tenant,
} from 'lib/tenant-list'
import { getBackendBaseUrl } from 'lib/backendUrl'
import { useEffect, useState } from 'react'

const KNOWN_MODES: TachyonFieldMode[] = ['production', 'sandbox']

type TenantPickerState =
	| { status: 'loading' }
	| { status: 'loaded'; tenants: Tenant[] }
	| { status: 'error'; message: string }

export class BrowserTenantFetchError extends Error {
	status: number

	constructor(status: number, message: string) {
		super(`Failed to fetch tenants: ${status} ${message}`)
		this.name = 'BrowserTenantFetchError'
		this.status = status
	}
}

type FieldTokenResponse = {
	accessToken?: string
}

function resolveBrowserFetch(fetchImpl?: typeof fetch): typeof fetch {
	if (fetchImpl) return fetchImpl
	if (typeof window !== 'undefined' && typeof window.fetch === 'function') {
		return window.fetch.bind(window)
	}
	return fetch.bind(globalThis)
}

export async function fetchFieldAccessToken(
	force = false,
	fetchImpl?: typeof fetch,
): Promise<string> {
	const browserFetch = resolveBrowserFetch(fetchImpl)
	const res = await browserFetch('/api/auth/field-token', {
		body: JSON.stringify({ force }),
		headers: { 'content-type': 'application/json' },
		method: 'POST',
	})
	if (!res.ok) {
		throw new BrowserTenantFetchError(
			res.status,
			res.statusText || 'Unable to refresh access token',
		)
	}
	const data = (await res.json()) as FieldTokenResponse
	if (!data.accessToken) {
		throw new BrowserTenantFetchError(401, 'Unable to refresh access token')
	}
	return data.accessToken
}

async function fetchTenantsForMode(options: {
	backendBaseUrl: string
	fetchImpl: typeof fetch
	mode: TachyonFieldMode
	token: string
}): Promise<Tenant[]> {
	const url = new URL('/get_tenants', options.backendBaseUrl)
	url.searchParams.set('required_action', FIELD_ADMIN_TENANT_ACCESS_ACTION)
	const res = await options.fetchImpl(url.toString(), {
		cache: 'no-store',
		headers: {
			Authorization: `Bearer ${options.token}`,
			'x-platform-id': PLATFORM_IDS[options.mode],
			'x-operator-id': OPERATOR_IDS[options.mode],
		},
		method: 'POST',
	})

	if (!res.ok) {
		const body = (await res.json().catch(() => ({}))) as { message?: string }
		throw new BrowserTenantFetchError(
			res.status,
			body.message ?? res.statusText,
		)
	}

	return normalizeTenantListResponse(await res.json()).map(withTenantMode)
}

async function fetchTenantsWithToken(options: {
	backendBaseUrl: string
	fetchImpl: typeof fetch
	token: string
}): Promise<Tenant[]> {
	const results = await Promise.allSettled(
		KNOWN_MODES.map(mode =>
			fetchTenantsForMode({
				...options,
				mode,
			}),
		),
	)
	const tenants = results.flatMap(result =>
		result.status === 'fulfilled' ? result.value : [],
	)
	const nonAuthorizationFailures = results.filter(
		(result): result is PromiseRejectedResult =>
			result.status === 'rejected' &&
			!(
				result.reason instanceof BrowserTenantFetchError &&
				(result.reason.status === 401 || result.reason.status === 403)
			),
	)

	if (nonAuthorizationFailures.length > 0) {
		throw nonAuthorizationFailures[0].reason
	}
	if (tenants.length > 0) {
		return dedupeTenants(tenants)
	}
	for (const result of results) {
		if (result.status === 'rejected') {
			throw result.reason
		}
	}
	return []
}

export async function fetchTenantsFromBrowser(
	options: {
		backendBaseUrl?: string
		fetchImpl?: typeof fetch
	} = {},
): Promise<Tenant[]> {
	const fetchImpl = resolveBrowserFetch(options.fetchImpl)
	const backendBaseUrl = options.backendBaseUrl ?? getBackendBaseUrl()
	let token = await fetchFieldAccessToken(false, fetchImpl)
	try {
		return await fetchTenantsWithToken({ backendBaseUrl, fetchImpl, token })
	} catch (error) {
		if (!(error instanceof BrowserTenantFetchError) || error.status !== 401) {
			throw error
		}
		token = await fetchFieldAccessToken(true, fetchImpl)
		return fetchTenantsWithToken({ backendBaseUrl, fetchImpl, token })
	}
}

export function TenantPickerClient() {
	const [state, setState] = useState<TenantPickerState>({ status: 'loading' })

	useEffect(() => {
		let cancelled = false
		fetchTenantsFromBrowser()
			.then(tenants => {
				if (!cancelled) {
					setState({ status: 'loaded', tenants: getRootTenantOptions(tenants) })
				}
			})
			.catch(error => {
				if (cancelled) return
				if (error instanceof BrowserTenantFetchError && error.status === 401) {
					window.location.assign('/auth/sign_out?error=expired')
					return
				}
				setState({
					status: 'error',
					message:
						error instanceof Error
							? error.message
							: 'テナント一覧の取得に失敗しました',
				})
			})
		return () => {
			cancelled = true
		}
	}, [])

	if (state.status === 'loading') {
		return (
			<div className='rounded-lg border border-zinc-200 bg-white px-4 py-6 text-sm text-zinc-500'>
				テナント一覧を読み込んでいます...
			</div>
		)
	}

	if (state.status === 'error') {
		return (
			<div
				role='alert'
				className='rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900'
			>
				<div className='font-medium'>テナント一覧を取得できませんでした</div>
				<div className='mt-1 text-red-800'>{state.message}</div>
			</div>
		)
	}

	return <TenantPickerList tenants={state.tenants} />
}
