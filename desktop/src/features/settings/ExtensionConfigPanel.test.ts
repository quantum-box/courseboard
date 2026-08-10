import { describe, expect, it } from 'vitest'

import {
  buildConfigJson,
  configDraftFromJson,
  validateExtensionConfig,
} from './ExtensionConfigPanel'

describe('golf extension player categories', () => {
  it('writes normalized choices without replacing config owned by another feature', () => {
    const original = {
      defaultCurrency: 'JPY',
      timezone: 'Asia/Tokyo',
      reservationProducts: [{ id: 'plan-1' }],
      playerTagOptions: ['旧区分'],
    }
    const draft = {
      ...configDraftFromJson(original),
      playerTagOptions: [' 共通 ', '', '優待'],
    }

    expect(buildConfigJson(draft, original)).toEqual({
      defaultCurrency: 'JPY',
      timezone: 'Asia/Tokyo',
      reservationProducts: [{ id: 'plan-1' }],
      playerTagOptions: ['共通', '優待'],
    })
  })

  it('rejects duplicate choices before replacing the shared config', () => {
    const draft = {
      ...configDraftFromJson(null),
      playerTagOptions: ['共通', ' 共通 '],
    }
    expect(validateExtensionConfig(draft)).toContain('重複')
  })
})
