import { describe, expect, it } from 'vitest'
import {
  attendanceByStaffId,
  caddieLinkPayload,
  caddieStatusForStaff,
  caddiesByStaffId,
  employmentTypeKey,
  filterStaffRows,
  newStaffPayload,
  staffEmploymentStatus,
  staffRows,
  unlinkedCaddies,
  type StaffAttendanceSnapshot,
  type StaffCaddieProfile,
  type StaffEmploymentStatus,
  type StaffMember,
} from './models'

function staff(id: string, name: string, status: StaffEmploymentStatus): StaffMember {
  return {
    id,
    name,
    // Field derives the flag from the status; the two never disagree on read.
    active: status === 'active',
    employmentStatus: status,
    employmentType: 'part_time',
    hiredAt: null,
    contractEndDate: null,
    phone: null,
    email: null,
    attributesJson: null,
  }
}

const STAFF: StaffMember[] = [
  staff('staff_aya', '佐藤 彩', 'active'),
  staff('staff_kitchen', '厨房 太郎', 'active'),
  staff('staff_old', '退職 花子', 'retired'),
  staff('staff_leave', '休職 次郎', 'on_leave'),
]

const PROFILES: StaffCaddieProfile[] = [
  {
    id: 'caddie_aya',
    displayName: '佐藤 彩',
    skillLevel: 'veteran',
    rank: 'A',
    staffId: 'staff_aya',
  },
  {
    id: 'caddie_ref_only',
    displayName: '参照だけ',
    skillLevel: 'regular',
    rank: 'C',
    staffReferenceType: 'staff_member',
    staffReferenceId: 'staff_old',
  },
  { id: 'caddie_legacy', displayName: '外部キャディ', skillLevel: 'regular', rank: 'D' },
]

const SNAPSHOTS: StaffAttendanceSnapshot[] = [
  { caddieProfileId: 'caddie_aya', staffId: 'staff_aya', attendanceStatus: 'working' },
  { caddieProfileId: 'caddie_legacy', staffId: null, attendanceStatus: 'not_linked' },
]

describe('caddiesByStaffId', () => {
  it('indexes by either link field Field filled in', () => {
    const index = caddiesByStaffId(PROFILES)
    expect(index.get('staff_aya')?.id).toBe('caddie_aya')
    expect(index.get('staff_old')?.id).toBe('caddie_ref_only')
  })

  it('keeps the first profile when two claim the same staff member', () => {
    const duplicate: StaffCaddieProfile = {
      id: 'caddie_dupe',
      displayName: '重複',
      skillLevel: 'regular',
      rank: 'D',
      staffId: 'staff_aya',
    }
    expect(caddiesByStaffId([...PROFILES, duplicate]).get('staff_aya')?.id).toBe('caddie_aya')
  })
})

describe('unlinkedCaddies', () => {
  it('lists only the profiles nobody is behind', () => {
    expect(unlinkedCaddies(PROFILES).map(profile => profile.id)).toEqual(['caddie_legacy'])
  })
})

describe('attendanceByStaffId', () => {
  it('skips snapshots that name no staff member', () => {
    const index = attendanceByStaffId(SNAPSHOTS)
    expect(index.get('staff_aya')).toBe('working')
    expect(index.size).toBe(1)
  })
})

describe('staffRows', () => {
  const rows = staffRows(STAFF, PROFILES, SNAPSHOTS)

  it('orders the roster by how present somebody is', () => {
    expect(rows.map(row => row.staff.id))
      .toEqual(['staff_aya', 'staff_kitchen', 'staff_leave', 'staff_old'])
  })

  it('folds the caddie role and today clock state into the row', () => {
    const aya = rows.find(row => row.staff.id === 'staff_aya')
    expect(aya?.caddie?.id).toBe('caddie_aya')
    expect(aya?.attendance).toBe('working')
  })

  it('leaves attendance unset for staff the caddie board says nothing about', () => {
    const kitchen = rows.find(row => row.staff.id === 'staff_kitchen')
    expect(kitchen?.caddie).toBeNull()
    expect(kitchen?.attendance).toBeUndefined()
  })
})

