import { describe, expect, it } from 'vitest'
import {
  attendanceByStaffId,
  caddieLinkPayload,
  caddiesByStaffId,
  employmentTypeKey,
  filterStaffRows,
  newStaffPayload,
  staffRows,
  unlinkedCaddies,
  type StaffAttendanceSnapshot,
  type StaffCaddieProfile,
  type StaffMember,
} from './models'

const STAFF: StaffMember[] = [
  { id: 'staff_aya', name: '佐藤 彩', active: true },
  { id: 'staff_kitchen', name: '厨房 太郎', active: true },
  { id: 'staff_old', name: '退職 花子', active: false },
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

  it('sinks retired staff below the people still employed', () => {
    expect(rows.at(-1)?.staff.id).toBe('staff_old')
    expect(rows.slice(0, 2).map(row => row.staff.id).sort())
      .toEqual(['staff_aya', 'staff_kitchen'])
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
    expect(filterStaffRows(rows, { ...base, role: 'caddie' }).map(row => row.staff.id))
      .toEqual(['staff_aya', 'staff_old'])
    expect(filterStaffRows(rows, { ...base, role: 'other' }).map(row => row.staff.id))
      .toEqual(['staff_kitchen'])
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
      .toEqual({ name: '山田 花子', employmentType: 'full_time', active: true })
  })

  it('sends only the link when attaching an existing caddie profile', () => {
    expect(caddieLinkPayload('staff_aya')).toEqual({
      staffId: 'staff_aya',
      staffReferenceType: 'staff_member',
      staffReferenceId: 'staff_aya',
    })
  })
})
