import { afterEach, describe, expect, it, vi } from 'vitest'
import {
	getServerCourseApiBaseUrl,
	joinServerCourseApiPath,
} from './serverCourseApiUrl'

describe('getServerCourseApiBaseUrl', () => {
	afterEach(() => {
		vi.unstubAllEnvs()
	})

	it('defaults to the local Rust course-api when unset outside Workers', () => {
		expect(getServerCourseApiBaseUrl()).toBe('http://127.0.0.1:8080')
	})

	it('requires an explicit URL on Cloudflare Workers', () => {
		vi.stubEnv('TACHYON_DEPLOYMENT_TARGET', 'cloudflare_workers')
		expect(getServerCourseApiBaseUrl()).toBeUndefined()
	})

	it('prefers COURSEBOARD_API_URL and strips trailing slashes', () => {
		vi.stubEnv('COURSEBOARD_API_URL', 'https://course-api.example.test/')
		expect(getServerCourseApiBaseUrl()).toBe('https://course-api.example.test')
	})

	it('joins course-api paths without creating double slashes', () => {
		vi.stubEnv('COURSEBOARD_API_URL', 'https://course-api.example.test/')

		expect(joinServerCourseApiPath('/v1/course/tee-sheet')).toBe(
			'https://course-api.example.test/v1/course/tee-sheet',
		)
		expect(joinServerCourseApiPath('v1/course/courses')).toBe(
			'https://course-api.example.test/v1/course/courses',
		)
	})
})
