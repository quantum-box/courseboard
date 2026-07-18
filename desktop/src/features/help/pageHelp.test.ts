import { describe, expect, it } from 'vitest'
import { getPageHelp } from './pageHelp'

describe('getPageHelp', () => {
  it('returns product help for reservation products route', () => {
    const help = getPageHelp('golf/products')
    expect(help.title).toBe('ゴルフ予約商品')
    expect(help.usage.length).toBeGreaterThanOrEqual(4)
    expect(help.data.some(section => section.heading.includes('Reservation product'))).toBe(true)
    expect(help.usage.some(section => section.body.includes('受付枠を保存'))).toBe(true)
  })

  it('maps nested cancellation fee routes to the list help', () => {
    expect(getPageHelp('cancellation-fees/new').title).toBe('キャンセル料')
    expect(getPageHelp('cancellation-fees/abc').title).toBe('キャンセル料')
    expect(getPageHelp('cancellation-fees').usage.length).toBeGreaterThanOrEqual(4)
  })

  it('maps caddie profile detail routes to roster help', () => {
    expect(getPageHelp('golf/caddies/profile-1').title).toBe('名簿')
    expect(getPageHelp('golf/caddies/dispatch').title).toBe('配置')
    expect(getPageHelp('golf/caddies/attendance').title).toBe('勤怠')
    expect(getPageHelp('golf/caddies/payroll').title).toBe('給与')
  })

  it('covers major operational routes with usage and data sections', () => {
    const routes = [
      'golf',
      'golf/courses',
      'golf/policy',
      'course-map',
      'golf/budgets',
      'golf/settlement',
      'settings',
    ]
    for (const route of routes) {
      const help = getPageHelp(route)
      expect(help.summary.length).toBeGreaterThan(20)
      expect(help.usage.length).toBeGreaterThanOrEqual(4)
      expect(help.data.length).toBeGreaterThan(0)
    }
  })
})
