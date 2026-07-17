import { describe, expect, it } from 'vitest'
import { authProxy } from './vite.config'

describe('local Auth.js proxy', () => {
  it('preserves the Vite origin for Cognito redirect_uri and HttpOnly cookies', () => {
    expect(authProxy('http://localhost:3001')).toEqual({
      target: 'http://localhost:3001',
      changeOrigin: false,
    })
  })
})
