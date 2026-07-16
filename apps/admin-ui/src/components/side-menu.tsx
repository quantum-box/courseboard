'use client'

import { Button } from 'components/ui/button'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from 'components/ui/dropdown-menu'
import {
	Sheet,
	SheetClose,
	SheetContent,
	SheetTrigger,
} from 'components/ui/sheet'
import {
	AlertTriangleIcon,
	AppWindowIcon,
	BotIcon,
	BriefcaseBusinessIcon,
	BuildingIcon,
	CheckCircleIcon,
	ChevronLeftIcon,
	ChevronDownIcon,
	ClipboardCheckIcon,
	CreditCardIcon,
	FileTextIcon,
	FileSearchIcon,
	FolderIcon,
	KeyIcon,
	LineChartIcon,
	LogOutIcon,
	BarChart3Icon,
	CalendarCheckIcon,
	CalculatorIcon,
	InfoIcon,
	type LucideProps,
	PackageIcon,
	PanelLeftIcon,
	PinIcon,
	ReceiptTextIcon,
	ScrollTextIcon,
	SettingsIcon,
	ShieldCheckIcon,
	ShoppingBagIcon,
	ShoppingCartIcon,
	StoreIcon,
	TagIcon,
	UsersIcon,
} from 'lucide-react'
import {
	useAdminI18n,
	type AdminLocale,
	type AdminMessageKey,
} from 'lib/admin-i18n'
import {
	getPinnedNavigationStorageKey,
	normalizePinnedNavigationPaths,
	togglePinnedNavigationPath,
} from 'lib/pinnedNavigation'
import { golfCourseAdminPaths } from 'lib/extension-admin-registry'
import { cn } from 'lib/utils'
import type { Route } from 'next'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { TachyonFieldLogo } from './tachyon-field-logo'

export type IconComponent = React.ForwardRefExoticComponent<
	Omit<LucideProps, 'ref'> & React.RefAttributes<SVGSVGElement>
>

export type MenuItem = {
	key: MenuOptions
	labelKey: AdminMessageKey
	path: string
	/** Hash route in the shared React/Vite/Tauri Courseboard application. */
	courseboardRoute?: string
	icon: IconComponent
	matchExactPaths?: string[]
	matchPrefixes?: string[]
	adminOnly?: boolean
}

export type MenuGroup = {
	key: MenuGroupKey
	labelKey: AdminMessageKey
	items: MenuItem[]
}

type MenuGroupKey =
	| 'customers'
	| 'sales'
	| 'billing'
	| 'master'
	| 'inventory'
	| 'hrm'
	| 'reservations'
	| 'accounting'
	| 'reports'
	| 'extensions'
	| 'settings'

export type MenuOptions =
	| 'home'
	| 'sales-dashboard'
	| 'library'
	| 'consumers'
	| 'orders'
	| 'reservations'
	| 'reservation-settings'
	| 'hrm-staff'
	| 'billing-center'
	| 'saas-subscriptions'
	| 'cancellation-fees'
	| 'inventory'
	| 'procurement'
	| 'deals'
	| 'agent'
	| 'invoices'
	| 'quotations'
	| 'consumer-orders'
	| 'store-pickup'
	| 'coupons'
	| 'imports'
	| 'photon'
	| 'analytics'
	| 'accounting'
	| 'accounting-core'
	| 'ar-ap'
	| 'erp-dashboard'
	| 'erp-reports'
	| 'receipts'
	| 'sales-ledger'
	| 'purchase-ledger'
	| 'vendors'
	| 'purchase-orders'
	| 'expenses'
	| 'evidence'
	| 'journal-classifications'
	| 'tenants'
	| 'billing-accounts'
	| 'audit-logs'
	| 'api-keys'
	| 'account-security'
	| 'users'
	| 'erp-rollout'
	| 'scope'
	| 'extensions'
	| 'golf-simulator'
	| 'settings'

export const dashboardItem: MenuItem = {
	key: 'home',
	labelKey: 'nav.home',
	path: '/home',
	icon: LineChartIcon,
	matchExactPaths: ['/home'],
	matchPrefixes: ['/home', '/dashboard'],
}

export const workspaceSettingsItems: MenuItem[] = [
	{
		key: 'settings',
		labelKey: 'nav.tenant-settings',
		path: '/settings',
		icon: SettingsIcon,
		matchExactPaths: ['/settings'],
	},
	{
		key: 'users',
		labelKey: 'nav.users',
		path: '/settings/users',
		icon: UsersIcon,
		matchPrefixes: ['/settings/users'],
		adminOnly: true,
	},
	{
		key: 'api-keys',
		labelKey: 'nav.api-keys',
		path: '/settings/api-keys',
		icon: KeyIcon,
		matchPrefixes: ['/settings/api-keys'],
	},
	{
		key: 'account-security',
		labelKey: 'nav.account-security',
		path: '/settings/security',
		icon: ShieldCheckIcon,
		matchPrefixes: ['/settings/security'],
	},
	{
		key: 'erp-rollout',
		labelKey: 'nav.erp-rollout',
		path: '/settings/erp-rollout',
		icon: ShieldCheckIcon,
		matchPrefixes: ['/settings/erp-rollout'],
	},
	{
		key: 'scope',
		labelKey: 'nav.scope',
		path: '/settings/scope',
		icon: InfoIcon,
		matchPrefixes: ['/settings/scope'],
	},
	{
		key: 'tenants',
		labelKey: 'nav.tenants',
		path: '/tenants',
		icon: BuildingIcon,
	},
	{
		key: 'billing-accounts',
		labelKey: 'nav.billing-accounts',
		path: '/billing-accounts',
		icon: CreditCardIcon,
	},
]

