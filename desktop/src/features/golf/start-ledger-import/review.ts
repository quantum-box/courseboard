import { toRemarks, toRemarksDraft, type RemarksDraft } from '../ledger/partyRemarks'
import type { StartLedgerContext, StartLedgerImportParty, StartLedgerImportResult, StartLedgerPartyDraft, StartLedgerRead } from './api'

/** The paper ledger draws four players per group. */
export const PLAYER_SLOTS = 4

export type ReviewPlayer = { name: string; tag: string; memberNumber: string }
/** One group on the review screen: what was read, and what the desk made of it. */
export type ReviewParty = {
  key: string
  source: StartLedgerPartyDraft
  courseId: string
  teeTime: string
  planId: string
  customerName: string
  competitionName: string
  players: ReviewPlayer[]
  remarks: RemarksDraft
  notes: string
  /** The desk compared this group with the original. */
  checked: boolean
  excluded: boolean
  result?: StartLedgerImportResult
}

export type ReviewIssues = {
  course: boolean
  teeTime: boolean
  name: boolean
  /** The sheet says セルフ/キャディ and the chosen plan says the other. */
  caddieMismatch: boolean
  /** A group already on the ledger at that course and time. */
  booked?: StartLedgerContext['booked'][number]
  /** Another group on this sheet has the same course and time. */
  repeated: boolean
}

/** Width, case, and spacing differ between the booking system and our names. */
export function normalizeName(value: string) {
  return value.normalize('NFKC').replace(/[\s　]+/gu, '').toLowerCase()
}

function bestMatch<T>(name: string | undefined, items: readonly T[], label: (item: T) => string): T | undefined {
  if (!name?.trim()) return undefined
  const wanted = normalizeName(name)
  const exact = items.filter(item => normalizeName(label(item)) === wanted)
  if (exact.length === 1) return exact[0]
  const partial = items.filter(item => {
    const candidate = normalizeName(label(item))
    return candidate.length > 0 && (candidate.includes(wanted) || wanted.includes(candidate))
  })
  return partial.length === 1 ? partial[0] : undefined
}

export function soldOn(plan: StartLedgerContext['plans'][number], courseId: string) {
  return !plan.courseIds || plan.courseIds.includes(courseId)
}

export function matchCourse(name: string | undefined, courses: StartLedgerContext['courses']) {
  return bestMatch(name, courses, course => course.name)?.id ?? ''
}

export function matchPlan(name: string | undefined, plans: StartLedgerContext['plans'], courseId: string) {
  return bestMatch(name, plans.filter(plan => !courseId || soldOn(plan, courseId)), plan => plan.name)?.reservationServiceId ?? ''
}

/** `菊池 芳彦 様` under the representative is the booker, not a competition. */
export function competitionFrom(groupName: string | undefined) {
  const value = groupName?.trim() ?? ''
  return /様$/u.test(value) ? '' : value
}

export function buildReview(read: StartLedgerRead, context: StartLedgerContext): ReviewParty[] {
  return read.parties.map((source, index) => {
    const courseId = matchCourse(source.courseName, context.courses)
    const players = source.players.slice(0, PLAYER_SLOTS).map(player => ({ name: player.name ?? '', tag: player.tag ?? '', memberNumber: player.number ?? '' }))
    while (players.length < PLAYER_SLOTS) players.push({ name: '', tag: '', memberNumber: '' })
    return {
      key: `${index}`,
      source,
      courseId,
      teeTime: source.teeTime ?? '',
      planId: matchPlan(source.planName, context.plans, courseId),
      customerName: source.representative ?? source.players.find(player => player.name)?.name ?? '',
      competitionName: competitionFrom(source.groupName),
      players,
      remarks: toRemarksDraft(source.remarks),
      notes: source.notes ?? '',
      checked: false,
      excluded: false,
    }
  })
}

/** Re-match the printed names after the course or plan list changed. */
export function rematch(parties: ReviewParty[], context: StartLedgerContext): ReviewParty[] {
  return parties.map(party => {
    const courseId = party.courseId && context.courses.some(course => course.id === party.courseId) ? party.courseId : matchCourse(party.source.courseName, context.courses)
    const planId = party.planId && context.plans.some(plan => plan.reservationServiceId === party.planId && soldOn(plan, courseId)) ? party.planId : matchPlan(party.source.planName, context.plans, courseId)
    return { ...party, courseId, planId }
  })
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/u

export function reviewIssues(party: ReviewParty, all: readonly ReviewParty[], context: StartLedgerContext): ReviewIssues {
  const plan = context.plans.find(item => item.reservationServiceId === party.planId)
  const style = party.source.playStyle
  return {
    course: !party.courseId,
    teeTime: !TIME.test(party.teeTime),
    name: !party.customerName.trim(),
    caddieMismatch: !!plan && !!style && plan.requiresCaddie !== (style === 'caddie'),
    booked: context.booked.find(item => item.golfCourseId === party.courseId && item.teeTime === party.teeTime),
    repeated: all.some(other => other.key !== party.key && !other.excluded && other.courseId === party.courseId && other.teeTime === party.teeTime),
  }
}

/** Issues that make the group impossible to book, as opposed to warnings. */
export function blocking(issues: ReviewIssues) {
  return issues.course || issues.teeTime || issues.name
}

/** Groups that still need the desk before anything is written. */
export function pendingParties(parties: readonly ReviewParty[], context: StartLedgerContext) {
  return parties.filter(party => !party.excluded && !isDone(party) && (!party.checked || blocking(reviewIssues(party, parties, context))))
}

/** The group is in the ledger, by this import or an earlier booking. */
export function isDone(party: ReviewParty) {
  return party.result?.outcome === 'created' || party.result?.outcome === 'already_booked'
}

/** Groups to send: checked, not excluded, not already done. */
export function partiesToImport(parties: readonly ReviewParty[]) {
  return parties.filter(party => !party.excluded && party.checked && !isDone(party))
}

export function toImportParty(party: ReviewParty): StartLedgerImportParty {
  const players = party.players
    .filter(player => player.name.trim())
    .map(player => ({
      name: player.name.trim(),
      ...(player.tag.trim() ? { tag: player.tag.trim() } : {}),
      ...(player.memberNumber.trim() ? { memberNumber: player.memberNumber.trim() } : {}),
    }))
  return {
    golfCourseId: party.courseId,
    teeTime: party.teeTime.trim(),
    reservationServiceId: party.planId || null,
    customerName: party.customerName.trim(),
    quantity: Math.max(1, players.length),
    competitionName: party.competitionName.trim() || null,
    players,
    remarks: toRemarks(party.remarks),
    notes: party.notes.trim() || null,
  }
}

export function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size))
  return out
}
