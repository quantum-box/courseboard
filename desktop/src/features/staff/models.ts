/**
 * The golf club's own staff roster, backed by the Field HRM master
 * (`GET/POST /v1/erp/staff`). This is everyone the company employs — the
 * kitchen, the front desk, maintenance — not only the people who caddie.
 *
 * Being a caddie is one role a staff member holds, so the caddie profile is
 * folded in here as a role badge rather than a separate list of people.
 */

import { resolveStaffId } from '../golf/caddieRegistration'

export type StaffMember = {
  id: string
  name: string
  /**
   * Derived by Field from `employmentStatus`; never written by this app.
   * Sending it would collapse a staff member on leave into a retired one.
   */
  active: boolean
  employmentStatus: string
  employmentType: string
  hiredAt: string | null
  contractEndDate: string | null
  phone: string | null
  email: string | null
  attributesJson: unknown | null
}

export type StaffCaddieProfile = {
  id: string
  displayName: string
  skillLevel: string
  rank: string
  employmentStatus?: string
  staffId?: string | null
  staffReferenceType?: string
  staffReferenceId?: string | null
}

/** Clock state for the day, as the caddie attendance snapshot reports it. */
export type StaffAttendanceStatus = 'not_linked' | 'not_clocked' | 'working' | 'clocked_out'

export type StaffAttendanceSnapshot = {
  caddieProfileId: string
  staffId?: string | null
  attendanceStatus: StaffAttendanceStatus
}

export type StaffRow = {
  staff: StaffMember
  /** Where this person stands with the club, as [`staffEmploymentStatus`] reads it. */
  status: StaffEmploymentStatus
  /** The caddie profile this staff member holds, when they caddie at all. */
  caddie: StaffCaddieProfile | null
  /**
   * Undefined for anyone the attendance snapshot says nothing about — every
   * non-caddie, since the punch clock is driven by the caddie board.
   */
  attendance?: StaffAttendanceStatus
}

export type StaffFilter = {
  query: string
  status: 'all' | StaffEmploymentStatus
  role: 'all' | 'caddie' | 'other'
}

/** Where a staff member stands with the club. */
export const STAFF_EMPLOYMENT_STATUSES = ['active', 'on_leave', 'retired'] as const
export type StaffEmploymentStatus = (typeof STAFF_EMPLOYMENT_STATUSES)[number]

/**
 * Where a staff member stands with the club, as Field HRM records it.
 *
 * Field owns the status outright: `active` on the same record is derived from
 * it upstream, so it is only worth reading when the status itself is missing —
 * a cached response from before Field grew the column.
 */
export function staffEmploymentStatus(member: StaffMember): StaffEmploymentStatus {
  const stored = member.employmentStatus?.trim().toLowerCase()
  if (stored && (STAFF_EMPLOYMENT_STATUSES as readonly string[]).includes(stored)) {
    return stored as StaffEmploymentStatus
  }
  return member.active ? 'active' : 'retired'
}

/**
 * The caddie employment status that matches a staff member's standing.
 *
 * A retired staff member left flagged "出勤できる" on the caddie roster keeps
 * turning up in shift and assignment screens, so the two rosters are kept in
 * step whenever the staff status changes.
 */
export function caddieStatusForStaff(status: StaffEmploymentStatus) {
  if (status === 'active') return 'active'
  return status === 'on_leave' ? 'inactive' : 'suspended'
}

/**
 * Employment types offered when registering someone, and the only ones Field
 * HRM accepts. `contract` is offered too so editing somebody hired on one does
 * not quietly move them onto a different contract.
 */
export const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'contract'] as const
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number]

/**
 * The employment type as a label key, or `null` when HRM does not say.
 *
 * Older records and staff registered elsewhere carry no type at all, and a
 * guessed default would read as fact on a roster people are paid from.
 */
export function employmentTypeKey(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase()
  if (!normalized) return null
  return (EMPLOYMENT_TYPES as readonly string[]).includes(normalized)
    ? (normalized as EmploymentType)
    : null
}

function normalize(value: string) {
  return value.trim().replace(/[\s　]+/g, '').toLocaleLowerCase('ja')
}

/** Caddie profiles keyed by the staff member behind them. */
export function caddiesByStaffId(profiles: StaffCaddieProfile[]) {
  const index = new Map<string, StaffCaddieProfile>()
  for (const profile of profiles) {
    const staffId = resolveStaffId(profile)
    // First one wins: a duplicate would otherwise silently replace the profile
    // the roster screen shows for that person.
    if (staffId && !index.has(staffId)) index.set(staffId, profile)
  }
  return index
}

/** Legacy profiles with nobody behind them, offered when linking from here. */
export function unlinkedCaddies(profiles: StaffCaddieProfile[]) {
  return profiles.filter(profile => !resolveStaffId(profile))
}

export function attendanceByStaffId(snapshots: StaffAttendanceSnapshot[]) {
  const index = new Map<string, StaffAttendanceStatus>()
  for (const snapshot of snapshots) {
    if (snapshot.staffId) index.set(snapshot.staffId, snapshot.attendanceStatus)
  }
  return index
}

export function staffRows(
  staff: StaffMember[],
  profiles: StaffCaddieProfile[],
  snapshots: StaffAttendanceSnapshot[],
): StaffRow[] {
  const caddies = caddiesByStaffId(profiles)
  const attendance = attendanceByStaffId(snapshots)
  return staff
    .map(member => {
      const clock = attendance.get(member.id)
      return {
        staff: member,
        status: staffEmploymentStatus(member),
        caddie: caddies.get(member.id) ?? null,
        ...(clock ? { attendance: clock } : {}),
      }
    })
    // Whoever is at work today comes first, then the people on leave, then the
    // ones who have left — the roster is read from the top by the front desk.
    .sort((left, right) => STAFF_EMPLOYMENT_STATUSES.indexOf(left.status)
      - STAFF_EMPLOYMENT_STATUSES.indexOf(right.status)
      || left.staff.name.localeCompare(right.staff.name, 'ja'))
}

export function filterStaffRows(rows: StaffRow[], filter: StaffFilter) {
  const query = normalize(filter.query)
  return rows.filter(row => {
    if (filter.status !== 'all' && row.status !== filter.status) return false
    if (filter.role === 'caddie' && !row.caddie) return false
    if (filter.role === 'other' && row.caddie) return false
    if (!query) return true
    return normalize(row.staff.name).includes(query)
      || row.staff.id.toLocaleLowerCase('ja').includes(query)
      || (row.caddie ? normalize(row.caddie.displayName).includes(query) : false)
  })
}

/**
 * Body for `POST /v1/erp/staff`.
 *
 * The status is named rather than the `active` flag Field derives from it:
 * the two disagreeing is resolved upstream in the status's favour, so writing
 * the flag would only ever be a slower way of saying the same thing wrong.
 */
export function newStaffPayload(name: string, employmentType: EmploymentType) {
  return {
    name: name.trim(),
    employmentType,
    employmentStatus: 'active',
  }
}

/**
 * Body for linking an existing caddie profile to a staff member.
 *
 * Only the link is sent: the API merges a patch into the stored profile, so
 * naming nothing else leaves the rest of that caddie's settings alone.
 */
export function caddieLinkPayload(staffId: string) {
  return {
    staffId,
    staffReferenceType: 'staff_member',
    staffReferenceId: staffId,
  }
}
