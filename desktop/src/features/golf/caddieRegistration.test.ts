import { describe, expect, it } from 'vitest'
import {
  caddieCreatePayload,
  exactStaffMatch,
  staffLinkBroken,
  staffSuggestions,
  type StaffCandidate,
} from './caddieRegistration'

const STAFF: StaffCandidate[] = [
  { id: 'staff_aya', name: '佐藤 彩', active: true },
  { id: 'staff_ken', name: '佐藤 健', active: true },
  { id: 'staff_old', name: '退職 太郎', active: false },
]

describe('staffSuggestions', () => {
  it('offers the already-registered people a typed name could mean', () => {
    expect(staffSuggestions(STAFF, '佐藤').map(item => item.id).sort())
      .toEqual(['staff_aya', 'staff_ken'])
  })

  it('ignores the space the operator happens to type', () => {
    expect(staffSuggestions(STAFF, 'さとう').map(item => item.id)).toEqual([])
    expect(staffSuggestions(STAFF, '佐藤彩').map(item => item.id)).toEqual(['staff_aya'])
  })

  it('matches on the staff id so a code pasted from HRM still finds the person', () => {
    expect(staffSuggestions(STAFF, 'staff_ken').map(item => item.id)).toEqual(['staff_ken'])
  })

  it('leaves out retired staff and an empty query', () => {
    expect(staffSuggestions(STAFF, '退職')).toEqual([])
    expect(staffSuggestions(STAFF, '   ')).toEqual([])
  })

  it('caps the list so the form stays readable', () => {
    const many = Array.from({ length: 9 }, (_, index) => ({
      id: `staff_${index}`,
      name: `山田 ${index}`,
      active: true,
    }))
    expect(staffSuggestions(many, '山田')).toHaveLength(5)
  })
})

describe('exactStaffMatch', () => {
  it('resolves a name that stands for exactly one staff member', () => {
    expect(exactStaffMatch(STAFF, ' 佐藤彩 ')?.id).toBe('staff_aya')
  })

  it('leaves namesakes unresolved rather than guessing whose pay it is', () => {
    const namesakes: StaffCandidate[] = [
      { id: 'staff_1', name: '田中 一郎', active: true },
      { id: 'staff_2', name: '田中 一郎', active: true },
    ]
    expect(exactStaffMatch(namesakes, '田中 一郎')).toBeNull()
  })

  it('does not resolve a partial name or a retired staff member', () => {
    expect(exactStaffMatch(STAFF, '佐藤')).toBeNull()
    expect(exactStaffMatch(STAFF, '退職 太郎')).toBeNull()
  })
})

describe('caddieCreatePayload', () => {
  const draft = { name: ' 山田 花子 ', skillLevel: 'regular', rank: 'C', baseFeeAmount: 12_000 }

  it('omits the staff fields so the API registers and links the staff member', () => {
    const payload = caddieCreatePayload(draft)

    expect(payload.displayName).toBe('山田 花子')
    expect(payload).not.toHaveProperty('staffId')
    expect(payload).not.toHaveProperty('staffReferenceId')
  })

  it('sends both link fields when the operator picked an existing staff member', () => {
    // Field reads `staffId` on some surfaces and the reference pair on others.
    const payload = caddieCreatePayload({ ...draft, staffId: 'staff_aya' })

    expect(payload).toMatchObject({
      staffId: 'staff_aya',
      staffReferenceType: 'staff_member',
      staffReferenceId: 'staff_aya',
    })
  })

  it('treats a blank staff id as no link at all', () => {
    expect(caddieCreatePayload({ ...draft, staffId: '  ' })).not.toHaveProperty('staffId')
  })
})

describe('staffLinkBroken', () => {
  const staffIds = new Set(['stf-1', 'stf-2'])

  it('spots a caddie pointing at staff Field no longer has', () => {
    // The case the roster could not see: the id is there, so `resolveStaffId`
    // reports a link and the unlinked warning counts the caddie as healthy.
    expect(staffLinkBroken({ staffId: 'stf-gone' }, staffIds)).toBe(true)
  })

  it('leaves a live link alone', () => {
    expect(staffLinkBroken({ staffId: 'stf-1' }, staffIds)).toBe(false)
  })

  it('follows the staff_member reference the same way', () => {
    // Field fills one of two fields, and a link through the reference pair can
    // go stale exactly like the scalar one.
    expect(staffLinkBroken(
      { staffReferenceType: 'staff_member', staffReferenceId: 'stf-gone' },
      staffIds,
    )).toBe(true)
    expect(staffLinkBroken(
      { staffReferenceType: 'staff_member', staffReferenceId: 'stf-2' },
      staffIds,
    )).toBe(false)
  })

  it('is not broken when there was never a link', () => {
    // A caddie nobody was ever behind is the unlinked warning's business.
    // Counting it here too would report the same person twice.
    expect(staffLinkBroken({}, staffIds)).toBe(false)
    expect(staffLinkBroken({ staffId: null }, staffIds)).toBe(false)
  })

  it('accuses nobody while the staff list is unavailable', () => {
    // A failed or still-flying lookup has no list to check against. Reading
    // that as "Field has no staff" would mark every caddie on the roster
    // broken at once, which is worse than saying nothing.
    expect(staffLinkBroken({ staffId: 'stf-gone' }, null)).toBe(false)
  })

  it('trusts an empty list that actually arrived', () => {
    // Distinct from the case above: Field answered, and it has no staff.
    expect(staffLinkBroken({ staffId: 'stf-1' }, new Set())).toBe(true)
  })
})