// フル ERP ナビ定義（温存）。courseboard では下の最小 menuGroups だけを表示する。
export const allMenuGroups: MenuGroup[] = [
	{
		key: 'customers',
		labelKey: 'nav.customers',
		items: [
			{
				key: 'consumers',
				labelKey: 'nav.consumers',
				path: '/library/consumers',
				icon: UsersIcon,
				matchPrefixes: ['/library/consumers'],
			},
			{
				key: 'library',
				labelKey: 'nav.library',
				path: '/library/clients',
				icon: BuildingIcon,
				matchPrefixes: ['/library/clients'],
			},
		],
	},
	{
		key: 'sales',
		labelKey: 'nav.sales',
		items: [
			{
				key: 'agent',
				labelKey: 'nav.agent',
				path: '/agent',
				icon: BotIcon,
				matchPrefixes: ['/agent'],
			},
			{
				key: 'deals',
				labelKey: 'nav.deals',
				path: '/deals',
				icon: BriefcaseBusinessIcon,
				matchPrefixes: ['/deals'],
			},
			{
				key: 'quotations',
				labelKey: 'nav.quotations',
				path: '/quotations',
				icon: FileTextIcon,
				matchPrefixes: ['/quotations'],
			},
			{
				key: 'orders',
				labelKey: 'nav.orders',
				path: '/orders',
				icon: ShoppingCartIcon,
			},
			{
				key: 'consumer-orders',
				labelKey: 'nav.consumer-orders',
				path: '/consumer-orders',
				icon: ShoppingBagIcon,
			},
			{
				key: 'store-pickup',
				labelKey: 'nav.store-pickup',
				path: '/store/pickup',
				icon: StoreIcon,
			},
			{
				key: 'coupons',
				labelKey: 'nav.coupons',
				path: '/store/coupons',
				icon: TagIcon,
			},
		],
	},
	{
		key: 'billing',
		labelKey: 'nav.billing',
		items: [
			{
				key: 'billing-center',
				labelKey: 'nav.billing-center',
				path: '/billing',
				icon: CreditCardIcon,
				matchPrefixes: ['/billing'],
			},
			{
				key: 'saas-subscriptions',
				labelKey: 'nav.saas-subscriptions',
				path: '/saas-subscriptions',
				icon: AppWindowIcon,
				matchPrefixes: ['/saas-subscriptions'],
			},
			{
				key: 'invoices',
				labelKey: 'nav.invoices',
				path: '/invoices',
				icon: FileTextIcon,
				matchPrefixes: ['/invoices'],
			},
			{
				key: 'cancellation-fees',
				labelKey: 'nav.cancellation-fees',
				path: '/cancellation-fees/new',
				icon: CreditCardIcon,
				matchPrefixes: ['/cancellation-fees'],
			},
			{
				key: 'ar-ap',
				labelKey: 'nav.ar-ap',
				path: '/erp/ar-ap',
				icon: CreditCardIcon,
				matchPrefixes: ['/erp/ar-ap'],
			},
			{
				key: 'accounting',
				labelKey: 'nav.revenue-reconciliation',
				path: '/accounting/revenue-reconciliation',
				icon: ReceiptTextIcon,
				matchPrefixes: ['/accounting/revenue-reconciliation'],
			},
		],
	},
	{
		key: 'master',
		labelKey: 'nav.master',
		items: [
			{
				key: 'library',
				labelKey: 'nav.products',
				path: '/library/products',
				icon: FolderIcon,
				matchExactPaths: ['/library'],
				matchPrefixes: ['/library/products'],
			},
			{
				key: 'inventory',
				labelKey: 'nav.locations',
				path: '/inventory/locations',
				icon: StoreIcon,
				matchPrefixes: ['/inventory/locations'],
			},
			{
				key: 'vendors',
				labelKey: 'nav.vendors',
				path: '/erp/vendors',
				icon: BuildingIcon,
				matchPrefixes: ['/erp/vendors'],
			},
		],
	},
	{
		key: 'inventory',
		labelKey: 'nav.inventory',
		items: [
			{
				key: 'inventory',
				labelKey: 'nav.stock',
				path: '/inventory',
				icon: PackageIcon,
				matchExactPaths: ['/inventory'],
			},
			{
				key: 'inventory',
				labelKey: 'nav.low-stock',
				path: '/inventory/low-stock',
				icon: AlertTriangleIcon,
				matchPrefixes: ['/inventory/low-stock'],
			},
			{
				key: 'inventory',
				labelKey: 'nav.transfers',
				path: '/inventory/transfers',
				icon: ShoppingCartIcon,
				matchPrefixes: ['/inventory/transfers'],
			},
			{
				key: 'purchase-orders',
				labelKey: 'nav.purchase-orders',
				path: '/erp/purchase-orders',
				icon: ShoppingCartIcon,
				matchPrefixes: ['/erp/purchase-orders'],
			},
			{
				key: 'procurement',
				labelKey: 'nav.procurement',
				path: '/procurement/deliveries',
				icon: FileTextIcon,
			},
		],
	},
	{
		key: 'hrm',
		labelKey: 'nav.hrm',
		items: [
			{
				key: 'hrm-staff',
				labelKey: 'nav.staff',
				path: '/hrm/staff',
				icon: UsersIcon,
				matchPrefixes: ['/hrm/staff', '/staff'],
			},
		],
	},
	{
		key: 'reservations',
		labelKey: 'nav.reservations',
		items: [
			{
				key: 'reservations',
				labelKey: 'nav.reservations',
				path: '/reservations',
				icon: CalendarCheckIcon,
				matchExactPaths: ['/reservations'],
				matchPrefixes: ['/reservations/rsv_'],
			},
			{
				key: 'reservation-settings',
				labelKey: 'nav.reservation-settings',
				path: '/reservations/settings',
				icon: SettingsIcon,
				matchPrefixes: ['/reservations/settings'],
			},
		],
	},
	{
		key: 'accounting',
		labelKey: 'nav.accounting',
		items: [
			{
				key: 'erp-dashboard',
				labelKey: 'nav.erp-dashboard',
				path: '/erp/dashboard',
				icon: LineChartIcon,
				matchPrefixes: ['/erp/dashboard'],
			},
			{
				key: 'sales-ledger',
				labelKey: 'nav.sales-ledger',
				path: '/erp/sales-ledger',
				icon: ReceiptTextIcon,
				matchPrefixes: ['/erp/sales-ledger'],
			},
			{
				key: 'purchase-ledger',
				labelKey: 'nav.purchase-ledger',
				path: '/erp/purchase-ledger',
				icon: ScrollTextIcon,
				matchPrefixes: ['/erp/purchase-ledger'],
			},
			{
				key: 'journal-classifications',
				labelKey: 'nav.journal-classifications',
				path: '/erp/journal-classifications',
				icon: CheckCircleIcon,
				matchPrefixes: ['/erp/journal-classifications'],
			},
			{
				key: 'evidence',
				labelKey: 'nav.evidence',
				path: '/erp/evidence',
				icon: FileSearchIcon,
				matchPrefixes: ['/erp/evidence'],
			},
			{
				key: 'accounting',
				labelKey: 'nav.monthly-close',
				path: '/accounting/monthly-closing',
				icon: ClipboardCheckIcon,
				matchPrefixes: ['/accounting/monthly-closing'],
			},
			{
				key: 'audit-logs',
				labelKey: 'nav.audit-logs',
				path: '/audit-logs',
				icon: ShieldCheckIcon,
				matchPrefixes: ['/audit-logs', '/erp/audit-logs'],
				adminOnly: true,
			},
		],
	},
	{
		key: 'reports',
		labelKey: 'nav.reports',
		items: [
			{
				key: 'erp-reports',
				labelKey: 'nav.reports-home',
				path: '/reports',
				icon: BarChart3Icon,
				matchExactPaths: ['/reports'],
				matchPrefixes: [],
			},
			{
				key: 'analytics',
				labelKey: 'nav.analytics',
				path: '/reports/sales',
				icon: LineChartIcon,
				matchPrefixes: ['/reports/sales'],
			},
			{
				key: 'analytics',
				labelKey: 'nav.automated-reports',
				path: '/reports/automated',
				icon: BotIcon,
				matchPrefixes: ['/reports/automated'],
			},
			{
				key: 'cancellation-fees',
				labelKey: 'nav.cancellation-fees',
				path: '/reports/cancellation-fees',
				icon: ReceiptTextIcon,
				matchPrefixes: ['/reports/cancellation-fees'],
			},
		],
	},
	{
		key: 'extensions',
		labelKey: 'nav.extensions',
		items: [
			{
				key: 'extensions',
				labelKey: 'nav.tenant-extensions',
				path: '/extensions',
				icon: FolderIcon,
				matchPrefixes: ['/extensions', '/extension-host'],
				adminOnly: true,
			},
			{
				key: 'golf-simulator',
				labelKey: 'nav.golf-simulator',
				path: '/golf-simulator',
				icon: CalculatorIcon,
				matchPrefixes: ['/golf-simulator'],
				adminOnly: true,
			},
		],
	},
]

