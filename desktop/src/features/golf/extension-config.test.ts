import { describe, expect, it } from 'vitest'
import { buildGolfExtensionConfig, golfExtensionConfigToDraft } from './extension-config'

describe('tax settings in the golf extension config', () => {
  const base = golfExtensionConfigToDraft({})

  it('starts blank so nothing is priced against a guessed prefecture', () => {
    expect(base.prefecture).toBe('')
    expect(base.taxGrade).toBe('')
  })

  it('keeps a prefecture we hold a schedule for', () => {
    const config = buildGolfExtensionConfig({ ...base, prefecture: 'hokkaido' }, {})
    expect(config.prefecture).toBe('hokkaido')
  })

  it('refuses a prefecture we have no schedule for, rather than failing at lookup', () => {
    expect(() => buildGolfExtensionConfig({ ...base, prefecture: 'atlantis' }, {}))
      .toThrow()
  })

  it('refuses a grade without the prefecture that assigned it', () => {
    expect(() => buildGolfExtensionConfig({ ...base, taxGrade: '7' }, {})).toThrow()
  })

  it('keeps a grade to characters a schedule uses', () => {
    const ok = buildGolfExtensionConfig({ ...base, prefecture: 'hokkaido', taxGrade: '11' }, {})
    expect(ok.taxGrade).toBe('11')
    expect(() => buildGolfExtensionConfig(
      { ...base, prefecture: 'hokkaido', taxGrade: '1 級' },
      {},
    )).toThrow()
  })

  it('leaves the keys another surface wrote alone', () => {
    const config = buildGolfExtensionConfig(
      { ...base, prefecture: 'hokkaido' },
      { reservationProducts: [{ id: 'svc:a' }] },
    )
    expect(config.reservationProducts).toEqual([{ id: 'svc:a' }])
  })

  it('no longer plants booking-rule defaults it was never asked for', () => {
    // Saving the tax panel used to write holes, party size, cart policy and
    // deposit ratios into the config — normalized defaults for a club that had
    // never set any, shadowing values whose real home is Field's reservation
    // policy. A save must write exactly what the form shows.
    const untouched = {
      memberGuestPricing: { pricingMode: 'member-first' },
      defaultHoles: 9,
    }
    const config = buildGolfExtensionConfig(
      { ...golfExtensionConfigToDraft(untouched), prefecture: 'hokkaido' },
      untouched,
    )

    expect(config.memberGuestPricing).toEqual({ pricingMode: 'member-first' })
    expect(config.defaultHoles).toBe(9)
    expect(config).not.toHaveProperty('maxPlayersPerTeeTime')
    expect(config).not.toHaveProperty('cartPolicy')
    expect(config).not.toHaveProperty('publicProductName')
  })
})
