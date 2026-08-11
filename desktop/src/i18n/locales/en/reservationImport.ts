import type { DeepPartial } from '../../types'
import type { reservationImport as source } from '../ja/reservationImport'

export const reservationImport: DeepPartial<typeof source> = {
  title: 'Import bookings',
  description:
    'Read the booking system\'s daily reservation export and bring this month\'s group counts in.',

  upload: {
    title: 'Choose a file',
    description:
      'Pick the .xlsx exactly as the booking system exported it. The month it covers is read from the file name.',
    file: 'Reservation export',
    fileHint: 'e.g. 日別予約状況_組数_20260718_202607_真駒内_滝の_羊ケ丘.xlsx',
    month: 'Month',
    monthHint: 'Only needed when the file name does not say which month it covers.',
    check: 'Check the file',
    checking: 'Reading…',
    readError: 'That file could not be read. Choose it again.',
  },

  preview: {
    title: 'What will be imported',
    description: 'Bookings for {{yearMonth}}. Import them if this looks right.',
    apply: 'Import this',
    applying: 'Importing…',
    cancel: 'Discard',
    metric: {
      month: 'Month',
      courses: 'Courses',
      days: 'Days',
      groups: 'Groups',
      caddieGroups: 'With a caddie',
      skipped: 'Left out',
    },
    unit: {
      courses: '{{n}} courses',
      days: '{{n}} days',
      groups: '{{n}} groups',
      halfDays: '{{n}} entries',
    },
    courses: {
      title: 'By course',
      sheetLabel: 'Name in the file',
      courseName: 'Course in Course Board',
      days: 'Days',
      groups: 'Groups',
      caddieGroups: 'With a caddie',
    },
    empty: {
      title: 'No file chosen yet',
      description: 'Choose a file above to see what it holds before importing it.',
    },
  },

  warnings: {
    title: 'Worth checking',
    description:
      'The import still goes through. Check these days against the original booking sheet afterwards.',
  },

  warning: {
    unreadableCount:
      'The group count for {{course}} on {{date}} ({{half}}) is not a number, so that half-day was left out.',
    caddieGroupsExceedTotal:
      '{{course}} on {{date}} ({{half}}) has {{caddieGroups}} groups with a caddie out of {{totalGroups}} groups in total. Imported as sent, but one of the two numbers looks wrong.',
    courseTotalsDisagreeWithSheet:
      'The totals for {{date}} ({{half}}) do not agree. The file\'s club-wide row says {{sheetTotal}} groups; the courses add up to {{importedTotal}}.',
    unknownCourse:
      'No course in Course Board matches "{{course}}" from the file, so its bookings were left out. Match the course name in course settings.',
    ambiguousCourse:
      '"{{course}}" from the file could be any of {{candidates}}, so its bookings were left out. Make the course names distinguishable.',
    unknown:
      'There is something in this file worth checking. Compare it against the original booking sheet after importing.',
  },

  daily: {
    title: 'Groups by day',
    description: '{{from}} – {{to}}',
    course: 'Course',
    allCourses: 'All courses',
    date: 'Date',
    morning: 'Morning',
    afternoon: 'Afternoon',
    total: 'Total',
    caddieGroups: 'With a caddie',
    empty: {
      title: 'Nothing imported for this month yet',
      description: 'Import a file above and the daily counts will show here.',
    },
  },

  imported: {
    title: 'Imported',
    message: 'Imported {{n}} entries of {{yearMonth}} bookings.',
    skipped: '{{n}} were left out.',
  },

  error: {
    monthRequired:
      'The file name does not say which month it covers. Choose the month above and try again.',
    failed: 'The file could not be imported.',
  },
}
