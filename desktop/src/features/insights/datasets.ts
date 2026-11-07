/**
 * The numbers an insights screen may show, counted in the desk from tee-sheet
 * rows. The model only ever sees the *shape* of these (names, columns, row
 * counts); the values are bound into its layout at render time.
 */

export type InsightReservation = {
  teeTime: string
  courseName: string
  partySize: number
  playType: 'caddie' | 'self' | string
  status: string
}

export type Period = {
  /** Inclusive, `YYYY-MM-DD` in the tenant's zone. */
  from: string
  to: string
}

type Row = Record<string, string | number | null>

export type InsightDatasets = {
  summary: {
    period: string
    reservations: number
    players: number
    cancelled: number
    noShow: number
    averagePartySize: number
  }
  byWeekday: Row[]
  byDate: Row[]
  byCourse: Row[]
  byHour: Row[]
  byStatus: Row[]
  byPlayType: Row[]
}

const WEEKDAYS = ['月', '火', '水', '木', '金', '土', '日'] as const

const STATUS_LABELS: Record<string, string> = {
  confirmed: '予約確定',
  checked_in: 'チェックイン済',
  on_course: 'プレー中',
  completed: 'プレー終了',
  cancelled: 'キャンセル',
  no_show: 'ノーショー',
}

const PLAY_TYPE_LABELS: Record<string, string> = {
  caddie: 'キャディ付き',
  self: 'セルフ',
}

/** Groups that did not happen are not "reservations" in any count below. */
function isCounted(status: string) {
  return status !== 'cancelled' && status !== 'no_show'
}

type LocalParts = { date: string; weekdayIndex: number; hour: number }

function localParts(iso: string, timeZone: string): LocalParts | null {
  const instant = new Date(iso)
  if (Number.isNaN(instant.getTime())) return null
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
      weekday: 'short',
    }).formatToParts(instant).map(part => [part.type, part.value]),
  )
  const weekdayIndex = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(parts.weekday)
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekdayIndex,
    hour: Number(parts.hour),
  }
}

/** Every calendar day in the period, so a day with no bookings still shows 0. */
export function daysOf(period: Period): string[] {
  const days: string[] = []
  const cursor = new Date(`${period.from}T00:00:00Z`)
  const last = new Date(`${period.to}T00:00:00Z`)
  while (cursor <= last && days.length < 400) {
    days.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return days
}

function weekdayOfDate(date: string) {
  return (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7
}

function dayLabel(date: string) {
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}(${WEEKDAYS[weekdayOfDate(date)]})`
}

function tally(
  map: Map<string, { reservations: number; players: number }>,
  key: string,
  partySize: number,
) {
  const entry = map.get(key) ?? { reservations: 0, players: 0 }
  entry.reservations += 1
  entry.players += partySize
  map.set(key, entry)
}

export function buildDatasets(
  items: InsightReservation[],
  period: Period,
  timeZone: string,
): InsightDatasets {
  const byWeekday = new Map<string, { reservations: number; players: number }>()
  const byDate = new Map<string, { reservations: number; players: number }>()
  const byCourse = new Map<string, { reservations: number; players: number }>()
  const byHour = new Map<string, { reservations: number; players: number }>()
  const byStatus = new Map<string, number>()
  const byPlayType = new Map<string, number>()
  let reservations = 0
  let players = 0
  let cancelled = 0
  let noShow = 0

  for (const item of items) {
    const parts = localParts(item.teeTime, timeZone)
    if (!parts || parts.date < period.from || parts.date > period.to) continue
    byStatus.set(item.status, (byStatus.get(item.status) ?? 0) + 1)
    if (item.status === 'cancelled') cancelled += 1
    if (item.status === 'no_show') noShow += 1
    if (!isCounted(item.status)) continue
    const size = Number.isFinite(item.partySize) ? item.partySize : 0
    reservations += 1
    players += size
    tally(byWeekday, WEEKDAYS[parts.weekdayIndex] ?? '?', size)
    tally(byDate, parts.date, size)
    tally(byCourse, item.courseName || '(コース未設定)', size)
    tally(byHour, String(parts.hour), size)
    byPlayType.set(item.playType, (byPlayType.get(item.playType) ?? 0) + 1)
  }

  const days = daysOf(period)
  // Days of the week that fall inside the period, each with how many times it
  // occurs, so a month-long period can still be read per weekday.
  const weekdayOccurrences = new Map<string, number>()
  for (const day of days) {
    const label = WEEKDAYS[weekdayOfDate(day)]
    weekdayOccurrences.set(label, (weekdayOccurrences.get(label) ?? 0) + 1)
  }
  const hours = [...byHour.keys()].map(Number).sort((a, b) => a - b)

  return {
    summary: {
      period: `${dayLabel(period.from)}〜${dayLabel(period.to)}`,
      reservations,
      players,
      cancelled,
      noShow,
      averagePartySize: reservations ? Math.round((players / reservations) * 10) / 10 : 0,
    },
    byWeekday: WEEKDAYS.filter(label => weekdayOccurrences.has(label)).map(label => ({
      weekday: label,
      reservations: byWeekday.get(label)?.reservations ?? 0,
      players: byWeekday.get(label)?.players ?? 0,
      days: weekdayOccurrences.get(label) ?? 0,
    })),
    byDate: days.map(date => ({
      date: dayLabel(date),
      reservations: byDate.get(date)?.reservations ?? 0,
      players: byDate.get(date)?.players ?? 0,
    })),
    byCourse: [...byCourse.entries()]
      .sort((a, b) => b[1].reservations - a[1].reservations)
      .map(([course, value]) => ({ course, ...value })),
    byHour: hours.map(hour => ({
      hour: `${hour}時`,
      reservations: byHour.get(String(hour))?.reservations ?? 0,
      players: byHour.get(String(hour))?.players ?? 0,
    })),
    byStatus: [...byStatus.entries()].map(([status, count]) => ({
      status: STATUS_LABELS[status] ?? status,
      count,
    })),
    byPlayType: [...byPlayType.entries()].map(([playType, count]) => ({
      playType: PLAY_TYPE_LABELS[playType] ?? playType,
      count,
    })),
  }
}

/**
 * What the model is told about the datasets: names, columns and sizes, never
 * the values.
 */
export function describeDatasets(datasets: InsightDatasets): string {
  const lines = [
    `/datasets/summary — object: period (string, e.g. "11/2(月)〜11/8(日)"), reservations (number of groups, cancellations and no-shows excluded), players (number of people), cancelled, noShow, averagePartySize.`,
    `/datasets/byWeekday — ${datasets.byWeekday.length} rows ordered 月→日: weekday (string), reservations, players, days (how many of that weekday the period contains).`,
    `/datasets/byDate — ${datasets.byDate.length} rows, one per day in order: date (string like "11/2(月)"), reservations, players.`,
    `/datasets/byCourse — ${datasets.byCourse.length} rows, busiest first: course (string), reservations, players.`,
    `/datasets/byHour — ${datasets.byHour.length} rows by tee-off hour: hour (string like "7時"), reservations, players.`,
    `/datasets/byStatus — ${datasets.byStatus.length} rows, includes cancelled and no-show: status (string), count.`,
    `/datasets/byPlayType — ${datasets.byPlayType.length} rows: playType (string), count.`,
  ]
  return lines.join('\n')
}
