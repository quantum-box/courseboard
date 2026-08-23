import { describe, expect, it } from 'vitest'
import { normalizedPlayerTagOptions, validatePlayerTagOptions } from './playerTagOptions'

// Reading the categories out of the extension config moved to the API with
// the storage itself; what remains here is the form's own hygiene.
describe('player category form hygiene', () => {
  it('normalizes whitespace and drops the rows left empty', () => {
    expect(normalizedPlayerTagOptions([' 共通 ', '', '優待'])).toEqual(['共通', '優待'])
  })

  it('flags a duplicate the operator typed twice', () => {
    expect(validatePlayerTagOptions(['共通', ' 共通 '])).toBe('duplicate')
  })
})
