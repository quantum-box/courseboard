/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { clearResourceCache } from '../../hooks/useResource'
import { i18next } from '../../i18n'
import { NameCaddieSheet } from './UnassignedRounds'

const api = vi.hoisted(() => ({ json: vi.fn() }))

vi.mock('../../api', async importOriginal => {
  const actual = await importOriginal<typeof import('../../api')>()
  return { ...actual, courseboardApiJson: api.json }
})

vi.mock('../../lib/toast', () => ({ showToast: vi.fn() }))

const round = {
  id: 'reservation-1',
  reservationNumber: 'R-1',
  golfCourseId: 'course-east',
  courseName: '東コース',
  teeTime: '2026-08-08T07:00:00+09:00',
  playType: 'caddie',
  partySize: 4,
  partyName: '山田組',
}

function candidate(status?: 'unconfirmed' | 'unplaced' | 'on_course') {
  return {
    caddieProfileId: 'caddie-1',
    displayName: '佐藤 彩',
    skillLevel: 'veteran',
    ratingAverage: 4.8,
    ratingCount: 42,
    roundsAssigned: 0,
    remainingRounds: 1,
    attendanceStatus: 'working' as const,
    recommendationScore: 161,
    recommendedRole: 'primary',
    pairingDisplayName: null,
    rationale: ['on_duty'],
    ...(status === undefined ? {} : { shiftPlacementStatus: status }),
  }
}

function renderSheet() {
  return render(
    <I18nextProvider i18n={i18next}>
      <NameCaddieSheet
        round={round}
        onClose={vi.fn()}
        onNamed={vi.fn()}
      />
    </I18nextProvider>,
  )
}

describe('NameCaddieSheet shift placement warning', () => {
  beforeEach(async () => {
    await i18next.changeLanguage('ja')
    clearResourceCache()
    api.json.mockReset()
    api.json.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.startsWith('/v1/course/caddie-recommendations?')) {
        return { items: [candidate('on_course')] }
      }
      if (path === '/v1/course/caddie-assignments' && init?.method === 'POST') return {}
      throw new Error(`Unexpected API call: ${init?.method ?? 'GET'} ${path}`)
    })
  })

  afterEach(() => {
    cleanup()
    clearResourceCache()
    vi.restoreAllMocks()
  })

  it.each([
    ['unconfirmed', '当日のシフトが未確定'],
    ['unplaced', 'コース未割付'],
  ] as const)('shows the %s badge', async (status, label) => {
    api.json.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.startsWith('/v1/course/caddie-recommendations?')) {
        return { items: [candidate(status)] }
      }
      if (path === '/v1/course/caddie-assignments' && init?.method === 'POST') return {}
      throw new Error(`Unexpected API call: ${init?.method ?? 'GET'} ${path}`)
    })
    renderSheet()

    expect(await screen.findByText(label)).toBeTruthy()
  })

  it.each([
    ['on_course', 'on-course placement'],
    [undefined, 'old response without placement'],
  ] as const)('does not warn for %s', async (status, _description) => {
    api.json.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.startsWith('/v1/course/caddie-recommendations?')) {
        return { items: [candidate(status)] }
      }
      if (path === '/v1/course/caddie-assignments' && init?.method === 'POST') return {}
      throw new Error(`Unexpected API call: ${init?.method ?? 'GET'} ${path}`)
    })
    renderSheet()

    await screen.findByText('佐藤 彩')
    expect(screen.queryByText('当日のシフトが未確定')).toBeNull()
    expect(screen.queryByText('コース未割付')).toBeNull()
  })

  it('does not start saving or POST when the manual confirmation is cancelled', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const posts: unknown[] = []
    api.json.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.startsWith('/v1/course/caddie-recommendations?')) return { items: [candidate('unconfirmed')] }
      if (path === '/v1/course/caddie-assignments' && init?.method === 'POST') {
        posts.push(init.body)
        return {}
      }
      throw new Error(`Unexpected API call: ${init?.method ?? 'GET'} ${path}`)
    })
    renderSheet()

    const pick = await screen.findByRole('button', { name: 'この人にする' })
    fireEvent.click(pick)

    await waitFor(() => expect(confirm).toHaveBeenCalledOnce())
    expect(posts).toEqual([])
    expect(screen.getByRole('button', { name: 'この人にする' })).toBeTruthy()
  })

  it('POSTs the existing assignment when the warning is accepted', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const posts: RequestInit[] = []
    api.json.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.startsWith('/v1/course/caddie-recommendations?')) return { items: [candidate('unplaced')] }
      if (path === '/v1/course/caddie-assignments' && init?.method === 'POST') {
        posts.push(init)
        return {}
      }
      throw new Error(`Unexpected API call: ${init?.method ?? 'GET'} ${path}`)
    })
    renderSheet()

    fireEvent.click(await screen.findByRole('button', { name: 'この人にする' }))

    await waitFor(() => expect(posts).toHaveLength(1))
    expect(JSON.parse(String(posts[0]?.body))).toEqual({
      caddieProfileId: 'caddie-1',
      reservationId: 'reservation-1',
      scheduledAt: round.teeTime,
    })
  })
})
