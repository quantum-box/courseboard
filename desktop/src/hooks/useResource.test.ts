/* @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { configureApiAuth } from '../api'
import {
  clearResourceCache,
  peekResourceCache,
  useResource,
  writeResourceCache,
} from './useResource'

function selectScope(tenantId: string, platformId = 'prod', operatorId = tenantId) {
  configureApiAuth({
    tenantId,
    operatorId,
    platformId,
    getAccessToken: async () => 'token',
    onUnauthorized: () => {},
    onForbidden: () => {},
  })
}

afterEach(() => {
  cleanup()
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
    selectScope('tenant-a')
    writeResourceCache('courses:list', { items: ['a'] })

    selectScope('tenant-b')
    expect(peekResourceCache('courses:list')).toBeUndefined()
    writeResourceCache('courses:list', { items: ['b'] })

    selectScope('tenant-a')
    expect(peekResourceCache('courses:list')).toEqual({ items: ['a'] })
    selectScope('tenant-b')
    expect(peekResourceCache('courses:list')).toEqual({ items: ['b'] })
  })

  it('does not reuse one platform\'s in-flight request in another platform', async () => {
    let resolveProd!: (value: string) => void
    let resolveSandbox!: (value: string) => void
    const prodRequest = new Promise<string>(resolve => {
      resolveProd = resolve
    })
    const sandboxRequest = new Promise<string>(resolve => {
      resolveSandbox = resolve
    })
    const prodLoader = vi.fn(() => prodRequest)
    const sandboxLoader = vi.fn(() => sandboxRequest)

    selectScope('tenant-a', 'prod')
    const prod = renderHook(() => useResource(prodLoader, [], { cacheKey: 'courses:list' }))
    await waitFor(() => expect(prodLoader).toHaveBeenCalledOnce())
    // The auth scope is process-wide. Unmount the old consumer before binding
    // the next scope so its late result cannot make the hook adopt the new key.
    prod.unmount()

    selectScope('tenant-a', 'sandbox')
    const sandbox = renderHook(() => useResource(sandboxLoader, [], { cacheKey: 'courses:list' }))
    await waitFor(() => expect(sandboxLoader).toHaveBeenCalledOnce())

    await act(async () => {
      resolveProd('prod')
      resolveSandbox('sandbox')
      await Promise.all([prodRequest, sandboxRequest])
    })
    await waitFor(() => expect(sandbox.result.current.data).toBe('sandbox'))
    expect(prodLoader).toHaveBeenCalledOnce()
    expect(sandboxLoader).toHaveBeenCalledOnce()
  })

  it('shares one in-flight loader for simultaneous consumers of one key', async () => {
    let resolve!: (value: string) => void
    const request = new Promise<string>(resolveRequest => {
      resolve = resolveRequest
    })
    const loader = vi.fn(() => request)

    selectScope('tenant-a')
    const first = renderHook(() => useResource(loader, [], { cacheKey: 'courses:list' }))
    const second = renderHook(() => useResource(loader, [], { cacheKey: 'courses:list' }))
    await waitFor(() => expect(loader).toHaveBeenCalledOnce())

    await act(async () => {
      resolve('shared')
      await request
    })
    await waitFor(() => {
      expect(first.result.current.data).toBe('shared')
      expect(second.result.current.data).toBe('shared')
    })
    expect(loader).toHaveBeenCalledOnce()
  })

  it('starts independent in-flight loaders for different keys', async () => {
    let resolveCourses!: (value: string) => void
    let resolveStaff!: (value: string) => void
    const coursesRequest = new Promise<string>(resolve => {
      resolveCourses = resolve
    })
    const staffRequest = new Promise<string>(resolve => {
      resolveStaff = resolve
    })
    const coursesLoader = vi.fn(() => coursesRequest)
    const staffLoader = vi.fn(() => staffRequest)

    selectScope('tenant-a')
    const courses = renderHook(() => useResource(coursesLoader, [], { cacheKey: 'courses:list' }))
    const staff = renderHook(() => useResource(staffLoader, [], { cacheKey: 'staff:list' }))
    await waitFor(() => {
      expect(coursesLoader).toHaveBeenCalledOnce()
      expect(staffLoader).toHaveBeenCalledOnce()
    })

    await act(async () => {
      resolveCourses('courses')
      resolveStaff('staff')
      await Promise.all([coursesRequest, staffRequest])
    })
    await waitFor(() => {
      expect(courses.result.current.data).toBe('courses')
      expect(staff.result.current.data).toBe('staff')
    })
    expect(coursesLoader).toHaveBeenCalledOnce()
    expect(staffLoader).toHaveBeenCalledOnce()
  })

  it('does not reuse an invalidated in-flight request', async () => {
    let resolveOld!: (value: string) => void
    let resolveNew!: (value: string) => void
    const oldRequest = new Promise<string>(resolve => {
      resolveOld = resolve
    })
    const newRequest = new Promise<string>(resolve => {
      resolveNew = resolve
    })
    const oldLoader = vi.fn(() => oldRequest)
    const newLoader = vi.fn(() => newRequest)
    const thirdLoader = vi.fn(async () => 'unexpected')

    selectScope('tenant-a')
    renderHook(() => useResource(oldLoader, [], { cacheKey: 'courses:list' }))
    await waitFor(() => expect(oldLoader).toHaveBeenCalledOnce())

    clearResourceCache('courses:list')
    const fresh = renderHook(() => useResource(newLoader, [], { cacheKey: 'courses:list' }))
    await waitFor(() => expect(newLoader).toHaveBeenCalledOnce())

    await act(async () => {
      resolveOld('old')
      await oldRequest
    })
    const shared = renderHook(() => useResource(thirdLoader, [], { cacheKey: 'courses:list' }))
    await act(async () => {
      await Promise.resolve()
    })
    expect(thirdLoader).not.toHaveBeenCalled()

    await act(async () => {
      resolveNew('new')
      await newRequest
    })
    await waitFor(() => {
      expect(fresh.result.current.data).toBe('new')
      expect(shared.result.current.data).toBe('new')
    })
  })

  it('releases a failed in-flight request so the next refresh can retry', async () => {
    const loader = vi.fn()
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce('recovered')

    selectScope('tenant-a')
    const resource = renderHook(() => useResource(loader, [], { cacheKey: 'courses:list' }))
    await waitFor(() => expect(resource.result.current.error).toBeInstanceOf(Error))
    expect(loader).toHaveBeenCalledOnce()

    await act(async () => {
      await resource.result.current.refresh()
    })
    await waitFor(() => {
      expect(resource.result.current.data).toBe('recovered')
      expect(resource.result.current.error).toBeNull()
    })
    expect(loader).toHaveBeenCalledTimes(2)
  })
})
