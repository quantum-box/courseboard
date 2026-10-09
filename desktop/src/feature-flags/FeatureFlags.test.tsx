/* @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { FEATURE_FLAG_KEYS, FeatureFlagProvider, useFeatureFlag } from './FeatureFlags'
import { routeGateFrom } from './gated-routes'

const mock = vi.hoisted(() => ({ tenantId: 'tenant-a', evaluate: vi.fn() }))
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ tenant: { id: mock.tenantId } }) }))
vi.mock('./feature-flags-api', async importOriginal => ({
  ...await importOriginal<typeof import('./feature-flags-api')>(),
  evaluateFeatureFlags: mock.evaluate,
}))

function Draft() {
  const [year, setYear] = useState('2026')
  return <><input aria-label="対象年" value={year} onChange={event => setYear(event.target.value)} /><input aria-label="PDF" type="file" /></>
}
function GatedDraft() {
  const flag = useFeatureFlag(FEATURE_FLAG_KEYS.reservationReportImport)
  const gate = routeGateFrom(FEATURE_FLAG_KEYS.reservationReportImport, flag)
  return gate === 'visible' ? <Draft /> : <p>{gate}</p>
}
const tree = <FeatureFlagProvider><GatedDraft /></FeatureFlagProvider>
const flags = (enabled: boolean) => ({ [FEATURE_FLAG_KEYS.reservationReportImport]: enabled })
beforeEach(() => { mock.tenantId = 'tenant-a'; mock.evaluate.mockReset() })
afterEach(() => { cleanup(); vi.useRealTimers() })

it('keeps the selected PDF and year during focus and timer refresh, then honors disabling', async () => {
  vi.useFakeTimers()
  mock.evaluate.mockResolvedValueOnce(flags(true))
  render(tree)
  await act(async () => {})
  const year = screen.getByRole('textbox', { name: '対象年' })
  const input = screen.getByLabelText('PDF') as HTMLInputElement
  const file = new File(['%PDF synthetic'], 'acceptance.pdf', { type: 'application/pdf' })
  fireEvent.change(year, { target: { value: '2099' } })
  fireEvent.change(input, { target: { files: [file] } })
  let finish!: (value: Record<string, boolean>) => void
  mock.evaluate.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  fireEvent.focus(window)
  expect(screen.getByRole('textbox', { name: '対象年' })).toBe(year)
  expect((year as HTMLInputElement).value).toBe('2099')
  expect(screen.getByLabelText('PDF')).toBe(input)
  expect(input.files?.[0]).toBe(file)
  await act(async () => { finish(flags(true)) })
  await act(async () => { vi.advanceTimersByTime(60_000) })
  expect(screen.getByLabelText('PDF')).toBe(input)
  expect((year as HTMLInputElement).value).toBe('2099')
  await act(async () => { finish(flags(false)) })
  expect(screen.queryByLabelText('PDF')).toBeNull()
  expect(screen.getByText('hidden')).toBeTruthy()
})

it('waits for the new tenant and ignores a late refresh from the previous tenant', async () => {
  mock.evaluate.mockResolvedValueOnce(flags(true))
  const mounted = render(tree)
  await act(async () => {})
  let oldReply!: (value: Record<string, boolean>) => void
  let newReply!: (value: Record<string, boolean>) => void
  mock.evaluate.mockImplementationOnce(() => new Promise(resolve => { oldReply = resolve }))
  fireEvent.focus(window)
  mock.evaluate.mockImplementationOnce(() => new Promise(resolve => { newReply = resolve }))
  mock.tenantId = 'tenant-b'
  mounted.rerender(<FeatureFlagProvider><GatedDraft /></FeatureFlagProvider>)
  expect(screen.queryByLabelText('PDF')).toBeNull()
  expect(screen.getByText('loading')).toBeTruthy()
  await act(async () => { oldReply(flags(true)) })
  expect(screen.getByText('loading')).toBeTruthy()
  await act(async () => { newReply(flags(false)) })
  expect(screen.getByText('hidden')).toBeTruthy()
})

it('keeps a draft open while retrying an unavailable flag provider', async () => {
  mock.evaluate.mockRejectedValueOnce(new Error('provider unavailable'))
  render(tree)
  await act(async () => {})
  const year = screen.getByRole('textbox', { name: '対象年' })
  fireEvent.change(year, { target: { value: '2099' } })
  let finish!: (value: Record<string, boolean>) => void
  mock.evaluate.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  fireEvent.focus(window)
  expect(screen.getByRole('textbox', { name: '対象年' })).toBe(year)
  await act(async () => { finish(flags(true)) })
  expect(screen.getByRole('textbox', { name: '対象年' })).toBe(year)
  expect((year as HTMLInputElement).value).toBe('2099')
})
