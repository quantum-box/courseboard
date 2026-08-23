import { describe, expect, it } from 'vitest'
import { buildPricingSettings, pricingSettingsToDraft, type PricingSettings } from './pricing-settings'

const stored: PricingSettings = {
  prefecture: null,
  taxGrade: null,
  taxableRatio: 0.85,
  priceElasticity: -1.2,
  fixedCostPerDay: 300000,
  variableCostPerVisitor: 1500,
}

describe('the tax panel over the pricing settings', () => {
  const base = pricingSettingsToDraft(stored)

  it('starts blank so nothing is priced against a guessed prefecture', () => {
    expect(base.prefecture).toBe('')
    expect(base.taxGrade).toBe('')
  })

  it('keeps a prefecture we hold a schedule for', () => {
    const next = buildPricingSettings({ ...base, prefecture: 'hokkaido' }, stored)
    expect(next.prefecture).toBe('hokkaido')
  })

  it('refuses a prefecture we have no schedule for, rather than failing at lookup', () => {
    expect(() => buildPricingSettings({ ...base, prefecture: 'atlantis' }, stored)).toThrow()
  })

  it('refuses a grade without the prefecture that assigned it', () => {
    expect(() => buildPricingSettings({ ...base, taxGrade: '7' }, stored)).toThrow()
  })

  it('keeps a grade to characters a schedule uses', () => {
    const ok = buildPricingSettings({ ...base, prefecture: 'hokkaido', taxGrade: '11' }, stored)
    expect(ok.taxGrade).toBe('11')
    expect(() => buildPricingSettings({ ...base, prefecture: 'hokkaido', taxGrade: '1 級' }, stored))
      .toThrow()
  })

  it('sends back the cost assumptions it does not edit', () => {
    // The panel shows two fields, but the API replaces the whole row. A cost
    // somebody set by hand has to ride through the save untouched.
    const custom = { ...stored, taxableRatio: 0.6, fixedCostPerDay: 450000 }
    const next = buildPricingSettings(
      { ...pricingSettingsToDraft(custom), prefecture: 'hokkaido' },
      custom,
    )
    expect(next.taxableRatio).toBe(0.6)
    expect(next.fixedCostPerDay).toBe(450000)
  })

  it('clearing the prefecture is a deliberate null, not an empty string', () => {
    const next = buildPricingSettings({ prefecture: '', taxGrade: '' }, {
      ...stored,
      prefecture: 'hokkaido',
      taxGrade: '7',
    })
    expect(next.prefecture).toBeNull()
    expect(next.taxGrade).toBeNull()
  })
})
