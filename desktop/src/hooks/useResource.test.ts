import { afterEach, describe, expect, it } from 'vitest'
import { configureApiAuth } from '../api'
import { clearResourceCache, peekResourceCache, writeResourceCache } from './useResource'

function selectTenant(tenantId: string) {
  configureApiAuth({
    tenantId,
    operatorId: tenantId,
    platformId: 'prod',
    getAccessToken: async () => 'token',
    onUnauthorized: () => {},
    onForbidden: () => {},
  })
}

afterEach(() => {
  clearResourceCache()
  configureApiAuth(null)
})

describe('resource cache helpers', () => {
  it('stores and clears keys by prefix', () => {
    writeResourceCache('caddie-courses:a', { items: [1] })
    writeResourceCache('caddie-ratings:a', { items: [2] })
    expect(peekResourceCache('caddie-courses:a')).toEqual({ items: [1] })

    clearResourceCache('caddie-courses:')
    expect(peekResourceCache('caddie-courses:a')).toBeUndefined()
    expect(peekResourceCache('caddie-ratings:a')).toEqual({ items: [2] })

    clearResourceCache()
    expect(peekResourceCache('caddie-ratings:a')).toBeUndefined()
  })

  it('never reuses one tenant\'s page data in another tenant', () => {
    selectTenant('tenant-a')
    writeResourceCache('courses:list', { items: ['a'] })

    selectTenant('tenant-b')
    expect(peekResourceCache('courses:list')).toBeUndefined()
    writeResourceCache('courses:list', { items: ['b'] })

    selectTenant('tenant-a')
    expect(peekResourceCache('courses:list')).toEqual({ items: ['a'] })
    selectTenant('tenant-b')
    expect(peekResourceCache('courses:list')).toEqual({ items: ['b'] })
  })
})
