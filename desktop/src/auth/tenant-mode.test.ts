import { describe, expect, it } from 'vitest'
import type { AuthTenantMode } from './types'
import { tenantModeBadge } from './tenant-mode'

describe('tenantModeBadge', () => {
  it.each([
    ['production', { variant: 'success', label: 'production' }],
    ['sandbox', { variant: 'warning', label: 'sandbox' }],
    ['unknown', { variant: 'neutral', label: 'unknown' }],
  ] as const)('presents %s explicitly', (mode, expected) => {
    expect(tenantModeBadge(mode)).toEqual(expected)
  })

  it('keeps an untyped future value visibly unknown at runtime', () => {
    expect(tenantModeBadge('preview' as AuthTenantMode)).toEqual({
      variant: 'neutral',
      label: 'unknown',
    })
  })
})
