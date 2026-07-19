import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react'

type ReloadHandler = () => void

type PageReloadContextValue = {
  registerPageReload: (handler: ReloadHandler) => () => void
  triggerPageReload: () => boolean
}

const PageReloadContext = createContext<PageReloadContextValue | null>(null)

export function PageReloadProvider({ children }: { children: ReactNode }) {
  const handlersRef = useRef(new Set<ReloadHandler>())

  const registerPageReload = useCallback((handler: ReloadHandler) => {
    handlersRef.current.add(handler)
    return () => {
      handlersRef.current.delete(handler)
    }
  }, [])

  const triggerPageReload = useCallback(() => {
    const handlers = [...handlersRef.current]
    if (handlers.length === 0) return false
    for (const handler of handlers) handler()
    return true
  }, [])

  const value = useMemo(
    () => ({ registerPageReload, triggerPageReload }),
    [registerPageReload, triggerPageReload],
  )

  return (
    <PageReloadContext.Provider value={value}>
      {children}
    </PageReloadContext.Provider>
  )
}

export function usePageReload() {
  const context = useContext(PageReloadContext)
  if (!context) {
    throw new Error('usePageReload must be used within PageReloadProvider')
  }
  return context
}

/** Register the current screen's reload action for ⌘R / Ctrl+R. */
export function useRegisterPageReload(handler: ReloadHandler | null | undefined) {
  const { registerPageReload } = usePageReload()
  const handlerRef = useRef(handler)
  handlerRef.current = handler
  const enabled = Boolean(handler)

  useEffect(() => {
    if (!enabled) return
    return registerPageReload(() => {
      handlerRef.current?.()
    })
  }, [enabled, registerPageReload])
}