// courseboard 用の最小ナビ。ゴルフ機能とキャンセル料のみを表示する。
// 他の汎用 ERP メニューは allMenuGroups に温存してあり、必要になれば戻せる。
export const menuGroups: MenuGroup[] = [
	{
		key: 'extensions',
		labelKey: 'nav.golf-course',
		items: [
			{
				key: 'extensions',
				labelKey: 'nav.golf-portal',
				path: golfCourseAdminPaths.portal,
				courseboardRoute: '/golf',
				icon: AppWindowIcon,
				matchExactPaths: [golfCourseAdminPaths.portal],
			},
			{
				key: 'extensions',
				labelKey: 'nav.golf-courses',
				path: golfCourseAdminPaths.courses,
				courseboardRoute: '/golf/courses',
				icon: FolderIcon,
				matchPrefixes: [golfCourseAdminPaths.courses],
			},
			{
				key: 'extensions',
				labelKey: 'nav.golf-reservation-products',
				path: golfCourseAdminPaths.reservationProducts,
				courseboardRoute: '/golf/products',
				icon: CalendarCheckIcon,
				matchPrefixes: [golfCourseAdminPaths.reservationProducts],
			},
			{
				key: 'extensions',
				labelKey: 'nav.golf-caddies',
				path: golfCourseAdminPaths.caddies,
				courseboardRoute: '/golf/caddies',
				icon: UsersIcon,
				matchPrefixes: [golfCourseAdminPaths.caddies],
			},
			{
				key: 'extensions',
				labelKey: 'nav.golf-budgets',
				path: golfCourseAdminPaths.budgets,
				courseboardRoute: '/golf/budgets',
				icon: BarChart3Icon,
				matchPrefixes: [golfCourseAdminPaths.budgets],
			},
			{
				key: 'extensions',
				labelKey: 'nav.golf-policy',
				path: golfCourseAdminPaths.policy,
				courseboardRoute: '/golf/policy',
				icon: SettingsIcon,
				matchPrefixes: [golfCourseAdminPaths.policy],
			},
			{
				key: 'extensions',
				labelKey: 'nav.golf-settlement',
				path: golfCourseAdminPaths.settlement,
				courseboardRoute: '/golf/settlement',
				icon: ReceiptTextIcon,
				matchPrefixes: [golfCourseAdminPaths.settlement],
			},
		],
	},
	{
		key: 'billing',
		labelKey: 'nav.cancellation-fees',
		items: [
			{
				key: 'cancellation-fees',
				labelKey: 'nav.cancellation-fees',
				path: '/cancellation-fees/new',
				courseboardRoute: '/cancellation-fees',
				icon: CreditCardIcon,
				matchPrefixes: ['/cancellation-fees'],
			},
		],
	},
]

