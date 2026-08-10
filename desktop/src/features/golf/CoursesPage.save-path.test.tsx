/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearResourceCache } from '../../hooks/useResource'
import { i18next } from '../../i18n'
import { PageReloadProvider } from '../../lib/pageReload'
import type { GolfCourse } from './models'
import { CoursesPage } from './CoursesPage'

const api = vi.hoisted(() => ({ json: vi.fn() }))
const toast = vi.hoisted(() => ({ show: vi.fn() }))

vi.mock('../../api', async importOriginal => {
  const actual = await importOriginal<typeof import('../../api')>()
  return { ...actual, courseboardApiJson: api.json }
})

vi.mock('../../lib/toast', () => ({ showToast: toast.show }))

type CourseWrite = {
  name: string
  shortName: string | null
  holeCount: number
  startIntervalMinutes: number
  isActive: boolean
}

const coursesPath = '/v1/course/courses'
let storedCourses: GolfCourse[] = []
let postBodies: CourseWrite[] = []
let patchBodies: Array<{ path: string; body: CourseWrite }> = []
let getCount = 0

function storedCourse(id: string, body: CourseWrite): GolfCourse {
  return {
    id,
    ...body,
    timezone: 'Asia/Tokyo',
    businessHoursJson: null,
    createdAt: '2026-08-10T00:00:00Z',
    updatedAt: '2026-08-10T00:00:00Z',
  }
}

function renderPage() {
  return render(
    <I18nextProvider i18n={i18next}>
      <PageReloadProvider>
        <CoursesPage />
      </PageReloadProvider>
    </I18nextProvider>,
  )
}

describe('CoursesPage save paths', () => {
  beforeEach(async () => {
    await i18next.changeLanguage('ja')
    clearResourceCache()
    storedCourses = [storedCourse('course-existing', {
      name: '既存コース',
      shortName: '既存',
      holeCount: 18,
      startIntervalMinutes: 8,
      isActive: true,
    })]
    postBodies = []
    patchBodies = []
    getCount = 0
    api.json.mockReset()
    toast.show.mockReset()
    api.json.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === coursesPath && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as CourseWrite
        postBodies.push(body)
        const created = storedCourse('course-created', body)
        storedCourses = [...storedCourses, created]
        return created
      }
      if (path.startsWith(`${coursesPath}/`) && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body)) as CourseWrite
        patchBodies.push({ path, body })
        const id = decodeURIComponent(path.slice(`${coursesPath}/`.length))
        const current = storedCourses.find(course => course.id === id)
        if (!current) throw new Error(`Unknown course: ${id}`)
        const updated = { ...current, ...body, updatedAt: '2026-08-10T01:00:00Z' }
        storedCourses = storedCourses.map(course => course.id === id ? updated : course)
        return updated
      }
      if (path === coursesPath && !init?.method) {
        getCount += 1
        return { items: storedCourses.map(course => ({ ...course })) }
      }
      throw new Error(`Unexpected API call: ${init?.method ?? 'GET'} ${path}`)
    })
  })

  afterEach(() => {
    cleanup()
    clearResourceCache()
  })

  it('keeps the course master columns focused on information used from the list', async () => {
    renderPage()

    const table = await screen.findByRole('table')
    expect(within(table).getAllByRole('columnheader').map(header => header.textContent)).toEqual([
      'コース',
      'ホール',
      '営業時間',
      '状態',
      '更新',
      '操作',
    ])
  })

  it('creates a course through the real Sheet and reads it back', async () => {
    storedCourses = []
    const firstRender = renderPage()
    const addButtons = await screen.findAllByRole('button', { name: 'コースを追加' })
    fireEvent.click(addButtons[0])

    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByRole('textbox', { name: /コース名/ }), {
      target: { value: '新コース' },
    })
    fireEvent.change(within(dialog).getByRole('textbox', { name: /略称/ }), {
      target: { value: '新' },
    })
    fireEvent.change(within(dialog).getByRole('combobox', { name: /ホール数/ }), {
      target: { value: '9' },
    })
    fireEvent.change(within(dialog).getByRole('spinbutton', { name: /スタート間隔/ }), {
      target: { value: '12' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }))

    await waitFor(() => expect(postBodies).toEqual([{
      name: '新コース',
      shortName: '新',
      holeCount: 9,
      startIntervalMinutes: 12,
      isActive: true,
    }]))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(getCount).toBeGreaterThanOrEqual(2)

    firstRender.unmount()
    clearResourceCache()
    renderPage()
    expect(await screen.findByText('新コース')).toBeTruthy()
    expect(screen.getByText('9H')).toBeTruthy()
  })

  it('edits a course through the real Sheet and reads the update back', async () => {
    const firstRender = renderPage()
    fireEvent.click(await screen.findByRole('button', { name: '既存コース を直す' }))

    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByRole('textbox', { name: /コース名/ }), {
      target: { value: '更新コース' },
    })
    fireEvent.change(within(dialog).getByRole('textbox', { name: /略称/ }), {
      target: { value: '更新' },
    })
    fireEvent.change(within(dialog).getByRole('combobox', { name: /状態/ }), {
      target: { value: 'inactive' },
    })
    fireEvent.change(within(dialog).getByRole('spinbutton', { name: /スタート間隔/ }), {
      target: { value: '15' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }))

    await waitFor(() => expect(patchBodies).toEqual([{
      path: `${coursesPath}/course-existing`,
      body: {
        name: '更新コース',
        shortName: '更新',
        holeCount: 18,
        startIntervalMinutes: 15,
        isActive: false,
      },
    }]))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(getCount).toBeGreaterThanOrEqual(2)

    firstRender.unmount()
    clearResourceCache()
    renderPage()
    expect(await screen.findByText('更新コース')).toBeTruthy()
    expect(screen.getByText('停止中')).toBeTruthy()
    expect(screen.queryByText('既存コース')).toBeNull()
  })
})
