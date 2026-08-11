import { describe, expect, it } from 'vitest'

import { resolveFeatureFlagValues } from './feature-flags-api'

describe('resolveFeatureFlagValues', () => {
  const keys = [
    'feature.courseboard.flag-evaluation-smoke',
    'feature.courseboard.absent',
  ]

  it('starts every requested key disabled', () => {
    expect(resolveFeatureFlagValues(keys, undefined)).toEqual({
      'feature.courseboard.flag-evaluation-smoke': false,
      'feature.courseboard.absent': false,
    })
  })

  it('enables only keys the API explicitly returned as enabled', () => {
    const resolved = resolveFeatureFlagValues(keys, [
      { key: 'feature.courseboard.flag-evaluation-smoke', enabled: true },
    ])
    expect(resolved).toEqual({
      'feature.courseboard.flag-evaluation-smoke': true,
      'feature.courseboard.absent': false,
    })
  })

  it('ignores unrequested keys and non-boolean enabled values', () => {
    const resolved = resolveFeatureFlagValues(keys, [
      { key: 'feature.courseboard.unrequested', enabled: true },
      {
        key: 'feature.courseboard.absent',
        enabled: 'yes' as unknown as boolean,
      },
    ])
    expect(resolved).toEqual({
      'feature.courseboard.flag-evaluation-smoke': false,
      'feature.courseboard.absent': false,
    })
    expect(Object.keys(resolved)).toHaveLength(2)
  })

  it('returns a frozen record', () => {
    expect(Object.isFrozen(resolveFeatureFlagValues(keys, undefined))).toBe(true)
  })
})
