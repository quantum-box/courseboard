import { describe, expect, it } from 'vitest'
import { protectedRequestCredentials } from './api'

describe('protectedRequestCredentials', () => {
  it('includes the HttpOnly session only for same-origin Web requests', () => {
    expect(protectedRequestCredentials('/field-api/v1/invoices', 'https://courseboard.example', false)).toBe('include')
  })

  it('omits credentials for Native and cross-origin requests', () => {
    expect(protectedRequestCredentials('https://courseboard.example/field-api/v1/invoices', 'tauri://localhost', true)).toBe('omit')
    expect(protectedRequestCredentials('https://api.example/field-api/v1/invoices', 'https://courseboard.example', false)).toBe('omit')
  })
})