export function isAdminRole(role?: string | null) {
	const normalizedRole = normalizeRole(role)
	return (
		normalizedRole === 'OWNER' ||
		normalizedRole === 'FIELD:ADMIN' ||
		normalizedRole === 'ERP:ADMIN'
	)
}

function normalizeRole(role?: string | null) {
	const normalized = role?.trim().toUpperCase() ?? 'GENERAL'
	if (normalized.startsWith('ERP:')) {
		return normalized.replace(/^ERP:/, 'FIELD:')
	}
	return normalized
}

export function buildHref(modePrefix: string, tenantId: string, path: string) {
	return `${modePrefix}/${tenantId}${path}`
}

export function buildMenuItemHref(
	modePrefix: string,
	tenantId: string,
	item: Pick<MenuItem, 'path' | 'courseboardRoute'>,
) {
	if (!item.courseboardRoute) {
		return buildHref(modePrefix, tenantId, item.path)
	}

	const mode = modePrefix === '/sandbox' ? 'sandbox' : 'production'
	return `/courseboard-ui/index.html?tenant=${encodeURIComponent(tenantId)}&mode=${mode}#${item.courseboardRoute}`
}

type MenuEntry = {
	groupKey: MenuGroupKey
	item: MenuItem
}

// ゴルフ機能の nav グループ（アイテムが golf-course 配下を指す）判定。
function isGolfNavGroup(group: MenuGroup): boolean {
	return group.items.some(item =>
		item.path.startsWith('/extensions/golf-course'),
	)
}

// ゴルフ拡張が無効なテナントではゴルフ関連グループを出さない。
export function getNavGroups(isGolfEnabled = true): MenuGroup[] {
	return isGolfEnabled
		? menuGroups
		: menuGroups.filter(group => !isGolfNavGroup(group))
}

function getVisibleMenuEntries(
	userRole?: string | null,
	groups: MenuGroup[] = menuGroups,
) {
	return groups.flatMap(group =>
		group.items
			.filter(item => !item.adminOnly || isAdminRole(userRole))
			.map(item => ({
				groupKey: group.key,
				item,
			})),
	)
}

function usePinnedNavigationPaths(
	modePrefix: string,
	tenantId: string,
	visibleEntries: MenuEntry[],
) {
	const storageKey = useMemo(
		() => getPinnedNavigationStorageKey(modePrefix, tenantId),
		[modePrefix, tenantId],
	)
	const [pinnedPaths, setPinnedPaths] = useState<string[]>([])

	useEffect(() => {
		const storedValue = window.localStorage.getItem(storageKey)
		if (!storedValue) {
			setPinnedPaths([])
			return
		}

		try {
			setPinnedPaths(normalizePinnedNavigationPaths(JSON.parse(storedValue)))
		} catch {
			window.localStorage.removeItem(storageKey)
			setPinnedPaths([])
		}
	}, [storageKey])

	const pinnedEntries = useMemo(() => {
		const entriesByPath = new Map(
			visibleEntries.map(entry => [entry.item.path, entry]),
		)
		return pinnedPaths
			.map(path => entriesByPath.get(path))
			.filter((entry): entry is MenuEntry => Boolean(entry))
	}, [pinnedPaths, visibleEntries])

	const pinnedPathSet = useMemo(() => new Set(pinnedPaths), [pinnedPaths])

	const togglePinnedPath = (path: string) => {
		setPinnedPaths(currentPaths => {
			const nextPaths = togglePinnedNavigationPath(currentPaths, path)
			window.localStorage.setItem(storageKey, JSON.stringify(nextPaths))
			return nextPaths
		})
	}

	return {
		pinnedEntries,
		pinnedPathSet,
		togglePinnedPath,
	}
}

function isItemSelected(
	item: MenuItem,
	current: MenuOptions | undefined,
	pathname: string | null,
	tenantId: string,
) {
	if (!pathname) {
		return current === item.key
	}

	const tenantPath = pathname.split(`/${tenantId}`)[1] ?? pathname
	const exactPaths = item.matchExactPaths ?? []
	const prefixes = item.matchPrefixes ?? [item.path]

	return (
		exactPaths.includes(tenantPath) ||
		prefixes.some(
			path => tenantPath === path || tenantPath.startsWith(`${path}/`),
		)
	)
}

function getActiveGroups(
	selectedMenu: MenuOptions | undefined,
	pathname: string | null,
	tenantId: string,
) {
	return menuGroups
		.filter(group =>
			group.items.some(item =>
				isItemSelected(item, selectedMenu, pathname, tenantId),
			),
		)
		.map(group => group.key)
}

