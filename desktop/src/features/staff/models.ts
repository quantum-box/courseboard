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
  active: boolean
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
  status: 'all' | 'active' | 'retired'
  role: 'all' | 'caddie' | 'other'
}

/** Employment types offered when registering someone. */
export const EMPLOYMENT_TYPES = ['full_time', 'part_time'] as const
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
  return [...staff]
    // Retired staff sink below the people the roster is actually about.
    .sort((left, right) => Number(right.active) - Number(left.active)
      || left.name.localeCompare(right.name, 'ja'))
    .map(member => {
      const status = attendance.get(member.id)
      return {
        staff: member,
        caddie: caddies.get(member.id) ?? null,
        ...(status ? { attendance: status } : {}),
      }
    })
}

export function filterStaffRows(rows: StaffRow[], filter: StaffFilter) {
  const query = normalize(filter.query)
  return rows.filter(row => {
    if (filter.status === 'active' && !row.staff.active) return false
    if (filter.status === 'retired' && row.staff.active) return false
    if (filter.role === 'caddie' && !row.caddie) return false
    if (filter.role === 'other' && row.caddie) return false
    if (!query) return true
    return normalize(row.staff.name).includes(query)
      || row.staff.id.toLocaleLowerCase('ja').includes(query)
      || (row.caddie ? normalize(row.caddie.displayName).includes(query) : false)
  })
}

/** Body for `POST /v1/erp/staff`. */
export function newStaffPayload(name: string, employmentType: EmploymentType) {
  return {
    name: name.trim(),
    employmentType,
    active: true,
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
