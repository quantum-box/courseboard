/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearResourceCache } from '../../hooks/useResource'
import { i18next } from '../../i18n'
import { PageReloadProvider } from '../../lib/pageReload'
import { CaddiesPage } from './CaddiesPage'

const api = vi.hoisted(() => ({ json: vi.fn() }))
const toast = vi.hoisted(() => ({ show: vi.fn() }))

vi.mock('../../api', async importOriginal => {
  const actual = await importOriginal<typeof import('../../api')>()
  return { ...actual, courseboardApiJson: api.json }
})

vi.mock('../../lib/toast', () => ({ showToast: toast.show }))

type CaddieProfile = {
  id: string
  displayName: string
  staffId?: string | null
  staffReferenceType?: string
  staffReferenceId?: string | null
  active: boolean
  skillLevel: 'rookie' | 'regular' | 'veteran'
  rank: 'A' | 'B' | 'C' | 'D'
  employmentStatus: string
  baseFeeAmount: number
  currency: string
  maxRoundsPerDay: number
  monthlyContractRounds?: number
  canTwoRounds?: boolean
  desiredIncome?: number
  ratingAverage?: number | null
  ratingCount: number
}

const profilesPath = '/v1/course/caddie-profiles'
let storedProfiles: CaddieProfile[] = []
let postBodies: Record<string, unknown>[] = []
let patchBodies: Array<{ path: string; body: Record<string, unknown> }> = []
let profileGetCount = 0

function existingProfile(): CaddieProfile {
  return {
    id: 'caddie-existing',
    displayName: '既存キャディ',
    staffId: 'staff-existing',
    staffReferenceType: 'staff_member',
    staffReferenceId: 'staff-existing',
    active: true,
    skillLevel: 'regular',
    rank: 'C',
    employmentStatus: 'active',
    baseFeeAmount: 12000,
    currency: 'JPY',
    maxRoundsPerDay: 2,
    monthlyContractRounds: 25,
    canTwoRounds: true,
    desiredIncome: 400000,
    ratingAverage: null,
    ratingCount: 0,
  }
}

function renderPage(initialProfileId?: string) {
  return render(
    <I18nextProvider i18n={i18next}>
      <PageReloadProvider>
        <CaddiesPage initialProfileId={initialProfileId} />
      </PageReloadProvider>
    </I18nextProvider>,
  )
}

