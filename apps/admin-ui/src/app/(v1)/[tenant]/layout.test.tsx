import type React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TenantLayout from './layout'

vi.mock('app/auth', () => ({
	authWithCheck: vi.fn(),
}))

vi.mock('lib/tenantPath', async () => {
	const actual =
		await vi.importActual<typeof import('lib/tenantPath')>('lib/tenantPath')
	return {
		...actual,
		resolveTenantPathSegment: vi.fn(),
	}
})

vi.mock('components/client-only', () => ({
	ClientOnly: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('app/(v1)/agent-chat-floating', () => ({
	AgentChatFloating: () => null,
}))

vi.mock('next/navigation', () => ({
	redirect: vi.fn((url: string) => {
		throw new Error(`redirect:${url}`)
	}),
	notFound: vi.fn(() => {
		throw new Error('notFound')
	}),
}))

import { authWithCheck } from 'app/auth'
import { resolveTenantPathSegment } from 'lib/tenantPath'

const authWithCheckMock = vi.mocked(authWithCheck)
const resolveTenantPathSegmentMock = vi.mocked(resolveTenantPathSegment)

describe('TenantLayout tenant segment handling', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		authWithCheckMock.mockResolvedValue({
			accessToken: 'access-token',
			user: { id: 'user_1' },
		} as never)
		resolveTenantPathSegmentMock.mockResolvedValue({
			id: 'tn_01j91h09tpj5ehwbwfwfxpak2b',
			name: 'Tenant',
		} as never)
	})

	it('renders children for tn_ path segments', async () => {
		const element = await TenantLayout({
			children: <main>protected</main>,
			params: Promise.resolve({ tenant: 'tn_01j91h09tpj5ehwbwfwfxpak2b' }),
		})

		expect(renderToStaticMarkup(element)).toContain('protected')
	})

	it('redirects slug path segments to the canonical tenant id URL instead of rendering', async () => {
		await expect(
			TenantLayout({
				children: <main>protected</main>,
				params: Promise.resolve({ tenant: 'course-board' }),
			}),
		).rejects.toThrow('redirect:/tn_01j91h09tpj5ehwbwfwfxpak2b/home')
	})

	it('returns notFound for segments that resolve to no tenant', async () => {
		resolveTenantPathSegmentMock.mockResolvedValueOnce(null)

		await expect(
			TenantLayout({
				children: <main>protected</main>,
				params: Promise.resolve({ tenant: 'unknown-tenant' }),
			}),
		).rejects.toThrow('notFound')
	})
})
