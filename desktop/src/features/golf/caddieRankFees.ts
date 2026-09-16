/**
 * What one round pays, and what a month adds up to.
 *
 * The table is edited on the payroll screen rather than buried in settings: the
 * operator who notices a month's total is wrong is the one who has to fix the
 * rate, and sending them somewhere else to do it means they either give up or
 * fix it after the export has already gone out.
 *
 * Everything here is pure so the arithmetic can be checked without a server.
 */

import { i18next } from '../../i18n'

export const RANKS = ['A', 'B', 'C', 'D'] as const

export type Rank = (typeof RANKS)[number]

/** The table as the API answers it. */
export type CaddieRankFees = {
  a: number
  b: number
  c: number
  d: number
  currency: string
}

/** The same table while it is being typed into, which is text until it parses. */
export type CaddieRankFeeDraft = Record<Rank, string>

/** One caddie's line on the sheet. */
export type PayrollRow = {
  caddieProfileId: string
  displayName: string
  staffId?: string | null
  workedMinutes: number
  shiftedMinutes: number
  assignedRounds: number
  rank: Rank
  roundFee: number
  /** True when `roundFee` is the caddie's own rather than their rank's. */
  feeOverridden: boolean
  feeTotal: number
  currency: string
  openClockIn: boolean
  roundsWithoutClockIn: number
}

/** A rank's share of the month, for the breakdown on the monthly close. */
export type RankTotals = {
  rank: Rank
  caddies: number
  rounds: number
  fees: number
  /** How many of those caddies are paid something other than the rank fee. */
  overridden: number
}

/** Mirrors the server-side default for a tenant that has never set a table. */
export const DEFAULT_RANK_FEES: CaddieRankFees = {
  a: 12000,
  b: 11000,
  c: 10000,
  d: 9000,
  currency: 'JPY',
}

/** The largest amount the API accepts, so the form refuses it before the save. */
const MAX_ROUND_FEE = 1_000_000

function feeKey(rank: Rank) {
  return rank.toLowerCase() as 'a' | 'b' | 'c' | 'd'
}

export function feeForRank(fees: CaddieRankFees, rank: Rank) {
  return fees[feeKey(rank)]
}

export function rankFeeDraft(fees: CaddieRankFees): CaddieRankFeeDraft {
  return {
    A: String(fees.a),
    B: String(fees.b),
    C: String(fees.c),
    D: String(fees.d),
  }
}

export function rankFeeDraftIsDirty(draft: CaddieRankFeeDraft, fees: CaddieRankFees) {
  return RANKS.some(rank => draft[rank] !== String(feeForRank(fees, rank)))
}

/**
 * The table the draft describes, or the reason it describes none.
 *
 * A blank or unparseable amount is refused rather than read as zero: zero is a
 * rank the club has decided not to pay for, which is a different statement from
 * a field somebody cleared and has not filled back in.
 */
export function buildRankFees(
  draft: CaddieRankFeeDraft,
  currency: string,
): CaddieRankFees {
  const amounts = {} as Record<Rank, number>
  for (const rank of RANKS) {
    const raw = draft[rank].trim()
    const value = Number(raw)
    if (raw === '' || !Number.isInteger(value) || value < 0 || value > MAX_ROUND_FEE) {
      throw new Error(i18next.t('caddies:payroll.rankFees.invalid', { rank }))
    }
    amounts[rank] = value
  }
  return {
    a: amounts.A,
    b: amounts.B,
    c: amounts.C,
    d: amounts.D,
    currency,
  }
}

/**
 * The month broken down by rank.
 *
 * Every rank gets a line, including the ones nobody holds — a rank missing from
 * the breakdown reads as "nobody is on it" only if you already know the club's
 * grades, and a zero row says it outright.
 */
export function rankTotals(rows: PayrollRow[]): RankTotals[] {
  return RANKS.map(rank => {
    const mine = rows.filter(row => row.rank === rank)
    return {
      rank,
      caddies: mine.length,
      rounds: mine.reduce((total, row) => total + row.assignedRounds, 0),
      fees: mine.reduce((total, row) => total + row.feeTotal, 0),
      overridden: mine.filter(row => row.feeOverridden).length,
    }
  })
}

/** The whole month, as the monthly close totals it. */
export function payrollTotals(rows: PayrollRow[]) {
  return rows.reduce(
    (total, row) => ({
      workedMinutes: total.workedMinutes + row.workedMinutes,
      rounds: total.rounds + row.assignedRounds,
      fees: total.fees + row.feeTotal,
      warnings: total.warnings + row.roundsWithoutClockIn + (row.openClockIn ? 1 : 0),
    }),
    { workedMinutes: 0, rounds: 0, fees: 0, warnings: 0 },
  )
}
