import { describe, expect, it } from 'vitest'

import {
  buildConfigJson,
  configDraftFromJson,
  validateExtensionConfig,
} from './ExtensionConfigPanel'

describe('the settings panel over its two stores', () => {
  it('writes only the timezone into the config, leaving every other key alone', () => {
    // The visitor categories moved to CourseBoard's own table and the currency
    // was retired, but their stale copies must survive a timezone save: the
    // categories' migration fallback still reads the config on tenants that
    // have not saved locally yet.
    const original = {
      defaultCurrency: 'JPY',
      timezone: 'Asia/Tokyo',
      reservationProducts: [{ id: 'plan-1' }],
      playerTagOptions: ['旧区分'],
    }
    const draft = { ...configDraftFromJson(original), timezone: 'Asia/Taipei' }

    expect(buildConfigJson(draft, original)).toEqual({
      defaultCurrency: 'JPY',
      timezone: 'Asia/Taipei',
      reservationProducts: [{ id: 'plan-1' }],
      playerTagOptions: ['旧区分'],
    })
  })

  it('shows the categories from their own store, not from the config copy', () => {
    const draft = configDraftFromJson({ playerTagOptions: ['旧区分'] }, ['共通', '優待'])
    expect(draft.playerTagOptions).toEqual(['共通', '優待'])
  })

  it('rejects duplicate categories before anything is written', () => {
    const draft = {
      ...configDraftFromJson(null),
      playerTagOptions: ['共通', ' 共通 '],
    }
    expect(validateExtensionConfig(draft)).toContain('重複')
  })

  it('rejects a non-IANA tenant timezone before saving the source of truth', () => {
    const draft = {
      ...configDraftFromJson(null),
      timezone: 'JST',
    }
    expect(validateExtensionConfig(draft)).toContain('地域名')
  })
})
