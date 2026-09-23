/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearResourceCache } from '../../hooks/useResource'
import { i18next } from '../../i18n'
import { PageReloadProvider } from '../../lib/pageReload'
import { showToast } from '../../lib/toast'
import { ShiftBoardPage } from './ShiftBoardPage'
import type { ConfirmedShift } from './shiftBoard'

const api = vi.hoisted(() => ({
  json: vi.fn(),
  downloadBlob: vi.fn(),
  downloadText: vi.fn(),
}))

vi.mock('../../api', async importOriginal => {
  const actual = await importOriginal<typeof import('../../api')>()
  return {
    ...actual,
    courseboardApiJson: api.json,
    downloadBlob: api.downloadBlob,
    downloadText: api.downloadText,
  }
})

vi.mock('../../lib/toast', () => ({ showToast: vi.fn() }))

/** Every document handed to the workbook writer, which still writes it. */
const workbook = vi.hoisted(() => ({ documents: [] as Array<{ note: string }> }))
vi.mock('./shiftBoardExport', async importOriginal => {
  const actual = await importOriginal<typeof import('./shiftBoardExport')>()
  return {
    ...actual,
    shiftExportXlsx: async (document: Parameters<typeof actual.shiftExportXlsx>[0]) => {
      workbook.documents.push(document)
      return actual.shiftExportXlsx(document)
    },
  }
})

const CADDIE = 'caddie-a'
const MONTH = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
}).format(new Date()).slice(0, 7)
const FIRST_DAY = `${MONTH}-01`
const MONTH_LABEL = `${Number(MONTH.slice(5, 7))}月`
const DAYS_IN_MONTH = new Date(Number(MONTH.slice(0, 4)), Number(MONTH.slice(5, 7)), 0).getDate()

/** The one confirmed day the board starts with: the caddie is off. */
const confirmed: ConfirmedShift = {
  caddieProfileId: CADDIE,
  date: FIRST_DAY,
  golfCourseId: null,
  isWorking: false,
  span: 'full_day',
  roundsCapacity: 0,
  origin: 'generated',
  note: null,
}

/** What the run proposes for that day instead: working, on the east course. */
const proposed: ConfirmedShift = {
  ...confirmed,
  golfCourseId: 'course-east',
  isWorking: true,
  roundsCapacity: 1,
}

const calls: Array<{ path: string; method: string }> = []
let employmentStatus = 'active'
/** The saved month the board reads. Tests that need a working day replace it. */
let confirmedShift: ConfirmedShift = confirmed
/** Caddies the board reads beside the one every test starts with. */
let extraProfiles: Array<{ id: string; displayName: string; employmentStatus: string }> = []
/** Their saved month, when a test needs one. */
let extraShifts: ConfirmedShift[] = []
/** Requests caddies filed, which the board shows but the sheet does not. */
let requests: Array<{ caddieProfileId: string; date: string; status: string }> = []
/** A month nobody has confirmed yet: the board has requests and no shifts. */
let unconfirmedMonth = false

