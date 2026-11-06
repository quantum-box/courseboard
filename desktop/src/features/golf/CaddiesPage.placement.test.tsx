/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { clearResourceCache } from '../../hooks/useResource'
import { i18next } from '../../i18n'
import { AutoAssignPanel } from './CaddiesPage'

const api = vi.hoisted(() => ({ json: vi.fn() }))

vi.mock('../../api', async importOriginal => {
  const actual = await importOriginal<typeof import('../../api')>()
  return { ...actual, courseboardApiJson: api.json }
})

vi.mock('../../lib/toast', () => ({ showToast: vi.fn() }))

const calls: Array<{ path: string; init?: RequestInit }> = []

function result(statuses: Array<'unconfirmed' | 'unplaced' | 'on_course' | undefined>, deadline = true) {
  return {
    dryRun: true,
    assigned: statuses.map((status, index) => ({
      reservationId: `reservation-${index + 1}`,
      scheduledAt: `2026-08-08T0${7 + index}:00:00+09:00`,
      caddieProfileId: `caddie-${index + 1}`,
      caddieDisplayName: ['佐藤 彩', '高橋 浩', '山田 花子'][index] ?? `キャディ${index + 1}`,
      rationale: ['on_duty'],
      ...(status === undefined ? {} : { shiftPlacementStatus: status }),
    })),
    skipped: [],
    ...(deadline ? {
      deadlineWarning: {
        deadlineDate: '2026-08-20',
        unsubmittedCaddieNames: ['佐藤 彩'],
      },
    } : {}),
  }
}

function renderPanel(date = '2026-08-08') {
  return render(
    <I18nextProvider i18n={i18next}>
      <AutoAssignPanel
        date={date}
        onChanged={vi.fn()}
        setFlash={vi.fn()}
      />
    </I18nextProvider>,
  )
}

describe('AutoAssignPanel shift placement warning', () => {
  beforeEach(async () => {
    await i18next.changeLanguage('ja')
    clearResourceCache()
    calls.length = 0
    api.json.mockReset()
    api.json.mockImplementation(async (path: string, init?: RequestInit) => {
      calls.push({ path, init })
      return result(['unconfirmed', 'unplaced', 'on_course'], true)
    })
  })

  afterEach(() => {
    cleanup()
    clearResourceCache()
    vi.restoreAllMocks()
  })

  it('explains who cannot take each skipped round', async () => {
    api.json.mockResolvedValue({ dryRun: true, assigned: [], skipped: [{
      reservationId: 'round-skipped', scheduledAt: '2026-11-06T09:00:00+09:00', reason: 'no_caddie_available',
      unavailableCaddies: [
        { caddieProfileId: 'c1', displayName: '田中 恵美', reasons: ['busy', 'daily_limit'] },
        { caddieProfileId: 'c2', displayName: '山田 美穂', reasons: ['outside_shift'] },
      ],
    }] })
    renderPanel('2026-11-06')
    fireEvent.click(screen.getByRole('button', { name: 'キャディを自動配置' }))
    expect(await screen.findByText('候補者ごとの理由（2人）')).toBeTruthy()
    fireEvent.click(screen.getByText('候補者ごとの理由（2人）'))
    expect(screen.getByText('田中 恵美')).toBeTruthy()
    expect(screen.getByText('別の組・業務を担当中 · この日の担当上限に到達')).toBeTruthy()
    expect(screen.getByText('山田 美穂')).toBeTruthy()
    expect(screen.getByText('この時間はシフト対象外・休み')).toBeTruthy()
  })

  it('opens the preview in a dialog and closes without assigning', async () => {
    renderPanel()
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'キャディを自動配置' }))
    await waitFor(() => expect(screen.getByText('佐藤 彩')).toBeTruthy())
    expect(screen.getByRole('dialog', { name: '自動で配置する' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(calls).toHaveLength(1)
    expect(JSON.parse(String(calls[0]?.init?.body)).dryRun).toBe(true)
  })

  it('shows badges and one aggregate notice for unconfirmed and unplaced preview rows', async () => {
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'キャディを自動配置' }))

    await waitFor(() => expect(screen.getByText('佐藤 彩')).toBeTruthy())
    expect(screen.getAllByText('当日のシフトが未確定')).toHaveLength(1)
    expect(screen.getAllByText('コース未割付')).toHaveLength(1)
    expect(screen.getByText('シフト配置を確認してください')).toBeTruthy()
    expect(screen.getByText(/配置はできますが、供給異常として表示されます/)).toBeTruthy()
  })

  it('does not show placement warnings for on-course or old response rows', async () => {
    api.json.mockImplementation(async (path: string, init?: RequestInit) => {
      calls.push({ path, init })
      return result(['on_course', undefined], false)
    })
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'キャディを自動配置' }))

    await waitFor(() => expect(screen.getByText('佐藤 彩')).toBeTruthy())
    expect(screen.queryByText('当日のシフトが未確定')).toBeNull()
    expect(screen.queryByText('コース未割付')).toBeNull()
    expect(screen.queryByText(/供給異常として表示されます/)).toBeNull()
  })

  it.each(['2026-08-08', '2026-08-15'])(
    'allows planning for %s without an attendance warning or confirmation',
    async date => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
      api.json.mockImplementation(async (path: string, init?: RequestInit) => {
        calls.push({ path, init })
        const plan = result(['on_course'], false)
        plan.assigned[0]!.rationale = ['not_clocked_in']
        plan.assigned[0]!.scheduledAt = `${date}T07:00:00+09:00`
        return plan
      })
      renderPanel(date)
      fireEvent.click(screen.getByRole('button', { name: 'キャディを自動配置' }))

      await waitFor(() => expect(screen.getByText('佐藤 彩')).toBeTruthy())
      expect(screen.getByText('未出勤')).toBeTruthy()
      expect(screen.queryByText(/出勤していない候補/)).toBeNull()
      expect(screen.queryByText(/当日中に出勤の打刻/)).toBeNull()

      fireEvent.click(screen.getByRole('button', { name: 'この配置で決める' }))
      await waitFor(() => expect(calls).toHaveLength(2))
      expect(confirm).not.toHaveBeenCalled()
      expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({ date, dryRun: false })
    },
  )

  it('combines placement and deadline warnings in one non-blocking execute confirmation', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'キャディを自動配置' }))
    await waitFor(() => expect(screen.getByText('佐藤 彩')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'この配置で決める' }))
    await waitFor(() => expect(confirm).toHaveBeenCalledOnce())
    expect(confirm.mock.calls[0]?.[0]).toContain('休み希望がまだ届いていません')
    expect(confirm.mock.calls[0]?.[0]).toContain('シフト配置を確認してください')
    expect(confirm.mock.calls[0]?.[0]).toContain('佐藤 彩：当日のシフトが未確定')
    expect(calls).toHaveLength(1)

    confirm.mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: 'この配置で決める' }))
    await waitFor(() => expect(calls).toHaveLength(2))
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({
      date: '2026-08-08',
      dryRun: false,
    })
  })
})
