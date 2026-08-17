// @vitest-environment jsdom

import { act, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  PageReloadProvider,
  usePageReload,
  useRegisterPageReload,
} from './pageReload'

describe('page reload lifecycle', () => {
  it('does not report completion until the registered reload finishes', async () => {
    let finishReload: (() => void) | undefined
    const handler = vi.fn(() => new Promise<void>(resolve => {
      finishReload = resolve
    }))
    let trigger: ReturnType<typeof usePageReload>['triggerPageReload'] | undefined

    function Harness() {
      useRegisterPageReload(handler)
      trigger = usePageReload().triggerPageReload
      return null
    }

    render(
      <PageReloadProvider>
        <Harness />
      </PageReloadProvider>,
    )

    const reload = trigger?.()
    expect(reload).not.toBe(false)
    await Promise.resolve()
    expect(handler).toHaveBeenCalledOnce()

    let completed = false
    void (reload as Promise<void>).then(() => {
      completed = true
    })
    expect(completed).toBe(false)

    await act(async () => {
      finishReload?.()
      await reload
    })
    expect(completed).toBe(true)
  })
})
