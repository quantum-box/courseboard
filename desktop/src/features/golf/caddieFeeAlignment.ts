/**
 * Moving caddies who carry a fee of their own onto their rank's fee.
 *
 * Everyone registered before rank fees existed was entered with an amount, so
 * the rank table prices nobody until those amounts go back to zero (PLT-3346).
 * Whether a caddie should go is the club's call — for some the rank pays less —
 * so the screen only ever starts with the moves that change nobody's pay ticked.
 *
 * Everything here is pure so the choice can be checked without a server.
 */

import type { CaddieRankFees, Rank } from './caddieRankFees'

export type FeeAlignmentEffect = 'unchanged' | 'raise' | 'cut'

export type FeeAlignmentCandidate = {
  caddieProfileId: string
  displayName: string
  active: boolean
  rank: Rank
  ownFee: number
  rankFee: number
  /** `rankFee - ownFee`: negative is a pay cut. */
  difference: number
  effect: FeeAlignmentEffect
}

export type CaddieFeeChange = {
  id: number
  caddieProfileId: string
  displayName?: string | null
  rank: Rank
  previousFee: number
  newFee: number
  rankFee: number
  currency: string
  note?: string | null
  changedBy?: string | null
  changedByName?: string | null
  changedAt: string
}

export type FeeAlignmentPreview = {
  rankFeesConfirmed: boolean
  fees: CaddieRankFees
  candidates: FeeAlignmentCandidate[]
  recentChanges: CaddieFeeChange[]
}

export type FeeAlignmentOutcome =
  | 'aligned'
  | 'already_on_rank'
  | 'own_fee_changed'
  | 'not_found'
  | 'rank_unpriced'
  | 'failed'

export type FeeAlignmentResult = {
  caddieProfileId: string
  outcome: FeeAlignmentOutcome
  message?: string | null
}

/**
 * Whether a candidate can be ticked at all.
 *
 * A rank priced at zero would pay nothing per round, and the server refuses the
 * move; offering the checkbox would only produce a refusal to read.
 */
export function canAlign(candidate: FeeAlignmentCandidate) {
  return candidate.rankFee > 0
}

/**
 * The ticks the sheet opens with: only the moves that change nobody's pay.
 *
 * Raises and cuts are left for a person to choose. A raise is a pay decision
 * too, and ticking it by default would make it one the screen took.
 */
export function initialSelection(candidates: FeeAlignmentCandidate[]) {
  return new Set(
    candidates
      .filter(candidate => candidate.effect === 'unchanged' && canAlign(candidate))
      .map(candidate => candidate.caddieProfileId),
  )
}

/** The request body for the ticked candidates, carrying the fee each one showed. */
export function alignmentRequest(
  candidates: FeeAlignmentCandidate[],
  selected: ReadonlySet<string>,
  note: string,
) {
  const trimmed = note.trim()
  return {
    items: candidates
      .filter(candidate => selected.has(candidate.caddieProfileId) && canAlign(candidate))
      .map(candidate => ({
        caddieProfileId: candidate.caddieProfileId,
        expectedOwnFee: candidate.ownFee,
      })),
    ...(trimmed ? { note: trimmed } : {}),
  }
}

/** How many ticked moves cut pay, and by how much per round in total. */
export function selectedCuts(
  candidates: FeeAlignmentCandidate[],
  selected: ReadonlySet<string>,
) {
  const cuts = candidates.filter(
    candidate => candidate.effect === 'cut' && selected.has(candidate.caddieProfileId),
  )
  return {
    count: cuts.length,
    perRound: cuts.reduce((total, candidate) => total + candidate.difference, 0),
  }
}

/** The results, counted: moved, and everyone who was not. */
export function summarizeResults(results: FeeAlignmentResult[]) {
  const aligned = results.filter(result => result.outcome === 'aligned').length
  return { aligned, skipped: results.length - aligned }
}
