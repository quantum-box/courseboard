import { describe, expect, it } from 'vitest'
import { helpEn } from './help.en'
import { helpJa } from './help.ja'
import { helpJaPlain } from './help.ja-plain'
import { getPageHelp } from './pageHelp'

const ROUTES = Object.keys(helpJa.routes)

describe('getPageHelp', () => {
  it('returns the guide for a known route', () => {
    const help = getPageHelp('golf/products')
    expect(help.title).toBe('プレー商品')
    expect(help.usage.length).toBeGreaterThanOrEqual(2)
  })

  it('maps nested cancellation fee routes to the list guide', () => {
    expect(getPageHelp('cancellation-fees/new').title).toBe('キャンセル料')
    expect(getPageHelp('cancellation-fees/abc').title).toBe('キャンセル料')
  })

  it('maps caddie detail routes to the roster guide, and subviews to their own', () => {
    expect(getPageHelp('golf/caddies/profile-1').title).toBe('キャディ名簿')
    expect(getPageHelp('golf/caddies/dispatch').title).toBe('キャディの配置')
    expect(getPageHelp('golf/caddies/attendance').title).toBe('出勤')
    expect(getPageHelp('golf/caddies/payroll').title).toBe('給与')
  })

  it('falls back for unknown routes', () => {
    expect(getPageHelp('unknown').title).toBe('Course Board')
  })

  it('keeps every route short and readable', () => {
    for (const route of ROUTES) {
      const help = getPageHelp(route)
      expect(help.summary.length).toBeGreaterThan(15)
      // The guide is a sidebar: walls of text defeat its purpose.
      expect(help.usage.length).toBeLessThanOrEqual(3)
      expect(help.data.length).toBeLessThanOrEqual(2)
    }
  })

  it('serves each locale and falls back to Japanese for gaps', () => {
    expect(getPageHelp('golf/timeline', 'en').title).toBe('Timeline')
    expect(getPageHelp('golf/timeline', 'ja-plain').title).toBe('今日の予定表')
    // An unknown locale still returns readable copy.
    expect(getPageHelp('golf/timeline', 'de').title).toBe('タイムライン')
  })

  it('covers the same routes in every locale', () => {
    expect(Object.keys(helpEn.routes).sort()).toEqual([...ROUTES].sort())
    expect(Object.keys(helpJaPlain.routes).sort()).toEqual([...ROUTES].sort())
  })
})
