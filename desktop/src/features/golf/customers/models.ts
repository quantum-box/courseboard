/** One person in the customer ledger. */
export type Customer = {
  id: string
  name: string
  nameKana?: string | null
  /** Absent for anyone taken by phone or at the counter, which is most of them. */
  email?: string | null
  phone?: string | null
}

export type CustomerList = {
  items: Customer[]
}

export const customersPath = '/v1/course/customers'

/**
 * How a candidate is told apart from the others sharing its name.
 *
 * Two members called 本田 are one row apart in the list, and picking the wrong
 * one attaches a stranger's visit history to the booking. Whatever separates
 * them — the kana, a phone number — has to be on screen at the moment of the
 * choice, so this returns the distinguishing detail rather than the name again.
 */
export function customerDistinguisher(customer: Customer): string | null {
  const parts = [customer.nameKana, customer.phone, customer.email]
    .map(part => part?.trim())
    .filter((part): part is string => Boolean(part))
  return parts.length > 0 ? parts.join(' · ') : null
}
