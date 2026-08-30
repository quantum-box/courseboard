/* @vitest-environment jsdom */

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { clearResourceCache } from '../../hooks/useResource'
import { i18next } from '../../i18n'
import { PageReloadProvider } from '../../lib/pageReload'
import { CaddiesPage } from './CaddiesPage'

const api = vi.hoisted(() => ({ json: vi.fn() }))

vi.mock('../../api', async importOriginal => {
  const actual = await importOriginal<typeof import('../../api')>()
  return { ...actual, courseboardApiJson: api.json }
})

vi.mock('../../lib/toast', () => ({ showToast: vi.fn() }))

const profilesPath = '/v1/course/caddie-profiles'

function caddie(id: string, displayName: string, staffId: string | null) {
  return {
    id,
    displayName,
    staffId,
    staffReferenceType: staffId ? 'staff_member' : undefined,
    staffReferenceId: staffId,
    active: true,
    skillLevel: 'regular' as const,
    employmentStatus: 'active',
    baseFeeAmount: 0,
    currency: 'JPY',
    maxRoundsPerDay: 1,
    ratingAverage: null,
    ratingCount: 0,
  }
}

function staffMember(id: string, name: string) {
  return {
    id,
    name,
    active: true,
    employmentStatus: 'active',
    employmentType: 'part_time',
    hiredAt: null,
  }
}

/** The roster as the demo club actually had it: two links Field cannot resolve. */
function roster(options: { withStaffIndex?: boolean } = {}) {
  const { withStaffIndex = true } = options
  const items = [
    caddie('cad-1', '髙田卓哉', 'stf-1'),
    caddie('cad-2', '動作確認 キャディ同期', 'stf-gone-1'),
    caddie('cad-3', '動作確認 削除順', 'stf-gone-2'),
    caddie('cad-4', 'まだ紐づけていない人', null),
  ]
  const staff = [staffMember('stf-1', '髙田卓哉')]
  return withStaffIndex ? { items, staff } : { items }
}

function renderPage() {
  render(
    <I18nextProvider i18n={i18next}>
      <PageReloadProvider>
        <CaddiesPage />
      </PageReloadProvider>
    </I18nextProvider>,
  )
}

describe('a caddie whose staff record Field no longer has', () => {
  beforeEach(async () => {
    await i18next.changeLanguage('ja')
    window.history.replaceState({}, '', '/')
    clearResourceCache()
    api.json.mockReset()
  })

  afterEach(cleanup)

  it('says so on the roster instead of calling the caddie linked', async () => {
    // Without this the row reads "スタッフと紐づけずみ" — the id is present, so
    // nothing on the screen distinguishes a live link from a dead one, and the
    // desk has no way to find the two people who dropped out of payroll.
    api.json.mockImplementation(async (path: string) => {
      if (path === profilesPath) return roster()
      return { items: [] }
    })
    renderPage()

    await waitFor(() =>
      expect(screen.getByText(
        i18next.t('caddies:roster.brokenLinkWarning.title', { n: '2' }),
      )).toBeTruthy(),
    )
    expect(screen.getAllByText(i18next.t('caddies:roster.linkBroken')).length).toBe(2)
  })

  it('keeps the two warnings apart', async () => {
    // The unlinked notice counts a missing id. These caddies have one, so
    // folding them together would report the same roster problem twice and
    // lose which of the two things went wrong.
    api.json.mockImplementation(async (path: string) => {
      if (path === profilesPath) return roster()
      return { items: [] }
    })
    renderPage()

    await waitFor(() =>
      expect(screen.getByText(
        i18next.t('caddies:roster.brokenLinkWarning.title', { n: '2' }),
      )).toBeTruthy(),
    )
    expect(screen.getByText(
      i18next.t('caddies:roster.unlinkedWarning.title', { n: '1' }),
    )).toBeTruthy()
  })

  it('stays quiet when every link resolves', async () => {
    api.json.mockImplementation(async (path: string) => {
      if (path === profilesPath) {
        return { items: [caddie('cad-1', '髙田卓哉', 'stf-1')], staff: [staffMember('stf-1', '髙田卓哉')] }
      }
      return { items: [] }
    })
    renderPage()

    await waitFor(() => expect(screen.getByText('髙田卓哉')).toBeTruthy())
    expect(screen.queryByText(i18next.t('caddies:roster.linkBroken'))).toBeNull()
    expect(screen.getByText(i18next.t('caddies:roster.linked'))).toBeTruthy()
  })

  it('accuses nobody when the roster arrives without a staff index', async () => {
    // A response with no staff index is not Field saying it has no staff. The
    // old shape omitted it, and reading that as an empty roster would mark
    // every linked caddie broken the moment an older deployment answers.
    api.json.mockImplementation(async (path: string) => {
      if (path === profilesPath) return roster({ withStaffIndex: false })
      return { items: [] }
    })
    renderPage()

    await waitFor(() => expect(screen.getByText('髙田卓哉')).toBeTruthy())
    expect(screen.queryByText(i18next.t('caddies:roster.linkBroken'))).toBeNull()
  })
})
