import { i18next } from '../../i18n'

/**
 * One band of a course's week: when it opens, how many groups may be out at
 * once, and how far apart they go out.
 *
 * `capacity` counts groups, never players. Field states the same contract on
 * its side; party size is a condition of the plan, not a quantity of stock.
 */
export type GolfAvailabilityRule = {
  id?: string
  /** Sunday is 0, as everywhere else in CourseBoard. */
  weekday: number
  startTime: string
  endTime: string
  capacity: number
  slotIntervalMinutes: number
}

const DEFAULT_INTERVAL_MINUTES = 8

export function emptyRule(weekday = 1, slotIntervalMinutes = DEFAULT_INTERVAL_MINUTES): GolfAvailabilityRule {
  return {
    weekday,
    startTime: '07:00',
    endTime: '12:00',
    capacity: 1,
    slotIntervalMinutes,
  }
}

export function normalizeRule(rule: GolfAvailabilityRule): GolfAvailabilityRule {
  return {
    ...rule,
    startTime: rule.startTime.slice(0, 5),
    endTime: rule.endTime.slice(0, 5),
  }
}

function validTime(value: string) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
}

export type RuleIssueCode = 'time' | 'order' | 'capacity' | 'interval' | 'overlap'

function minutesOfDay(time: string) {
  if (!validTime(time)) return null
  const [hour, minute] = time.split(':').map(Number)
  return hour * 60 + minute
}

/**
 * What is wrong with each band, index-aligned with `rules`.
 *
 * Overlap is checked here rather than left to the API: two bands on one weekday
 * that overlap generate the same tee time twice, and the later row silently
 * wins on Field's uniqueness key.
 */
export function collectRuleIssues(rules: GolfAvailabilityRule[]): RuleIssueCode[][] {
  const issues = rules.map<RuleIssueCode[]>(rule => {
    const codes: RuleIssueCode[] = []
    if (!validTime(rule.startTime) || !validTime(rule.endTime)) {
      codes.push('time')
    } else if (rule.startTime >= rule.endTime) {
      codes.push('order')
    }
    if (!Number.isInteger(rule.capacity) || rule.capacity < 1) codes.push('capacity')
    if (
      !Number.isInteger(rule.slotIntervalMinutes)
      || rule.slotIntervalMinutes < 1
      || rule.slotIntervalMinutes > 1440
    ) {
      codes.push('interval')
    }
    return codes
  })

  rules.forEach((rule, index) => {
    const start = minutesOfDay(rule.startTime)
    const end = minutesOfDay(rule.endTime)
    if (start === null || end === null) return
    rules.forEach((other, otherIndex) => {
      if (otherIndex <= index || other.weekday !== rule.weekday) return
      const otherStart = minutesOfDay(other.startTime)
      const otherEnd = minutesOfDay(other.endTime)
      if (otherStart === null || otherEnd === null) return
      if (start < otherEnd && otherStart < end) {
        if (!issues[index].includes('overlap')) issues[index].push('overlap')
        if (!issues[otherIndex].includes('overlap')) issues[otherIndex].push('overlap')
      }
    })
  })

  return issues
}

export function ruleIssueText(code: RuleIssueCode) {
  return i18next.t(`schedule:issue.${code}` as 'schedule:issue.time')
}

export function countRuleIssues(rules: GolfAvailabilityRule[]) {
  return collectRuleIssues(rules).filter(codes => codes.length > 0).length
}

/** Weekday, then time of day: the order an operator reads a week in. */
export function sortRules<T extends GolfAvailabilityRule>(rules: T[]): T[] {
  return [...rules].sort((left, right) => (
    left.weekday - right.weekday
    || left.startTime.localeCompare(right.startTime)
    || left.endTime.localeCompare(right.endTime)
  ))
}

export type RuleChangeSummary = {
  added: number
  removed: number
  changed: number
}

