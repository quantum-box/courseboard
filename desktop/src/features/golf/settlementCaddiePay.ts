/**
 * What the month pays the caddies, as the close reads it (PLT-3347).
 *
 * The payroll screen is for going down the sheet one caddie at a time, so the
 * month's totals and the rank breakdown live on the close instead. Nothing is
 * priced here: every row already carries the amount the server worked out off
 * the rank table, and this only adds the rows up.
 *
 * The close already shows a caddie figure of its own — the fees stamped on the
 * assignments when they were made. The two answer different questions (what
 * was committed, what is owed at today's rates), so they are shown side by
 * side with the gap between them rather than one replacing the other.
 */

import { payrollTotals, rankTotals, type PayrollRow, type RankTotals } from './caddieRankFees'

export type SettlementCaddiePay = {
  currency: string
  /** Pay for the month at today's rates, summed over the payroll rows. */
  fees: number
  rounds: number
  /** Caddies with at least one round in the month. */
  caddiesOnRounds: number
  /** Caddies whose attendance needs a look before the sheet goes out. */
  caddiesToCheck: number
  /** What the assignments were stamped with when they were made. */
  committed: number
  /**
   * `fees - committed`. `null` when the two are in different currencies, where
   * a difference would be arithmetic on unlike amounts.
   */
  difference: number | null
  byRank: RankTotals[]
}

export function settlementCaddiePay(
  rows: PayrollRow[],
  committed: { total: number, currency: string },
): SettlementCaddiePay {
  const totals = payrollTotals(rows)
  // A club is paid in one currency, and every row carries the rank table's.
  const currency = rows[0]?.currency ?? committed.currency
  return {
    currency,
    fees: totals.fees,
    rounds: totals.rounds,
    caddiesOnRounds: rows.filter(row => row.assignedRounds > 0).length,
    caddiesToCheck: rows.filter(row => row.openClockIn || row.roundsWithoutClockIn > 0).length,
    committed: committed.total,
    difference: currency === committed.currency ? totals.fees - committed.total : null,
    byRank: rankTotals(rows),
  }
}
