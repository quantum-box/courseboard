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
    available: 'Available',
    off: 'Day off requested',
    morning: 'Morning only',
    afternoon: 'Afternoon only',
    light: 'Light duty only',
    unknown: 'Check status',
    none: 'Nothing planned',
  },
  cell: {
    assigned: 'W',
    available: 'A',
    off: 'O',
    morning: 'AM',
    afternoon: 'PM',
    light: 'L',
    unknown: '?',
    tooltip: '{{name}} · {{date}}',
    assignments: '{{n}} assignments',
    aria: '{{name}}, {{date}}, {{state}}',
    ariaWithAssignments: '{{name}}, {{date}}, {{state}}, {{n}} assignments',
  },
  employment: {
    inactive: 'On leave',
    suspended: 'Suspended',
    unknown: 'Check status',
  },
  streak: {
    header: 'Streak',
    days: '{{n}}d',
    warningTitle: 'Some caddies have long working streaks',
    warningBody: '{{names}} assigned or available for {{n}} or more days in a row. See whether a day off fits.',
    threshold: 'Streaks of 6+ days are highlighted',
  },
  table: {
    caddie: 'Caddie',
    aria: 'Shift board for {{month}}',
  },
  navigation: {
    label: 'Move the visible week',
    previous: 'Previous week',
    current: 'This week',
    next: 'Next week',
  },
  empty: {
    title: 'Nothing planned this month',
    description: 'Assignments and requested days off will appear here as a table.',
  },
}
