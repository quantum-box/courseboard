import type { DeepPartial } from '../../types'
import type { customers as source } from '../ja/customers'

export const customers: DeepPartial<typeof source> = {
  search: {
    title: 'Find a customer',
    description: 'Members and visitors alike — everyone who plays here is in this ledger.',
    label: 'Name, reading, or phone',
    placeholder: 'e.g. Honda, ホンダ, 090-1234',
    prompt: 'Type at least two characters of a name, reading, or phone number.',
    noMatches: 'Nobody matches "{{term}}". You can register them as a new customer.',
  },
  create: {
    open: 'Register a new customer',
    title: 'Register a new customer',
    description: 'A name is enough. Bookings taken by phone often have nothing else.',
    namePlaceholder: 'e.g. Yasuhiko Honda',
    saved: 'Customer registered',
    failed: 'Could not register the customer',
  },
  detail: {
    description: 'What the ledger holds, and the membership against it.',
  },
  field: {
    name: 'Name',
    nameKana: 'Reading',
    phone: 'Phone',
    email: 'Email',
    membership: 'Membership',
  },
  noContact: 'No contact details',
}