export function NavItem({
	href,
	icon: Icon,
	children,
	className = '',
	collapsed = false,
	isSelected = false,
	onClick,
	externalDocument = false,
}: {
	href: string
	icon?: IconComponent
	children: React.ReactNode | string
	className?: string
	collapsed?: boolean
	isSelected?: boolean
	onClick?: () => void
	externalDocument?: boolean
}) {
	const label = typeof children === 'string' ? children : undefined
	const selectedClassName =
		'bg-foreground text-background hover:bg-foreground/90 hover:text-background'
	const defaultClassName =
		'text-muted-foreground hover:bg-muted hover:text-foreground'

	const content = (
		<>
			{Icon && <Icon className='h-3.5 w-3.5 shrink-0' />}
			{typeof children === 'string' ? (
				<span
					className={`min-w-0 truncate text-[13px] font-medium leading-5 ${
						isSelected ? 'text-background' : 'text-muted-foreground'
					} ${collapsed ? 'sr-only' : ''}`}
				>
					{children}
				</span>
			) : (
				children
			)}
		</>
	)
	const linkClassName = `self-stretch h-7 rounded-md py-1 items-center gap-2 inline-flex transition-colors ${
				isSelected ? selectedClassName : defaultClassName
			} ${
				collapsed ? 'justify-center px-0' : 'justify-start px-2'
			} ${className}`

	if (externalDocument) {
		return (
			<a
				className={linkClassName}
				href={href}
				aria-current={isSelected ? 'page' : undefined}
				title={label}
				onClick={onClick}
			>
				{content}
			</a>
		)
	}

	return (
		<Link
			className={linkClassName}
			href={href as Route}
			prefetch={false}
			aria-current={isSelected ? 'page' : undefined}
			title={label}
			onClick={onClick}
		>
			{content}
		</Link>
	)
}

function NavMenuItemRow({
	closeOnNavigate,
	collapsed,
	href,
	isPinned,
	isSelected,
	item,
	label,
	onTogglePin,
}: {
	closeOnNavigate?: boolean
	collapsed?: boolean
	href: string
	isPinned: boolean
	isSelected: boolean
	item: MenuItem
	label: string
	onTogglePin: (path: string) => void
}) {
	const { t } = useAdminI18n()
	const navItem = (
		<NavItem
			collapsed={collapsed}
			externalDocument={Boolean(item.courseboardRoute)}
			href={href}
			icon={item.icon}
			isSelected={isSelected}
		>
			{label}
		</NavItem>
	)

	if (collapsed) {
		return closeOnNavigate ? (
			<SheetClose asChild>{navItem}</SheetClose>
		) : (
			navItem
		)
	}

	const pinLabel = `${isPinned ? t('nav.unpin') : t('nav.pin')}: ${label}`

	return (
		<div className='group/nav-row grid grid-cols-[minmax(0,1fr)_1.75rem] items-center gap-1'>
			{closeOnNavigate ? <SheetClose asChild>{navItem}</SheetClose> : navItem}
			<Button
				aria-label={pinLabel}
				aria-pressed={isPinned}
				className={cn(
					'h-7 w-7 shrink-0 rounded-md text-muted-foreground transition-opacity hover:text-foreground focus-visible:text-foreground',
					closeOnNavigate
						? 'opacity-100'
						: 'pointer-events-none opacity-0 group-hover/nav-row:pointer-events-auto group-hover/nav-row:opacity-100 group-focus-within/nav-row:pointer-events-auto group-focus-within/nav-row:opacity-100',
					isPinned && 'text-foreground',
				)}
				onClick={() => onTogglePin(item.path)}
				size='icon'
				title={pinLabel}
				type='button'
				variant='ghost'
			>
				<PinIcon className={cn('h-3.5 w-3.5', isPinned && 'fill-current')} />
			</Button>
		</div>
	)
}

function GroupHeader({
	group,
	isActive,
}: {
	group: MenuGroup
	isActive: boolean
}) {
	const { t } = useAdminI18n()

	return (
		<div
			className={`flex h-7 w-full items-center rounded-md px-2 text-left text-[11px] font-semibold ${
				isActive
					? 'bg-muted text-foreground'
					: 'text-muted-foreground'
			}`}
		>
			<span className='truncate'>{t(group.labelKey)}</span>
		</div>
	)
}

function MenuGroupSection({
	group,
	modePrefix,
	tenantId,
	selectedMenu,
	pathname,
	activeGroups,
	pinnedPathSet,
	togglePinnedPath,
	closeOnNavigate,
	collapsed = false,
	userRole,
}: {
	group: MenuGroup
	modePrefix: string
	tenantId: string
	selectedMenu?: MenuOptions
	pathname: string | null
	activeGroups: MenuGroupKey[]
	pinnedPathSet: Set<string>
	togglePinnedPath: (path: string) => void
	closeOnNavigate?: boolean
	collapsed?: boolean
	userRole?: string | null
}) {
	const { t } = useAdminI18n()
	const isActive = activeGroups.includes(group.key)
	const visibleItems = group.items.filter(
		item => !item.adminOnly || isAdminRole(userRole),
	)

	if (visibleItems.length === 0) {
		return null
	}

	return (
		<div className='grid gap-0.5'>
			{collapsed ? null : (
				<GroupHeader group={group} isActive={isActive} />
			)}
			<div className={`grid gap-0.5 ${collapsed ? '' : 'pl-1.5'}`}>
				{visibleItems.map(item => {
					return (
						<NavMenuItemRow
							collapsed={collapsed}
							key={`${group.key}-${item.path}`}
							closeOnNavigate={closeOnNavigate}
							href={buildMenuItemHref(modePrefix, tenantId, item)}
							isSelected={isItemSelected(
								item,
								selectedMenu,
								pathname,
								tenantId,
							)}
							isPinned={pinnedPathSet.has(item.path)}
							item={item}
							label={t(item.labelKey)}
							onTogglePin={togglePinnedPath}
						/>
					)
				})}
			</div>
		</div>
	)
}

