import type { StaffMember } from './models'

export type StaffListResponse = { items: StaffMember[] }

export type StaffNameUpdateResult = {
  member: StaffMember
  roster: StaffListResponse
}

type FieldJson = <T>(path: string, init?: RequestInit) => Promise<T>

export class StaffMemberNotFoundError extends Error {
  constructor() {
    super('staff member was not found')
    this.name = 'StaffMemberNotFoundError'
  }
}

/**
 * Change only the HRM-owned name while preserving every other mutable field.
 *
 * Field currently implements PATCH /v1/erp/staff/{id} as a full-row UPSERT:
 * omitted values are replaced by defaults or null instead of being merged.
 * Fetching and echoing the complete mutable record is therefore intentional,
 * temporary compatibility work tracked by PLT-3352:
 * https://linear.app/quantum-box/issue/PLT-3352
 */
export function staffNameUpdatePayload(member: StaffMember, name: string) {
  return {
    name: name.trim(),
    employmentType: member.employmentType,
    active: member.active,
    hiredAt: member.hiredAt,
    contractEndDate: member.contractEndDate,
    phone: member.phone,
    email: member.email,
    attributesJson: member.attributesJson,
  }
}

function findStaff(response: StaffListResponse, staffId: string) {
  const member = response.items.find(item => item.id === staffId)
  if (!member) throw new StaffMemberNotFoundError()
  return member
}

/**
 * Read immediately before the full-row PATCH, then read HRM again to confirm.
 * PLT-3352 tracks replacing this compatibility RMW with a safe Field contract.
 */
export async function updateStaffName(
  fieldJson: FieldJson,
  staffId: string,
  name: string,
): Promise<StaffNameUpdateResult> {
  const before = await fieldJson<StaffListResponse>('/v1/erp/staff')
  const current = findStaff(before, staffId)

  await fieldJson<StaffMember>(
    `/v1/erp/staff/${encodeURIComponent(staffId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(staffNameUpdatePayload(current, name)),
    },
  )

  // Do not report the submitted string as success. The HRM read-back is the
  // authoritative value the roster and every linked caddie screen will show.
  const roster = await fieldJson<StaffListResponse>('/v1/erp/staff')
  return { member: findStaff(roster, staffId), roster }
}