export function ruleChangeCount(summary: RuleChangeSummary) {
  return summary.added + summary.removed + summary.changed
}

function bandKey(rule: GolfAvailabilityRule) {
  return `${rule.weekday}|${rule.startTime}|${rule.endTime}`
}

/**
 * What saving would do to the stored week.
 *
 * Saving replaces the whole schedule, so a band the operator deleted stops
 * generating inventory the moment they press save. Counting the removals up
 * front is what lets the editor say so beforehand.
 */
export function summarizeRuleChanges(
  baseline: GolfAvailabilityRule[],
  current: GolfAvailabilityRule[],
): RuleChangeSummary {
  const before = new Map(baseline.map(rule => [bandKey(rule), rule]))
  const after = new Map(current.map(rule => [bandKey(rule), rule]))

  let added = 0
  let changed = 0
  after.forEach((rule, key) => {
    const previous = before.get(key)
    if (!previous) {
      added += 1
      return
    }
    if (
      previous.capacity !== rule.capacity
      || previous.slotIntervalMinutes !== rule.slotIntervalMinutes
    ) {
      changed += 1
    }
  })

  let removed = 0
  before.forEach((_, key) => {
    if (!after.has(key)) removed += 1
  })

  return { added, removed, changed }
}

/**
 * Put one weekday's bands on every target weekday, replacing whatever those
 * days held. Building one day and stamping it across the week is the bulk of
 * setting a season up.
 */
export function copyWeekdayRules(
  rules: GolfAvailabilityRule[],
  from: number,
  targets: number[],
): GolfAvailabilityRule[] {
  const days = targets.filter(target => target !== from)
  if (days.length === 0) return rules

  const source = rules.filter(rule => rule.weekday === from)
  const kept = rules.filter(rule => !days.includes(rule.weekday))
  const copies = days.flatMap(target => source.map(rule => ({
    weekday: target,
    startTime: rule.startTime,
    endTime: rule.endTime,
    capacity: rule.capacity,
    slotIntervalMinutes: rule.slotIntervalMinutes,
  })))

  return [...kept, ...copies]
}

function addMinutes(time: string, minutes: number) {
  const total = Math.min((minutesOfDay(time) ?? 0) + minutes, 23 * 60 + 59)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/** The next band to offer on a weekday: one that starts where the day ends. */
export function nextRuleForWeekday(
  rules: GolfAvailabilityRule[],
  weekday: number,
  fallbackInterval = DEFAULT_INTERVAL_MINUTES,
): GolfAvailabilityRule {
  const sameDay = rules.filter(rule => rule.weekday === weekday)
  const interval = sameDay.at(-1)?.slotIntervalMinutes ?? fallbackInterval
  if (sameDay.length === 0) return emptyRule(weekday, interval)

  const latestEnd = sameDay.reduce(
    (latest, rule) => (rule.endTime > latest ? rule.endTime : latest),
    sameDay[0].endTime,
  )
  if (!validTime(latestEnd) || latestEnd >= '23:00') return emptyRule(weekday, interval)

  return {
    ...emptyRule(weekday, interval),
    startTime: latestEnd,
    endTime: addMinutes(latestEnd, 180),
  }
}

/**
 * How many groups a band actually generates: one start per interval, counting
 * the one that leaves on the closing minute.
 */
export function bandStartCount(rule: GolfAvailabilityRule) {
  const start = minutesOfDay(rule.startTime)
  const end = minutesOfDay(rule.endTime)
  if (start === null || end === null || end <= start) return null
  if (!Number.isInteger(rule.slotIntervalMinutes) || rule.slotIntervalMinutes < 1) return null
  return Math.floor((end - start) / rule.slotIntervalMinutes) + 1
}

/** Tee times a whole week of bands would put on sale, for the save summary. */
export function weeklyStartCount(rules: GolfAvailabilityRule[]) {
  return rules.reduce((total, rule) => total + (bandStartCount(rule) ?? 0), 0)
}
