import { MacOSWindowTabs } from '@tachyon-sdk/native-ui'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { routeTitle } from './AppShell'
import {
  goBack,
  goForward,
  useNavigationAvailability,
  useRoute,
} from '../lib/router'

interface CourseboardTab {
  label: string
  title: string
  selected: boolean
}

const TABS_CHANGED_EVENT = 'courseboard-tabs-changed'

export function tabTitleForRoute(route: string) {
  return routeTitle(route)
}

export function supportsDesktopTabs(targetOs: string) {
  return targetOs === 'macos' || targetOs === 'windows'
}

export function MacOSTabStrip() {
  const route = useRoute()
  const { canGoBack, canGoForward } = useNavigationAvailability()
  const [tabs, setTabs] = useState<CourseboardTab[]>([])
  const [enabled, setEnabled] = useState(false)
  const [targetOs, setTargetOs] = useState<string>()

  useEffect(() => {
    let disposed = false
    invoke<string>('app_target_os')
      .then(target => {
        if (!disposed) {
          setTargetOs(target)
          setEnabled(supportsDesktopTabs(target))
        }
      })
      .catch(() => {
        // Web preview and tests do not expose the native command surface.
      })
    return () => {
      disposed = true
    }
  }, [])

  const refreshTabs = useCallback(async () => {
    setTabs(await invoke<CourseboardTab[]>('list_courseboard_tabs'))
  }, [])

  useEffect(() => {
    if (!enabled) return
    let secondFrame = 0
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        invoke('mark_courseboard_tab_content_ready').catch(console.error)
      })
    })
    return () => {
      cancelAnimationFrame(firstFrame)
      cancelAnimationFrame(secondFrame)
    }
  }, [enabled])

  useEffect(() => {
    if (!enabled) return
    let disposed = false
    let unlisten: (() => void) | undefined
    refreshTabs().catch(console.error)
    listen(TABS_CHANGED_EVENT, () => refreshTabs().catch(console.error))
      .then(stop => {
        if (disposed) stop()
        else unlisten = stop
      })
      .catch(console.error)
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [enabled, refreshTabs])

  useEffect(() => {
    if (!enabled) return
    invoke('update_courseboard_tab_title', { title: tabTitleForRoute(route) })
      .then(refreshTabs)
      .catch(console.error)
  }, [enabled, refreshTabs, route])

  useEffect(() => {
    if (!enabled) return
    const onKeyDown = (event: KeyboardEvent) => {
      const back = (event.metaKey && event.key === '[')
        || (targetOs === 'windows' && event.altKey && event.key === 'ArrowLeft')
      const forward = (event.metaKey && event.key === ']')
        || (targetOs === 'windows' && event.altKey && event.key === 'ArrowRight')
      if (back && canGoBack) {
        event.preventDefault()
        goBack()
      } else if (forward && canGoForward) {
        event.preventDefault()
        goForward()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [canGoBack, canGoForward, enabled, targetOs])

  if (!enabled) return null
  const selected = tabs.find(tab => tab.selected)

  const controlsInset = targetOs === 'macos' ? 76 : 0
  return (
    <div className="relative shrink-0">
      <MacOSWindowTabs
        tabs={tabs.map(tab => ({ id: tab.label, title: tab.title }))}
        activeTabId={selected?.label ?? ''}
        onTabSelect={label => invoke('activate_courseboard_tab', { label }).catch(console.error)}
        onTabClose={label => invoke('close_courseboard_tab', { label }).catch(console.error)}
        onNewTab={() => invoke('create_courseboard_tab', { path: null, activate: true }).catch(console.error)}
        tabListLabel="Course Boardのタブ"
        newTabLabel="新しいタブ"
        closeTabLabel={tab => `${tab.title}を閉じる`}
        windowControlsInset={controlsInset + 68}
      />
      <nav
        aria-label="履歴ナビゲーション"
        className="absolute top-0 z-10 flex h-[38px] w-[68px] items-center justify-center gap-0.5 border-r border-border"
        style={{ left: controlsInset }}
      >
        <HistoryButton direction="back" disabled={!canGoBack} onClick={goBack} />
        <HistoryButton direction="forward" disabled={!canGoForward} onClick={goForward} />
      </nav>
    </div>
  )
}

function HistoryButton({
  direction,
  disabled,
  onClick,
}: {
  direction: 'back' | 'forward'
  disabled: boolean
  onClick: () => void
}) {
  const back = direction === 'back'
  const Icon = back ? ChevronLeft : ChevronRight
  const label = back ? '戻る' : '進む'
  return (
    <button
      type="button"
      aria-label={label}
      title={`${label} (${back ? '⌘[' : '⌘]'})`}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent"
    >
      <Icon className="size-4" strokeWidth={2} />
    </button>
  )
}
