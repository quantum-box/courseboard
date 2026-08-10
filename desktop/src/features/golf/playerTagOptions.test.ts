import { describe, expect, it } from 'vitest'

import {
  normalizedPlayerTagOptions,
  playerTagOptionDraftFromConfig,
  playerTagOptionsFromConfig,
  validatePlayerTagOptions,
} from './playerTagOptions'

describe('player tag options', () => {
  it('reads ordered tenant choices and ignores unsafe values in daily entry', () => {
    const config = { playerTagOptions: [' 共通 ', 42, '', '優待', '共通'] }
    expect(playerTagOptionsFromConfig(config)).toEqual(['共通', '優待'])
  })

  it('keeps invalid draft values visible so settings can correct them', () => {
    const config = { playerTagOptions: ['共通', '共通'] }
    expect(playerTagOptionDraftFromConfig(config)).toEqual(['共通', '共通'])
    expect(validatePlayerTagOptions(playerTagOptionDraftFromConfig(config))).toBe('duplicate')
  })

  it('trims saved choices and drops blank rows', () => {
    expect(normalizedPlayerTagOptions([' 共通 ', ' ', '優待'])).toEqual(['共通', '優待'])
  })
})
