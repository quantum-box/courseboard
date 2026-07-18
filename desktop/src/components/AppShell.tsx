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
  ChevronsLeft,
  ChevronsRight,
  CircleDollarSign,
  CircleHelp,
  ClipboardCheck,
  Clock,
  CreditCard,
  FolderTree,
  Gauge,
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
import { useAuth } from '../auth/AuthProvider'
import { PageReloadProvider, usePageReload } from '../lib/pageReload'
import { navigate } from '../lib/router'
import { CourseBoardBrand } from './CourseBoardBrand'
import { WorkspaceHelpPanel } from './WorkspaceHelp'

export type NavigationItem = {
  route: string
  label: string
  description: string
  icon: LucideIcon
  shortcut?: string
}

export type NavigationSection = {
  id: string
  label: string | null
  items: NavigationItem[]
}

export const navigationSections: NavigationSection[] = [
  {
    id: 'home',
    label: null,
    items: [
      { route: 'golf', label: 'ホーム', description: '運用状況と機能への入口', icon: Gauge, shortcut: '1' },
    ],
  },
  {
    id: 'course-booking',
    label: 'コース予約',
    items: [
      { route: 'golf/products', label: 'ゴルフ予約商品', description: 'プレープランと受付枠', icon: CalendarCheck, shortcut: '2' },
      { route: 'golf/policy', label: '予約ポリシー', description: '受付制御と客単価判定', icon: Settings2, shortcut: '3' },
      { route: 'course-map', label: 'コースマップ', description: 'カート位置をリアルタイム表示', icon: Map },
    ],
  },
  {
    id: 'caddie',
    label: 'キャディ管理',
    items: [
      { route: 'golf/caddies', label: '名簿', description: 'プロフィール、スタッフ連携、希望休', icon: Users, shortcut: '4' },
      { route: 'golf/caddies/dispatch', label: '配置', description: '当日割当、供給、自動配置', icon: ClipboardCheck },
      { route: 'golf/caddies/attendance', label: '勤怠', description: '出勤打刻と割当照合', icon: Clock },
      { route: 'golf/caddies/payroll', label: '給与', description: '月次集計と給与CSV', icon: CircleDollarSign },
    ],
  },
  {
    id: 'finance',
    label: '経理・精算',
    items: [
      { route: 'golf/budgets', label: '予算マスタ', description: '日別予算と達成率', icon: BarChart3, shortcut: '5' },
      { route: 'golf/settlement', label: '月次精算', description: '売上、費用、未収の照合', icon: ReceiptText, shortcut: '6' },
      { route: 'cancellation-fees', label: 'キャンセル料', description: '請求、送信、入金確認', icon: CreditCard, shortcut: '7' },
    ],
  },
]

/**
 * Rarely-touched tenant masters live under Settings, not the daily sidebar.
 * Kept searchable via ⌘K and linked from the settings hub.
 */
export const settingsNavigation: NavigationItem[] = [
  {
    route: 'golf/courses',
    label: 'コース管理',
    description: 'コースとスタート間隔（初期設定）',
    icon: FolderTree,
  },
]

/** Flat list used by keyboard shortcuts, titles, and the home feature grid. */
export const allNavigation = navigationSections.flatMap(section => section.items)

/** Home feature tiles: operational screens excluding home itself and the live map. */
export const golfNavigation = allNavigation.filter(
  item => item.route !== 'golf' && item.route !== 'course-map',
)

