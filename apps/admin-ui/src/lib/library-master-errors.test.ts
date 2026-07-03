import { describe, expect, it } from 'vitest'

import {
	libraryMasterErrorDetails,
	libraryMasterErrorMessage,
} from './library-master-errors'

describe('libraryMasterErrorMessage', () => {
	it('classifies Library validation errors from urql-style Error messages', () => {
		const error = new Error(
			'GraphQL Error: {"response":{"errors":[{"message":"name is required","extensions":{"code":"LIBRARY_MASTER_VALIDATION"}}]}}',
		)

		expect(libraryMasterErrorMessage(error)).toContain('入力検証')
	})

	it('classifies Library conflict errors from parsed GraphQL payloads', () => {
		const message = libraryMasterErrorMessage({
			response: {
				errors: [
					{
						message: 'conflict',
						extensions: { code: 'LIBRARY_MASTER_CONFLICT' },
					},
				],
			},
		})

		expect(message).toContain('再読み込み')
	})

	it('returns operator-facing titles for permission errors', () => {
		const details = libraryMasterErrorDetails({
			response: {
				errors: [
					{
						message: 'forbidden',
						extensions: { code: 'LIBRARY_MASTER_PERMISSION_DENIED' },
					},
				],
			},
		})

		expect(details).toMatchObject({
			code: 'LIBRARY_MASTER_PERMISSION_DENIED',
			title: 'Library の権限で拒否されました',
		})
	})

	it('returns stable messages for unavailable and network errors', () => {
		expect(
			libraryMasterErrorDetails({
				response: {
					errors: [
						{
							message: 'service unavailable',
							extensions: { code: 'LIBRARY_MASTER_UNAVAILABLE' },
						},
					],
				},
			}),
		).toMatchObject({
			code: 'LIBRARY_MASTER_UNAVAILABLE',
			title: 'Library API が利用できません',
		})

		expect(
			libraryMasterErrorMessage({
				response: {
					errors: [
						{
							message: 'connect failed',
							extensions: { code: 'LIBRARY_MASTER_NETWORK' },
						},
					],
				},
			}),
		).toContain('接続に失敗')
	})

	it('ignores unrelated errors', () => {
		expect(libraryMasterErrorMessage(new Error('network'))).toBeNull()
	})
})
