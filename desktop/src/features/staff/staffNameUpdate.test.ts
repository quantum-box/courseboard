import { describe, expect, it } from 'vitest'
import type { StaffMember } from './models'
import { updateStaffName } from './staffNameUpdate'

describe('updateStaffName', () => {
  it('preserves every mutable HRM field and returns the post-update read-back', async () => {
    let stored: StaffMember = {
      id: 'staff_aya',
      name: '佐藤 彩',
      employmentType: 'contract',
      active: false,
      hiredAt: '2024-04-01',
      contractEndDate: '2027-03-31',
      phone: '011-000-0000',
      email: 'aya@example.test',
      attributesJson: { payrollCode: 'A-17', uniform: { size: 'M' } },
    }
    const calls: Array<{ path: string; init?: RequestInit }> = []

    const fieldJson = async <T>(path: string, init?: RequestInit): Promise<T> => {
      calls.push({ path, init })
      if (init?.method === 'PATCH') {
        const payload = JSON.parse(String(init.body)) as Omit<StaffMember, 'id'>
        expect(payload).toEqual({
          name: '佐藤 花子',
          employmentType: 'contract',
          active: false,
          hiredAt: '2024-04-01',
          contractEndDate: '2027-03-31',
          phone: '011-000-0000',
          email: 'aya@example.test',
          attributesJson: { payrollCode: 'A-17', uniform: { size: 'M' } },
        })
        stored = { ...stored, ...payload, name: '佐藤　花子' }
        // Only the subsequent GET is authoritative; the PATCH response must
        // not be used to build the visible success state.
        return { ...stored, name: 'PATCH応答の名前' } as T
      }
      return { items: [{ ...stored }] } as T
    }

    const result = await updateStaffName(fieldJson, stored.id, ' 佐藤 花子 ')

    expect(calls.map(call => [call.path, call.init?.method ?? 'GET'])).toEqual([
      ['/v1/erp/staff', 'GET'],
      ['/v1/erp/staff/staff_aya', 'PATCH'],
      ['/v1/erp/staff', 'GET'],
    ])
    expect(result.member.name).toBe('佐藤　花子')
    expect(result.roster.items[0]).toEqual(stored)
  })
})
