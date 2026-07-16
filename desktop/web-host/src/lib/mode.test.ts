import { describe, expect, it } from 'vitest'
import {
	getKnownOperatorName,
	getOperatorNameForMode,
	OPERATOR_IDS,
} from './mode'

describe('operator display names', () => {
	it('resolves known production and sandbox operator names', () => {
		expect(getOperatorNameForMode('production')).toBe(
			'TACHYON Field Production',
		)
		expect(getOperatorNameForMode('sandbox')).toBe('TACHYON Field Sandbox')
		expect(getKnownOperatorName(OPERATOR_IDS.production)).toBe(
			'TACHYON Field Production',
		)
		expect(getKnownOperatorName(OPERATOR_IDS.sandbox)).toBe(
			'TACHYON Field Sandbox',
		)
	})

	it('returns null for unknown operator ids', () => {
		expect(getKnownOperatorName('tn_unknown')).toBeNull()
	})
})
