import type { DeepPartial } from '../../types'
import type { customers as source } from '../ja/customers'

export const customers: DeepPartial<typeof source> = {
  search: {
    title: 'Find a customer',
    description: 'Members and visitors alike — everyone who plays here is in this ledger.',
    label: 'Name, reading, phone, or email',
    placeholder: 'e.g. Honda, ホンダ, 090-1234, honda@example.com',
    prompt: 'Enter a name, reading, phone number, or email address. Names can be searched from one character.',
    recent: 'Showing up to {{count}} of the most recently registered customers. Search by name, reading, phone, or email to find anyone else.',
    emptyLedgerTitle: 'No customers yet',
    emptyLedger: 'Use "Register a new customer" to add one.',
    noMatchesTitle: 'No customer matches "{{term}}"',
    condition: {
      name: 'a name or reading',
      phone: 'a phone number',
      email: 'an email address',
    },
    noMatches: 'No customer matched "{{term}}" when searched as {{condition}}. Check the input; if it is correct, you can register a new customer.',
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
    description: 'What the ledger holds for this person.',
    back: 'Back to the customer ledger',
    missing: 'This customer could not be found. They may have been removed from the ledger.',
    membershipTitle: 'Membership',
    membershipDescription: 'Whether they are a member or a visitor, and of what.',
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
