'use client'
import { useParams } from 'next/navigation'

/**
 * Returns the current tenant ID from the URL params.
 * Uses useParams() to always reflect the actual URL,
 * preventing stale tenant context during navigation.
 */
export function useTenantId(): string {
	const params = useParams<{ tenant: string }>()
	return params.tenant
}