describe('filterStaffRows', () => {
  const rows = staffRows(STAFF, PROFILES, SNAPSHOTS)
  const base = { query: '', status: 'all', role: 'all' } as const

  it('finds a person by name, staff id, or their caddie name', () => {
    expect(filterStaffRows(rows, { ...base, query: '厨房' })).toHaveLength(1)
    expect(filterStaffRows(rows, { ...base, query: 'staff_aya' })).toHaveLength(1)
    expect(filterStaffRows(rows, { ...base, query: '参照だけ' })[0]?.staff.id).toBe('staff_old')
  })

  it('ignores the space between a family and given name', () => {
    expect(filterStaffRows(rows, { ...base, query: '佐藤彩' })).toHaveLength(1)
  })

  it('splits the roster by employment and by the caddie role', () => {
    expect(filterStaffRows(rows, { ...base, status: 'retired' }).map(row => row.staff.id))
      .toEqual(['staff_old'])
    expect(filterStaffRows(rows, { ...base, status: 'on_leave' }).map(row => row.staff.id))
      .toEqual(['staff_leave'])
    expect(filterStaffRows(rows, { ...base, status: 'active' }).map(row => row.staff.id))
      .toEqual(['staff_aya', 'staff_kitchen'])
    expect(filterStaffRows(rows, { ...base, role: 'caddie' }).map(row => row.staff.id))
      .toEqual(['staff_aya', 'staff_old'])
    expect(filterStaffRows(rows, { ...base, role: 'other' }).map(row => row.staff.id))
      .toEqual(['staff_kitchen', 'staff_leave'])
  })
})

describe('staffEmploymentStatus', () => {
  it('takes the status Field stores', () => {
    expect(staffEmploymentStatus(staff('s', 'x', 'on_leave'))).toBe('on_leave')
    expect(staffEmploymentStatus(staff('s', 'x', 'retired'))).toBe('retired')
    expect(staffEmploymentStatus(staff('s', 'x', 'active'))).toBe('active')
  })

  it('falls back to the flag for a record stored before Field had the column', () => {
    const legacy = { ...staff('s', 'x', 'active'), employmentStatus: '' }
    expect(staffEmploymentStatus(legacy)).toBe('active')
    expect(staffEmploymentStatus({ ...legacy, active: false })).toBe('retired')
  })

  it('does not read a status it cannot show', () => {
    const unknown = { ...staff('s', 'x', 'on_leave'), employmentStatus: 'seconded' }
    // `active` is false alongside a non-active status upstream, so an unknown
    // code reads as away rather than at work.
    expect(staffEmploymentStatus(unknown)).toBe('retired')
  })
})

describe('caddieStatusForStaff', () => {
  it('keeps a caddie off the board once their staff record says they are away', () => {
    expect(caddieStatusForStaff('active')).toBe('active')
    expect(caddieStatusForStaff('on_leave')).toBe('inactive')
    expect(caddieStatusForStaff('retired')).toBe('suspended')
  })
})

describe('employmentTypeKey', () => {
  it('names the two types the roster knows', () => {
    expect(employmentTypeKey('full_time')).toBe('full_time')
    expect(employmentTypeKey(' Part_Time ')).toBe('part_time')
  })

  it('stays null for a missing or unknown type rather than guessing one', () => {
    // The roster is read as fact for payroll; an invented default would lie.
    expect(employmentTypeKey(undefined)).toBeNull()
    expect(employmentTypeKey('  ')).toBeNull()
    expect(employmentTypeKey('seasonal')).toBeNull()
  })
})

describe('payloads', () => {
  it('registers a staff member as active under a trimmed name', () => {
    expect(newStaffPayload('  山田 花子 ', 'full_time'))
      .toEqual({ name: '山田 花子', employmentType: 'full_time', employmentStatus: 'active' })
  })

  it('sends only the link when attaching an existing caddie profile', () => {
    expect(caddieLinkPayload('staff_aya')).toEqual({
      staffId: 'staff_aya',
      staffReferenceType: 'staff_member',
      staffReferenceId: 'staff_aya',
    })
  })
})
