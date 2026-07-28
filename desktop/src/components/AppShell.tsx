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
  TooltipProvider,
  TooltipTrigger,
} from '@tachyon-sdk/native-ui'
import {
  BarChart3,
  Building2,
  CalendarCheck,
  CalendarDays,
  CalendarRange,
  Check,
  ChevronsLeft,
  ChevronsRight,
  CircleDollarSign,
  CircleHelp,
  ClipboardCheck,
  Clock,
  CreditCard,
  FolderTree,
  Gauge,
  Languages,
  LogOut,
  Map,
  Menu,
  Moon,
  Pin,
  ReceiptText,
  Search,
  Settings,
  Settings2,
  Sun,
  UserRound,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react'
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
  | 'cancellation-fees'
  | 'golf/courses'
  | 'golf/policy'

export type NavigationItem = {
  route: NavigationRoute
  icon: LucideIcon
}

export type NavigationSection = {
  /** Matches a key under `nav:sections`; `showLabel: false` renders the group unlabelled. */
  id: 'home' | 'courseBooking' | 'caddie' | 'finance'
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
      { route: 'golf/timeline', icon: CalendarRange },
      { route: 'golf/products', icon: CalendarCheck },
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
    id: 'finance',
    showLabel: true,
    items: [
      { route: 'golf/budgets', icon: BarChart3 },
      { route: 'golf/settlement', icon: ReceiptText },
      { route: 'cancellation-fees', icon: CreditCard },
    ],
  },
]

/**
 * Rarely-touched tenant masters live under Settings, not the daily sidebar.
 * Kept searchable via ⌘K and linked from the settings hub.
 */
export const settingsNavigation: NavigationItem[] = [
  { route: 'golf/courses', icon: FolderTree },
  { route: 'golf/policy', icon: Settings2 },
  { route: 'course-map', icon: Map },
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
  const [commandOpen, setCommandOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [pinnedRoutes, setPinnedRoutes] = useState<string[]>(() => readPinnedRoutes())
  const [dark, setDark] = useState(() => {
    const stored = localStorage.getItem('courseboard.theme')
    return stored ? stored === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches
  })
  const pointerInsideSidebarRef = useRef(false)
  const hoverLeaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const accountMenuOpenRef = useRef(false)
  const activeLocale = currentLocale()

  /** Permanent preference stays in `collapsed`; hover only changes the visual rail. */
  const visuallyCollapsed = collapsed && !hoverExpanded

  const pinnedItems = useMemo(
    () => pinnedRoutes
      .map(pinnedRoute => (
        allNavigation.find(item => item.route === pinnedRoute)
        ?? settingsNavigation.find(item => item.route === pinnedRoute)
      ))
      .filter((item): item is NavigationItem => Boolean(item)),
    [pinnedRoutes],
  )

  const pinnedRouteSet = useMemo(() => new Set(pinnedRoutes), [pinnedRoutes])

  const unpinnedSections = useMemo(
    () => navigationSections
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

  useEffect(() => {
    setMobileOpen(false)
  }, [route])

  useEffect(() => {
    return () => {
      if (hoverLeaveTimerRef.current) clearTimeout(hoverLeaveTimerRef.current)
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isPageRefreshShortcut(event)) {
        const refreshButton = document.querySelector<HTMLButtonElement>('[data-page-refresh]')
        if (refreshButton) {
          event.preventDefault()
          if (!refreshButton.disabled) refreshButton.click()
        } else if (triggerPageReload()) {
          // Prefer in-app data reload when no PageRefreshButton is mounted.
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

  const clearHoverLeaveTimer = () => {
    if (hoverLeaveTimerRef.current) {
      clearTimeout(hoverLeaveTimerRef.current)
      hoverLeaveTimerRef.current = null
    }
  }

  const handleSidebarPointerEnter = () => {
    pointerInsideSidebarRef.current = true
    clearHoverLeaveTimer()
    if (collapsed) setHoverExpanded(true)
  }

  const handleSidebarPointerLeave = () => {
    pointerInsideSidebarRef.current = false
    clearHoverLeaveTimer()
    hoverLeaveTimerRef.current = setTimeout(() => {
      if (!pointerInsideSidebarRef.current && !accountMenuOpenRef.current) {
        setHoverExpanded(false)
      }
    }, 180)
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
    <Sidebar collapsed={visuallyCollapsed} className="courseboard-sidebar">
      <SidebarHeader className="brand-row">
        <CourseBoardBrand variant="sidebar" collapsed={visuallyCollapsed} dark={dark} />
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
        <Tooltip>
          <TooltipTrigger asChild>
            <SidebarItem type="button" onClick={() => setCommandOpen(true)}>
              <Search />
              <SidebarItemLabel>{t('nav:sidebar.search')}</SidebarItemLabel>
              <span className="shortcut-pair"><Kbd>⌘</Kbd><Kbd>K</Kbd></span>
            </SidebarItem>
          </TooltipTrigger>
          {visuallyCollapsed ? (
            <TooltipContent side="right">{t('nav:sidebar.search')}</TooltipContent>
          ) : null}
        </Tooltip>
      </SidebarSection>

      {pinnedItems.length > 0 ? (
        <SidebarSection>
          <SidebarSectionLabel>{t('nav:sidebar.pinned')}</SidebarSectionLabel>
          {pinnedItems.map(item => (
            <NavigationRow
              key={item.route}
              item={item}
              active={isActive(route, item.route)}
              collapsed={visuallyCollapsed}
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
              collapsed={visuallyCollapsed}
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
              clearHoverLeaveTimer()
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
      <div className="app-shell">
        <aside
          className="desktop-sidebar"
          data-collapsed-rail={collapsed || undefined}
          data-hover-expanded={collapsed && hoverExpanded ? true : undefined}
          onMouseEnter={handleSidebarPointerEnter}
          onMouseLeave={handleSidebarPointerLeave}
        >
          {sidebar}
        </aside>
        {mobileOpen ? (
          <div className="mobile-nav-layer" role="presentation" onMouseDown={() => setMobileOpen(false)}>
            <aside className="mobile-sidebar" onMouseDown={event => event.stopPropagation()}>{sidebar}</aside>
          </div>
        ) : null}

        <div className="app-workspace">
          <header className="workspace-bar" data-tauri-drag-region>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="mobile-menu"
              aria-label={t('nav:sidebar.openMenu')}
              onClick={() => {
                setCollapsed(false)
                setMobileOpen(true)
              }}
            >
              <Menu />
            </Button>
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
      </div>


      <CommandDialog open={commandOpen} onOpenChange={setCommandOpen}>
        <CommandInput placeholder={t('nav:command.placeholder')} />
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
  collapsed,
  pinned,
  onTogglePin,
}: {
  item: NavigationItem
  active: boolean
  collapsed: boolean
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
      <Tooltip>
        <TooltipTrigger asChild>
          <SidebarItem
            type="button"
            active={active}
            onClick={event => navigateFromClick(event, item.route)}
          >
            <Icon />
            <SidebarItemLabel>{label}</SidebarItemLabel>
          </SidebarItem>
        </TooltipTrigger>
        {collapsed ? <TooltipContent side="right">{label}</TooltipContent> : null}
      </Tooltip>
      {!collapsed ? (
        <button
          type="button"
          className="nav-pin"
          aria-label={pinned ? t('sidebar.unpin') : t('sidebar.pin')}
          aria-pressed={pinned}
          onClick={handlePinClick}
        >
          <Pin />
        </button>
      ) : null}
    </div>
  )
}