beforeEach(() => {
  clearResourceCache()
  calls.length = 0
  employmentStatus = 'active'
  confirmedShift = confirmed
  extraProfiles = []
  extraShifts = []
  requests = []
  unconfirmedMonth = false
  api.json.mockReset()
  api.downloadBlob.mockReset()
  api.downloadText.mockReset()
  api.downloadBlob.mockResolvedValue(undefined)
  vi.mocked(showToast).mockClear()
  workbook.documents = []
  vi.spyOn(window, 'print').mockImplementation(() => undefined)
  api.json.mockImplementation(async (path: string, init?: RequestInit) => {
    calls.push({ path, method: init?.method ?? 'GET' })
    if (path === '/v1/course/caddie-profiles') {
      return {
        items: [{ id: CADDIE, displayName: '高田 卓哉', employmentStatus }, ...extraProfiles],
      }
    }
    if (path.startsWith('/v1/course/caddie-availabilities?')) return { items: requests }
    if (path.startsWith('/v1/course/caddie-assignments?')) return { items: [] }
    if (path.startsWith('/v1/course/caddie-shifts?')) {
      return { items: unconfirmedMonth ? [] : [confirmedShift, ...extraShifts] }
    }
    if (path.startsWith('/v1/course/caddie-availability-deadlines/')) return null
    if (path.startsWith('/v1/course/caddie-availability-submissions/')) return { items: [] }
    if (path === '/v1/course/courses') {
      return { items: [{ id: 'course-east', name: '東コース', shortName: '東' }] }
    }
    if (path === '/v1/course/caddie-shift-rules') {
      return {
        avoidedRestWeekdays: [],
        maxConsecutiveWorkDays: 6,
        maxRoundsPerDay: 2,
        minRestDaysPerMonth: 0,
        unfiledRequest: 'working',
        statutoryMaxConsecutiveWorkDays: 6,
        maxRoundsCeiling: 2,
      }
    }
    if (path.endsWith('/preview') && init?.method === 'POST') {
      return {
        summary: {
          yearMonth: MONTH,
          daysWritten: 1,
          pinnedKept: 0,
          unplaced: [],
          statutoryRestDays: 0,
          overworked: [],
          deadlineWarning: null,
        },
        shifts: [proposed],
      }
    }
    if (path.endsWith('/field-sync')) {
      // The board pushes the confirmed month to Field afterwards. Answering
      // "nothing left" keeps these tests about the plan, not the push.
      return { filed: 0, withdrawn: 0, unlinkable: 0, failed: 0, remaining: 0, done: true }
    }
    if (path.startsWith('/v1/course/caddie-shift-plans/') && init?.method === 'POST') {
      return {
        yearMonth: MONTH,
        daysWritten: 1,
        pinnedKept: 0,
        unplaced: [],
        statutoryRestDays: 0,
        overworked: [],
        deadlineWarning: null,
      }
    }
    throw new Error(`Unexpected API call: ${init?.method ?? 'GET'} ${path}`)
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function renderBoard() {
  return render(
    <I18nextProvider i18n={i18next}>
      <PageReloadProvider>
        <ShiftBoardPage />
      </PageReloadProvider>
    </I18nextProvider>,
  )
}

function firstDayCell(root: HTMLElement) {
  return within(root).getByLabelText(new RegExp(`${FIRST_DAY}`)).closest('td') as HTMLTableCellElement
}

describe('planning a month before confirming it', () => {
  it('draws the plan without writing anything, and writes it only when asked', async () => {
    const { container } = renderBoard()
    await waitFor(() => expect(firstDayCell(container).dataset.kind).toBe('off'))

    fireEvent.click(screen.getByRole('button', { name: i18next.t('shifts:draft.action') }))

    // The normal board remains confirmed. Only the temporary dialog shows the
    // proposed day and marks it as a change.
    const dialog = await screen.findByRole('dialog')
    expect(dialog.classList.contains('shift-board-preview-dialog')).toBe(true)
    await waitFor(() => expect(firstDayCell(dialog).dataset.kind).toBe('available'))
    expect(firstDayCell(dialog).dataset.draftChange).toBe('true')
    expect(firstDayCell(dialog).textContent).toBe(i18next.t('shifts:cell.available'))
    expect(firstDayCell(container).dataset.kind).toBe('off')
    expect(firstDayCell(container).dataset.draftChange).toBeUndefined()
    expect(calls.filter(call => call.method === 'POST')).toEqual([
      { path: `/v1/course/caddie-shift-plans/${MONTH}/preview`, method: 'POST' },
    ])

    // Proposed days are read-only inside the dialog; the confirmed board is
    // untouched behind it.
    const previewDayButton = within(dialog)
      .getByLabelText(new RegExp(FIRST_DAY)) as HTMLButtonElement
    expect(previewDayButton.disabled).toBe(true)

    fireEvent.click(within(dialog).getByRole('button', { name: i18next.t('shifts:draft.apply') }))

    await waitFor(() => {
      expect(calls.some(call =>
        call.method === 'POST' && call.path === `/v1/course/caddie-shift-plans/${MONTH}`)).toBe(true)
    })
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: i18next.t('shifts:draft.apply') })).toBeNull())
  })

  it('throws the plan away and leaves the confirmed month as it was', async () => {
    const { container } = renderBoard()
    await waitFor(() => expect(firstDayCell(container).dataset.kind).toBe('off'))

    fireEvent.click(screen.getByRole('button', { name: i18next.t('shifts:draft.action') }))
    const dialog = await screen.findByRole('dialog')
    await waitFor(() => expect(firstDayCell(dialog).dataset.kind).toBe('available'))

    fireEvent.click(within(dialog).getByRole('button', { name: i18next.t('shifts:draft.discard') }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(firstDayCell(container).dataset.kind).toBe('off')
    expect(firstDayCell(container).dataset.draftChange).toBeUndefined()
    expect(calls.filter(call => call.method === 'POST')).toHaveLength(1)
  })

  it('marks Saturdays, Sundays, and stopped employment without changing row height', async () => {
    employmentStatus = 'suspended'
    const { container } = renderBoard()
    await waitFor(() => expect(firstDayCell(container).dataset.kind).toBe('off'))

    expect(container.querySelector('thead .shift-board-saturday')).not.toBeNull()
    expect(container.querySelector('thead .shift-board-sunday')).not.toBeNull()
    const row = container.querySelector('tbody tr')
    expect(row?.getAttribute('data-employment-status')).toBe('suspended')
    const status = within(row as HTMLTableRowElement).getByText(
      i18next.t('shifts:employment.suspended'),
    )
    expect(status.classList.contains('sr-only')).toBe(true)
  })

  it('prints the complete confirmed month from a dedicated print table', async () => {
    // Day 2 is worked, so the month has a sheet; day 1 stays a rest day, which
    // the sheet leaves blank.
    extraShifts = [{
      ...confirmed,
      date: `${MONTH}-02`,
      isWorking: true,
      roundsCapacity: 1,
    }]
    const { container } = renderBoard()
    await waitFor(() => expect(firstDayCell(container).dataset.kind).toBe('off'))
    const originalTitle = document.title

    fireEvent.pointerDown(screen.getByRole('button', { name: i18next.t('shifts:export.action') }), {
      button: 0,
      ctrlKey: false,
    })
    fireEvent.click(await screen.findByRole('menuitem', { name: i18next.t('shifts:export.pdfPrint') }))

    expect(window.print).toHaveBeenCalledOnce()
    expect(document.title).toBe(`キャディシフト表_${MONTH_LABEL}`)
    const printable = document.body.querySelector<HTMLElement>('.shift-board-print')
    expect(printable?.dataset.printSource).toBe('confirmed')
    expect(printable?.querySelectorAll('thead th')).toHaveLength(DAYS_IN_MONTH + 2)
    // The screen still says 休 for day 1; the printed page leaves it blank.
    const printedDays = printable?.querySelectorAll<HTMLTableCellElement>('tbody td[data-kind]')
    expect(printedDays?.[0]?.dataset.kind).toBe('none')
    expect(printedDays?.[0]?.textContent).toBe('')
    expect(printedDays?.[1]?.dataset.kind).toBe('available')
    expect(printable?.textContent).not.toContain(i18next.t('shifts:cell.off'))
    // The printed legend is the workbook's: it says what a blank square means,
    // and leaves out marks the sheet can no longer print (SCC-43, SCC-44).
    const legend = printable?.querySelector('.shift-board-print-legend')?.textContent ?? ''
    expect(legend).toContain(i18next.t('shifts:export.legend.blank'))
    expect(legend).not.toContain(i18next.t('shifts:legend.light'))
    expect(legend).not.toContain(i18next.t('shifts:export.legend.changed'))

    window.dispatchEvent(new Event('afterprint'))
    expect(document.title).toBe(originalTitle)
    await waitFor(() => expect(document.body.querySelector<HTMLElement>('.shift-board-print')
      ?.dataset.printSource).toBe('confirmed'))
  })

  it('prints the proposed month as a draft without replacing the confirmed table', async () => {
    const { container } = renderBoard()
    await waitFor(() => expect(firstDayCell(container).dataset.kind).toBe('off'))

    fireEvent.click(screen.getByRole('button', { name: i18next.t('shifts:draft.action') }))
    const dialog = await screen.findByRole('dialog')
    await waitFor(() => expect(firstDayCell(dialog).dataset.kind).toBe('available'))

    fireEvent.pointerDown(within(dialog).getByRole('button', {
      name: i18next.t('shifts:export.draftAction'),
    }), { button: 0, ctrlKey: false })
    fireEvent.click(await screen.findByRole('menuitem', { name: i18next.t('shifts:export.pdfPrint') }))

    expect(window.print).toHaveBeenCalledOnce()
    expect(document.title).toBe(`キャディシフト案_${MONTH_LABEL}`)
    const printable = document.body.querySelector<HTMLElement>('.shift-board-print')
    const firstPrintedDay = printable
      ?.querySelector<HTMLTableCellElement>('tbody td[data-kind]')
    expect(printable?.dataset.printSource).toBe('draft')
    expect(firstPrintedDay?.dataset.kind).toBe('available')
    expect(firstPrintedDay?.dataset.draftChange).toBe('true')
    expect(firstDayCell(container).dataset.kind).toBe('off')
    expect(calls.filter(call => call.method === 'POST')).toHaveLength(1)
  })

  it('exports the confirmed month as a BOM-prefixed CSV', async () => {
    // Day 2 is worked: a month with no working day at all has no sheet.
    extraShifts = [{
      ...confirmed,
      date: `${MONTH}-02`,
      isWorking: true,
      roundsCapacity: 1,
    }]
    const { container } = renderBoard()
    await waitFor(() => expect(firstDayCell(container).dataset.kind).toBe('off'))

    fireEvent.pointerDown(screen.getByRole('button', { name: i18next.t('shifts:export.action') }), {
      button: 0,
      ctrlKey: false,
    })
    fireEvent.click(await screen.findByRole('menuitem', { name: i18next.t('shifts:export.csv') }))

    expect(api.downloadText).toHaveBeenCalledOnce()
    const [filename, contents] = api.downloadText.mock.calls[0] as [string, string]
    expect(filename).toBe(`キャディシフト表_${MONTH_LABEL}.csv`)
    expect(contents.startsWith('\uFEFF')).toBe(true)
    expect(contents).toContain('高田 卓哉')
  })

  it('leaves the planned course out of the exported sheet', async () => {
    // The sheet is handed round as "who works when". A course tag beside the
    // day's mark read as part of that state, so the export drops it even
    // though the day was planned onto one.
    confirmedShift = {
      ...confirmed,
      golfCourseId: 'course-east',
      isWorking: true,
      roundsCapacity: 1,
    }
    const { container } = renderBoard()
    await waitFor(() => expect(firstDayCell(container).dataset.kind).toBe('available'))

    fireEvent.pointerDown(screen.getByRole('button', { name: i18next.t('shifts:export.action') }), {
      button: 0,
      ctrlKey: false,
    })
    fireEvent.click(await screen.findByRole('menuitem', { name: i18next.t('shifts:export.csv') }))

    expect(api.downloadText).toHaveBeenCalledOnce()
    const [, contents] = api.downloadText.mock.calls[0] as [string, string]
    expect(contents).toContain(i18next.t('shifts:cell.available'))
    expect(contents).not.toContain('東')
  })

  it('leaves the days nobody works blank instead of marking them 休', async () => {
    // The sheet answers "who is on the course that day", so a rest day is an
    // empty square. 休 in every other square was what made the handout
    // unreadable (SCC-24).
    confirmedShift = { ...confirmed, isWorking: true, roundsCapacity: 1 }
    extraShifts = [{ ...confirmed, date: `${MONTH}-02` }]
    const { container } = renderBoard()
    await waitFor(() => expect(firstDayCell(container).dataset.kind).toBe('available'))

    fireEvent.pointerDown(screen.getByRole('button', { name: i18next.t('shifts:export.action') }), {
      button: 0,
      ctrlKey: false,
    })
    fireEvent.click(await screen.findByRole('menuitem', { name: i18next.t('shifts:export.csv') }))

    const [, contents] = api.downloadText.mock.calls[0] as [string, string]
    const row = contents.split('\r\n').find(line => line.startsWith('高田 卓哉'))
    const cells = row?.split(',') ?? []
    // name, employment, streak, then one square per day.
    expect(cells[3]).toBe(i18next.t('shifts:cell.available'))
    expect(cells[4]).toBe('')
    expect(contents).not.toContain(i18next.t('shifts:cell.off'))
  })

  it('prints only decided days, not the requests around them', async () => {
    // SCC-43: day 1 is a confirmed working day; day 3 only carries a request.
    // The sheet used to fill day 3 in from the request, handing an undecided
    // day round as if it were a shift (and 軽 only ever comes from a request).
    confirmedShift = { ...confirmed, isWorking: true, roundsCapacity: 1 }
    requests = [{ caddieProfileId: CADDIE, date: `${MONTH}-03`, status: 'light_duty' }]
    const { container } = renderBoard()
    await waitFor(() => expect(firstDayCell(container).dataset.kind).toBe('available'))

    fireEvent.pointerDown(screen.getByRole('button', { name: i18next.t('shifts:export.action') }), {
      button: 0,
      ctrlKey: false,
    })
    fireEvent.click(await screen.findByRole('menuitem', { name: i18next.t('shifts:export.csv') }))

    const [, contents] = api.downloadText.mock.calls[0] as [string, string]
    const row = contents.split('\r\n').find(line => line.startsWith('高田 卓哉'))
    const cells = row?.split(',') ?? []
    expect(cells[3]).toBe(i18next.t('shifts:cell.available'))
    expect(cells[5]).toBe('')
    expect(contents).not.toContain(i18next.t('shifts:cell.light'))
  })

  it('says a month nobody has confirmed is not ready, instead of printing the requests', async () => {
    // The board still shows the request; only the sheet refuses.
    unconfirmedMonth = true
    requests = [{ caddieProfileId: CADDIE, date: FIRST_DAY, status: 'available' }]
    const { container } = renderBoard()
    await waitFor(() => expect(firstDayCell(container).dataset.kind).toBe('available'))

    fireEvent.pointerDown(screen.getByRole('button', { name: i18next.t('shifts:export.action') }), {
      button: 0,
      ctrlKey: false,
    })
    fireEvent.click(await screen.findByRole('menuitem', { name: i18next.t('shifts:export.csv') }))

    expect(api.downloadText).not.toHaveBeenCalled()
    expect(showToast).toHaveBeenCalledWith(expect.objectContaining({
      message: i18next.t('shifts:export.notConfirmed'),
    }))
  })

  it('says so rather than handing round a blank sheet for a month nobody works', async () => {
    const { container } = renderBoard()
    await waitFor(() => expect(firstDayCell(container).dataset.kind).toBe('off'))

    fireEvent.pointerDown(screen.getByRole('button', { name: i18next.t('shifts:export.action') }), {
      button: 0,
      ctrlKey: false,
    })
    fireEvent.click(await screen.findByRole('menuitem', { name: i18next.t('shifts:export.csv') }))

    expect(api.downloadText).not.toHaveBeenCalled()
    expect(showToast).toHaveBeenCalledWith(expect.objectContaining({
      message: i18next.t('shifts:export.emptyMonth'),
    }))
  })

  it('leaves a caddie who is off all month out of the exported sheet', async () => {
    // The sheet is read to find who is on the course, and a row of nothing but
    // 休 answers nobody. Days nobody has filed for are a different thing: the
    // caddie the test starts with has one saved day off and no request for the
    // rest of the month, and has to stay on the sheet.
    const AWAY = 'caddie-away'
    extraProfiles = [{ id: AWAY, displayName: '沼田 登', employmentStatus: 'active' }]
    confirmedShift = { ...confirmed, isWorking: true, roundsCapacity: 1 }
    extraShifts = Array.from({ length: DAYS_IN_MONTH }, (_, index) => ({
      ...confirmed,
      caddieProfileId: AWAY,
      date: `${MONTH}-${String(index + 1).padStart(2, '0')}`,
    }))
    renderBoard()
    // Both caddies are drawn on the board (screen and print view); only the
    // sheet leaves one out.
    await waitFor(() => expect(screen.getAllByText('沼田 登').length).toBeGreaterThan(0))

    fireEvent.pointerDown(screen.getByRole('button', { name: i18next.t('shifts:export.action') }), {
      button: 0,
      ctrlKey: false,
    })
    fireEvent.click(await screen.findByRole('menuitem', { name: i18next.t('shifts:export.csv') }))

    expect(api.downloadText).toHaveBeenCalledOnce()
    const [, contents] = api.downloadText.mock.calls[0] as [string, string]
    expect(contents).toContain('高田 卓哉')
    expect(contents).not.toContain('沼田 登')
  })

  it('exports the proposed month as a real Excel workbook', async () => {
    renderBoard()
    fireEvent.click(await screen.findByRole('button', { name: i18next.t('shifts:draft.action') }))
    const dialog = await screen.findByRole('dialog')
    await waitFor(() => expect(firstDayCell(dialog).dataset.kind).toBe('available'))

    fireEvent.pointerDown(within(dialog).getByRole('button', {
      name: i18next.t('shifts:export.draftAction'),
    }), { button: 0, ctrlKey: false })
    fireEvent.click(await screen.findByRole('menuitem', { name: i18next.t('shifts:export.excel') }))

    await waitFor(() => expect(api.downloadBlob).toHaveBeenCalledOnce())
    const [filename, blob] = api.downloadBlob.mock.calls[0] as [string, Blob]
    expect(filename).toBe(`キャディシフト案_${MONTH_LABEL}.xlsx`)
    expect(blob.type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    expect(blob.size).toBeGreaterThan(1000)

    // SCC-44: the workbook explains its own marks. It used to say only that
    // they "match the screen", which nobody holding the paper could look up.
    // Read from what went into the workbook rather than by unzipping it:
    // under jsdom fflate is handed a Uint8Array from another realm and files
    // the bytes as folders, which a real browser never does.
    const sheet = workbook.documents.at(-1)?.note ?? ''
    const entry = (mark: string, meaning: string) => i18next.t('shifts:export.legendEntry', {
      mark,
      meaning: i18next.t(meaning as 'shifts:export.legend.working'),
    })
    expect(sheet).toContain(entry(i18next.t('shifts:cell.available'), 'shifts:export.legend.working'))
    expect(sheet).toContain(entry(i18next.t('shifts:cell.morning'), 'shifts:export.legend.morning'))
    expect(sheet).toContain(i18next.t('shifts:export.legend.blank'))
    // A plan's sheet marks the days the plan changes, so it says what that is.
    expect(sheet).toContain(entry(i18next.t('shifts:export.changedMark'), 'shifts:export.legend.changed'))
    expect(sheet).not.toContain('記号は画面と同じです')
  })
})
