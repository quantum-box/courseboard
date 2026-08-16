import { describe, expect, it } from 'vitest'
import type { StaffMember } from './models'
import {
  deleteStaffMember,
  rosterWith,
  rosterWithout,
  staffBasicsPatch,
  updateStaffBasics,
} from './staffUpdate'

function member(overrides: Partial<StaffMember> = {}): StaffMember {
  return {
    id: 'staff_aya',
    name: '佐藤 彩',
    employmentType: 'contract',
    employmentStatus: 'active',
    active: true,
    hiredAt: '2024-04-01',
    contractEndDate: '2027-03-31',
    phone: '011-000-0000',
    email: 'aya@example.test',
    attributesJson: { payrollCode: 'A-17' },
    ...overrides,
  }
}

describe('staffBasicsPatch', () => {
  it('names only what changed, so Field keeps the rest', () => {
    expect(staffBasicsPatch(member(), {
      name: '佐藤 彩',
      employmentType: 'contract',
      status: 'on_leave',
    })).toEqual({ employmentStatus: 'on_leave' })
  })

  it('never sends active, which would outrank the status and retire them', () => {
    const patch = staffBasicsPatch(member(), {
      name: ' 佐藤 花子 ',
      employmentType: 'full_time',
      status: 'on_leave',
    })

    expect(patch).toEqual({
      name: '佐藤 花子',
      employmentType: 'full_time',
      employmentStatus: 'on_leave',
    })
    expect(patch).not.toHaveProperty('active')
    expect(patch).not.toHaveProperty('attributesJson')
  })

  it('is empty when the dialog is submitted untouched', () => {
    expect(staffBasicsPatch(member(), {
      name: '佐藤 彩',
      employmentType: 'contract',
      status: 'active',
    })).toEqual({})
  })

  it('compares against the status Field derived, not the raw flag', () => {
    // A record from before Field grew the column carries no status at all.
    const legacy = member({ employmentStatus: '', active: false })
    expect(staffBasicsPatch(legacy, {
      name: legacy.name,
      employmentType: legacy.employmentType,
      status: 'retired',
    })).toEqual({})
  })
})

describe('updateStaffBasics', () => {
  it('sends one PATCH and reports the record Field stored', async () => {
    const calls: Array<{ path: string; method: string; body: unknown }> = []
    const fieldJson = async <T>(path: string, init?: RequestInit): Promise<T> => {
      calls.push({
        path,
        method: init?.method ?? 'GET',
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      })
      return { ...member(), name: '佐藤　花子', active: false, employmentStatus: 'on_leave' } as T
    }

    const saved = await updateStaffBasics(fieldJson, member(), {
      name: '佐藤 花子',
      employmentType: 'contract',
      status: 'on_leave',
    })

    expect(calls).toEqual([{
      path: '/v1/erp/staff/staff_aya',
      method: 'PATCH',
      body: { name: '佐藤 花子', employmentStatus: 'on_leave' },
    }])
    expect(saved.name).toBe('佐藤　花子')
    expect(saved.employmentStatus).toBe('on_leave')
  })

  it('does not call Field at all when nothing changed', async () => {
    let called = false
    const fieldJson = async <T>(): Promise<T> => {
      called = true
      return {} as T
    }

    const unchanged = await updateStaffBasics(fieldJson, member(), {
      name: '佐藤 彩',
      employmentType: 'contract',
      status: 'active',
    })

    expect(called).toBe(false)
    expect(unchanged).toEqual(member())
  })
})

describe('deleteStaffMember', () => {
  it('deletes the one member, with the id escaped', async () => {
    const calls: Array<[string, string]> = []
    const fieldJson = async <T>(path: string, init?: RequestInit): Promise<T> => {
      calls.push([path, init?.method ?? 'GET'])
      return undefined as T
    }

    await deleteStaffMember(fieldJson, 'staff/one')

    expect(calls).toEqual([['/v1/erp/staff/staff%2Fone', 'DELETE']])
  })
})

describe('roster edits', () => {
  const roster = { items: [member(), member({ id: 'staff_kitchen', name: '厨房 太郎' })] }

  it('swaps one member in without disturbing the order', () => {
    const updated = rosterWith(roster, member({ name: '佐藤 花子' }))
    expect(updated.items.map(item => item.name)).toEqual(['佐藤 花子', '厨房 太郎'])
  })

  it('drops the member the screen just deleted', () => {
    expect(rosterWithout(roster, 'staff_aya').items.map(item => item.id))
      .toEqual(['staff_kitchen'])
  })
})
