import {
  Badge,
  Button,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Kbd,
  Sidebar,
  SidebarAccount,
  SidebarAccountInfo,
  SidebarAvatar,
  SidebarFooter,
  SidebarHeader,
  SidebarItem,
  SidebarItemLabel,
  SidebarSection,
  SidebarSectionLabel,
  Tooltip,
  TooltipContent,
  Toaster,
  TooltipProvider,
  TooltipTrigger,
} from '@tachyon-sdk/native-ui'
import {
  BarChart3,
  BookUser,
  Building2,
  CalendarCheck,
  CalendarDays,
  CalendarRange,
  Calculator,
  Check,
  ChevronsLeft,
  ChevronsRight,
  CircleDollarSign,
  CircleHelp,
  ClipboardCheck,
  Clock,
  CreditCard,
  FolderTree,
  FileSpreadsheet,
  Gauge,
  House,
  IdCard,
  Languages,
  LogOut,
  Map,
  Menu,
  Moon,
  PanelLeft,
  Pin,
  ReceiptText,
  Search,
  Settings,
  Settings2,
  Sun,
  Table2,
  UserRound,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/AuthProvider'
import { formatTenantWorkspaceLabel, tenantWorkspaceLabel } from '../auth/tenant-label'
import { i18next, LOCALES, LOCALE_LABELS, currentLocale, setLocale } from '../i18n'
import { PageReloadProvider, usePageReload } from '../lib/pageReload'
import { navigate, navigateFromClick } from '../lib/router'
import { isPageRefreshShortcut } from '../lib/shortcuts'
import { CourseBoardBrand } from './CourseBoardBrand'
import { WorkspaceHelpPanel } from './WorkspaceHelp'

/** Routes that carry a translated label under the `nav:items` namespace. */
export type NavigationRoute =
  | 'golf'
  | 'golf/ledger'
  | 'golf/customers'
  | 'golf/reservation-report-import'
  | 'golf/timeline'
  | 'golf/products'
  | 'course-map'
  | 'golf/caddies'
  | 'golf/caddies/dispatch'
  | 'golf/caddies/attendance'
  | 'golf/caddies/shifts'
  | 'golf/caddies/payroll'
  | 'golf/budgets'
  | 'golf/settlement'
  | 'golf/simulator'
  | 'cancellation-fees'
  | 'staff'
  | 'golf/courses'
  | 'golf/policy'
  | 'settings/members'

export type NavigationItem = {
  route: NavigationRoute
  icon: LucideIcon
}

export type NavigationSection = {
  /** Matches a key under `nav:sections`; `showLabel: false` renders the group unlabelled. */
  id: 'home' | 'courseBooking' | 'caddie' | 'finance' | 'company' | 'dataIntegration'
  showLabel: boolean
  items: NavigationItem[]
}

export const navigationSections: NavigationSection[] = [
  {
    id: 'home',
    showLabel: false,
    items: [{ route: 'golf', icon: Gauge }],
  },
  {
    id: 'courseBooking',
    showLabel: true,
    items: [
      // The ledger is the start desk's board; the timeline is the caddie view
      // of the same day, so the ledger comes first.
      { route: 'golf/ledger', icon: Table2 },
      { route: 'golf/timeline', icon: CalendarRange },
      // The ledger of people, beside the ledger of tee times. Members are read
      // off it, and a visitor's second visit only registers because it exists.
      { route: 'golf/customers', icon: BookUser },
      { route: 'golf/products', icon: CalendarCheck },
      // Courses stopped being a one-time master when the bookable week moved
      // onto them: opening hours and tee-time generation are seasonal work.
      { route: 'golf/courses', icon: FolderTree },
    ],
  },
  {
    id: 'caddie',
    showLabel: true,
    items: [
      { route: 'golf/caddies', icon: Users },
      { route: 'golf/caddies/dispatch', icon: ClipboardCheck },
      { route: 'golf/caddies/attendance', icon: Clock },
      { route: 'golf/caddies/shifts', icon: CalendarDays },
      { route: 'golf/caddies/payroll', icon: CircleDollarSign },
    ],
  },
  {
    id: 'company',
    showLabel: true,
    items: [{ route: 'staff', icon: IdCard }],
  },
  {
    id: 'finance',
    showLabel: true,
    items: [
      { route: 'golf/budgets', icon: BarChart3 },
      { route: 'golf/settlement', icon: ReceiptText },
      { route: 'golf/simulator', icon: Calculator },
      { route: 'cancellation-fees', icon: CreditCard },
    ],
  },
  {
    id: 'dataIntegration',
    showLabel: true,
    items: [{ route: 'golf/reservation-report-import', icon: FileSpreadsheet }],
  },
]

/**
 * Screens kept available by direct links, the home screen, and search, but not
 * promoted in the daily sidebar. The timeline may return here when the start
 * desk workflow has a clear owner and purpose.
 */
const sidebarHiddenRoutes = new Set<NavigationRoute>(['golf/timeline'])

export const sidebarNavigationSections: NavigationSection[] = navigationSections
  .map(section => ({
    ...section,
    items: section.items.filter(item => !sidebarHiddenRoutes.has(item.route)),
  }))
  .filter(section => section.items.length > 0)

/**
 * Rarely-touched tenant masters live under Settings, not the daily sidebar.
 * Kept searchable via ⌘K and linked from the settings hub.
 */
export const settingsNavigation: NavigationItem[] = [
  { route: 'golf/policy', icon: Settings2 },
  { route: 'course-map', icon: Map },
  { route: 'settings/members', icon: UserRound },
]

/** Navigation copy is looked up at render time so it follows the active locale. */
export function navLabel(route: NavigationRoute | 'settings') {
  return i18next.t(`nav:items.${route}.label`)
}

export function navDescription(route: NavigationRoute | 'settings') {
  return i18next.t(`nav:items.${route}.description`)
}

/** Flat list used by keyboard shortcuts, titles, and the home feature grid. */
export const allNavigation = navigationSections.flatMap(section => section.items)

/** Home feature tiles: operational screens excluding home itself and the live map. */
export const golfNavigation = allNavigation.filter(
  item => item.route !== 'golf' && item.route !== 'course-map',
)

const PINNED_STORAGE_KEY = 'courseboard.sidebar.pinned'
/** How close to the window edge the pointer must get to slide the sidebar back out. */
const SIDEBAR_REVEAL_EDGE = 12

const WIDTH_STORAGE_KEY = 'courseboard.sidebar.width'
const SIDEBAR_MIN_WIDTH = 200
const SIDEBAR_MAX_WIDTH = 400
const SIDEBAR_DEFAULT_WIDTH = 240
/** Pointer travel that separates a resize drag from a click on the edge. */
const RESIZE_DRAG_THRESHOLD = 3
/** Keyboard step for the resize handle. */
const RESIZE_KEY_STEP = 16

function clampSidebarWidth(value: number) {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(value)))
}

