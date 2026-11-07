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

function showPanel(rows: TeeSheetRow[], initialAssignments: Array<{ reservationId: string; status: string; caddieProfileId?: string }> = []) {
  const refresh = vi.fn()
  const horizonChange = vi.fn()
  function Harness() {
    const [assignments, setAssignments] = useState(initialAssignments)
    return <UnassignedRoundsPanel sheet={{ data: { items: rows }, error: null, loading: false, refresh }}
      profiles={[{ id: 'caddie-1', displayName: '山田 美穂' }]} assignments={assignments} horizon={14} onHorizonChange={horizonChange}
      onChanged={() => setAssignments([...assignments, { reservationId: 'pending', status: 'assigned', caddieProfileId: 'caddie-1' }])} />
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

  it('keeps fully assigned bookings visible', () => {
    showPanel([round('assigned')], [{ reservationId: 'assigned', status: 'assigned' }])
    expect(screen.getByRole('table')).toBeTruthy()
    expect(screen.getByText('配置済み')).toBeTruthy()
  })

  it('starts with familiar group/player columns and keeps assigned caddie bookings too', () => {
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
    expect(screen.getByText('配置済みの組')).toBeTruthy()
    expect(screen.queryByText('セルフの組')).toBeNull()
    expect(screen.queryByText('キャンセルした組')).toBeNull()
  })

  it('assigns the clicked booking and keeps it with the assigned caddie after refresh', async () => {
    const { refresh } = showPanel([round('pending')])
    fireEvent.click(screen.getByRole('button', { name: /08:00 佐藤 太郎 のキャディを決める/ }))
    expect(await screen.findByText('山田 美穂')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'この人にする' }))
    await waitFor(() => expect(screen.getByRole('button', { name: /山田 美穂/ })).toBeTruthy())
    expect(screen.getByText('秋の親睦杯 1組')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /のキャディを決める/ })).toBeNull()
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
    await screen.findByRole('button', { name: /山田 美穂/ })
    expect(screen.getByRole('table')).toBeTruthy()
    fireEvent.change(screen.getByRole('combobox', { name: 'コースで絞る' }), { target: { value: '' } })
    expect(screen.getByText('西の組')).toBeTruthy()
  })
  it('groups OUT/IN by club and retains assignments across both views', () => {
    showPanel([
      round('s-out', { courseName: '真駒内 空沼OUT', golfCourseId: 's-out', partyName: '空沼の組', party: undefined }),
      round('s-in', { courseName: '空沼IN', golfCourseId: 's-in', partyName: 'INの組', party: undefined }),
      round('m-out', { courseName: '藻岩OUT', golfCourseId: 'm-out' }),
      round('takino', { courseName: '滝のCC 東コース', golfCourseId: 'takino', partyName: '滝の組', party: undefined }),
      round('hitsujigaoka', { courseName: '羊ケ丘OUT', golfCourseId: 'hitsujigaoka', partyName: '羊の組', party: undefined }),
    ], [{ reservationId: 's-out', status: 'assigned', caddieProfileId: 'caddie-1' }])
    expect(screen.getByRole('button', { name: '真駒内' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getAllByRole('table')).toHaveLength(3)
    expect(screen.getByText('空沼の組')).toBeTruthy()
    expect(screen.getByRole('button', { name: /山田 美穂/ })).toBeTruthy()
    expect(screen.queryByText('滝の組')).toBeNull()
    fireEvent.change(screen.getByRole('combobox', { name: 'コースで絞る' }), { target: { value: 's-in' } })
    fireEvent.click(screen.getByRole('button', { name: '滝の' }))
    expect(screen.getByText('滝の組')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '羊ヶ丘' }))
    expect(screen.getByText('羊の組')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '真駒内' }))
    fireEvent.click(screen.getByRole('button', { name: '一覧表示' }))
    expect(screen.getByText('空沼の組')).toBeTruthy()
    expect(screen.getByRole('button', { name: /山田 美穂/ })).toBeTruthy()
  })

})
