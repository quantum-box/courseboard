'use server'

import { authWithCheck } from 'app/auth'
import { getBackendBaseUrl } from 'lib/backendUrl'

const PLATFORM_ID =
	process.env.NEXT_PUBLIC_PLATFORM_ID || 'tn_01hjjn348rn3t49zz6hvmfq67p'

export type EvidenceSummary = {
	id: string
	voucherType: string
	originCategory: string
	status: string
	verificationStatus: string
	transactionDate: string
	postingPeriod?: string | null
	documentNumber?: string | null
	counterpartyId?: string | null
	counterparty?: string | null
	amount?: string | null
	taxAmount?: string | null
	currency: string
	taxCategory?: string | null
	sourceModule?: string | null
	sourceId?: string | null
	journalEntryId?: string | null
	fileHash: string
	hashAlgorithm: string
	contentType?: string | null
	originalFileName?: string | null
	fileSizeBytes?: number | null
	retentionPolicyId?: string | null
	retentionUntil: string
	uploadedBy?: string | null
	createdBy?: string | null
	createdAt: string
	updatedAt: string
}

export type EvidenceSourceLink = {
	sourceType: string
	sourceId: string
	sourceLineId?: string | null
	linkRole: string
	requiredForClose: boolean
	reviewStatus: string
	confidence?: string | null
	linkedBy?: string | null
	createdAt: string
}

export type EvidenceFileSummary = {
	id: string
	versionNo: number
	fileRole: string
	fileHash: string
	hashAlgorithm: string
	status: string
	contentType?: string | null
	originalFileName?: string | null
	fileSizeBytes?: number | null
	isCurrentOriginal: boolean
	timestampApplied: boolean
	uploadedBy?: string | null
	createdAt: string
}

export type EvidenceOcrMetadata = {
	id: string
	fileObjectId?: string | null
	provider?: string | null
	derivativeRole: string
	sourceType?: string | null
	sourceId?: string | null
	ocrText?: string | null
	extractedFieldsJson?: unknown
	providerPayloadJson?: unknown
	confidence?: string | null
	reviewStatus: string
	reviewedBy?: string | null
	reviewedAt?: string | null
	createdAt: string
}

export type EvidenceAuditEntry = {
	id: string
	eventType: string
	actorId?: string | null
	reason?: string | null
	requestId?: string | null
	sourceChannel?: string | null
	sourceFileObjectId?: string | null
	sourceVersionNo?: number | null
	beforeJson?: unknown
	afterJson?: unknown
	metadataJson?: unknown
	createdAt: string
}

export type EvidenceSearchItem = {
	evidence: EvidenceSummary
	linkedJournal?: EvidenceSourceLink | null
	linkedSources: EvidenceSourceLink[]
	latestFileVersion?: EvidenceFileSummary | null
	auditSummary: {
		eventCount: number
		latestAction?: string | null
		latestActor?: string | null
		latestAt?: string | null
		latestSourceChannel?: string | null
	}
}

export type EvidenceDetail = {
	evidence: EvidenceSummary
	latestFileVersion?: EvidenceFileSummary | null
	fileVersions: EvidenceFileSummary[]
	ocrMetadata: EvidenceOcrMetadata[]
	auditHistory: EvidenceAuditEntry[]
	linkedSources: EvidenceSourceLink[]
}

export type EvidenceSearchFilter = {
	voucherType?: string
	status?: string
	verificationStatus?: string
	transactionDateFrom?: string
	transactionDateTo?: string
	amountMin?: string
	amountMax?: string
	counterparty?: string
	taxCategory?: string
	sourceModule?: string
	sourceId?: string
	journalEntryId?: string
	fileHash?: string
	ocrReviewStatus?: string
	auditAction?: string
	auditDateFrom?: string
	auditDateTo?: string
	sortBy?: string
	sortDirection?: string
	limit?: number
	offset?: number
}

export type ActionResult<T> = {
	success: boolean
	message?: string
	data?: T
}

type LinkInput = {
	evidenceRecordId: string
	sourceType: string
	sourceId: string
	sourceLineId?: string
	linkRole: string
	requiredForClose?: boolean
	confidence?: string
}

type OcrReviewInput = {
	evidenceRecordId: string
	fileVersionId?: string
	derivativeId?: string
	reviewStatus: string
	reviewerCorrection?: unknown
	reviewerNote?: string
	reason?: string
	reviewedBy?: string
}

function headers(accessToken: string, tenantId: string) {
	return {
		Authorization: `Bearer ${accessToken}`,
		'x-platform-id': PLATFORM_ID,
		'x-operator-id': tenantId,
		'content-type': 'application/json',
	}
}

function appendParam(params: URLSearchParams, key: string, value?: string) {
	const trimmed = value?.trim()
	if (trimmed) params.set(key, trimmed)
}

function apiBase() {
	return getBackendBaseUrl().replace(/\/+$/, '')
}

export async function searchEvidenceAction(
	tenantId: string,
	filter: EvidenceSearchFilter,
): Promise<
	ActionResult<{
		items: EvidenceSearchItem[]
		limit: number
		offset: number
		sortBy: string
		sortDirection: string
	}>
