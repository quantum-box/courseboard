import type { DeepPartial } from '../../types'
import type { shifts as source } from '../ja/shifts'

export const shifts: DeepPartial<typeof source> = {
  title: 'Shift board',
  description: 'A month of caddie schedules at a glance, so long unbroken stretches stand out early.',
  loading: 'Loading the shift board',
  month: 'Month',
  legend: {
    label: 'Legend',
    assigned: 'Assigned',
    off: 'Day off requested',
    morning: 'Morning only',
    afternoon: 'Afternoon only',
    light: 'Light duty only',
    none: 'Nothing planned',
  },
  cell: {
    assigned: 'W',
    off: 'O',
    morning: 'AM',
    afternoon: 'PM',
    light: 'L',
    tooltip: '{{name}} · {{date}}',
    assignments: '{{n}} assignments',
  },
  streak: {
    header: 'Streak',
    days: '{{n}}d',
    warningTitle: 'Some caddies have long working streaks',
    warningBody: '{{names}} assigned {{n}} or more days in a row. See whether a day off fits.',
    threshold: 'Streaks of 6+ days are highlighted',
  },
  table: {
    caddie: 'Caddie',
    aria: 'Shift board for {{month}}',
  },
  empty: {
    title: 'Nothing planned this month',
    description: 'Assignments and requested days off will appear here as a table.',
  },
}
