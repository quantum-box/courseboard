import { describe, expect, it } from 'vitest'

import { isSupportedTimezone } from './timezone'

describe('tenant timezone validation', () => {
  it('accepts canonical IANA names', () => {
    expect(isSupportedTimezone('Asia/Tokyo')).toBe(true)
    expect(isSupportedTimezone('Europe/Berlin')).toBe(true)
  })

  it('rejects abbreviations and misspellings', () => {
    expect(isSupportedTimezone('JST')).toBe(false)
    expect(isSupportedTimezone('Asia/Tokio')).toBe(false)
  })
})
