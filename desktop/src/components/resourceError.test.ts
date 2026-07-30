import { describe, expect, it } from 'vitest'
import { resourceErrorCopy } from './Page'
import { ApiError } from '../api'
import { ja } from '../i18n/locales/ja'

describe('resourceErrorCopy', () => {
  it('maps engine-specific transport failures onto the offline copy', () => {
    // These reach the operator verbatim today: Chrome/WebKit wording differs.
    expect(resourceErrorCopy(new TypeError('Failed to fetch')).key).toBe('error.offline')
    expect(resourceErrorCopy(new TypeError('Load failed')).key).toBe('error.offline')
    expect(resourceErrorCopy(new Error('NetworkError when attempting to fetch resource')).key)
      .toBe('error.offline')
  })

  it('does not read a download or upload failure as being offline', () => {
    // "load failed" is a substring of both, and CSV export errors take that shape.
    const download = resourceErrorCopy(new Error('Download failed: report is too large'))
    expect(download.key).toBe('error.unexpected')
    expect(download.detail).toBe('Download failed: report is too large')
    expect(resourceErrorCopy(new Error('Upload failed')).key).toBe('error.unexpected')
    expect(resourceErrorCopy(new Error('Reload failed')).key).toBe('error.unexpected')
  })

  it('still recognises a transport failure that is not at the start of the message', () => {
    expect(resourceErrorCopy(new Error('GET /v1/course: Load failed')).key).toBe('error.offline')
    expect(resourceErrorCopy(new Error('net::ERR_CONNECTION_REFUSED')).key).toBe('error.offline')
  })

  it('maps bodiless API failures by status', () => {
    expect(resourceErrorCopy(new Error('Request failed with 404')).key).toBe('error.notFound')
    expect(resourceErrorCopy(new Error('Request failed with 409')).key).toBe('error.conflict')
    expect(resourceErrorCopy(new Error('Request failed with 502')).key).toBe('error.apiUnreachable')
  })

  it('answers a status-carrying failure by status, keeping the body as detail', () => {
    // The server writes English; it belongs in the detail, not the lead sentence.
    const result = resourceErrorCopy(new ApiError('caddie profile was not found', 404))
    expect(result.key).toBe('error.notFound')
    expect(result.detail).toBe('caddie profile was not found')
    expect(resourceErrorCopy(new ApiError('Request failed with 409', 409)).detail).toBeUndefined()
  })

  it('keeps upstream provider failures distinct from an unreachable API', () => {
    expect(resourceErrorCopy(new Error('external provider error: upstream unavailable')).key)
      .toBe('error.providerError')
  })

  it('keeps the upstream reason for a provider failure', () => {
    // Observed on production: without the detail nobody can tell that Field is
    // answering 500 because a column is missing from its database.
    const raw = 'external provider error: Field API returned 500 Internal Server Error: '
      + "Unknown column 'display_name' in 'field list'"
    const result = resourceErrorCopy(new Error(raw))
    expect(result.key).toBe('error.providerError')
    expect(result.detail).toBe(raw)
  })

  it('never surfaces an unmapped message as the primary copy', () => {
    const result = resourceErrorCopy(new Error('some server-authored English detail'))
    expect(result.key).toBe('error.unexpected')
    expect(result.detail).toBe('some server-authored English detail')
  })

  it('resolves every key it can return', () => {
    const errors = [
      new TypeError('Failed to fetch'),
      new Error('Request failed with 400'),
      new Error('Request failed with 401'),
      new Error('Request failed with 403'),
      new Error('Request failed with 404'),
      new Error('Request failed with 409'),
      new Error('Request failed with 422'),
      new Error('Request failed with 500'),
      new Error('Request failed with 503'),
      new Error('external provider error: x'),
      new Error('verify_user failed'),
      new Error('anything else'),
      'not an error',
    ]
    for (const error of errors) {
      const { key } = resourceErrorCopy(error)
      const path = key.split('.')
      const value = path.reduce<unknown>(
        (node, segment) => (node as Record<string, unknown>)?.[segment],
        ja.common,
      )
      expect(typeof value, `${key} must exist in ja.common`).toBe('string')
    }
  })
})
