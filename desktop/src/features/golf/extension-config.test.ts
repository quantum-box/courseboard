import { describe, expect, it } from 'vitest'
import { buildGolfExtensionConfig, golfExtensionConfigToDraft } from './extension-config'

describe('golf extension config form', () => {
  it('maps the API config into operator-friendly values', () => {
    expect(golfExtensionConfigToDraft({
      cartPolicy: 'required',
      defaultDurationMinutes: 90,
      defaultHoles: 9,
      maxPlayersPerTeeTime: 3,
      memberGuestPricing: { memberDepositRatio: 0.2, guestDepositRatio: 0.35 },
      publicProductName: '休日プラン',
    })).toMatchObject({
      cartPolicy: 'required',
      defaultDurationMinutes: '90',
      defaultHoles: '9',
      maxPlayersPerTeeTime: '3',
      memberDepositPercent: '20',
      guestDepositPercent: '35',
      publicProductName: '休日プラン',
    })
  })

  it('preserves config fields that are not edited by the form', () => {
    const original = {
      reservationProducts: [{ id: 'legacy-product' }],
      memberGuestPricing: { pricingMode: 'member-first' },
    }
    const config = buildGolfExtensionConfig(golfExtensionConfigToDraft(original), original)

    expect(config).toMatchObject({
      reservationProducts: [{ id: 'legacy-product' }],
      memberGuestPricing: {
        pricingMode: 'member-first',
        memberDepositRatio: 0.3,
        guestDepositRatio: 0.3,
      },
    })
  })

  it('rejects values outside the supported operating range', () => {
    const draft = golfExtensionConfigToDraft({})
    expect(() => buildGolfExtensionConfig({ ...draft, maxPlayersPerTeeTime: '10' }, {}))
      .toThrow('1枠の人数は 1〜4 人')
  })
})
