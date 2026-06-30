'use client'

import { Button } from 'components/ui/button'
import { SideMenu, SideMenuSheet, type MenuOptions } from 'components/side-menu'
import { NavigationCommandPalette } from 'components/navigation-command-palette'
import { PanelRightIcon } from 'lucide-react'
import { RouteProgressBar } from 'components/route-progress-bar'
import { useEffect, useMemo, useState } from 'react'

const SIDEBAR_CLOSED_KEY_PREFIX = 'tachyon-field-admin-sidebar-collapsed'
const TENANT_NAME_KEY_PREFIX = 'tachyon-field-admin-tenant-name'
const TENANT_NAME_EMPTY_CACHE_VALUE = '__tachyon_field_admin_empty_tenant_name__'

export function getSidebarClosedStorageKey(modePrefix: string, tenant: string) {
	const mode = modePrefix === '/sandbox' ? 'sandbox' : 'production'
	return `${SIDEBAR_CLOSED_KEY_PREFIX}:${mode}:${tenant}`
}

export function getTenantNameStorageKey(tenant: string) {
	return `${TENANT_NAME_KEY_PREFIX}:${tenant}`
}

export function encodeTenantNameCacheValue(tenantName: string | null) {
	const normalized = tenantName?.trim()
	return normalized || TENANT_NAME_EMPTY_CACHE_VALUE
}

export function decodeTenantNameCacheValue(value: string | null): {
	hit: boolean
	tenantName: string | null
} {
	if (value === null) {
		return { hit: false, tenantName: null }
	}
	if (value === TENANT_NAME_EMPTY_CACHE_VALUE) {
		return { hit: true, tenantName: null }
	}
	return { hit: true, tenantName: value }
}

