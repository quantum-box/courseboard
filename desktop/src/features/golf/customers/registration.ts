import { customerPath } from './models'

/** Which way into the ledger somebody came. */
export type CustomerRegistrationSource = 'manual' | 'reception_sheet' | 'ledger'

/**
 * How a ledger entry came to exist.
 *
 * `null` for everybody registered before CourseBoard started keeping this —
 * most of the ledger for a long while — which the screen says plainly rather
 * than treating as a gap in the record.
 */
export type CustomerRegistration = {
  source: CustomerRegistrationSource
  /** The signed-in operator who created the entry, when the token named one. */
  registeredBy?: string | null
  /** Zero-based line of the reception sheet. Only ever set for a sheet. */
  sourceRowIndex?: number | null
  createdAt: string
}

export function customerRegistrationPath(customerId: string): string {
  return `${customerPath(customerId)}/registration`
}
