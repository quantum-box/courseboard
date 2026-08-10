/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearResourceCache } from '../../hooks/useResource'
import { i18next } from '../../i18n'
import { PageReloadProvider } from '../../lib/pageReload'
import { CourseSchedulePage } from './CourseSchedulePage'

const api = vi.hoisted(() => ({ json: vi.fn() }))
const toast = vi.hoisted(() => ({ show: vi.fn() }))

vi.mock('../../api', async importOriginal => {
  const actual = await importOriginal<typeof import('../../api')>()
  return { ...actual, courseboardApiJson: api.json }
})

vi.mock('../../lib/toast', () => ({ showToast: toast.show }))

type UiRule = {
  id?: string
  weekday: number
  startTime: string
  endTime: string
  capacity: number
  slotIntervalMinutes: number
  isNew?: true
}

type FieldRule = {
  id?: string
  timezone: string
  dayOfWeek: number
  startTime: string
  endTime: string
  capacity: number
  slotIntervalMinutes: number
  seasonStartMonthDay?: string | null
  seasonEndMonthDay?: string | null
  effectiveFrom?: string | null
  effectiveTo?: string | null
}

const courseId = 'golfcrs-ui-roundtrip'
let fieldRules: FieldRule[] = []
let putBodies: Array<{ rules: UiRule[] }> = []

function fieldRule(overrides: Partial<FieldRule> = {}): FieldRule {
  return {
    id: 'ravr-existing',
    timezone: 'Asia/Tokyo',
    dayOfWeek: 0,
    startTime: '07:00:00',
    endTime: '12:00:00',
    capacity: 1,
    slotIntervalMinutes: 8,
    seasonStartMonthDay: '04-01',
    seasonEndMonthDay: '11-30',
    effectiveFrom: '2026-01-01',
    effectiveTo: '2026-12-31',
    ...overrides,
  }
}

function toUiRule(rule: FieldRule): UiRule {
  return {
    ...(rule.id ? { id: rule.id } : {}),
    weekday: (rule.dayOfWeek + 1) % 7,
    startTime: rule.startTime.slice(0, 5),
    endTime: rule.endTime.slice(0, 5),
    capacity: rule.capacity,
    slotIntervalMinutes: rule.slotIntervalMinutes,
  }
}

function saveThroughGateway(input: UiRule): FieldRule {
  const current = input.id ? fieldRules.find(rule => rule.id === input.id) : undefined
  if (!current && !input.isNew) throw new Error('ambiguous schedule rule identity')
  return {
    ...current,
    id: input.id ?? `ravr-new-${fieldRules.length + 1}`,
    timezone: 'Asia/Tokyo',
    dayOfWeek: (input.weekday + 6) % 7,
    startTime: input.startTime,
    endTime: input.endTime,
    capacity: input.capacity,
    slotIntervalMinutes: input.slotIntervalMinutes,
  }
}

function renderPage() {
  return render(
    <I18nextProvider i18n={i18next}>
      <PageReloadProvider>
        <CourseSchedulePage courseId={courseId} />
      </PageReloadProvider>
    </I18nextProvider>,
  )
}

describe('CourseSchedulePage save path', () => {
  beforeEach(async () => {
    await i18next.changeLanguage('ja')
    clearResourceCache()
    fieldRules = [fieldRule()]
    putBodies = []
    api.json.mockReset()
    toast.show.mockReset()
    api.json.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/v1/course/courses') {
        return {
          items: [{
            id: courseId,
            name: 'UI roundtrip course',
            holeCount: 18,
            timezone: 'Asia/Tokyo',
            startIntervalMinutes: 8,
            isActive: true,
            createdAt: '2026-08-10T00:00:00Z',
            updatedAt: '2026-08-10T00:00:00Z',
          }],
        }
      }
      if (path === '/v1/course/resources') {
        return {
          items: [{
            golfCourseId: courseId,
            reservationResourceId: 'rsrc-ui-roundtrip',
            resourceKind: 'course',
            active: true,
          }],
        }
      }
      if (path === '/v1/course/booking-horizon') {
        return { days: 90, bookableThrough: '2026-11-08' }
      }
      if (path === `/v1/course/courses/${courseId}/schedule` && init?.method === 'PUT') {
        const body = JSON.parse(String(init.body)) as { rules: UiRule[] }
        putBodies.push(body)
        fieldRules = body.rules.map(saveThroughGateway)
        return {
          items: fieldRules.map(toUiRule),
          bookableThrough: '2026-11-08',
          built: { created: 0, updated: 1, deactivated: 0, unchanged: 0 },
        }
      }
      if (path === `/v1/course/courses/${courseId}/schedule`) {
        return { items: fieldRules.map(toUiRule) }
      }
      throw new Error(`Unexpected API call: ${init?.method ?? 'GET'} ${path}`)
    })
  })

  afterEach(() => {
    cleanup()
    clearResourceCache()
  })

  it('sends the persisted id and keeps both kinds of Field-owned date fields', async () => {
    renderPage()
    const capacity = await screen.findByRole('spinbutton', {
      name: /月曜日.*同時に出せる組数/,
    })

    fireEvent.change(capacity, { target: { value: '2' } })
    fireEvent.click(await screen.findByRole('button', { name: '受付枠を保存' }))

    await waitFor(() => expect(putBodies).toHaveLength(1))
    expect(putBodies[0].rules).toEqual([{
      id: 'ravr-existing',
      weekday: 1,
      startTime: '07:00',
      endTime: '12:00',
      capacity: 2,
      slotIntervalMinutes: 8,
    }])
    expect(fieldRules[0]).toMatchObject({
      id: 'ravr-existing',
      capacity: 2,
      seasonStartMonthDay: '04-01',
      seasonEndMonthDay: '11-30',
      effectiveFrom: '2026-01-01',
      effectiveTo: '2026-12-31',
    })
  })

  it('marks an id-less band added in the UI as an intentional create', async () => {
    renderPage()
    // The page can paint between the schedule request resolving and the effect
    // copying it into editor state. Wait for the persisted Monday row so this
    // click exercises a real post-load edit instead of that transient frame.
    await screen.findByRole('spinbutton', {
      name: /月曜日.*同時に出せる組数/,
    })
    fireEvent.click(await screen.findByRole('button', { name: '火曜日に時間帯を追加' }))
    await screen.findByRole('spinbutton', {
      name: /火曜日.*同時に出せる組数/,
    })
    fireEvent.click(await screen.findByRole('button', { name: '受付枠を保存' }))

    await waitFor(() => expect(putBodies).toHaveLength(1))
    expect(putBodies[0].rules).toContainEqual(expect.objectContaining({
      weekday: 2,
      isNew: true,
    }))
    expect(putBodies[0].rules.find(rule => rule.weekday === 2)?.id).toBeUndefined()
  })

  it('fails explicitly instead of treating a loaded id-less band as new', async () => {
    fieldRules = [fieldRule({ id: undefined })]
    renderPage()
    const capacity = await screen.findByRole('spinbutton', {
      name: /月曜日.*同時に出せる組数/,
    })

    fireEvent.change(capacity, { target: { value: '2' } })
    fireEvent.click(await screen.findByRole('button', { name: '受付枠を保存' }))

    await waitFor(() => expect(toast.show).toHaveBeenCalledWith(expect.objectContaining({
      tone: 'danger',
      message: expect.stringContaining(
        '保存済みの受付枠を識別できません。画面を読み込み直してから、もう一度お試しください。',
      ),
    })))
    expect(putBodies).toHaveLength(0)
  })
})
