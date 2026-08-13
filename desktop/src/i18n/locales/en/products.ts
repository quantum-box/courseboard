import type { DeepPartial } from '../../types'
import type { products as source } from '../ja/products'

export const products: DeepPartial<typeof source> = {
  loading: 'Loading play products',
  addService: 'Add a booking service',
  playType: {
    caddie: 'With caddie',
    self: 'Self play',
  },
  editor: {
    displayName: 'Plan name',
    displayNameHint: 'Shown on booking screens and slot lists.',
    course: 'Course',
    courseHint: 'The courses this plan is sold on. Pick several when the plan is the same on each; hours and tee times come from whichever course is booked.',
    courseUnset: 'Choose a course',
    courseNone: 'No courses yet. Create one first.',
    maxPlayers: 'Players per group',
    maxPlayersHint: 'The cap on one group. Leave it empty to follow the reservation policy. How many groups you accept is set on the course.',
    maxPlayersValue: '{{n}} players',
    maxPlayersFromPolicy: 'Follow the reservation policy',
    displayNamePlaceholder: 'Weekday caddie plan',
    createTitle: 'Add a booking service',
    editTitle: 'Edit play settings',
    description: 'Attach a play type, hole count, and expected duration to a service ID.',
    serviceId: 'Booking service ID',
    serviceIdHintNew: 'Enter the booking service ID.',
    serviceIdHintEdit: 'Existing IDs cannot be changed.',
    playType: 'Play type',
    holeCount: 'Holes',
    duration: 'Expected duration',
    durationHint: '30–720 minutes',
    save: 'Save play settings',
    saveFailed: 'Could not save the play settings',
    saved: {
      title: 'Plan saved',
      body: 'Saved “{{name}}” (ID: {{serviceId}}).',
    },
  },
  list: {
    title: 'Booking services',
    description: 'Select a row to open that service’s weekly slots.',
    badge: '{{n}} rows',
    editPlan: 'Plan settings',
    open: 'Open the slots for {{name}}',
    empty: {
      title: 'No booking services',
      description: 'Register a booking service ID, then set its play type and slots.',
      action: 'Add the first booking service',
    },
    table: {
      service: 'Booking service',
      course: 'Course',
      playType: 'Play type',
      holes: 'Holes',
      duration: 'Duration',
      updated: 'Updated',
      actions: 'Actions',
    },
  },
  detail: {
    back: 'Back to booking services',
    summary: 'Plan settings',
    notFound: {
      title: 'No such booking service',
      description: 'Nothing is registered under {{serviceId}}. It may have been removed, or the URL may be wrong.',
    },
  },
  course: {
    unset: 'No course',
    unknown: 'Unknown course',
    backlog: {
      title: '{{n}} plans have no course',
      description: 'Without a course there is nothing to check opening hours, tee interval, or shared caddies against. Open each one and set it.',
    },
    required: {
      title: 'This plan has no course',
      description: 'Naming a course turns on the tee-interval ceiling check and the caddie split with the other plans on that course.',
    },
  },
  inventory: {
    title: 'Bookable hours',
    description: 'Hours belong to the course. Plans sold on the same course share its tee times, so the hours are set there.',
    open: 'Open the hours for {{course}}',
    needsCourse: {
      title: 'Name a course to open its hours',
      description: 'This plan does not say which course it is sold on yet. Choose one in the plan settings.',
    },
    legacy: {
      title: 'This plan still carries old slots',
      description: 'They predate the move to course-level hours and cannot be edited here. They disappear once the booking screen reads course inventory.',
      limits: '{{groups}} groups · {{players}} players',
    },
  },
  /** What is left of the per-plan week: the id line, and the legacy read-only list. */
  slots: {
    subtitle: 'ID: {{serviceId}}',
    week: {
      dayLabel: '{{day}}',
    },
  },
  capacity: {
    title: 'Build slots from caddie supply',
    description:
      'Caddies with no day-off request count as available. The result applies to the same weekday on the selected service.',
    badge: 'Linked to staffing',
    date: 'Date',
    targetWeekday: 'That date is a {{day}}. The result lands on {{day}} slots.',
    calculate: 'Calculate supply',
    calculating: 'Calculating',
    failed: 'Could not calculate the supply',
    morning: 'Morning',
    afternoon: 'Afternoon',
    groups: '{{n}} groups',
    limit: 'Sellable limit',
    activeCaddies: 'Available caddies',
    activeCaddiesValue: '{{available}}/{{total}}',
    assumed: '{{n}} have no day-off request on file',
    allRegistered: 'Everyone has submitted their requests',
    warning: {
      title: 'Some requests are missing',
      description:
        '{{n}} caddies are counted as available. Check day-off requests in the caddie roster before you commit.',
    },
    applyTo: 'Apply to {{day}}',
  },
  validation: {
    displayNameRequired: 'Enter a plan name.',
    displayNameLength: 'Keep the plan name within 255 characters.',
    serviceIdRequired: 'Enter a booking service ID.',
    serviceIdFormat: 'Booking service IDs may use letters, digits, period, hyphen, underscore, and colon.',
    courseRequired: 'Choose a course. Courses differ in opening hours and in what they sell.',
    maxPlayers: 'Enter players per group between 1 and 99.',
    holeCount: 'Choose 9 or 18 holes.',
    duration: 'Enter a duration between 30 and 720 minutes.',
  },
  error: {
    generic: 'Could not finish that.',
  },
}