const PINNED_STORAGE_KEY = 'courseboard.sidebar.pinned'
const knownRoutes = new Set([
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

const CADDIE_SUBVIEWS = new Set(['dispatch', 'attendance', 'payroll'])

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
  if (route === 'settings') return '設定'
  if (isCaddieRosterRoute(route)) return '名簿'
  return (
    settingsNavigation.find(item => isActive(route, item.route))?.label
    ?? allNavigation.find(item => isActive(route, item.route))?.label
    ?? 'Course Board'
  )
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
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setCommandOpen(value => !value)
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'r') {
        // Prefer in-app data reload over the browser/Tauri hard refresh
        // whenever the current screen registered a handler.
        if (triggerPageReload()) {
          event.preventDefault()
        }
      }
      if ((event.metaKey || event.ctrlKey) && /^[1-7]$/.test(event.key)) {
        const item = allNavigation.find(entry => entry.shortcut === event.key)
        if (item) {
          event.preventDefault()
          navigate(item.route)
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
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

  const title = useMemo(() => routeTitle(route), [route])
  const accountName = auth.user?.name ?? auth.user?.email ?? 'Course Board user'
  const accountInitials = accountName
    .split(/[\s　]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase())
    .join('') || 'CB'

  const sidebar = (
    <Sidebar collapsed={visuallyCollapsed} className="courseboard-sidebar">
      <SidebarHeader className="brand-row">
        <CourseBoardBrand variant="sidebar" collapsed={visuallyCollapsed} />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="desktop-collapse"
          aria-label={collapsed ? 'サイドバーを開く' : 'サイドバーを閉じる'}
          onClick={toggleCollapsed}
        >
          {collapsed ? <ChevronsRight /> : <ChevronsLeft />}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="mobile-close"
          aria-label="メニューを閉じる"
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
              <SidebarItemLabel>検索</SidebarItemLabel>
              <span className="shortcut-pair"><Kbd>⌘</Kbd><Kbd>K</Kbd></span>
            </SidebarItem>
          </TooltipTrigger>
          {visuallyCollapsed ? <TooltipContent side="right">検索</TooltipContent> : null}
        </Tooltip>
      </SidebarSection>

      {pinnedItems.length > 0 ? (
        <SidebarSection>
          <SidebarSectionLabel>ピン留め</SidebarSectionLabel>
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
          {section.label ? <SidebarSectionLabel>{section.label}</SidebarSectionLabel> : null}
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
            <SidebarAccount type="button" aria-label="アカウントメニューを開く">
              <SidebarAvatar>{accountInitials}</SidebarAvatar>
              <SidebarAccountInfo
                name={accountName}
                detail={`${auth.tenant?.name ?? auth.tenant?.id ?? 'テナント未選択'} · ${auth.user?.role ?? ''}`}
              />
              <Badge variant={auth.tenant?.mode === 'sandbox' ? 'warning' : 'success'} className="runtime-dot">
                {auth.tenant?.mode === 'sandbox' ? 'Sandbox' : '本番'}
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
            <DropdownMenuItem onSelect={auth.switchTenant}><Building2 /> テナントを切り替え</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => navigate('settings')}><Settings /> 設定</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setDark(value => !value)}>
              {dark ? <Sun /> : <Moon />}
              {dark ? 'ライト表示' : 'ダーク表示'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => { void auth.signOut() }}><LogOut /> ログアウト</DropdownMenuItem>
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
              aria-label="メニューを開く"
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
                    aria-label={helpOpen ? 'ヘルプを閉じる' : 'このページのヘルプ'}
                    aria-pressed={helpOpen}
                    data-active={helpOpen ? true : undefined}
                    onClick={() => setHelpOpen(value => !value)}
                  >
                    <CircleHelp />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{helpOpen ? 'ガイドを閉じる' : 'ガイドを開く'}</TooltipContent>
              </Tooltip>
              <span>{auth.tenant?.name ?? auth.tenant?.id}</span>
            </div>
          </header>
          <div className="workspace-body">
            <main className="workspace-content">{children}</main>
            <WorkspaceHelpPanel route={route} open={helpOpen} onClose={() => setHelpOpen(false)} />
          </div>
        </div>
      </div>


      <CommandDialog open={commandOpen} onOpenChange={setCommandOpen}>
        <CommandInput placeholder="画面を検索…" />
        <CommandList>
          <CommandEmpty>一致する画面はありません。</CommandEmpty>
          {navigationSections.map(section => (
            <CommandGroup key={section.id} heading={section.label ?? 'ホーム'}>
              {section.items.map(item => {
                const Icon = item.icon
                return (
                  <CommandItem
                    key={item.route}
                    value={`${item.label} ${item.description}`}
                    onSelect={() => {
                      navigate(item.route)
                      setCommandOpen(false)
                    }}
                  >
                    <Icon />
                    <span className="command-copy"><strong>{item.label}</strong><small>{item.description}</small></span>
                    {item.shortcut ? <Kbd>⌘{item.shortcut}</Kbd> : null}
                  </CommandItem>
                )
              })}
            </CommandGroup>
          ))}
          <CommandGroup heading="設定">
            <CommandItem onSelect={() => { navigate('settings'); setCommandOpen(false) }}>
              <Settings />
              <span className="command-copy"><strong>設定</strong><small>Extension runtime とテナント連携</small></span>
            </CommandItem>
            {settingsNavigation.map(item => {
              const Icon = item.icon
              return (
                <CommandItem
                  key={item.route}
                  value={`${item.label} ${item.description}`}
                  onSelect={() => {
                    navigate(item.route)
                    setCommandOpen(false)
                  }}
                >
                  <Icon />
                  <span className="command-copy"><strong>{item.label}</strong><small>{item.description}</small></span>
                </CommandItem>
              )
            })}
          </CommandGroup>
          <CommandGroup heading="アカウント">
            <CommandItem onSelect={() => setDark(value => !value)}>
              {dark ? <Sun /> : <Moon />}
              <span className="command-copy"><strong>表示テーマを切り替え</strong><small>ライト / ダーク</small></span>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </TooltipProvider>
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
  const Icon = item.icon

  const handlePinClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    onTogglePin()
  }

  return (
    <div className="nav-row" data-pinned={pinned || undefined}>
      <Tooltip>
        <TooltipTrigger asChild>
          <SidebarItem type="button" active={active} onClick={() => navigate(item.route)}>
            <Icon />
            <SidebarItemLabel>{item.label}</SidebarItemLabel>
            {item.shortcut ? <Kbd className="nav-shortcut">⌘{item.shortcut}</Kbd> : null}
          </SidebarItem>
        </TooltipTrigger>
        {collapsed ? <TooltipContent side="right">{item.label}</TooltipContent> : null}
      </Tooltip>
      {!collapsed ? (
        <button
          type="button"
          className="nav-pin"
          aria-label={pinned ? 'Unpin from sidebar' : 'Pin to top of sidebar'}
          aria-pressed={pinned}
          onClick={handlePinClick}
        >
          <Pin />
        </button>
      ) : null}
    </div>
  )
}
