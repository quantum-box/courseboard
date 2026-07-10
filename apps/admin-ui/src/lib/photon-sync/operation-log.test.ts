import { describe, expect, it } from 'vitest'
import {
	createPendingOperation,
	redactPayload,
	trimErrorSummary,
} from './operation-log'

describe('photon sync operation log', () => {
	it('redacts secrets recursively before persistence', () => {
		const payload = redactPayload({
			name: 'Vendor',
			accessToken: 'secret-token',
			nested: {
				api_key: 'secret-key',
				contactEmail: 'vendor@example.com',
			},
		})

		expect(payload).toEqual({
			name: 'Vendor',
			accessToken: '[redacted]',
			nested: {
				api_key: '[redacted]',
				contactEmail: 'vendor@example.com',
			},
		})
	})

	it('creates a queued operation with stable tenant scope', () => {
		const operation = createPendingOperation({
			platformId: 'tn_platform',
			tenantId: 'op_tenant',
			actorUserId: 'us_actor',
			operationId: 'op_1',
			entityType: 'erp.vendors',
			entityId: 'vendor_1',
			mutationType: 'update',
			payload: { name: 'Vendor' },
			baseVersion: 'v1',
			idempotencyKey: 'op_tenant:erp.vendors:vendor_1:v1',
			now: '2026-05-18T00:00:00.000Z',
		})

		expect(operation.status).toBe('queued')
		expect(operation.payloadRedactionVersion).toBe(1)
		expect(operation.retryCount).toBe(0)
		expect(operation.createdAt).toBe('2026-05-18T00:00:00.000Z')
	})

	it('trims error summaries before local persistence', () => {
		const summary = trimErrorSummary(new Error('x'.repeat(700)))

		expect(summary).toHaveLength(500)
	})
})
