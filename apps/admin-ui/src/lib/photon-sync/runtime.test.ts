import { describe, expect, it, vi } from 'vitest'
import { initPhotonSyncRuntime } from './runtime'
import type { LocalProjectionStore } from './types'

const config = {
	platformId: 'tn_platform',
	tenantId: 'op_tenant',
	actorUserId: 'us_actor',
	enabled: true,
}

describe('photon sync runtime', () => {
	it('falls back to remote reads when storage is not configured', async () => {
		const runtime = initPhotonSyncRuntime({ config })
		const readRemote = vi.fn(async () => ({ id: 'vendor_1' }))

		const result = await runtime.readThrough('erp.vendors', readRemote)

		expect(runtime.state.enabled).toBe(false)
		expect(readRemote).toHaveBeenCalledTimes(1)
		expect(result).toEqual({
			source: 'remote',
			data: { id: 'vendor_1' },
			projected: false,
		})
	})

	it('projects read-through results when storage and project callback exist', async () => {
		const store: LocalProjectionStore = {
			project: vi.fn(),
			read: vi.fn(),
			enqueue: vi.fn(),
		}
		const runtime = initPhotonSyncRuntime({ config, store })
		const project = vi.fn()

		const result = await runtime.readThrough(
			'erp.vendors',
			async () => ({ items: [{ id: 'vendor_1' }] }),
			project,
		)

		expect(runtime.state.enabled).toBe(true)
		expect(project).toHaveBeenCalledWith({ items: [{ id: 'vendor_1' }] })
		expect(result.projected).toBe(true)
	})

	it('rejects pending writes in read projection mode', async () => {
		const store: LocalProjectionStore = {
			project: vi.fn(),
			read: vi.fn(),
			enqueue: vi.fn(),
		}
		const runtime = initPhotonSyncRuntime({ config, store })

		await expect(
			runtime.enqueue({
				platformId: 'tn_platform',
				tenantId: 'op_tenant',
				actorUserId: 'us_actor',
				operationId: 'op_1',
				entityType: 'erp.vendors',
				mutationType: 'update',
				payload: {},
				payloadRedactionVersion: 1,
				idempotencyKey: 'key',
				status: 'queued',
				retryCount: 0,
				createdAt: '2026-05-18T00:00:00.000Z',
				updatedAt: '2026-05-18T00:00:00.000Z',
			}),
		).rejects.toThrow('pending writes are disabled')
	})
})
