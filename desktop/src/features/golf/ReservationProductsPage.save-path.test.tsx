/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearResourceCache } from '../../hooks/useResource'
import { i18next } from '../../i18n'
import { PageReloadProvider } from '../../lib/pageReload'
import type { GolfCourse, GolfReservationProduct } from './models'
import { ReservationProductsPage } from './ReservationProductsPage'

const api = vi.hoisted(() => ({ json: vi.fn() }))
const toast = vi.hoisted(() => ({ show: vi.fn() }))
const router = vi.hoisted(() => ({ navigate: vi.fn() }))

vi.mock('../../api', async importOriginal => {
  const actual = await importOriginal<typeof import('../../api')>()
  return { ...actual, courseboardApiJson: api.json }
})

vi.mock('../../lib/toast', () => ({ showToast: toast.show }))

vi.mock('../../lib/router', async importOriginal => {
  const actual = await importOriginal<typeof import('../../lib/router')>()
  return { ...actual, navigate: router.navigate }
})

const productsPath = '/v1/course/reservation-products'
const coursesPath = '/v1/course/courses'

let storedProducts: GolfReservationProduct[] = []
let writes: Array<{ path: string; body: Record<string, unknown> }> = []

function course(id: string, name: string): GolfCourse {
  return {
    id,
    name,
    shortName: null,
    holeCount: 18,
    timezone: 'Asia/Tokyo',
    businessHoursJson: null,
    startIntervalMinutes: 8,
    isActive: true,
    createdAt: '2026-08-10T00:00:00Z',
    updatedAt: '2026-08-10T00:00:00Z',
  }
}

const courses = [course('course-east', '東コース'), course('course-west', '西コース')]

function storedProduct(body: Record<string, unknown>, serviceId: string): GolfReservationProduct {
  const golfCourseIds = Array.isArray(body.golfCourseIds)
    ? (body.golfCourseIds as string[])
    : body.golfCourseId
      ? [String(body.golfCourseId)]
      : []
  return {
    id: `product_${serviceId}`,
    tenantId: 'courseboard_id',
    extensionKey: 'golf_course',
    reservationServiceId: serviceId,
    displayName: String(body.displayName ?? ''),
    playType: body.playType === 'self' ? 'self' : 'caddie',
    holeCount: Number(body.holeCount ?? 18),
    expectedDurationMinutes: Number(body.expectedDurationMinutes ?? 240),
    golfCourseIds,
    golfCourseId: golfCourseIds.length === 1 ? golfCourseIds[0]! : null,
    maxPlayersPerGroup: null,
    createdAt: '2026-08-10T00:00:00Z',
    updatedAt: '2026-08-10T00:00:00Z',
  }
}

function renderPage() {
  return render(
    <I18nextProvider i18n={i18next}>
      <PageReloadProvider>
        <ReservationProductsPage />
      </PageReloadProvider>
    </I18nextProvider>,
  )
}

describe('ReservationProductsPage save paths', () => {
  beforeEach(async () => {
    await i18next.changeLanguage('ja')
    clearResourceCache()
    storedProducts = []
    writes = []
    api.json.mockReset()
    toast.show.mockReset()
    router.navigate.mockReset()
    api.json.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.startsWith(`${productsPath}/`) && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>
        writes.push({ path, body })
        const serviceId = decodeURIComponent(path.slice(`${productsPath}/`.length))
        const saved = storedProduct(body, serviceId)
        storedProducts = [
          ...storedProducts.filter(item => item.reservationServiceId !== serviceId),
          saved,
        ]
        return saved
      }
      if (path === productsPath && !init?.method) {
        return { items: storedProducts.map(product => ({ ...product })) }
      }
      if (path === coursesPath && !init?.method) {
        return { items: courses.map(item => ({ ...item })) }
      }
      throw new Error(`Unexpected API call: ${init?.method ?? 'GET'} ${path}`)
    })
  })

  afterEach(() => {
    cleanup()
    clearResourceCache()
  })

  it('sends the courses a plan is sold on as an array, without the scalar alias', async () => {
    renderPage()
    fireEvent.click((await screen.findAllByRole('button', { name: '予約サービスを追加' }))[0]!)

    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByRole('textbox', { name: /プラン名/ }), {
      target: { value: 'シーズンパス' },
    })
    fireEvent.change(within(dialog).getByRole('textbox', { name: /予約サービスID/ }), {
      target: { value: 'season-pass' },
    })
    fireEvent.click(within(dialog).getByRole('checkbox', { name: '東コース' }))
    fireEvent.click(within(dialog).getByRole('checkbox', { name: '西コース' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'プレー設定を保存' }))

    await waitFor(() => expect(writes).toHaveLength(1))
    expect(writes[0]!.path).toBe(`${productsPath}/season-pass`)
    expect(writes[0]!.body.golfCourseIds).toEqual(['course-east', 'course-west'])
    // The API refuses both shapes in one request.
    expect(writes[0]!.body).not.toHaveProperty('golfCourseId')
  })

  it('will not save a new plan until it names a course', async () => {
    renderPage()
    fireEvent.click((await screen.findAllByRole('button', { name: '予約サービスを追加' }))[0]!)

    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByRole('textbox', { name: /プラン名/ }), {
      target: { value: 'コース未定' },
    })
    fireEvent.change(within(dialog).getByRole('textbox', { name: /予約サービスID/ }), {
      target: { value: 'no-course' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'プレー設定を保存' }))

    expect(await within(dialog).findByText(/コースを選んでください/)).toBeTruthy()
    expect(writes).toHaveLength(0)
  })

  it('names every course a stored plan is sold on in the list', async () => {
    storedProducts = [storedProduct(
      { displayName: 'シーズンパス', golfCourseIds: ['course-east', 'course-west'] },
      'season-pass',
    )]
    renderPage()

    const table = await screen.findByRole('table')
    expect(within(table).getByText('東コース')).toBeTruthy()
    expect(within(table).getByText('西コース')).toBeTruthy()
  })
})
