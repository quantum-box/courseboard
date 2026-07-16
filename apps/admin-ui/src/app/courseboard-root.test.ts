import { describe, expect, it } from 'vitest'
import {
	COURSEBOARD_REACT_ENTRY_PATH,
	resolveCourseboardRootRedirect,
} from './courseboard-root'

describe('resolveCourseboardRootRedirect', () => {
	it('sends the dedicated Cloud App root to the React golf app', () => {
		expect(resolveCourseboardRootRedirect('true')).toBe(
			COURSEBOARD_REACT_ENTRY_PATH,
		)
	})

	it('preserves the existing tenant picker by default', () => {
		expect(resolveCourseboardRootRedirect(undefined)).toBeUndefined()
		expect(resolveCourseboardRootRedirect('false')).toBeUndefined()
	})
})
