import { describe, expect, it } from 'vitest'
import {
  courseboardApiBaseUrlForOrigin,
  previewCourseboardApiBaseUrl,
} from './courseboardApiOrigin'

describe('previewCourseboardApiBaseUrl', () => {
  it('pairs a CourseBoard PR frontend with the API from the same PR', () => {
    expect(previewCourseboardApiBaseUrl('https://pr313--courseboard.txcloud.app')).toBe(
      'https://pr313--courseboard-api.txcloud.app',
    )
  })

  it('does not override production, local, or unofficial preview origins', () => {
    expect(previewCourseboardApiBaseUrl('https://courseboard.txcloud.app')).toBeUndefined()
    expect(previewCourseboardApiBaseUrl('http://127.0.0.1:5173')).toBeUndefined()
    expect(
      previewCourseboardApiBaseUrl('https://pr313--courseboard.quantum-box.workers.dev'),
    ).toBeUndefined()
  })
})

describe('courseboardApiBaseUrlForOrigin', () => {
  it('keeps the configured API outside a PR preview', () => {
    expect(courseboardApiBaseUrlForOrigin(
      'https://courseboard-api.txcloud.app/',
      'https://courseboard.txcloud.app',
    )).toBe('https://courseboard-api.txcloud.app')
  })
})