> {
	const session = await authWithCheck()
	const params = new URLSearchParams()
	params.set('limit', String(filter.limit ?? 50))
	params.set('offset', String(filter.offset ?? 0))
	appendParam(params, 'voucher_type', filter.voucherType)
	appendParam(params, 'status', filter.status)
	appendParam(params, 'verification_status', filter.verificationStatus)
	appendParam(params, 'transaction_date_from', filter.transactionDateFrom)
	appendParam(params, 'transaction_date_to', filter.transactionDateTo)
	appendParam(params, 'amount_min', filter.amountMin)
	appendParam(params, 'amount_max', filter.amountMax)
	appendParam(params, 'counterparty', filter.counterparty)
	appendParam(params, 'tax_category', filter.taxCategory)
	appendParam(params, 'source_module', filter.sourceModule)
	appendParam(params, 'source_id', filter.sourceId)
	appendParam(params, 'journal_entry_id', filter.journalEntryId)
	appendParam(params, 'file_hash', filter.fileHash)
	appendParam(params, 'ocr_review_status', filter.ocrReviewStatus)
	appendParam(params, 'audit_action', filter.auditAction)
	appendParam(params, 'audit_date_from', filter.auditDateFrom)
	appendParam(params, 'audit_date_to', filter.auditDateTo)
	appendParam(params, 'sort_by', filter.sortBy)
	appendParam(params, 'sort_direction', filter.sortDirection)

	try {
		const response = await fetch(
			`${apiBase()}/v1/erp/evidence/search?${params.toString()}`,
			{ headers: headers(session.accessToken, tenantId) },
		)
		if (!response.ok) {
			console.error('Failed to search evidence:', await response.text())
			return { success: false, message: '証憑検索に失敗しました' }
		}
		return { success: true, data: (await response.json()) as never }
	} catch (error) {
		const message =
			error instanceof Error ? error.message : 'Failed to search evidence'
		console.error('Failed to search evidence:', message)
		return { success: false, message }
	}
}

export async function fetchEvidenceDetailAction(
	tenantId: string,
	evidenceRecordId: string,
): Promise<ActionResult<EvidenceDetail>> {
	const session = await authWithCheck()
	try {
		const response = await fetch(
			`${apiBase()}/v1/erp/evidence/${encodeURIComponent(evidenceRecordId)}`,
			{ headers: headers(session.accessToken, tenantId) },
		)
		if (!response.ok) {
			console.error('Failed to fetch evidence detail:', await response.text())
			return { success: false, message: '証憑詳細の取得に失敗しました' }
		}
		return { success: true, data: (await response.json()) as EvidenceDetail }
	} catch (error) {
		const message =
			error instanceof Error ? error.message : 'Failed to fetch evidence detail'
		console.error('Failed to fetch evidence detail:', message)
		return { success: false, message }
	}
}

export async function upsertEvidenceLinkAction(
	tenantId: string,
	input: LinkInput,
): Promise<ActionResult<EvidenceSourceLink>> {
	const session = await authWithCheck()
	const response = await fetch(`${apiBase()}/v1/erp/evidence/source-links`, {
		method: 'POST',
		headers: headers(session.accessToken, tenantId),
		body: JSON.stringify(input),
	})
	if (!response.ok) {
		console.error('Failed to save evidence link:', await response.text())
		return { success: false, message: 'リンク更新に失敗しました' }
	}
	return { success: true, data: (await response.json()) as EvidenceSourceLink }
}

export async function deleteEvidenceLinkAction(
	tenantId: string,
	input: LinkInput,
): Promise<ActionResult<{ removed: boolean }>> {
	const session = await authWithCheck()
	const response = await fetch(`${apiBase()}/v1/erp/evidence/source-links`, {
		method: 'DELETE',
		headers: headers(session.accessToken, tenantId),
		body: JSON.stringify(input),
	})
	if (!response.ok) {
		console.error('Failed to delete evidence link:', await response.text())
		return { success: false, message: 'リンク削除に失敗しました' }
	}
	return { success: true, data: (await response.json()) as { removed: boolean } }
}

export async function reviewEvidenceOcrAction(
	tenantId: string,
	input: OcrReviewInput,
): Promise<
	ActionResult<{
		rawOcrMetadata: EvidenceOcrMetadata
		reviewerCorrection?: EvidenceOcrMetadata | null
		auditEntry: EvidenceAuditEntry
	}>
> {
	const session = await authWithCheck()
	let reviewerCorrection: unknown = input.reviewerCorrection
	if (typeof reviewerCorrection === 'string') {
		const trimmed = reviewerCorrection.trim()
		if (trimmed) {
			try {
				reviewerCorrection = JSON.parse(trimmed)
			} catch {
				reviewerCorrection = trimmed
			}
		} else {
			reviewerCorrection = undefined
		}
	}
	const response = await fetch(
		`${apiBase()}/v1/erp/evidence/${encodeURIComponent(input.evidenceRecordId)}/ocr-review`,
		{
			method: 'POST',
			headers: headers(session.accessToken, tenantId),
			body: JSON.stringify({
				evidenceRecordId: input.evidenceRecordId,
				fileVersionId: input.fileVersionId,
				derivativeId: input.derivativeId,
				reviewStatus: input.reviewStatus,
				reviewerCorrection,
				reviewerNote: input.reviewerNote,
				reason: input.reason,
				reviewedBy: input.reviewedBy,
			}),
		},
	)
	if (!response.ok) {
		console.error('Failed to review evidence OCR:', await response.text())
		return { success: false, message: 'OCRレビュー更新に失敗しました' }
	}
	return { success: true, data: (await response.json()) as never }
}
