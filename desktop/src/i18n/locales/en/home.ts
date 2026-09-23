import type { DeepPartial } from '../../types'
import type { home as source } from '../ja/home'

export const home: DeepPartial<typeof source> = {
  title: 'Home',
  description: 'Start the day here.',
  launcher: {
    eyebrow: "Today's operations",
    title: 'Where do you want to start?',
    description: 'Choose the task you need, from bookings and caddie assignments to settlement.',
    featured: 'Frequently used tasks',
  },
  features: {
    title: 'More tasks',
  },
  flow: {
    title: 'How today goes',
    description: 'Work top to bottom — each step hands the same booking data to the next.',
    steps: {
      ledger: {
        label: 'Reservation ledger',
        detail: "Check today's bookings and available starts",
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