function PinnedNavigationSection({
	pinnedEntries,
	pinnedPathSet,
	modePrefix,
	tenantId,
	selectedMenu,
	pathname,
	closeOnNavigate,
	collapsed = false,
	togglePinnedPath,
}: {
	pinnedEntries: MenuEntry[]
	pinnedPathSet: Set<string>
	modePrefix: string
	tenantId: string
	selectedMenu?: MenuOptions
	pathname: string | null
	closeOnNavigate?: boolean
	collapsed?: boolean
	togglePinnedPath: (path: string) => void
}) {
	const { t } = useAdminI18n()

	if (pinnedEntries.length === 0) {
		return null
	}

	return (
		<div className='grid gap-0.5'>
			{collapsed ? null : (
				<div className='flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-semibold text-muted-foreground'>
					<PinIcon className='h-3.5 w-3.5 shrink-0 fill-current' />
					<span className='truncate'>{t('nav.pinned')}</span>
				</div>
			)}
			<div className={`grid gap-0.5 ${collapsed ? '' : 'pl-1.5'}`}>
				{pinnedEntries.map(({ groupKey, item }) => (
					<NavMenuItemRow
						key={`pinned-${groupKey}-${item.path}`}
						closeOnNavigate={closeOnNavigate}
						collapsed={collapsed}
						href={buildMenuItemHref(modePrefix, tenantId, item)}
						isPinned={pinnedPathSet.has(item.path)}
						isSelected={isItemSelected(item, selectedMenu, pathname, tenantId)}
						item={item}
						label={t(item.labelKey)}
						onTogglePin={togglePinnedPath}
					/>
				))}
			</div>
		</div>
	)
}

function GroupedNavigation({
	selectedMenu,
	tenantId,
	modePrefix,
	closeOnNavigate = false,
	collapsed = false,
	userRole,
	isGolfEnabled = true,
}: {
	selectedMenu?: MenuOptions
	tenantId: string
	modePrefix: string
	closeOnNavigate?: boolean
	collapsed?: boolean
	userRole?: string | null
	isGolfEnabled?: boolean
}) {
	const pathname = usePathname()
	const { t } = useAdminI18n()
	const groups = useMemo(() => getNavGroups(isGolfEnabled), [isGolfEnabled])
	const visibleEntries = useMemo(
		() => getVisibleMenuEntries(userRole, groups),
		[userRole, groups],
	)
	const { pinnedEntries, pinnedPathSet, togglePinnedPath } =
		usePinnedNavigationPaths(modePrefix, tenantId, visibleEntries)
	const activeGroups = useMemo(
		() => getActiveGroups(selectedMenu, pathname, tenantId),
		[selectedMenu, pathname, tenantId],
	)
	const dashboardSelected = isItemSelected(
		dashboardItem,
		selectedMenu,
		pathname,
		tenantId,
	)
	const dashboardLink = (
		<NavItem
			collapsed={collapsed}
			href={buildHref(modePrefix, tenantId, dashboardItem.path)}
			icon={dashboardItem.icon}
			isSelected={dashboardSelected}
		>
			{t(dashboardItem.labelKey)}
		</NavItem>
	)

	return (
		<nav
			aria-label={t('nav.global')}
			className='grid gap-1 text-sm font-medium'
		>
			{closeOnNavigate ? (
				<SheetClose asChild>{dashboardLink}</SheetClose>
			) : (
				dashboardLink
			)}
			<PinnedNavigationSection
				closeOnNavigate={closeOnNavigate}
				collapsed={collapsed}
				modePrefix={modePrefix}
				pathname={pathname}
				pinnedEntries={pinnedEntries}
				pinnedPathSet={pinnedPathSet}
				selectedMenu={selectedMenu}
				tenantId={tenantId}
				togglePinnedPath={togglePinnedPath}
			/>
			{groups.map(group => (
				<MenuGroupSection
					key={group.key}
					group={group}
					modePrefix={modePrefix}
					tenantId={tenantId}
					selectedMenu={selectedMenu}
					pathname={pathname}
					activeGroups={activeGroups}
					pinnedPathSet={pinnedPathSet}
					togglePinnedPath={togglePinnedPath}
					closeOnNavigate={closeOnNavigate}
					collapsed={collapsed}
					userRole={userRole}
				/>
			))}
		</nav>
	)
}

