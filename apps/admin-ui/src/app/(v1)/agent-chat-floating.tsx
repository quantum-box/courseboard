'use client'

import { AgentChatProvider, FloatingChatPanel } from '@tachyon-sdk/agent-chat'
import { getLlmsBaseUrl } from 'lib/getLlmsBaseUrl'
import { usePathname } from 'next/navigation'
import { useMemo } from 'react'

type AgentChatFloatingProps = {
	accessToken: string
	tenantId: string
	userId?: string
}

function deriveContext(pathname: string): { page: string; hint?: string } {
	const segments = pathname.split('/').filter(Boolean)
	const tenantScopedSegments =
		segments.length > 1 ? segments.slice(1) : segments
	const pagePath = tenantScopedSegments.join('/') || 'home'
	const contextMap: Record<string, { page: string; hint?: string }> = {
		sources: { page: 'sources', hint: 'Source management' },
		products: { page: 'products', hint: 'Product management' },
		orders: { page: 'orders', hint: 'Order management' },
		agent: { page: 'agent', hint: 'Quotation and invoice document operations' },
		settings: { page: 'settings', hint: 'Admin settings' },
	}
	return contextMap[pagePath] ?? { page: pagePath }
}

export function AgentChatFloating({
	accessToken,
	tenantId,
	userId,
}: AgentChatFloatingProps) {
	const pathname = usePathname()
	const context = useMemo(() => deriveContext(pathname), [pathname])
	const apiBaseUrl = useMemo(() => getLlmsBaseUrl(), [])
	return (
		<AgentChatProvider
			apiBaseUrl={apiBaseUrl}
			accessToken={accessToken}
			tenantId={tenantId}
			userId={userId}
			context={context}
		>
			<FloatingChatPanel />
		</AgentChatProvider>
	)
}
