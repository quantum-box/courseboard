import { describe, expect, it } from 'vitest'

import {
  caddiesWithFreeHours,
  clockOfMinutes,
  dutyWindowProblem,
  filedDuties,
  minutesOfClock,
  minutesOfTeeTime,
  normalizedCaddieDuties,
  validateCaddieDuties,
  type CaddieDutyAssignment,
  type DutyProfile,
  type DutyRoundAssignment,
  type DutyShift,
} from './caddieDuties'

const DATE = '2026-08-29'

function profile(id: string, displayName: string, employmentStatus = 'active'): DutyProfile {
  return { id, displayName, employmentStatus }
}

function shift(caddieProfileId: string, isWorking = true, date = DATE): DutyShift {
  return { caddieProfileId, date, isWorking }
}

function round(caddieProfileId: string, hour = 7, status = 'assigned'): DutyRoundAssignment {
  return {
    caddieProfileId,
    reservationId: 'rsv_1',
    status,
    scheduledAt: `${DATE}T${String(hour).padStart(2, '0')}:00:00+09:00`,
  }
}

function duty(
  caddieProfileId: string,
  startTime = '00:00',
  endTime = '24:00',
  overrides: Partial<CaddieDutyAssignment> = {},
): CaddieDutyAssignment {
  return {
    id: `${caddieProfileId}-${startTime}`,
    caddieProfileId,
    date: DATE,
    dutyLabel: 'コース整備',
    startTime,
    endTime,
    allDay: startTime === '00:00' && endTime === '24:00',
    ...overrides,
  }
}

describe('clock helpers', () => {
  it('reads and writes the club’s own clock', () => {
    expect(minutesOfClock('09:30')).toBe(570)
    expect(minutesOfClock('24:00')).toBe(1440)
    expect(minutesOfTeeTime('2026-08-29T07:08:00+09:00')).toBe(428)
    expect(clockOfMinutes(570)).toBe('09:30')
    expect(clockOfMinutes(1440)).toBe('24:00')
  })
})

describe('caddiesWithFreeHours', () => {
  it('offers the afternoon of a caddie whose morning is spoken for', () => {
    const free = caddiesWithFreeHours({
      profiles: [profile('cp_1', 'Sato')],
      assignments: [],
      shifts: [shift('cp_1')],
      duties: [duty('cp_1', '08:00', '12:00')],
      date: DATE,
    })
    expect(free).toEqual([
      { caddieProfileId: 'cp_1', displayName: 'Sato', morningFree: false, afternoonFree: true },
    ])
  })

  it('leaves out a caddie whose day is covered front and back', () => {
    const free = caddiesWithFreeHours({
      profiles: [profile('cp_1', 'Sato')],
      assignments: [],
      shifts: [shift('cp_1')],
      duties: [duty('cp_1', '08:00', '12:00'), duty('cp_1', '13:00', '17:00')],
      date: DATE,
    })
    expect(free).toEqual([])
  })

  it('counts a round as taking the half it runs in', () => {
    const free = caddiesWithFreeHours({
      profiles: [profile('cp_1', 'Sato')],
      assignments: [round('cp_1', 7)],
      shifts: [shift('cp_1')],
      duties: [],
      date: DATE,
    })
    // 07:00 + 4.5h runs to 11:30, so the afternoon is still the caddie's.
    expect(free[0]).toMatchObject({ morningFree: false, afternoonFree: true })
  })

  it('treats a cancelled round as no round at all', () => {
    const free = caddiesWithFreeHours({
      profiles: [profile('cp_1', 'Sato')],
      assignments: [round('cp_1', 7, 'cancelled')],
      shifts: [shift('cp_1')],
      duties: [],
      date: DATE,
    })
    expect(free[0]).toMatchObject({ morningFree: true, afternoonFree: true })
  })

  it('leaves out a day confirmed as off, and anyone off the roster', () => {
    const free = caddiesWithFreeHours({
      profiles: [profile('cp_1', 'Sato'), profile('cp_2', 'Tanaka'), profile('cp_3', 'Ito', 'suspended')],
      assignments: [],
      shifts: [shift('cp_1'), shift('cp_2', false)],
      duties: [],
      date: DATE,
    })
    expect(free.map(item => item.caddieProfileId)).toEqual(['cp_1'])
  })

  it('offers the whole active roster on a day no month was confirmed for', () => {
    const free = caddiesWithFreeHours({
      profiles: [profile('cp_1', 'Sato')],
      assignments: [],
      shifts: [],
      duties: [],
      date: DATE,
    })
    expect(free.map(item => item.caddieProfileId)).toEqual(['cp_1'])
  })

  it('reads only the chosen day', () => {
    const free = caddiesWithFreeHours({
      profiles: [profile('cp_1', 'Sato')],
      assignments: [],
      shifts: [shift('cp_1', false, '2026-08-30')],
      duties: [duty('cp_1', '08:00', '12:00', { date: '2026-08-30' })],
      date: DATE,
    })
    expect(free[0]).toMatchObject({ morningFree: true, afternoonFree: true })
  })
})

