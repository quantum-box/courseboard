import {
  staffEmploymentStatus,
  type StaffEmploymentStatus,
  type StaffMember,
} from './models'

export type StaffListResponse = { items: StaffMember[] }

/** Everything the roster lets an operator change about a staff member. */
export type StaffBasics = {
  name: string
  employmentType: string
  status: StaffEmploymentStatus
}

type FieldJson = <T>(path: string, init?: RequestInit) => Promise<T>

function memberPath(staffId: string) {
  return `/v1/erp/staff/${encodeURIComponent(staffId)}`
}

/**
 * The changed fields, and only those.
 *
 * Field merges a patch now, so an untouched field left out keeps its stored
 * value. Naming it anyway would overwrite whatever somebody else saved in the
 * meantime with the value this screen happened to load.
 *
 * `active` is never sent. Field derives it from the status, and when the two
 * disagree the status wins — so sending `active: false` alongside a leave
 * would quietly retire the person instead.
 */
export function staffBasicsPatch(member: StaffMember, basics: StaffBasics) {
  const patch: {
    name?: string
    employmentType?: string
    employmentStatus?: StaffEmploymentStatus
  } = {}
  const name = basics.name.trim()
  if (name !== member.name) patch.name = name
  if (basics.employmentType !== member.employmentType) {
    patch.employmentType = basics.employmentType
  }
  if (basics.status !== staffEmploymentStatus(member)) {
    patch.employmentStatus = basics.status
  }
  return patch
}

/**
 * Save the roster edits and return the stored record.
 *
 * A single PATCH: Field's response is the row after the update, so the reads
 * that used to bracket this call — the compatibility RMW around the old
 * full-row UPSERT, tracked by PLT-3352 — are gone.
 */
export async function updateStaffBasics(
  fieldJson: FieldJson,
  member: StaffMember,
  basics: StaffBasics,
): Promise<StaffMember> {
  const patch = staffBasicsPatch(member, basics)
  // Nothing to say: an empty body would be accepted and change nothing, but a
  // round trip the operator cannot observe is not worth making.
  if (Object.keys(patch).length === 0) return member
  return fieldJson<StaffMember>(memberPath(member.id), {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

/**
 * Remove a staff member from the roster.
 *
 * Field hides the record rather than dropping it, so attendance and payroll
 * survive — but nothing in the API brings the person back, which is why the
 * screen asks before calling this.
 */
export async function deleteStaffMember(fieldJson: FieldJson, staffId: string) {
  await fieldJson<void>(memberPath(staffId), { method: 'DELETE' })
}

/** The roster with one member replaced, leaving the order alone. */
export function rosterWith(roster: StaffListResponse, member: StaffMember): StaffListResponse {
  return { ...roster, items: roster.items.map(item => (item.id === member.id ? member : item)) }
}

/** The roster without a member, for the screen that just deleted them. */
export function rosterWithout(roster: StaffListResponse, staffId: string): StaffListResponse {
  return { ...roster, items: roster.items.filter(item => item.id !== staffId) }
}
