import type { DeepPartial } from '../../types'
import type { courses as source } from '../ja/courses'

export const courses: DeepPartial<typeof source> = {
  title: 'Course setup',
  description:
    'Register each course with its name, hole count, and start interval. Play products and caddie coverage build on this.',
  add: 'Add a course',
  notice: {
    added: 'Added “{{name}}”.',
    updated: 'Saved “{{name}}”.',
    deleted: 'Deleted “{{name}}”.',
    failed: 'Could not finish that',
    checkInput: 'Check what you entered',
  },
  editor: {
    createTitle: 'Add a course',
    editTitle: 'Edit course',
    description: 'The basics used to generate booking slots.',
  },
  field: {
    name: 'Course name',
    namePlaceholder: 'Makomanai Country Club',
    shortName: 'Short name',
    shortNamePlaceholder: 'Makomanai',
    status: 'Status',
    holeCount: 'Holes',
    startInterval: 'Start interval',
    startIntervalHint: '1–60 minutes',
  },
  option: {
    holes18: '18 holes',
    holes9: '9 holes',
    holesOther: '{{n}} holes',
  },
  table: {
    course: 'Course',
    holes: 'Holes',
    hours: 'Opening hours',
    status: 'Status',
    updated: 'Updated',
    actions: 'Actions',
    schedule: 'Hours',
    scheduleAria: 'Open the bookable hours for {{name}}',
    editAria: 'Edit {{name}}',
    deleteAria: 'Delete {{name}}',
    deleting: 'Deleting',
  },
  confirmDelete: 'Delete “{{name}}”. Are you sure?',
  loading: 'Loading courses',
  list: {
    title: 'Courses',
    description: 'The courses used by play products and slot settings.',
  },
  empty: {
    title: 'No courses yet',
    description: 'Add your first course to set up play products and start slots.',
    action: 'Add the first course',
  },
  validation: {
    name: 'Enter a course name.',
    holeCount: 'Choose 9 or 18 holes.',
    startInterval: 'Enter a start interval between 1 and 60 minutes.',
  },
  error: {
    generic: 'Could not finish that.',
  },
}