export function V1AdminShell({
	breadcrumbs,
	children,
	current,
	modePrefix,
	tenant,
	tenantName,
	username,
	userRole,
}: {
	breadcrumbs?: React.ReactNode
	children: React.ReactNode
	current?: MenuOptions
	modePrefix: string
	tenant: string
	tenantName?: string | null
	username?: string | null
	userRole?: string | null
}) {
	const [isSidebarClosed, setIsSidebarClosed] = useState(false)
	const [isSidebarPreviewOpen, setIsSidebarPreviewOpen] = useState(false)
	const [resolvedTenantName, setResolvedTenantName] = useState(
		tenantName ?? null,
	)
	const isSidebarVisible = !isSidebarClosed || isSidebarPreviewOpen
	const sidebarClosedKey = useMemo(
		() => getSidebarClosedStorageKey(modePrefix, tenant),
		[modePrefix, tenant],
	)
	const tenantNameCacheKey = useMemo(
		() => getTenantNameStorageKey(tenant),
		[tenant],
	)

	useEffect(() => {
		if (tenantName) {
			window.sessionStorage.setItem(
				tenantNameCacheKey,
				encodeTenantNameCacheValue(tenantName),
			)
			setResolvedTenantName(tenantName)
			return
		}

		const cached = decodeTenantNameCacheValue(
			window.sessionStorage.getItem(tenantNameCacheKey),
		)
		setResolvedTenantName(cached.tenantName)
	}, [tenant, tenantName, tenantNameCacheKey])

	useEffect(() => {
		if (tenantName) {
			return
		}
		const cached = decodeTenantNameCacheValue(
			window.sessionStorage.getItem(tenantNameCacheKey),
		)
		if (cached.hit) {
			return
		}

		let cancelled = false
		const timeoutId = window.setTimeout(() => {
			fetch(`/api/tenant-name/${encodeURIComponent(tenant)}`)
				.then(async response => {
					if (!response.ok) return { ok: false as const }
					const data = (await response.json().catch(() => null)) as {
						tenantName?: unknown
					} | null
					const name =
						typeof data?.tenantName === 'string'
							? data.tenantName.trim()
							: null
					return { ok: true as const, tenantName: name || null }
				})
				.then(result => {
					if (!cancelled && result.ok) {
						window.sessionStorage.setItem(
							tenantNameCacheKey,
							encodeTenantNameCacheValue(result.tenantName),
						)
						setResolvedTenantName(result.tenantName)
					}
				})
				.catch(() => undefined)
		}, 800)

		return () => {
			cancelled = true
			window.clearTimeout(timeoutId)
		}
	}, [tenant, tenantName, tenantNameCacheKey])

	useEffect(() => {
		setIsSidebarClosed(window.localStorage.getItem(sidebarClosedKey) === 'true')
		setIsSidebarPreviewOpen(false)
	}, [sidebarClosedKey])

	useEffect(() => {
		if (!isSidebarClosed || !isSidebarPreviewOpen) {
			return
		}

		const closeWhenPointerLeavesSidebar = (event: MouseEvent) => {
			if (event.clientX > 280) {
				setIsSidebarPreviewOpen(false)
			}
		}

		window.addEventListener('mousemove', closeWhenPointerLeavesSidebar)
		return () => {
			window.removeEventListener('mousemove', closeWhenPointerLeavesSidebar)
		}
	}, [isSidebarClosed, isSidebarPreviewOpen])

	const openSidebar = () => {
		setIsSidebarClosed(false)
		setIsSidebarPreviewOpen(false)
		window.localStorage.setItem(sidebarClosedKey, 'false')
	}

	const closeSidebar = () => {
		setIsSidebarClosed(true)
		setIsSidebarPreviewOpen(false)
		window.localStorage.setItem(sidebarClosedKey, 'true')
	}

	const openPreviewSidebar = () => {
		if (isSidebarClosed) {
			setIsSidebarPreviewOpen(true)
		}
	}

	const closePreviewSidebar = () => {
		if (isSidebarClosed) {
			setIsSidebarPreviewOpen(false)
		}
	}

	return (
		<div className='flex min-h-screen w-full min-w-0 flex-col overflow-x-hidden bg-muted/40'>
			<RouteProgressBar />
			{isSidebarClosed && !isSidebarPreviewOpen ? (
				<div
					className='fixed inset-y-0 left-0 z-20 hidden w-6 sm:block'
					onMouseEnter={openPreviewSidebar}
				>
					<Button
						aria-label='サイドバーを開く'
						className='pointer-events-auto absolute left-0 top-4 h-10 w-6 rounded-l-none border-l-0 bg-background shadow-sm'
						onClick={openSidebar}
						size='icon'
						title='サイドバーを開く'
						type='button'
						variant='outline'
					>
						<PanelRightIcon className='h-3.5 w-3.5' />
					</Button>
				</div>
			) : null}
			<SideMenu
				isOpen={isSidebarVisible}
				isPreview={isSidebarClosed && isSidebarPreviewOpen}
				modePrefix={modePrefix}
				navigationSearch={
					<NavigationCommandPalette
						buttonClassName='w-full justify-start'
						labelAlwaysVisible
						modePrefix={modePrefix}
						tenantId={tenant}
						userRole={userRole}
					/>
				}
				onMouseLeave={closePreviewSidebar}
				onRequestPin={openSidebar}
				onRequestClose={closeSidebar}
				selectedMenu={current}
				tenantId={tenant}
				tenantName={resolvedTenantName}
				username={username}
				userRole={userRole}
			/>
			<div
				className={`flex min-w-0 flex-col pb-2 transition-[padding] duration-200 sm:pb-4 ${
					isSidebarClosed ? 'sm:pl-0' : 'sm:pl-64'
				}`}
			>
				<header className='sticky top-0 z-30 flex min-h-14 items-center border-b bg-background px-3 sm:hidden'>
					<SideMenuSheet
						modePrefix={modePrefix}
						navigationSearch={
							<NavigationCommandPalette
								buttonClassName='w-full justify-start'
								labelAlwaysVisible
								modePrefix={modePrefix}
								tenantId={tenant}
								userRole={userRole}
							/>
						}
						selectedMenu={current}
						tenantId={tenant}
						tenantName={resolvedTenantName}
						username={username}
						userRole={userRole}
					/>
				</header>

				{breadcrumbs ? (
					<div className='min-w-0 px-3 pt-3 sm:px-6 sm:pt-6'>{breadcrumbs}</div>
				) : null}
				{children}
			</div>
		</div>
	)
}
