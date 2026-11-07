/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, expect, it } from 'vitest'
import { i18next } from '../../i18n'
import { AutoAssignReservationRow } from './AutoAssignReservationRow'

afterEach(cleanup)
it('shows group size and competition and expands the matching booking details', async () => {
  await i18next.changeLanguage('ja')
  render(<I18nextProvider i18n={i18next}><AutoAssignReservationRow timeLabel="11/6 07:00" round={{
    id: 'r1', reservationNumber: 'R-100', golfCourseId: 'east', courseName: '空沼 OUT',
    teeTime: '2026-11-06T07:00:00+09:00', playType: 'caddie', partySize: 4,
    partyName: '山田組', displayName: '空沼18H キャディ付き',
    party: { competitionName: '秋の親睦コンペ', groupNumber: 2, organizer: '山田 太郎',
      players: [{ name: '山田 太郎' }, { name: '佐藤 花子' }] },
  }}>→ 鈴木 美穂</AutoAssignReservationRow></I18nextProvider>)
  expect(screen.getByText('秋の親睦コンペ · 2組')).toBeTruthy()
  expect(screen.getByText('空沼 OUT · 4名')).toBeTruthy()
  const summary = screen.getByLabelText('11/6 07:00 秋の親睦コンペ の予約詳細')
  expect(summary.closest('details')?.open).toBe(false)
  fireEvent.click(summary)
  expect(summary.closest('details')?.open).toBe(true)
  expect(screen.getByText('R-100')).toBeTruthy()
  expect(screen.getByText('空沼18H キャディ付き')).toBeTruthy()
  expect(screen.getByText('佐藤 花子')).toBeTruthy()
  expect(screen.getAllByText('名前未入力')).toHaveLength(2)
})