function WorkspaceSummary({
	collapsed = false,
	modePrefix,
	tenantName,
	username,
}: {
	collapsed?: boolean
	modePrefix: string
	tenantName?: string | null
	username?: string | null
}) {
	const { t } = useAdminI18n()
	const modeLabel = modePrefix === '/sandbox' ? 'Sandbox' : 'Production'
	const modeClassName =
		modePrefix === '/sandbox'
			? 'bg-amber-100 text-amber-800'
			: 'bg-emerald-600 text-white'
	return (
		<div className={`min-w-0 flex-1 text-left ${collapsed ? 'sr-only' : ''}`}>
			<div className='flex min-w-0 items-center gap-1.5'>
				<div className='min-w-0 truncate text-[11px] font-medium leading-4 text-muted-foreground'>
					{t('common.workspace')}
				</div>
				<span
					className={`shrink-0 rounded-full px-1.5 py-0 text-[10px] font-semibold leading-4 ${modeClassName}`}
				>
					{modeLabel}
				</span>
			</div>
			<div className='flex min-w-0 items-baseline gap-1.5 text-sm font-semibold leading-5'>
				<span className='min-w-0 flex-1 truncate text-foreground'>
					{tenantName ?? 'TACHYON Field'}
				</span>
				{username ? (
					<span className='max-w-20 shrink-0 truncate text-[11px] font-medium leading-4 text-muted-foreground'>
						{username}
					</span>
				) : null}
			</div>
		</div>
	)
}

function AccountFooter({
	collapsed = false,
	modePrefix,
	selectedMenu,
	tenantName,
	tenantId,
	username,
	userRole,
}: {
	collapsed?: boolean
	modePrefix: string
	selectedMenu?: MenuOptions
	tenantName?: string | null
	tenantId: string
	username?: string | null
	userRole?: string | null
}) {
	const { locale, setLocale, t } = useAdminI18n()
	const pathname = usePathname()
	const localeOptions: AdminLocale[] = ['ja', 'en']
	const modeLabel = modePrefix === '/sandbox' ? 'Sandbox' : 'Production'
	const visibleSettingsItems = workspaceSettingsItems.filter(
		item => !item.adminOnly || isAdminRole(userRole),
	)
	const hasSelectedSettingsItem = visibleSettingsItems.some(item =>
		isItemSelected(item, selectedMenu, pathname, tenantId),
	)

	return (
		<div className='border-t px-3 py-2'>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<button
						type='button'
						className={`flex w-full items-center gap-2 rounded-md py-1.5 text-left transition-colors hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring ${
							hasSelectedSettingsItem
								? 'bg-muted text-foreground'
								: 'bg-muted/50'
						} ${collapsed ? 'justify-center px-0' : 'px-2.5'}`}
						title={
							username
								? `${tenantName ?? 'TACHYON Field'} / ${username}`
								: (tenantName ?? 'TACHYON Field')
						}
					>
						{collapsed ? (
							<BuildingIcon className='h-4 w-4 text-muted-foreground' />
						) : null}
						<WorkspaceSummary
							collapsed={collapsed}
							modePrefix={modePrefix}
							tenantName={tenantName}
							username={username}
						/>
						{collapsed ? null : (
							<ChevronDownIcon className='h-4 w-4 shrink-0 text-muted-foreground' />
						)}
					</button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align='start' side='top' className='w-56'>
					<DropdownMenuLabel>{t('common.workspace')}</DropdownMenuLabel>
					<div className='px-2 pb-1 text-sm font-medium'>
						{tenantName ?? 'TACHYON Field'}
					</div>
					<div className='px-2 pb-2 text-xs text-muted-foreground'>
						{modeLabel}
					</div>
					{username ? (
						<div className='px-2 pb-2 text-xs font-medium text-muted-foreground'>
							{username}
						</div>
					) : null}
					<DropdownMenuSeparator />
					<DropdownMenuLabel>{t('nav.settings')}</DropdownMenuLabel>
					{visibleSettingsItems.map(item => {
						const Icon = item.icon
						const isSelected = isItemSelected(
							item,
							selectedMenu,
							pathname,
							tenantId,
						)
						return (
							<DropdownMenuItem asChild key={item.key}>
								<Link
									href={buildHref(modePrefix, tenantId, item.path) as Route}
									prefetch={false}
									className={`flex w-full items-center gap-2 ${
										isSelected ? 'bg-muted font-medium text-foreground' : ''
									}`}
								>
									<Icon className='h-4 w-4' />
									<span>{t(item.labelKey)}</span>
								</Link>
							</DropdownMenuItem>
						)
					})}
					<DropdownMenuSeparator />
					<DropdownMenuLabel>{t('language.title')}</DropdownMenuLabel>
					<div className='grid grid-cols-2 gap-1 px-2 py-1'>
						{localeOptions.map(option => (
							<button
								key={option}
								type='button'
								onClick={() => setLocale(option)}
								className={`min-h-8 rounded px-2 text-xs font-medium transition-colors ${
									locale === option
										? 'bg-foreground text-background'
										: 'text-muted-foreground hover:bg-muted hover:text-foreground'
								}`}
								aria-pressed={locale === option}
							>
								{t(`language.${option}`)}
							</button>
						))}
					</div>
					<DropdownMenuSeparator />
					<DropdownMenuItem asChild>
						<Link
							href='/auth/sign_out'
							prefetch={false}
							className='flex w-full items-center gap-2'
						>
							<LogOutIcon className='h-4 w-4' />
							<span>{t('common.logout')}</span>
						</Link>
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	)
}

export function GlobalNavigation({
	selectedMenu,
	tenantId,
	modePrefix,
	tenantName: _tenantName,
	userRole,
	isGolfEnabled = true,
}: {
	selectedMenu?: MenuOptions
	tenantId: string
	modePrefix: string
	tenantName?: string | null
	userRole?: string | null
	isGolfEnabled?: boolean
}) {
	const { t } = useAdminI18n()
	return (
		<div className='border-b bg-background px-3 py-2 sm:px-6'>
			<div className='flex gap-3 overflow-x-auto pb-1 md:flex-wrap md:overflow-visible'>
				<div className='w-36 shrink-0'>
					<GroupedNavigation
						selectedMenu={selectedMenu}
						tenantId={tenantId}
						modePrefix={modePrefix}
						userRole={userRole}
						isGolfEnabled={isGolfEnabled}
					/>
				</div>
			</div>
		</div>
	)
}