function readSidebarWidth() {
  const stored = Number(localStorage.getItem(WIDTH_STORAGE_KEY))
  if (!Number.isFinite(stored) || stored <= 0) return SIDEBAR_DEFAULT_WIDTH
  return clampSidebarWidth(stored)
}
const knownRoutes = new Set<string>([
  ...allNavigation.map(item => item.route),
  ...settingsNavigation.map(item => item.route),
])

function readPinnedRoutes(): string[] {
  try {
    const raw = localStorage.getItem(PINNED_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    const seen = new Set<string>()
    const routes: string[] = []
    for (const entry of parsed) {
      if (typeof entry !== 'string' || !knownRoutes.has(entry) || seen.has(entry)) continue
      seen.add(entry)
      routes.push(entry)
    }
    return routes
  } catch {
    return []
  }
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function focusableWithin(root: HTMLElement) {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter(element => element.getClientRects().length > 0)
}

const CADDIE_SUBVIEWS = new Set(['dispatch', 'attendance', 'shifts', 'payroll'])

function caddieRouteSegment(route: string) {
  if (!route.startsWith('golf/caddies/')) return null
  return route.slice('golf/caddies/'.length).split('/')[0] || null
}

function isCaddieRosterRoute(route: string) {
  if (route === 'golf/caddies') return true
  const segment = caddieRouteSegment(route)
  return Boolean(segment && !CADDIE_SUBVIEWS.has(segment))
}

function isActive(route: string, itemRoute: string) {
  if (itemRoute === 'golf') return route === itemRoute
  if (itemRoute === 'golf/caddies') return isCaddieRosterRoute(route)
  return route === itemRoute || route.startsWith(`${itemRoute}/`)
}

export function routeTitle(route: string) {
  if (route === 'settings/advanced') return i18next.t('settings:advanced.title')
  if (route === 'settings') return navLabel('settings')
  if (isCaddieRosterRoute(route)) return navLabel('golf/caddies')
  // A customer's own page carries the ledger's name in the title bar; the
  // person's name is already the first thing on the page itself.
  if (route.startsWith('golf/customers/')) return navLabel('golf/customers')
  const match = settingsNavigation.find(item => isActive(route, item.route))
    ?? allNavigation.find(item => isActive(route, item.route))
  return match ? navLabel(match.route) : i18next.t('common:app.name')
}

export function AppShell({ route, children }: { route: string; children: ReactNode }) {
  return (
    <PageReloadProvider>
      <AppShellFrame route={route}>{children}</AppShellFrame>
    </PageReloadProvider>
  )
}

function AppShellFrame({ route, children }: { route: string; children: ReactNode }) {
  const auth = useAuth()
  const { t, i18n } = useTranslation(['nav', 'common'])
  const { triggerPageReload } = usePageReload()
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('courseboard.sidebar.collapsed') === 'true')
  const [hoverExpanded, setHoverExpanded] = useState(false)
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(readSidebarWidth)
  const [resizing, setResizing] = useState(false)
  const [commandOpen, setCommandOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [pinnedRoutes, setPinnedRoutes] = useState<string[]>(() => readPinnedRoutes())
  const [dark, setDark] = useState(() => {
    const stored = localStorage.getItem('courseboard.theme')
    return stored ? stored === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches
  })
  const pointerInsideSidebarRef = useRef(false)
  const accountMenuOpenRef = useRef(false)
  const desktopSidebarRef = useRef<HTMLElement | null>(null)
  const sidebarOpenTriggerRef = useRef<HTMLButtonElement | null>(null)
  const resizeRef = useRef<{ pointerId: number; startX: number; startWidth: number; dragged: boolean } | null>(null)
  const mobileNavRef = useRef<HTMLElement | null>(null)
  const mobileTriggerRef = useRef<HTMLButtonElement | null>(null)
  const activeLocale = currentLocale()

  const pinnedItems = useMemo(
    () => pinnedRoutes
      .map(pinnedRoute => (
        allNavigation.find(item => (
          item.route === pinnedRoute && !sidebarHiddenRoutes.has(item.route)
        ))
        ?? settingsNavigation.find(item => item.route === pinnedRoute)
      ))
      .filter((item): item is NavigationItem => Boolean(item)),
    [pinnedRoutes],
  )

  const pinnedRouteSet = useMemo(() => new Set(pinnedRoutes), [pinnedRoutes])

  const unpinnedSections = useMemo(
    () => sidebarNavigationSections
      .map(section => ({
        ...section,
        items: section.items.filter(item => !pinnedRouteSet.has(item.route)),
      }))
      .filter(section => section.items.length > 0),
    [pinnedRouteSet],
  )

  const togglePinned = (itemRoute: string) => {
    setPinnedRoutes(current => {
      const next = current.includes(itemRoute)
        ? current.filter(route => route !== itemRoute)
        : [...current, itemRoute]
      localStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify(next))
      return next
    })
  }

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
    localStorage.setItem('courseboard.theme', dark ? 'dark' : 'light')
  }, [dark])

  useEffect(() => {
    localStorage.setItem('courseboard.sidebar.collapsed', String(collapsed))
  }, [collapsed])

  useEffect(() => {
    if (!collapsed) setHoverExpanded(false)
  }, [collapsed])

  // Collapsing from the header button would otherwise leave focus on a control
  // that is about to become invisible.
  useEffect(() => {
    if (!collapsed) return
    const active = document.activeElement
    if (active instanceof Node && desktopSidebarRef.current?.contains(active)) {
      sidebarOpenTriggerRef.current?.focus()
    }
  }, [collapsed])

  useEffect(() => {
    setMobileOpen(false)
  }, [route])

  /**
   * Reveal is driven by the pointer position rather than by enter/leave on the
   * sidebar itself: while hidden the sidebar has no hoverable box, and once it
   * slides out it lands under a pointer that may never move again, so boundary
   * events alone would strand it open.
   */
  useEffect(() => {
    if (!collapsed || mobileOpen) return
    const onMouseMove = (event: globalThis.MouseEvent) => {
      if (event.clientX <= SIDEBAR_REVEAL_EDGE) {
        setHoverExpanded(true)
        return
      }
      if (accountMenuOpenRef.current) return
      const panel = desktopSidebarRef.current?.querySelector('.courseboard-sidebar')
      const right = panel?.getBoundingClientRect().right ?? 0
      if (event.clientX > right) setHoverExpanded(false)
    }
    window.addEventListener('mousemove', onMouseMove)
    return () => window.removeEventListener('mousemove', onMouseMove)
  }, [collapsed, mobileOpen])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isPageRefreshShortcut(event)) {
        if (triggerPageReload()) {
          event.preventDefault()
        }
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setCommandOpen(value => !value)
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [triggerPageReload])

  // The mobile drawer is a modal: focus moves into it, returns to the hamburger
  // on close, and the workspace behind it is inert while it is open.
  useEffect(() => {
    if (!mobileOpen) return
    const panel = mobileNavRef.current
    if (panel) (focusableWithin(panel)[0] ?? panel).focus()
    return () => {
      // Runs after the drawer unmounts and `inert` is gone, so the trigger takes focus.
      mobileTriggerRef.current?.focus()
    }
  }, [mobileOpen])

  useEffect(() => {
    if (!mobileOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setMobileOpen(false)
        return
      }
      if (event.key !== 'Tab') return
      const panel = mobileNavRef.current
      if (!panel) return
      const focusable = focusableWithin(panel)
      if (focusable.length === 0) {
        event.preventDefault()
        panel.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement
      const outside = !(active instanceof Node) || !panel.contains(active)
      if (event.shiftKey && (outside || active === first)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (outside || active === last)) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [mobileOpen])

  const handleSidebarPointerEnter = () => {
    pointerInsideSidebarRef.current = true
    if (collapsed) setHoverExpanded(true)
  }

  const handleSidebarPointerLeave = () => {
    pointerInsideSidebarRef.current = false
  }

  const collapseFromEdge = () => {
    // The handle disappears with the sidebar, so no mouseleave follows it.
    pointerInsideSidebarRef.current = false
    setHoverExpanded(false)
    setCollapsed(true)
  }

  const storeSidebarWidth = (width: number) => {
    setSidebarWidth(width)
    localStorage.setItem(WIDTH_STORAGE_KEY, String(width))
  }

  // The edge is one control with two gestures: drag resizes, a plain click closes.
  const handleResizePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    resizeRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: sidebarWidth,
      dragged: false,
    }
    setResizing(true)
  }

  const handleResizePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = resizeRef.current
    if (!state || state.pointerId !== event.pointerId) return
    const delta = event.clientX - state.startX
    if (!state.dragged && Math.abs(delta) <= RESIZE_DRAG_THRESHOLD) return
    state.dragged = true
    setSidebarWidth(clampSidebarWidth(state.startWidth + delta))
  }

  const endResize = (event: ReactPointerEvent<HTMLDivElement>, apply: boolean) => {
    const state = resizeRef.current
    if (!state || state.pointerId !== event.pointerId) return
    resizeRef.current = null
    setResizing(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (!apply) {
      setSidebarWidth(state.startWidth)
      return
    }
    if (state.dragged) {
      storeSidebarWidth(clampSidebarWidth(state.startWidth + (event.clientX - state.startX)))
    } else {
      collapseFromEdge()
    }
  }

  const handleResizeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowLeft' ? -RESIZE_KEY_STEP : event.key === 'ArrowRight' ? RESIZE_KEY_STEP : 0
    if (step === 0) return
    event.preventDefault()
    storeSidebarWidth(clampSidebarWidth(sidebarWidth + step))
  }

  const toggleCollapsed = () => {
    setCollapsed(value => {
      const next = !value
      if (next && pointerInsideSidebarRef.current) {
        setHoverExpanded(true)
      } else {
        setHoverExpanded(false)
      }
      return next
    })
  }

  // `routeTitle` reads the global i18next instance, so re-resolve it per language.
  const title = useMemo(() => routeTitle(route), [route, i18n.language])
  const accountName = auth.user?.name ?? auth.user?.email ?? t('nav:account.defaultUser')
  const accountInitials = accountName
    .split(/[\s　]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase())
    .join('') || 'CB'
  const tenantLabel = auth.tenant ? tenantWorkspaceLabel(auth.tenant) : undefined
  const tenantDetail = auth.tenant
    ? formatTenantWorkspaceLabel(auth.tenant)
    : t('nav:workspace.tenantUnset')

  const sidebar = (
    <Sidebar collapsed={false} className="courseboard-sidebar">
      <SidebarHeader className="brand-row">
        <CourseBoardBrand variant="sidebar" collapsed={false} dark={dark} />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="desktop-collapse"
          aria-label={collapsed ? t('nav:sidebar.expand') : t('nav:sidebar.collapse')}
          onClick={toggleCollapsed}
        >
          {collapsed ? <ChevronsRight /> : <ChevronsLeft />}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="mobile-close"
          aria-label={t('nav:sidebar.closeMenu')}
          onClick={() => setMobileOpen(false)}
        >
          <X />
        </Button>
      </SidebarHeader>

      <SidebarSection>
        <SidebarItem type="button" onClick={() => setCommandOpen(true)}>
          <Search />
          <SidebarItemLabel>{t('nav:sidebar.search')}</SidebarItemLabel>
          <span className="shortcut-pair"><Kbd>⌘</Kbd><Kbd>K</Kbd></span>
        </SidebarItem>
      </SidebarSection>

      {pinnedItems.length > 0 ? (
        <SidebarSection>
          <SidebarSectionLabel>{t('nav:sidebar.pinned')}</SidebarSectionLabel>
          {pinnedItems.map(item => (
            <NavigationRow
              key={item.route}
              item={item}
              active={isActive(route, item.route)}
              pinned
              onTogglePin={() => togglePinned(item.route)}
            />
          ))}
        </SidebarSection>
      ) : null}

      {unpinnedSections.map(section => (
        <SidebarSection key={section.id}>
          {section.showLabel ? (
            <SidebarSectionLabel>{t(`nav:sections.${section.id}`)}</SidebarSectionLabel>
          ) : null}
          {section.items.map(item => (
            <NavigationRow
              key={item.route}
              item={item}
              active={isActive(route, item.route)}
              pinned={false}
              onTogglePin={() => togglePinned(item.route)}
            />
          ))}
        </SidebarSection>
      ))}

      <SidebarFooter>
        <DropdownMenu
          open={accountMenuOpen}
          onOpenChange={open => {
            accountMenuOpenRef.current = open
            setAccountMenuOpen(open)
            if (open) {
              if (collapsed) setHoverExpanded(true)
            } else if (!pointerInsideSidebarRef.current) {
              setHoverExpanded(false)
            }
          }}
        >
          <DropdownMenuTrigger asChild>
            <SidebarAccount type="button" aria-label={t('nav:account.openMenu')}>
              <SidebarAvatar>{accountInitials}</SidebarAvatar>
              <SidebarAccountInfo
                name={accountName}
                detail={`${tenantDetail} · ${auth.user?.role ?? ''}`}
              />
              <Badge variant={auth.tenant?.mode === 'sandbox' ? 'warning' : 'success'} className="runtime-dot">
                {auth.tenant?.mode === 'sandbox'
                  ? t('nav:workspace.sandbox')
                  : t('nav:workspace.production')}
              </Badge>
            </SidebarAccount>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="end" className="account-menu">
            <DropdownMenuLabel>
              <span className="account-menu-title">{accountName}</span>
              <span className="account-menu-detail">{auth.user?.email ?? auth.user?.id}</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled><UserRound /> {auth.user?.role ?? 'GENERAL'}</DropdownMenuItem>
            <DropdownMenuItem onSelect={auth.switchTenant}>
              <Building2 /> {t('nav:account.switchTenant')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => navigate('settings')}>
              <Settings /> {t('nav:account.settings')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setDark(value => !value)}>
              {dark ? <Sun /> : <Moon />}
              {dark ? t('common:theme.toLight') : t('common:theme.toDark')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{t('common:locale.label')}</DropdownMenuLabel>
            {LOCALES.map(locale => (
              <DropdownMenuItem key={locale} onSelect={() => setLocale(locale)}>
                {locale === activeLocale
                  ? <Check />
                  : <span className="menu-check-spacer" aria-hidden="true" />}
                {LOCALE_LABELS[locale]}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => { void auth.signOut() }}>
              <LogOut /> {t('nav:account.signOut')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarFooter>
    </Sidebar>
  )

  return (
    <TooltipProvider>
      <div
        className="app-shell"
        data-sidebar-resizing={resizing || undefined}
        style={{ '--courseboard-sidebar-width': `${sidebarWidth}px` } as CSSProperties}
      >
        {/* Collapsing hides the sidebar outright — no icon rail is left behind;
            it comes back full-width as an overlay while the pointer hugs the edge. */}
        <aside
          ref={desktopSidebarRef}
          className="desktop-sidebar"
          data-collapsed-overlay={collapsed || undefined}
          data-hover-expanded={collapsed && hoverExpanded ? true : undefined}
          inert={mobileOpen}
          onMouseEnter={handleSidebarPointerEnter}
          onMouseLeave={handleSidebarPointerLeave}
        >
          {sidebar}
          <div
            className="sidebar-resize-handle"
            role="separator"
            aria-orientation="vertical"
            aria-label={t('nav:sidebar.resize')}
            aria-valuenow={sidebarWidth}
            aria-valuemin={SIDEBAR_MIN_WIDTH}
            aria-valuemax={SIDEBAR_MAX_WIDTH}
            tabIndex={0}
            onPointerDown={handleResizePointerDown}
            onPointerMove={handleResizePointerMove}
            onPointerUp={event => endResize(event, true)}
            onPointerCancel={event => endResize(event, false)}
            onKeyDown={handleResizeKeyDown}
          />
        </aside>
        {mobileOpen ? (
          <div className="mobile-nav-layer" role="presentation" onMouseDown={() => setMobileOpen(false)}>
            <aside
              ref={mobileNavRef}
              className="mobile-sidebar"
              role="dialog"
              aria-modal="true"
              aria-label={t('nav:sidebar.menuLabel')}
              tabIndex={-1}
              onMouseDown={event => event.stopPropagation()}
            >
              {sidebar}
            </aside>
          </div>
        ) : null}

        <div className="app-workspace" inert={mobileOpen}>
          <header className="workspace-bar" data-tauri-drag-region>
            <Button
              ref={mobileTriggerRef}
              type="button"
              variant="ghost"
              size="icon"
              className="mobile-menu"
              aria-label={t('nav:sidebar.openMenu')}
              aria-expanded={mobileOpen}
              onClick={() => {
                setCollapsed(false)
                setMobileOpen(true)
              }}
            >
              <Menu />
            </Button>
            {/* Hovering the window edge is not discoverable on its own. */}
            {collapsed ? (
              <div className="desktop-collapsed-actions">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="desktop-home-shortcut"
                      aria-label={navLabel('golf')}
                      data-active={route === 'golf' ? true : undefined}
                      onClick={event => navigateFromClick(event, 'golf')}
                    >
                      <House />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">{navLabel('golf')}</TooltipContent>
                </Tooltip>
                <Button
                  ref={sidebarOpenTriggerRef}
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="desktop-sidebar-open"
                  aria-label={t('nav:sidebar.expand')}
                  onClick={() => setCollapsed(false)}
                >
                  <PanelLeft />
                </Button>
              </div>
            ) : null}
            <div className="workspace-title" data-tauri-drag-region>{title}</div>
            <div className="workspace-context">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="workspace-help-trigger"
                    aria-label={helpOpen ? t('nav:workspace.closeHelp') : t('nav:workspace.openHelp')}
                    aria-pressed={helpOpen}
                    data-active={helpOpen ? true : undefined}
                    onClick={() => setHelpOpen(value => !value)}
                  >
                    <CircleHelp />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {helpOpen ? t('nav:workspace.closeHelp') : t('nav:workspace.openHelp')}
                </TooltipContent>
              </Tooltip>
              {tenantLabel && auth.tenant ? (
                <span className="workspace-tenant" title={auth.tenant.id}>
                  <span className="workspace-tenant-name">{tenantLabel.primary}</span>
                  {tenantLabel.secondary ? (
                    <span className="workspace-tenant-slug">{tenantLabel.secondary}</span>
                  ) : null}
                </span>
              ) : null}
            </div>
          </header>
          <div className="workspace-body">
            <main className="workspace-content">{children}</main>
            <WorkspaceHelpPanel route={route} open={helpOpen} onClose={() => setHelpOpen(false)} />
          </div>
        </div>
        {/* Transient messages never capture the pointer or cover bottom actions. */}
        <Toaster
          className="courseboard-toaster"
          position="top-center"
          offset={{ top: 52, right: 16, bottom: 16, left: 16 }}
          mobileOffset={{
            top: 'calc(52px + env(safe-area-inset-top))',
            right: 16,
            bottom: 16,
            left: 16,
          }}
          containerAriaLabel={t('common:notification.label')}
        />
      </div>


      <CommandDialog
        open={commandOpen}
        onOpenChange={setCommandOpen}
        title={t('nav:command.title')}
        description={t('nav:command.description')}
      >
        {/* cmdk renders an empty <label> and points aria-labelledby at it, so the
            combobox only gets an accessible name from an explicit aria-label. */}
        <CommandInput
          placeholder={t('nav:command.placeholder')}
          aria-label={t('nav:command.inputLabel')}
        />
        <CommandList>
          <CommandEmpty>{t('nav:command.empty')}</CommandEmpty>
          {navigationSections.map(section => (
            <CommandGroup key={section.id} heading={t(`nav:sections.${section.id}`)}>
              {section.items.map(item => (
                <CommandNavigationItem
                  key={item.route}
                  item={item}
                  onNavigate={() => setCommandOpen(false)}
                />
              ))}
            </CommandGroup>
          ))}
          <CommandGroup heading={t('nav:sections.settings')}>
            <CommandItem onSelect={() => { navigate('settings'); setCommandOpen(false) }}>
              <Settings />
              <span className="command-copy">
                <strong>{navLabel('settings')}</strong>
                <small>{navDescription('settings')}</small>
              </span>
            </CommandItem>
            {settingsNavigation.map(item => (
              <CommandNavigationItem
                key={item.route}
                item={item}
                onNavigate={() => setCommandOpen(false)}
              />
            ))}
          </CommandGroup>
          <CommandGroup heading={t('common:locale.label')}>
            {LOCALES.map(locale => (
              <CommandItem
                key={locale}
                value={`${t('common:locale.label')} ${LOCALE_LABELS[locale]}`}
                onSelect={() => {
                  setLocale(locale)
                  setCommandOpen(false)
                }}
              >
                {locale === activeLocale ? <Check /> : <Languages />}
                <span className="command-copy">
                  <strong>{LOCALE_LABELS[locale]}</strong>
                  <small>{t('common:locale.description')}</small>
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandGroup heading={t('nav:sections.account')}>
            <CommandItem onSelect={() => setDark(value => !value)}>
              {dark ? <Sun /> : <Moon />}
              <span className="command-copy">
                <strong>{dark ? t('common:theme.toLight') : t('common:theme.toDark')}</strong>
                <small>{t('common:theme.description')}</small>
              </span>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </TooltipProvider>
  )
}

function CommandNavigationItem({
  item,
  onNavigate,
}: {
  item: NavigationItem
  onNavigate: () => void
}) {
  const Icon = item.icon
  const label = navLabel(item.route)
  const description = navDescription(item.route)
  return (
    <CommandItem
      value={`${label} ${description} ${item.route}`}
      onSelect={() => {
        navigate(item.route)
        onNavigate()
      }}
    >
      <Icon />
      <span className="command-copy"><strong>{label}</strong><small>{description}</small></span>
    </CommandItem>
  )
}

function NavigationRow({
  item,
  active,
  pinned,
  onTogglePin,
}: {
  item: NavigationItem
  active: boolean
  pinned: boolean
  onTogglePin: () => void
}) {
  const { t } = useTranslation('nav')
  const Icon = item.icon
  const label = navLabel(item.route)

  const handlePinClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    onTogglePin()
  }

  return (
    <div className="nav-row" data-pinned={pinned || undefined}>
      <SidebarItem
        type="button"
        active={active}
        onClick={event => navigateFromClick(event, item.route)}
      >
        <Icon />
        <SidebarItemLabel>{label}</SidebarItemLabel>
      </SidebarItem>
      <button
        type="button"
        className="nav-pin"
        aria-label={pinned ? t('sidebar.unpin') : t('sidebar.pin')}
        aria-pressed={pinned}
        onClick={handlePinClick}
      >
        <Pin />
      </button>
    </div>
  )
}
