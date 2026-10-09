/* @vitest-environment jsdom */
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ viewport: vi.fn(), destroy: vi.fn() }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {}, getDocument: () => ({
  promise: Promise.resolve({ numPages: 1, getPage: async () => ({ rotate: 90, getViewport: mock.viewport, render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }) }) }),
  destroy: mock.destroy,
}) }))
import { PdfPages } from './PdfPages'
beforeEach(() => {
  vi.clearAllMocks()
  mock.viewport.mockReturnValue({ width: 100, height: 200 })
  vi.stubGlobal('IntersectionObserver', class {
    constructor(private callback: IntersectionObserverCallback) {}
    observe(target: Element) { this.callback([{ target, isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver) }
    disconnect() {}
  })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
it.each([0, 90, 180, 270] as const)('adds selected rotation %i to the PDF authored rotation before confirming rendering', async rotation => {
  const rendered = vi.fn()
  render(<PdfPages url="blob:verified" sourceIndex={0} rotation={rotation} pages={[1]} onRendered={rendered} />)
  await waitFor(() => expect(rendered).toHaveBeenCalledWith(1))
  expect(mock.viewport).toHaveBeenCalledWith({ scale: 1.5, rotation: (90 + rotation) % 360 })
})
it('preserves authored rotation for existing viewers that do not request a rotation', async () => {
  const rendered = vi.fn()
  render(<PdfPages url="blob:verified" sourceIndex={0} onRendered={rendered} />)
  await waitFor(() => expect(rendered).toHaveBeenCalledWith(1))
  expect(mock.viewport).toHaveBeenCalledWith({ scale: 1.5, rotation: 90 })
})
