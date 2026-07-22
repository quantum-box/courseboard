import { describe, expect, it } from 'vitest'
import { caddieLoadPlan } from './caddieLoadPlan'

describe('caddieLoadPlan', () => {
  it('waits for the aggregated roster before loading supporting data', () => {
    expect(caddieLoadPlan('roster', false)).toEqual({
      assignments: false,
      recommendations: false,
      courses: false,
      attendance: false,
    })
  })

  it('loads only resources used by the active view', () => {
    expect(caddieLoadPlan('roster', true)).toEqual({
      assignments: true,
      recommendations: false,
      courses: true,
      attendance: true,
    })
    expect(caddieLoadPlan('dispatch', true)).toEqual({
      assignments: true,
      recommendations: true,
      courses: false,
      attendance: true,
    })
    expect(caddieLoadPlan('attendance', true)).toEqual({
      assignments: false,
      recommendations: false,
      courses: false,
      attendance: true,
    })
    expect(caddieLoadPlan('payroll', true)).toEqual({
      assignments: false,
      recommendations: false,
      courses: false,
      attendance: false,
    })
  })
})
