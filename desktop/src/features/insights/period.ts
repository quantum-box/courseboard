import type { Period } from './datasets'

export type PeriodPreset = 'thisWeek' | 'lastWeek' | 'nextWeek' | 'thisMonth'

export const PERIOD_LABELS: Record<PeriodPreset, string> = {
  thisWeek: '今週',
  lastWeek: '先週',
  nextWeek: '来週',
  thisMonth: '今月',
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

/** Weeks run Monday to Sunday, as the desk's weekly sheet does. */
export function periodFor(preset: PeriodPreset, today: string): Period {
  const mondayOffset = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7
  const monday = addDays(today, -mondayOffset)
  switch (preset) {
    case 'thisWeek':
      return { from: monday, to: addDays(monday, 6) }
    case 'lastWeek':
      return { from: addDays(monday, -7), to: addDays(monday, -1) }
    case 'nextWeek':
      return { from: addDays(monday, 7), to: addDays(monday, 13) }
    case 'thisMonth': {
      const first = `${today.slice(0, 7)}-01`
      const next = new Date(`${first}T00:00:00Z`)
      next.setUTCMonth(next.getUTCMonth() + 1)
      return { from: first, to: addDays(next.toISOString().slice(0, 10), -1) }
    }
  }
}
