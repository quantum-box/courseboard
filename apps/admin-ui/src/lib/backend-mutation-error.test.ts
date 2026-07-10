import { describe, expect, it } from 'vitest'
import { extractBackendErrorDetail } from './backend-mutation-error'

describe('backend mutation error formatting', () => {
	it('extracts backend message fields from JSON errors', () => {
		expect(
			extractBackendErrorDetail(
				JSON.stringify({ message: 'SMS provider rejected request' }),
			),
		).toBe('SMS provider rejected request')
	})

	it('extracts provider error details when present', () => {
		expect(
			extractBackendErrorDetail(
				JSON.stringify({ provider_error: { error: 'SES send denied' } }),
			),
		).toBe('SES send denied')
	})

	it('falls back to plain text bodies', () => {
		expect(extractBackendErrorDetail(' upstream timeout ')).toBe(
			'upstream timeout',
		)
	})
})
