import { describe, expect, it } from 'vitest'
import { normalizeSmsPhoneNumber } from './phone-number'

describe('normalizeSmsPhoneNumber', () => {
	it('adds +81 to Japanese domestic numbers', () => {
		expect(normalizeSmsPhoneNumber('09012345678')).toBe('+819012345678')
		expect(normalizeSmsPhoneNumber('090-1234-5678')).toBe('+819012345678')
		expect(normalizeSmsPhoneNumber('９０１２３４５６７８')).toBe(
			'+819012345678',
		)
	})

	it('keeps numbers that already include a country code', () => {
		expect(normalizeSmsPhoneNumber('+819012345678')).toBe('+819012345678')
		expect(normalizeSmsPhoneNumber('819012345678')).toBe('+819012345678')
	})

	it('leaves empty values unset', () => {
		expect(normalizeSmsPhoneNumber(undefined)).toBeUndefined()
		expect(normalizeSmsPhoneNumber('')).toBeUndefined()
	})
})