describe('filedDuties', () => {
  it('lists the day earliest first with the caddie named', () => {
    const rows = filedDuties({
      profiles: [profile('cp_1', 'Sato'), profile('cp_2', 'Tanaka')],
      duties: [duty('cp_2', '13:00', '17:00'), duty('cp_1', '08:00', '12:00')],
      date: DATE,
    })
    expect(rows.map(row => [row.displayName, row.duty.startTime])).toEqual([
      ['Sato', '08:00'],
      ['Tanaka', '13:00'],
    ])
  })

  it('still shows a job filed against somebody off the roster', () => {
    const rows = filedDuties({
      profiles: [profile('cp_1', 'Sato')],
      duties: [duty('cp_gone')],
      date: DATE,
    })
    expect(rows.map(row => row.displayName)).toEqual(['cp_gone'])
  })
})

describe('dutyWindowProblem', () => {
  const base = {
    caddieProfileId: 'cp_1',
    assignments: [] as DutyRoundAssignment[],
    duties: [] as CaddieDutyAssignment[],
    date: DATE,
  }

  it('says nothing about hours that are actually free', () => {
    expect(dutyWindowProblem({ ...base, startTime: '13:00', endTime: '17:00' })).toBeNull()
  })

  it('refuses a window that ends before it starts', () => {
    expect(dutyWindowProblem({ ...base, startTime: '13:00', endTime: '09:00' })).toBe('order')
    expect(dutyWindowProblem({ ...base, startTime: '13:00', endTime: '13:00' })).toBe('order')
  })

  it('refuses hours another job already claims, but lets them sit end to end', () => {
    const duties = [duty('cp_1', '08:00', '12:00')]
    expect(dutyWindowProblem({ ...base, duties, startTime: '11:00', endTime: '13:00' })).toBe('clash')
    expect(dutyWindowProblem({ ...base, duties, startTime: '12:00', endTime: '15:00' })).toBeNull()
  })

  it('refuses hours a round runs through', () => {
    expect(dutyWindowProblem({
      ...base,
      assignments: [round('cp_1', 7)],
      startTime: '09:00',
      endTime: '10:00',
    })).toBe('clash')
  })
})

describe('validateCaddieDuties', () => {
  it('drops blank rows without calling them a problem', () => {
    expect(normalizedCaddieDuties(['  コース整備 ', '', '   '])).toEqual(['コース整備'])
    expect(validateCaddieDuties(['コース整備', ''])).toBeNull()
  })

  it('names what the API would refuse', () => {
    expect(validateCaddieDuties(['コース整備', ' コース整備'])).toBe('duplicate')
    expect(validateCaddieDuties(['あ'.repeat(41)])).toBe('tooLong')
    expect(validateCaddieDuties(Array.from({ length: 31 }, (_, i) => `業務${i}`))).toBe('tooMany')
  })
})
