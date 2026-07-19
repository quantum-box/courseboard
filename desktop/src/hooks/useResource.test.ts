import { describe, expect, it } from 'vitest'
import { clearResourceCache, peekResourceCache, writeResourceCache } from './useResource'

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
})
