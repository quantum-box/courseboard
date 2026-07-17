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
  CreditCard,
  Flag,
  FolderTree,
  Gauge,
  LogOut,
  Map,
  Menu,
  Moon,
  ReceiptText,
  Search,
  Settings2,
  Sun,
  UserRound,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { navigate } from '../lib/router'
import { platformKind, platformLabel } from '../lib/platform'
import {
  isPageRefreshShortcut,
  navigationShortcutDigit,
  navigationShortcutLabel,
} from '../lib/shortcuts'

export type NavigationItem = {
  route: string
  label: string
  description: string
  icon: LucideIcon
  shortcut?: string
}

export const golfNavigation: NavigationItem[] = [
  { route: 'golf', label: 'ゴルフアプリ', description: '運用状況と機能への入口', icon: Gauge, shortcut: '1' },
  { route: 'golf/courses', label: 'コース管理', description: 'コースとスタート間隔', icon: FolderTree, shortcut: '2' },
  { route: 'golf/products', label: 'ゴルフ予約商品', description: 'プレープランと受付枠', icon: CalendarCheck, shortcut: '3' },
  { route: 'golf/caddies', label: 'キャディ管理', description: '配置、勤怠、給与、稼働', icon: Users, shortcut: '4' },
  { route: 'golf/budgets', label: '予算マスタ', description: '日別予算と達成率', icon: BarChart3, shortcut: '5' },
  { route: 'golf/policy', label: '予約ポリシー', description: '受付制御と客単価判定', icon: Settings2, shortcut: '6' },
  { route: 'golf/settlement', label: '月次精算', description: '売上、費用、未収の照合', icon: ReceiptText, shortcut: '7' },
]

export const billingNavigation: NavigationItem[] = [
  { route: 'cancellation-fees', label: 'キャンセル料', description: '請求、送信、入金確認', icon: CreditCard, shortcut: '8' },
]

const allNavigation = [...golfNavigation, ...billingNavigation]

function isActive(route: string, itemRoute: string) {
  if (itemRoute === 'golf') return route === itemRoute
  return route === itemRoute || route.startsWith(`${itemRoute}/`)
}

export function routeTitle(route: string) {
  if (route === 'course-map') return 'コースマップ'
  return allNavigation.find(item => isActive(route, item.route))?.label ?? 'Course Board'
}

export function AppShell({ route, children }: { route: string; children: ReactNode }) {
  const auth = useAuth()
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('courseboard.sidebar.collapsed') === 'true')
  const [mobileOpen, setMobileOpen] = useState(false)
  const [commandOpen, setCommandOpen] = useState(false)
  const [dark, setDark] = useState(() => {
    const stored = localStorage.getItem('courseboard.theme')
    return stored ? stored === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches
  })

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
    localStorage.setItem('courseboard.theme', dark ? 'dark' : 'light')
  }, [dark])

  useEffect(() => {
    localStorage.setItem('courseboard.sidebar.collapsed', String(collapsed))
  }, [collapsed])

  useEffect(() => {
    setMobileOpen(false)
  }, [route])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isPageRefreshShortcut(event)) {
        const refreshButton = document.querySelector<HTMLButtonElement>('[data-page-refresh]')
        if (refreshButton) {
          event.preventDefault()
          if (!refreshButton.disabled) refreshButton.click()
        }
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setCommandOpen(value => !value)
      }
      const shortcutDigit = navigationShortcutDigit(event, platformKind())
      if (shortcutDigit) {
        const item = allNavigation[Number(shortcutDigit) - 1]
        if (item) {
          event.preventDefault()
          navigate(item.route)
        }
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])

  const title = useMemo(() => routeTitle(route), [route])
  const accountName = auth.user?.name ?? auth.user?.email ?? 'Course Board user'
  const accountInitials = accountName
    .split(/[\s　]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase())
    .join('') || 'CB'

  const sidebar = (
    <Sidebar collapsed={collapsed} className="courseboard-sidebar">
      <SidebarHeader className="brand-row">
        <span className="brand-mark" aria-hidden="true"><Flag /></span>
        <span className="brand-name">Course Board</span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="desktop-collapse"
          aria-label={collapsed ? 'サイドバーを開く' : 'サイドバーを閉じる'}
          onClick={() => setCollapsed(value => !value)}
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
          {collapsed ? <TooltipContent side="right">検索</TooltipContent> : null}
        </Tooltip>
      </SidebarSection>

      <SidebarSection>
        <SidebarSectionLabel>ゴルフ</SidebarSectionLabel>
        {golfNavigation.map(item => (
          <NavigationRow key={item.route} item={item} active={isActive(route, item.route)} collapsed={collapsed} />
        ))}
      </SidebarSection>

      <SidebarSection>
        <SidebarSectionLabel>請求</SidebarSectionLabel>
        {billingNavigation.map(item => (
          <NavigationRow key={item.route} item={item} active={isActive(route, item.route)} collapsed={collapsed} />
        ))}
      </SidebarSection>

      <SidebarFooter>
        <NavigationRow
          item={{ route: 'course-map', label: 'コースマップ', description: 'カート位置をリアルタイム表示', icon: Map }}
          active={route === 'course-map'}
          collapsed={collapsed}
        />
        <SidebarItem type="button" onClick={() => setDark(value => !value)}>
          {dark ? <Sun /> : <Moon />}
          <SidebarItemLabel>{dark ? 'ライト表示' : 'ダーク表示'}</SidebarItemLabel>
        </SidebarItem>
        <DropdownMenu>
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
        <aside className="desktop-sidebar">{sidebar}</aside>
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
              <span>{auth.tenant?.name ?? auth.tenant?.id}</span>
              <Badge variant="outline">{platformLabel()}</Badge>
            </div>
          </header>
          <main className="workspace-content">{children}</main>
        </div>
      </div>

      <CommandDialog open={commandOpen} onOpenChange={setCommandOpen}>
        <CommandInput placeholder="画面を検索…" />
        <CommandList>
          <CommandEmpty>一致する画面はありません。</CommandEmpty>
          <CommandGroup heading="ゴルフ運用">
            {allNavigation.map(item => {
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
                  {item.shortcut ? <Kbd>{navigationShortcutLabel(item.shortcut, platformKind())}</Kbd> : null}
                </CommandItem>
              )
            })}
          </CommandGroup>
          <CommandGroup heading="現場">
            <CommandItem onSelect={() => { navigate('course-map'); setCommandOpen(false) }}>
              <Map />
              <span className="command-copy"><strong>コースマップ</strong><small>カート位置をリアルタイム表示</small></span>
            </CommandItem>
            <CommandItem onSelect={() => setDark(value => !value)}>
              <CircleDollarSign />
              <span className="command-copy"><strong>表示テーマを切り替え</strong><small>ライト / ダーク</small></span>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </TooltipProvider>
  )
}

function NavigationRow({ item, active, collapsed }: { item: NavigationItem; active: boolean; collapsed: boolean }) {
  const Icon = item.icon
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <SidebarItem type="button" active={active} onClick={() => navigate(item.route)}>
          <Icon />
          <SidebarItemLabel>{item.label}</SidebarItemLabel>
          {item.shortcut ? <Kbd>{navigationShortcutLabel(item.shortcut, platformKind())}</Kbd> : null}
        </SidebarItem>
      </TooltipTrigger>
      {collapsed ? <TooltipContent side="right">{item.label}</TooltipContent> : null}
    </Tooltip>
  )
}
