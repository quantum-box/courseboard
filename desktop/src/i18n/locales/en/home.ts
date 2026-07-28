import type { DeepPartial } from '../../types'
import type { home as source } from '../ja/home'

export const home: DeepPartial<typeof source> = {
  title: 'Home',
  description: 'Start the day here.',
  openTimeline: "Open today's timeline",
  features: {
    title: 'What you can do',
  },
  flow: {
    title: 'How today goes',
    description: 'Work top to bottom — each step hands the same booking data to the next.',
    steps: {
      timeline: {
        label: 'Timeline',
        detail: "Check today's bookings and caddie assignments",
      },
      dispatch: {
        label: 'Caddie assignments',
        detail: 'Fill open groups and fix overlaps',
      },
      revenue: {
        label: 'Revenue & billing',
        detail: 'Check target progress and cancellation fees',
      },
      settlement: {
        label: 'Monthly close',
        detail: 'Close out the month of revenue and cost',
      },
    },
  },
}
