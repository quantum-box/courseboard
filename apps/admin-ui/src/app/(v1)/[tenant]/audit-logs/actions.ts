'use server'

import { authWithCheck } from 'app/auth'
import { getTachyonApiBaseUrl } from 'lib/backendUrl'
import { buildSimplePdf, summarizeAuditLogs } from './audit-log-pdf'

const PLATFORM_ID =
	process.env.NEXT_PUBLIC_PLATFORM_ID || 'tn_01hjjn348rn3t49zz6hvmfq67p'

export type AuditLogFilter = {
	from?: string
	to?: string
	resourceType?: string
	resourceId?: string
	action?: string
	actorId?: string
	cursor?: string
	limit?: number
}

export type AuditLog = {
	id: string
	tenantId: string
	actorId: string
	actorType: string
	resourceType: string
	resourceId: string
	action: string
	diff?: unknown
	metadata?: unknown
	createdAt: string
}

export type AuditLogListResult = {
	success: boolean
	message?: string
	data?: {
		items: AuditLog[]
		nextCursor: string | null
	}
}

export type AuditLogCsvResult = {
	success: boolean
	message?: string
	data?: {
		base64: string
		filename: string
		contentType: string
	}
}

export type AuditLogPdfResult = AuditLogCsvResult

function appendParam(params: URLSearchParams, key: string, value?: string) {
	const trimmed = value?.trim()
	if (trimmed) {
		params.set(key, trimmed)
	}
}

function buildAuditLogParams(tenantId: string, filter: AuditLogFilter) {
	const params = new URLSearchParams()
	params.set('tenant_id', tenantId)
	params.set('limit', String(filter.limit ?? 50))
	appendParam(params, 'from', filter.from)
	appendParam(params, 'to', filter.to)
	appendParam(params, 'resource_type', filter.resourceType)
	appendParam(params, 'resource_id', filter.resourceId)
	appendParam(params, 'action', filter.action)
	appendParam(params, 'actor_id', filter.actorId)
	appendParam(params, 'cursor', filter.cursor)
	return params
}

function auditLogHeaders(accessToken: string, tenantId: string) {
	return {
		Authorization: `Bearer ${accessToken}`,
		'x-platform-id': PLATFORM_ID,
		'x-operator-id': tenantId,
	}
}

function todayInJst() {
	return new Intl.DateTimeFormat('sv-SE', {
		timeZone: 'Asia/Tokyo',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	}).format(new Date())
}

function normalizeAuditLog(value: unknown): AuditLog | null {
	if (!value || typeof value !== 'object') {
		return null
	}
	const record = value as Record<string, unknown>
	const id = record.id
	const tenantId = record.tenantId ?? record.tenant_id
	const actorId = record.actorId ?? record.actor_id
	const actorType = record.actorType ?? record.actor_type
	const resourceType = record.resourceType ?? record.resource_type
	const resourceId = record.resourceId ?? record.resource_id
	const action = record.action
	const createdAt = record.createdAt ?? record.created_at

	if (
		typeof id !== 'string' ||
		typeof tenantId !== 'string' ||
		typeof actorId !== 'string' ||
		typeof actorType !== 'string' ||
		typeof resourceType !== 'string' ||
		typeof resourceId !== 'string' ||
		typeof action !== 'string' ||
		typeof createdAt !== 'string'
	) {
		return null
	}

	return {
		id,
		tenantId,
		actorId,
		actorType,
		resourceType,
		resourceId,
		action,
		diff: record.diff,
		metadata: record.metadata,
		createdAt,
	}
}

function arrayBufferToBase64(arrayBuffer: ArrayBuffer) {
	const bytes = new Uint8Array(arrayBuffer)
	const chunkSize = 0x8000
	let binary = ''

	for (let index = 0; index < bytes.length; index += chunkSize) {
		const chunk = bytes.subarray(index, index + chunkSize)
		binary += String.fromCharCode.apply(null, Array.from(chunk))
	}

	return btoa(binary)
}

export async function fetchAuditLogsAction(
	tenantId: string,
	filter: AuditLogFilter,
): Promise<AuditLogListResult> {
	const session = await authWithCheck()
	const params = buildAuditLogParams(tenantId, filter)

	try {
		const response = await fetch(
			`${getTachyonApiBaseUrl().replace(/\/+$/, '')}/v1/audit-logs?${params.toString()}`,
			{
				headers: auditLogHeaders(session.accessToken, tenantId),
			},
		)

		if (!response.ok) {
			const text = await response.text()
			console.error('Failed to fetch audit logs:', text)
			return { success: false, message: '監査ログの取得に失敗しました' }
		}

		const raw = (await response.json()) as {
			items?: unknown[]
			nextCursor?: string | null
			next_cursor?: string | null
		}
		const items = (raw.items ?? [])
			.map(item => normalizeAuditLog(item))
			.filter((item): item is AuditLog => item !== null)

		return {
			success: true,
			data: {
				items,
				nextCursor: raw.nextCursor ?? raw.next_cursor ?? null,
			},
		}
	} catch (error: unknown) {
		const message =
			error instanceof Error ? error.message : 'Failed to fetch audit logs'
		console.error('Failed to fetch audit logs:', message)
		return { success: false, message }
	}
}

export async function exportAuditLogsAction(
	tenantId: string,
	filter: AuditLogFilter,
): Promise<AuditLogCsvResult> {
	const session = await authWithCheck()
	const params = buildAuditLogParams(tenantId, { ...filter, cursor: undefined })
	const today = todayInJst()

	try {
		const response = await fetch(
			`${getTachyonApiBaseUrl().replace(/\/+$/, '')}/v1/audit-logs/export?${params.toString()}`,
			{
				headers: auditLogHeaders(session.accessToken, tenantId),
			},
		)

		if (!response.ok) {
			const text = await response.text()
			console.error('Failed to export audit logs:', text)
			return { success: false, message: 'CSV出力に失敗しました' }
		}

		const arrayBuffer = await response.arrayBuffer()
		return {
			success: true,
			data: {
				base64: arrayBufferToBase64(arrayBuffer),
				filename: `audit-logs_${today}.csv`,
				contentType:
					response.headers.get('content-type') ?? 'text/csv; charset=utf-8',
			},
		}
	} catch (error: unknown) {
		const message =
			error instanceof Error ? error.message : 'Failed to export audit logs'
		console.error('Failed to export audit logs:', message)
		return { success: false, message }
	}
}

export async function exportAuditLogSummaryPdfAction(
	tenantId: string,
	filter: AuditLogFilter,
): Promise<AuditLogPdfResult> {
	const logs = await fetchAuditLogsAction(tenantId, {
		...filter,
		cursor: undefined,
		limit: 500,
	})
	if (!logs.success || !logs.data) {
		return { success: false, message: logs.message ?? 'PDF出力に失敗しました' }
	}

	const today = todayInJst()
	const lines = [
		'TACHYON Field ERP Audit Summary',
		`Tenant: ${tenantId}`,
		`Generated: ${today}`,
		`Events: ${logs.data.items.length}`,
		'',
		...summarizeAuditLogs(logs.data.items),
	]
	const pdf = buildSimplePdf(lines)
	return {
		success: true,
		data: {
			base64: Buffer.from(pdf, 'binary').toString('base64'),
			filename: `audit-summary_${today}.pdf`,
			contentType: 'application/pdf',
		},
	}
}