/**
 * デスクトップ用のメニューを表示するコンポーネント
 */
export function SideMenu({
	isOpen = true,
	isPreview = false,
	isGolfEnabled = true,
	onMouseLeave,
	onRequestClose,
	onRequestPin,
	navigationSearch,
	selectedMenu,
	tenantId,
	modePrefix,
	tenantName,
	username,
	userRole,
}: {
	isOpen?: boolean
	isPreview?: boolean
	isGolfEnabled?: boolean
	onMouseLeave?: () => void
	onRequestClose?: () => void
	onRequestPin?: () => void
	navigationSearch?: React.ReactNode
	selectedMenu?: MenuOptions
	tenantId: string
	modePrefix: string
	tenantName?: string | null
	username?: string | null
	userRole?: string | null
}) {
	const { t } = useAdminI18n()
	return (
		<aside
			className={`fixed inset-y-0 left-0 z-30 hidden w-64 flex-col overflow-hidden border-r bg-background shadow-lg transition-transform duration-200 sm:flex ${
				isOpen ? 'translate-x-0' : 'pointer-events-none -translate-x-full'
			}`}
			onMouseLeave={onMouseLeave}
		>
			<div className='flex min-h-16 items-center justify-between gap-3 border-b px-4 py-3'>
				<Link
					href={`${modePrefix}/${tenantId}/home` as Route}
					prefetch={false}
					className='block min-w-0 rounded-md px-1 py-1 transition-colors hover:bg-muted'
				>
					<TachyonFieldLogo markClassName='h-6' />
					<div className='text-xs font-medium text-muted-foreground'>
						{t('common.adminConsole')}
					</div>
				</Link>
				<div className='flex shrink-0 items-center gap-1'>
					{isPreview ? (
						<Button
							aria-label='サイドバーを固定する'
							className='h-8 w-8'
							onClick={onRequestPin}
							size='icon'
							title='サイドバーを固定する'
							type='button'
							variant='ghost'
						>
							<PinIcon className='h-4 w-4' />
						</Button>
					) : null}
					<Button
						aria-label='サイドバーを閉じる'
						className='h-8 w-8'
						onClick={onRequestClose}
						size='icon'
						title='サイドバーを閉じる'
						type='button'
						variant='ghost'
					>
						<ChevronLeftIcon className='h-4 w-4' />
					</Button>
				</div>
			</div>
			{navigationSearch ? (
				<div className='border-b px-3 py-2'>{navigationSearch}</div>
			) : null}
			<div className='flex-1 overflow-y-auto px-3 py-2.5'>
				<GroupedNavigation
					selectedMenu={selectedMenu}
					tenantId={tenantId}
					modePrefix={modePrefix}
					userRole={userRole}
					isGolfEnabled={isGolfEnabled}
				/>
			</div>
			<AccountFooter
				modePrefix={modePrefix}
				selectedMenu={selectedMenu}
				tenantId={tenantId}
				tenantName={tenantName}
				username={username}
				userRole={userRole}
			/>
		</aside>
	)
}

/**
 * スマートフォン用のメニューを表示するコンポーネント
 */
export function SideMenuSheet({
	navigationSearch,
	selectedMenu,
	tenantId,
	modePrefix,
	tenantName,
	username,
	userRole,
	isGolfEnabled = true,
}: {
	navigationSearch?: React.ReactNode
	selectedMenu?: MenuOptions
	tenantId: string
	modePrefix: string
	tenantName?: string | null
	username?: string | null
	userRole?: string | null
	isGolfEnabled?: boolean
}) {
	const { t } = useAdminI18n()
	return (
		<Sheet>
			<SheetTrigger asChild>
				<Button className='sm:hidden' size='icon' variant='outline'>
					<PanelLeftIcon className='h-5 w-5' />
					<span className='sr-only'>{t('common.menuToggle')}</span>
				</Button>
			</SheetTrigger>
			<SheetContent
				className='flex h-full flex-col p-0 sm:max-w-xs'
				side='left'
			>
				<div className='border-b px-4 py-3'>
					<SheetClose asChild>
						<Link
							href={`${modePrefix}/${tenantId}/home` as Route}
							prefetch={false}
							className='block rounded-md px-1 py-1 transition-colors hover:bg-muted'
						>
							<TachyonFieldLogo markClassName='h-6' />
							<div className='text-xs font-medium text-muted-foreground'>
								{t('common.adminConsole')}
							</div>
						</Link>
					</SheetClose>
				</div>
				{navigationSearch ? (
					<div className='border-b px-3 py-2'>{navigationSearch}</div>
				) : null}
				<div className='flex-1 overflow-y-auto px-3 py-2.5'>
					<GroupedNavigation
						selectedMenu={selectedMenu}
						tenantId={tenantId}
						modePrefix={modePrefix}
						closeOnNavigate
						userRole={userRole}
						isGolfEnabled={isGolfEnabled}
					/>
				</div>
				<AccountFooter
					modePrefix={modePrefix}
					selectedMenu={selectedMenu}
					tenantId={tenantId}
					tenantName={tenantName}
					username={username}
					userRole={userRole}
				/>
			</SheetContent>
		</Sheet>
	)
}
