import { describe, expect, it } from 'vitest'
import {
  caddieCreatePayload,
  exactStaffMatch,
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
