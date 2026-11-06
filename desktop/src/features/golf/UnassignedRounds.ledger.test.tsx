/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { clearResourceCache } from '../../hooks/useResource'
import { i18next } from '../../i18n'
import { UnassignedRoundsPanel, type TeeSheetRow } from './UnassignedRounds'

const api = vi.hoisted(() => ({ json: vi.fn() }))
vi.mock('../../api', async importOriginal => ({
  ...await importOriginal<typeof import('../../api')>(), courseboardApiJson: api.json,
}))
vi.mock('../../lib/toast', () => ({ showToast: vi.fn() }))

function round(id: string, changes: Partial<TeeSheetRow> = {}): TeeSheetRow {
  return {
    id, reservationNumber: id, golfCourseId: 'east', courseName: '東コース',
    teeTime: '2026-11-06T08:00:00+09:00', playType: 'caddie', partySize: 4,
    partyName: '佐藤 太郎', status: 'confirmed',
    party: { competitionName: '秋の親睦杯', groupNumber: 1, players: [
      { name: '佐藤 太郎' }, { name: '鈴木 花子' }, { name: '高橋 健一' }, { name: '田中 美咲' },
    ] },
    ...changes,
  }
}

function showPanel(rows: TeeSheetRow[], initialAssignments: Array<{ reservationId: string; status: string }> = []) {
  const refresh = vi.fn()
  const horizonChange = vi.fn()
  function Harness() {
    const [assignments, setAssignments] = useState(initialAssignments)
    return <UnassignedRoundsPanel sheet={{ data: { items: rows }, error: null, loading: false, refresh }}
      assignments={assignments} horizon={14} onHorizonChange={horizonChange}
      onChanged={() => setAssignments([...assignments, { reservationId: 'pending', status: 'assigned' }])} />
  }
  render(<I18nextProvider i18n={i18next}><Harness /></I18nextProvider>)
  return { refresh, horizonChange }
}

describe('unassigned booking ledger', () => {
  beforeEach(async () => {
    await i18next.changeLanguage('ja')
    clearResourceCache()
    api.json.mockReset()
    api.json.mockImplementation(async (path: string) => {
      if (path.startsWith('/v1/course/caddie-recommendations?')) return { items: [{
        caddieProfileId: 'caddie-1', displayName: '山田 美穂', skillLevel: 'veteran',
        ratingCount: 0, roundsAssigned: 0, remainingRounds: 1, recommendationScore: 100,
        rationale: [], shiftPlacementStatus: 'on_course',
      }] }
      return {}
    })
  })
  afterEach(() => { cleanup(); clearResourceCache(); vi.restoreAllMocks() })

  it('does not call an empty day fully assigned', () => {
    showPanel([])
    expect(screen.getByText('キャディ付きの予約がありません')).toBeTruthy()
    expect(screen.queryByText('すべての組に担当がいます')).toBeNull()
  })

  it('shows fully assigned only when caddie bookings exist', () => {
    showPanel([round('assigned')], [{ reservationId: 'assigned', status: 'assigned' }])
    expect(screen.getByText('すべての組に担当がいます')).toBeTruthy()
  })

  it('starts with familiar group/player columns and shows only unassigned caddie bookings', () => {
    showPanel([
      round('pending'), round('already-assigned', { partyName: '配置済みの組', party: undefined }),
      round('self', { playType: 'self', partyName: 'セルフの組', party: undefined }),
      round('cancelled', { status: 'cancelled', partyName: 'キャンセルした組', party: undefined }),
    ], [{ reservationId: 'already-assigned', status: 'assigned' }])
    expect(screen.getByRole('button', { name: '台帳表示' }).getAttribute('aria-pressed')).toBe('true')
    const table = screen.getByRole('table')
    expect(within(table).getByRole('columnheader', { name: 'プレイヤー4' })).toBeTruthy()
    expect(within(table).getByText('秋の親睦杯 1組')).toBeTruthy()
    expect(within(table).getByText('鈴木 花子')).toBeTruthy()
    expect(screen.queryByText('配置済みの組')).toBeNull()
    expect(screen.queryByText('セルフの組')).toBeNull()
    expect(screen.queryByText('キャンセルした組')).toBeNull()
  })

  it('assigns the clicked booking and removes it from the pending ledger after refresh', async () => {
    const { refresh } = showPanel([round('pending')])
    fireEvent.click(screen.getByRole('button', { name: /08:00 佐藤 太郎 のキャディを決める/ }))
    expect(await screen.findByText('山田 美穂')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'この人にする' }))
    await waitFor(() => expect(screen.getByText('すべての組に担当がいます')).toBeTruthy())
    const call = api.json.mock.calls.find(([path]) => path === '/v1/course/caddie-assignments')
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      caddieProfileId: 'caddie-1', reservationId: 'pending', scheduledAt: '2026-11-06T08:00:00+09:00',
    })
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('keeps same-time groups on different days separate and preserves course filtering across views', async () => {
    showPanel([
      round('pending'),
      round('tomorrow', { golfCourseId: 'west', courseName: '西コース', teeTime: '2026-11-07T08:00:00+09:00', partyName: '明日の組', party: undefined }),
    ])
    expect(screen.getAllByRole('table')).toHaveLength(2)
    fireEvent.change(screen.getByRole('combobox', { name: 'コースで絞る' }), { target: { value: 'west' } })
    expect(screen.getAllByRole('table')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: '一覧表示' }))
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getByText('明日の組')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '台帳表示' }))
    fireEvent.click(screen.getByRole('button', { name: '08:00 明日の組 のキャディを決める' }))
    await screen.findByText('山田 美穂')
    expect(api.json.mock.calls[0]?.[0]).toContain('scheduledAt=2026-11-07T08%3A00%3A00%2B09%3A00')
    expect(api.json.mock.calls[0]?.[0]).toContain('golfCourseId=west')
  })

  it('keeps multiple groups at one tee time and every named player visible', () => {
    showPanel([
      round('one'), round('two', { partyName: '二組目', party: { players: [
        { name: '山本 誠' }, { name: '山本 恵' }, { name: '山本 健' }, { name: '山本 陽子' }, { name: '五人目' },
      ] }, partySize: 5 }),
    ])
    expect(screen.getByRole('columnheader', { name: 'プレイヤー5' })).toBeTruthy()
    expect(screen.getByText('五人目')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /のキャディを決める/ })).toHaveLength(2)
  })

  it('lets the operator return to other courses after finishing the selected course', async () => {
    showPanel([round('pending'), round('west', {
      golfCourseId: 'west', courseName: '西コース', partyName: '西の組', party: undefined,
    })])
    fireEvent.change(screen.getByRole('combobox', { name: 'コースで絞る' }), { target: { value: 'east' } })
    fireEvent.click(screen.getByRole('button', { name: /08:00 佐藤 太郎 のキャディを決める/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'この人にする' }))
    await screen.findByText('このコースに未配置の組はありません')
    fireEvent.change(screen.getByRole('combobox', { name: 'コースで絞る' }), { target: { value: '' } })
    expect(screen.getByText('西の組')).toBeTruthy()
  })
})
