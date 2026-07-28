import type { DeepPartial } from '../../types'
import type { budgets as source } from '../ja/budgets'

export const budgets: DeepPartial<typeof source> = {
  title: 'Daily revenue targets',
  description:
    'Tune revenue, spend per player, and the caddie share for the month, side by side with actual bookings.',
  loading: 'Loading targets and actuals',
  filter: {
    month: 'Month',
    course: 'Course',
    allCourses: 'All courses',
    courseNote: 'The course filter applies to the list below',
  },
  progress: {
    title: 'Progress this month',
    description: 'Actual bookings across all courses, laid over the daily targets.',
    badge: 'All courses · {{n}} days',
    unavailable: {
      title: 'Actuals are unavailable',
      description: 'You can still edit targets. Refresh once actuals are available again.',
    },
    empty: {
      title: 'No targets or actuals for this month',
      description: 'Register daily targets to see how bookings track against them here.',
    },
    metrics: {
      target: 'Target revenue',
      actual: 'Actual revenue',
      rate: 'Attainment',
      bookings: 'Bookings / players',
      bookingsDetail: 'bookings / players',
    },
    table: {
      date: 'Date',
      revenue: 'Revenue (actual / target)',
      rate: 'Attainment',
      perPlayer: 'Per player (actual / target)',
      caddieRate: 'Caddie share (actual / target)',
    },
  },
  editor: {
    title: 'Add or update one day',
    description: 'Saving the same course and date overwrites that day’s target.',
    noCourses: {
      title: 'No courses yet',
      description: 'Create a course under Settings → Course setup.',
    },
    course: 'Course',
    date: 'Date',
    targetRevenue: 'Target revenue',
    targetRevenueHint: 'Yen, tax included',
    targetPerPlayer: 'Target per player',
    targetPerPlayerHint: 'Yen per player',
    caddieRate: 'Caddie share',
    caddieRateHint: '0–100%',
    save: 'Save target',
    saved: 'Saved the target for {{date}}.',
  },
  csv: {
    title: 'Import from CSV',
    description: 'Review what will be imported, then apply it all at once.',
    template: 'Template',
    file: 'CSV file',
    fileHint: 'Header row: {{header}}',
    importing: 'Importing…',
    apply: 'Apply the reviewed rows',
    imported: 'Imported {{name}}.',
    headerError: 'Check the CSV header. Required columns: {{header}}',
    readError: 'Could not read the CSV file.',
    importError: 'Could not import the CSV.',
  },
  list: {
    title: 'Registered targets',
    description: '{{from}} to {{to}}',
    badge: '{{n}} rows',
    empty: {
      title: 'No targets match',
      description: 'Register targets from the form above or from a CSV.',
    },
    table: {
      course: 'Course',
      date: 'Date',
      targetRevenue: 'Target revenue',
      targetPerPlayer: 'Target per player',
      caddieRate: 'Caddie share',
    },
  },
  validation: {
    courseAndDate: 'Choose a course and a date.',
    targetRevenue: 'Enter a target revenue of 0 or more.',
    targetPerPlayer: 'Enter a target per player of 0 or more.',
    caddieRate: 'Enter a caddie share between 0 and 100%.',
  },
  saveFailed: 'Could not save the target.',
}