describe('CaddiesPage save paths', () => {
  beforeEach(async () => {
    await i18next.changeLanguage('ja')
    window.history.replaceState({}, '', '/')
    clearResourceCache()
    storedProfiles = [existingProfile()]
    postBodies = []
    patchBodies = []
    profileGetCount = 0
    api.json.mockReset()
    toast.show.mockReset()
    api.json.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === profilesPath && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>
        postBodies.push(body)
        const created: CaddieProfile = {
          id: 'caddie-created',
          displayName: String(body.displayName),
          staffId: 'staff-created',
          staffReferenceType: 'staff_member',
          staffReferenceId: 'staff-created',
          active: true,
          skillLevel: body.skillLevel as CaddieProfile['skillLevel'],
          rank: body.rank as CaddieProfile['rank'],
          employmentStatus: 'active',
          baseFeeAmount: Number(body.baseFeeAmount),
          currency: String(body.currency),
          maxRoundsPerDay: Number(body.maxRoundsPerDay),
          ratingAverage: null,
          ratingCount: 0,
        }
        storedProfiles = [...storedProfiles, created]
        return created
      }
      if (path.startsWith(`${profilesPath}/`) && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>
        patchBodies.push({ path, body })
        const id = decodeURIComponent(path.slice(`${profilesPath}/`.length))
        const current = storedProfiles.find(profile => profile.id === id)
        if (!current) throw new Error(`Unknown caddie: ${id}`)
        const updated = { ...current, ...body } as CaddieProfile
        storedProfiles = storedProfiles.map(profile => profile.id === id ? updated : profile)
        return updated
      }
      if (path === profilesPath && !init?.method) {
        profileGetCount += 1
        return {
          items: storedProfiles.map(profile => ({ ...profile })),
          staff: storedProfiles.flatMap(profile => profile.staffId ? [{
            id: profile.staffId,
            name: profile.displayName,
            active: true,
          }] : []),
        }
      }
      if (path.startsWith('/v1/course/caddie-assignments?')) return { items: [] }
      if (path === '/v1/course/courses') return { items: [] }
      if (path.startsWith('/v1/course/caddie-attendance-snapshot?')) {
        return {
          date: new URL(path, 'https://courseboard.test').searchParams.get('date'),
          items: [],
        }
      }
      if (/^\/v1\/course\/caddie-profiles\/[^/]+\/courses$/.test(path)) return { items: [] }
      if (path.startsWith('/v1/course/caddie-ratings?')) return { items: [] }
      throw new Error(`Unexpected API call: ${init?.method ?? 'GET'} ${path}`)
    })
  })

  afterEach(() => {
    cleanup()
    clearResourceCache()
  })

  it('creates a caddie through the real dialog and reads it back', async () => {
    storedProfiles = []
    const firstRender = renderPage()
    const addButtons = await screen.findAllByRole('button', { name: 'キャディを追加' })
    fireEvent.click(addButtons[0])

    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByRole('textbox', { name: /^名前/ }), {
      target: { value: '新キャディ' },
    })
    fireEvent.change(within(dialog).getByRole('spinbutton', { name: /個人ごとの1ラウンド単価/ }), {
      target: { value: '15000' },
    })
    fireEvent.change(within(dialog).getByRole('combobox', { name: /スキル/ }), {
      target: { value: 'veteran' },
    })
    fireEvent.change(within(dialog).getByRole('combobox', { name: /ランク/ }), {
      target: { value: 'A' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'キャディを作る' }))

    await waitFor(() => expect(postBodies).toEqual([{
      displayName: '新キャディ',
      skillLevel: 'veteran',
      rank: 'A',
      baseFeeAmount: 15000,
      currency: 'JPY',
      active: true,
      employmentStatus: 'active',
      maxRoundsPerDay: 2,
    }]))
    expect(await screen.findByText('新キャディ')).toBeTruthy()
    expect(profileGetCount).toBeGreaterThanOrEqual(2)

    firstRender.unmount()
    clearResourceCache()
    renderPage('caddie-created')
    expect(await screen.findByRole('heading', { name: '新キャディ' })).toBeTruthy()
    expect(screen.getByText('Aランク')).toBeTruthy()
    expect(screen.getByText('ベテラン')).toBeTruthy()
  })

  it('edits a caddie through the real dialog and reads the update back', async () => {
    const firstRender = renderPage('caddie-existing')
    fireEvent.click(await screen.findByRole('button', { name: '基本の情報を直す' }))

    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByRole('combobox', { name: /スキル/ }), {
      target: { value: 'rookie' },
    })
    fireEvent.change(within(dialog).getByRole('combobox', { name: /ランク/ }), {
      target: { value: 'B' },
    })
    fireEvent.change(within(dialog).getByRole('combobox', { name: /出勤の状態/ }), {
      target: { value: 'inactive' },
    })
    fireEvent.change(within(dialog).getByRole('spinbutton', { name: /個人ごとの1ラウンド単価/ }), {
      target: { value: '16000' },
    })
    fireEvent.change(within(dialog).getByRole('textbox', { name: /通貨/ }), {
      target: { value: 'USD' },
    })
    fireEvent.change(within(dialog).getByRole('spinbutton', { name: /1日の上限/ }), {
      target: { value: '3' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }))

    await waitFor(() => expect(patchBodies).toEqual([{
      path: `${profilesPath}/caddie-existing`,
      body: {
        staffId: 'staff-existing',
        caddieCode: null,
        staffReferenceType: 'staff_member',
        staffReferenceId: 'staff-existing',
        skillLevel: 'rookie',
        rank: 'B',
        active: false,
        employmentStatus: 'inactive',
        baseFeeAmount: 16000,
        currency: 'USD',
        maxRoundsPerDay: 3,
        monthlyContractRounds: 25,
        canTwoRounds: true,
        desiredIncome: 400000,
      },
    }]))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(profileGetCount).toBeGreaterThanOrEqual(2)

    firstRender.unmount()
    clearResourceCache()
    renderPage('caddie-existing')
    expect(await screen.findByRole('heading', { name: '既存キャディ' })).toBeTruthy()
    expect(screen.getByText('Bランク')).toBeTruthy()
    expect(screen.getByText('新人')).toBeTruthy()
    expect(screen.getByText('休んでいる')).toBeTruthy()
  })
})
