import { Button } from '@tachyon-sdk/native-ui'
import { X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { getPageHelp, type PageHelpSection } from '../features/help/pageHelp'

const WIDTH_STORAGE_KEY = 'courseboard.help.panelWidth'
const DEFAULT_WIDTH = 320
const MIN_WIDTH = 240
const MAX_WIDTH = 560

function readStoredWidth() {
  try {
    const raw = localStorage.getItem(WIDTH_STORAGE_KEY)
    if (!raw) return DEFAULT_WIDTH
    const value = Number(raw)
    if (!Number.isFinite(value)) return DEFAULT_WIDTH
    return clampWidth(value)
  } catch {
    return DEFAULT_WIDTH
  }
}

function clampWidth(width: number) {
  const viewportCap = typeof window === 'undefined'
    ? MAX_WIDTH
    : Math.min(MAX_WIDTH, Math.floor(window.innerWidth * 0.55))
  return Math.min(viewportCap, Math.max(MIN_WIDTH, Math.round(width)))
}

function HelpBlock({ title, sections }: { title: string; sections: PageHelpSection[] }) {
  return (
    <section className="workspace-help-block">
      <h3>{title}</h3>
      <ul>
        {sections.map(section => (
          <li key={section.heading}>
            <strong>{section.heading}</strong>
            <p>{section.body}</p>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function WorkspaceHelpPanel({
  route,
  open,
  onClose,
}: {
  route: string
  open: boolean
  onClose: () => void
}) {
  const help = getPageHelp(route)
  const [width, setWidth] = useState(() => readStoredWidth())
  const [resizing, setResizing] = useState(false)
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  useEffect(() => {
    const onResize = () => setWidth(current => clampWidth(current))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const endResize = useCallback(() => {
    dragRef.current = null
    setResizing(false)
    document.body.style.removeProperty('cursor')
    document.body.style.removeProperty('user-select')
  }, [])

  useEffect(() => {
    if (!resizing) return

    const onPointerMove = (event: PointerEvent) => {
      const drag = dragRef.current
      if (!drag) return
      // Dragging the left edge: move left → wider, move right → narrower.
      const next = clampWidth(drag.startWidth + (drag.startX - event.clientX))
      setWidth(next)
    }

    const onPointerUp = () => {
      setWidth(current => {
        const next = clampWidth(current)
        localStorage.setItem(WIDTH_STORAGE_KEY, String(next))
        return next
      })
      endResize()
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
    }
  }, [resizing, endResize])

  function startResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    event.preventDefault()
    dragRef.current = { startX: event.clientX, startWidth: width }
    setResizing(true)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  if (!open) return null

  return (
    <aside
      className="workspace-help-panel"
      aria-label={`${help.title}のヘルプ`}
      data-resizing={resizing ? true : undefined}
      style={{ width, minWidth: width, maxWidth: width }}
    >
      <div
        className="workspace-help-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label="ガイドパネルの幅を変更"
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={MAX_WIDTH}
        aria-valuenow={width}
        tabIndex={0}
        onPointerDown={startResize}
        onKeyDown={event => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
          event.preventDefault()
          setWidth(current => {
            const delta = event.key === 'ArrowLeft' ? 16 : -16
            const next = clampWidth(current + delta)
            localStorage.setItem(WIDTH_STORAGE_KEY, String(next))
            return next
          })
        }}
      />
      <div className="workspace-help-panel-header">
        <div>
          <p className="workspace-help-kicker">Guide</p>
          <h2>{help.title}</h2>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="ヘルプを閉じる"
          onClick={onClose}
        >
          <X />
        </Button>
      </div>
      <p className="workspace-help-summary">{help.summary}</p>
      <div className="workspace-help-body">
        <HelpBlock title="使い方" sections={help.usage} />
        <HelpBlock title="データ構造" sections={help.data} />
      </div>
    </aside>
  )
}
