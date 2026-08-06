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
})
