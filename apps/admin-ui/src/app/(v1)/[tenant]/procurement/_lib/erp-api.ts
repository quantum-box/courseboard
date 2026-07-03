import { joinServerBackendPath } from 'lib/serverBackendUrl'
import { authWithCheck } from 'app/auth'
import { getTachyonApiBaseUrl } from 'lib/backendUrl'
import { getModeFromOperatorId, getPlatformIdForMode } from 'lib/mode'
import { normalizeStockLevel, type StockLevel } from './stock-level-normalizer'

const ACCOUNTING_API_BASE_URL = getTachyonApiBaseUrl()

export type DataSource = 'api'

export type DeliveryStatus =
	| 'draft'
	| 'processing'
	| 'ocr_completed'
	| 'needs_review'
	| 'received'
	| 'failed'

export type ReceivingDiscrepancyStatus = 'open' | 'resolved'

export type ReceivingDiscrepancyAction =
	| 'record_adjustment'
	| 'return_to_supplier'
	| 'reorder_required'
	| 'ignore'

export type DeliveryLine = {
	id: string
	skuCode: string
	productName: string
	quantity: number
	unit: string
	confidence: number | null
	vendorSkuText: string | null
	reviewRequired: boolean
	warehouseName: string | null
	note: string | null
	lotNo: string | null
	receivedAt: string | null
	expiresAt: string | null
}

export type DeliverySummary = {
	id: string
	status: DeliveryStatus
	supplierName: string
	warehouseName: string
	documentName: string
	uploadedAt: string
	receivedAt: string | null
	lineCount: number
	totalQuantity: number
	ocrStatus: string
	note: string | null
	originalObjectKey: string | null
	originalUrl: string | null
	originalSha256: string | null
	sizeBytes: number | null
	confidence: number | null
	reviewRequired: boolean
	reviewReasons: string[]
}

export type DeliveryDetail = DeliverySummary & {
	documentUrl: string | null
	rawText: string | null
	ocrLines: DeliveryLine[]
	receivedLines: DeliveryLine[]
}

export type DeliveryListResult = {
	items: DeliverySummary[]
	source: DataSource
}

export type DeliveryDetailResult = {
	item: DeliveryDetail | null
	source: DataSource
}

export type ReceivingDiscrepancyAuditLog = {
	id: string
	action: ReceivingDiscrepancyAction
	note: string | null
	createdAt: string
}

export type ReceivingDiscrepancy = {
	id: string
	tenantId: string
	receivingRecordId: string
	slipId: string
	sku: string
	expectedQuantity: number
	actualQuantity: number
	kind: string
	status: ReceivingDiscrepancyStatus
	notedAt: string
	resolvedAt: string | null
	resolutionNote: string | null
	auditLogs: ReceivingDiscrepancyAuditLog[]
}

export type ReceivingDiscrepancyListResult = {
	items: ReceivingDiscrepancy[]
	source: DataSource
}

export type StockLevelListResult = {
	items: StockLevel[]
	source: DataSource
}

export type LowStockDecisionStatus =
	| 'pending'
	| 'on_hold'
	| 'purchase_candidate'

export type LowStockAlert = {
	stockItemId: string
	stockLevelId: string
	skuCode: string
	productName: string
	warehouseId: string
	warehouseName: string
	quantityOnHand: number
	safetyStockQuantity: number
	reorderPointQuantity: number
	replenishmentTargetQuantity: number
	preferredOrderQuantity: number | null
	recommendedOrderQuantity: number
	shortageQuantity: number
	decisionStatus: LowStockDecisionStatus
	decisionNote: string | null
	decidedAt: string | null
	decidedBy: string | null
	updatedAt: string
}

export type LowStockAlertListResult = {
	items: LowStockAlert[]
	source: DataSource
}

export type StockMovement = {
	id: string
	stockItemId: string
	sku: string
	warehouseId: string
	warehouseName: string
	direction: 'increase' | 'decrease'
	quantity: number
	signedQuantity: number
	sourceEvent: string
	sourceEventLabel: string
	referenceType: string | null
	referenceId: string | null
	operatorId: string | null
	occurredAt: string
}

export type StockMovementListResult = {
	items: StockMovement[]
	source: DataSource
}

export type InventoryStore = {
	id: string
	kind: string
	name: string
	address: string | null
	businessHours: string | null
	posLocationId: string | null
	createdAt: string
	updatedAt: string
}

export type InventoryLocation = {
	id: string
	kind: 'warehouse' | 'store'
	referenceId: string
	name: string
	stockHolding: boolean
	createdAt: string
	updatedAt: string
}

export type StockTransfer = {
	id: string
	sku: string
	fromLocationId: string
	toLocationId: string
	quantity: number
	reason: string | null
	transferredAt: string
	createdAt: string
	createdBy: string | null
	status: string
}

export type InventoryStoreListResult = {
	items: InventoryStore[]
	source: DataSource
}

export type InventoryLocationListResult = {
	items: InventoryLocation[]
	source: DataSource
}

export type StockTransferListResult = {
	items: StockTransfer[]
	source: DataSource
}

export type TachyonFieldErpRolloutStatus = {
	tenantId: string
	mode: 'disabled' | 'allowlist' | 'all'
	enabled: boolean
	allowlisted: boolean
	sources: string[]
}

export type TachyonFieldErpRolloutStatusResult = {
	item: TachyonFieldErpRolloutStatus | null
	source: DataSource
	errorMessage: string | null
}

export type AccountingSalesEvent = {
	id: string
	provider: string
	eventType: string
	externalId: string
	grossAmount: string
	feeAmount: string
	netAmount: string
	taxAmount: string
	currency: string
	description: string | null
	journalEntryId: string | null
	status: string
	eventDate: string
}

export type AccountingPaymentReconciliation = {
	id: string
	provider: string
	payoutId: string
	depositAmount: string
	depositDate: string
	journalEntryId: string | null
	status: string
}

export type AccountingCloseReviewResult = {
	salesEvents: AccountingSalesEvent[]
	reconciliations: AccountingPaymentReconciliation[]
	source: DataSource
}

export type MonthlyClosingStatus = 'open' | 'closed' | 'reopened'

export type MonthlyClosingIssue = {
	kind: string
	id: string
	occurredOn: string
	amount: string | null
	status: string
	description: string | null
}

export type MonthlyClosingSummary = {
	companyId: string
	yearMonth: string
	periodStart: string
	periodEnd: string
	status: MonthlyClosingStatus
	closedAt: string | null
	reopenedAt: string | null
	invoiceCount: number
	draftInvoiceCount: number
	journalEntryCount: number
	unpostedJournalEntryCount: number
	salesEventCount: number
	unjournalizedSalesEventCount: number
	paymentReconciliationCount: number
	unreconciledPaymentCount: number
	evidenceTransactionCount: number
	missingEvidenceCount: number
	issueCount: number
	issues: MonthlyClosingIssue[]
}

export type MonthlyClosingResult = {
	summary: MonthlyClosingSummary
	source: DataSource
}

export type CloseReadinessBlocker = {
	kind: string
	label: string
	severity: 'critical' | 'warning'
	count: number
	sourceType: string
	sourceId: string | null
	drilldownPath: string
	drilldownUrl: string
	description: string
	remediationHint: string
	sampleSourceIds: string[]
}

export type CloseReadinessSummary = {
	companyId: string
	yearMonth: string
	periodStart: string
	periodEnd: string
	status: MonthlyClosingStatus
	blockerCount: number
	criticalCount: number
	warningCount: number
	generatedFromIssueCount: number
	blockers: CloseReadinessBlocker[]
}

export type CloseReadinessResult = {
	summary: CloseReadinessSummary
	source: DataSource
}

function asRecord(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return null
	}

	return value as Record<string, unknown>
}

function asString(value: unknown): string | null {
	return typeof value === 'string' && value.length > 0 ? value : null
}

function asNumber(value: unknown): number | null {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return value
	}

	if (typeof value === 'string') {
		const parsed = Number(value)
		return Number.isFinite(parsed) ? parsed : null
	}

	return null
}

function asBoolean(value: unknown): boolean | null {
	if (typeof value === 'boolean') return value
	if (typeof value === 'number') return value !== 0
	if (typeof value === 'string') {
		if (value === 'true' || value === '1') return true
		if (value === 'false' || value === '0') return false
	}
	return null
}

function asArray(value: unknown): unknown[] {
	return Array.isArray(value) ? value : []
}

function safeParseJson<T>(text: string): T | null {
	try {
		return JSON.parse(text) as T
	} catch {
		return null
	}
}

function sumQuantity(lines: DeliveryLine[]): number {
	return lines.reduce((sum, line) => sum + line.quantity, 0)
}

function normalizeDeliveryStatus(value: unknown): DeliveryStatus {
	const raw = (asString(value) ?? 'draft').toLowerCase()

	if (raw.includes('receive') || raw.includes('commit')) {
		return 'received'
	}
	if (raw.includes('ocr') && raw.includes('complete')) {
		return 'ocr_completed'
	}
	if (raw.includes('review') || raw.includes('confirm')) {
		return 'needs_review'
	}
	if (raw.includes('process')) {
		return 'processing'
	}
	if (raw.includes('fail') || raw.includes('error')) {
		return 'failed'
	}

	return 'draft'
}

function normalizeLineItems(value: unknown): DeliveryLine[] {
	return asArray(value)
		.map(item => {
			const record = asRecord(item)
			if (!record) {
				return null
			}

			const quantity = asNumber(
				record.quantity ?? record.qty ?? record.receivedQuantity,
			)
			const skuCode =
				asString(record.skuCode) ??
				asString(record.sku) ??
				asString(record.variantCode) ??
				'UNKNOWN-SKU'

			return {
				id:
					asString(record.id) ??
					asString(record.lineId) ??
					`${skuCode}-${Math.random().toString(36).slice(2, 8)}`,
				skuCode,
				productName:
					asString(record.productName) ??
					asString(record.itemName) ??
					asString(record.name) ??
					'未設定',
				quantity: quantity ?? 0,
				unit:
					asString(record.unit) ??
					asString(record.unitName) ??
					asString(record.uom) ??
					'pcs',
				confidence: asNumber(record.confidence ?? record.score),
				vendorSkuText:
					asString(record.vendorSkuText) ??
					asString(record.vendor_sku_text) ??
					null,
				reviewRequired:
					Boolean(record.reviewRequired ?? record.review_required) ||
					(asNumber(record.confidence ?? record.score) ?? 1) < 0.8,
				warehouseName:
					asString(record.warehouseName) ??
					asString(record.locationName) ??
					null,
				note: asString(record.note) ?? asString(record.memo) ?? null,
				lotNo: asString(record.lotNo) ?? asString(record.lot_no) ?? null,
				receivedAt:
					asString(record.receivedAt) ?? asString(record.received_at) ?? null,
				expiresAt:
					asString(record.expiresAt) ?? asString(record.expires_at) ?? null,
			}
		})
		.filter((item): item is DeliveryLine => item !== null)
}

function normalizeDeliverySummary(value: unknown): DeliverySummary | null {
	const record = asRecord(value)
	if (!record) {
		return null
	}

	const ocrLines = normalizeLineItems(
		record.ocrLines ?? record.ocr_lines ?? record.parsedLines ?? record.lines,
	)
	const receivedLines = normalizeLineItems(
		record.receivedLines ??
			record.receivingLines ??
			record.receiptLines ??
			record.received_lines,
	)

	return {
		id:
			asString(record.id) ??
			asString(record.deliveryId) ??
			asString(record.slipId) ??
			`delivery_${Math.random().toString(36).slice(2, 10)}`,
		status: normalizeDeliveryStatus(record.status),
		supplierName:
			asString(record.supplierName) ??
			asString(record.vendorName) ??
			asString(record.vendor) ??
			'未設定',
		warehouseName:
			asString(record.warehouseName) ??
			asString(record.destinationWarehouseName) ??
			asString(record.locationName) ??
			'未設定',
		documentName:
			asString(record.documentName) ??
			asString(record.fileName) ??
			asString(record.filename) ??
			asString(record.originalFilename) ??
			'納品書',
		uploadedAt:
			asString(record.uploadedAt) ??
			asString(record.createdAt) ??
			new Date().toISOString(),
		receivedAt:
			asString(record.receivedAt) ??
			asString(record.confirmedAt) ??
			asString(record.committedAt) ??
			null,
		lineCount:
			asNumber(record.lineCount) ??
			(ocrLines.length > 0 ? ocrLines.length : receivedLines.length),
		totalQuantity:
			asNumber(record.totalQuantity) ??
			(ocrLines.length > 0
				? sumQuantity(ocrLines)
				: sumQuantity(receivedLines)),
		ocrStatus:
			asString(record.ocrStatus) ??
			asString(record.ocr_state) ??
			(ocrLines.length > 0 ? 'completed' : 'pending'),
		note: asString(record.note) ?? asString(record.memo) ?? null,
		originalObjectKey:
			asString(record.originalObjectKey) ??
			asString(record.original_object_key) ??
			null,
		originalUrl:
			asString(record.originalUrl) ??
			asString(record.original_url) ??
			asString(record.documentUrl) ??
			asString(record.fileUrl) ??
			asString(record.downloadUrl) ??
			null,
		originalSha256:
			asString(record.originalSha256) ??
			asString(record.original_sha256) ??
			null,
		sizeBytes: asNumber(record.sizeBytes ?? record.size_bytes),
		confidence: asNumber(record.confidence ?? record.score),
		reviewRequired:
			Boolean(record.reviewRequired ?? record.review_required) ||
			ocrLines.some(line => line.reviewRequired),
		reviewReasons: asArray(record.reviewReasons ?? record.review_reasons)
			.map(item => asString(item))
			.filter((item): item is string => item !== null),
	}
}

function normalizeDeliveryDetail(value: unknown): DeliveryDetail | null {
	const payload = asRecord(value)
	if (!payload) {
		return null
	}

	const root = asRecord(payload.delivery) ?? payload
	const ocrRoot = asRecord(root.ocrResult) ?? asRecord(payload.ocrResult)
	const receivingRoot =
		asRecord(root.receivingRecord) ?? asRecord(payload.receivingRecord)

	const ocrLines = normalizeLineItems(
		ocrRoot?.lines ??
			root.ocrLines ??
			root.ocr_lines ??
			root.parsedLines ??
			payload.ocrLines,
	)
	const receivedLines = normalizeLineItems(
		receivingRoot?.lines ??
			root.receivedLines ??
			root.receivingLines ??
			payload.receivedLines,
	)

	const summary = normalizeDeliverySummary({
		...root,
		ocrLines,
		receivedLines,
	})

	if (!summary) {
		return null
	}

	return {
		...summary,
		documentUrl:
			summary.originalUrl ??
			asString(root.documentUrl) ??
			asString(root.fileUrl) ??
			asString(root.downloadUrl) ??
			null,
		rawText:
			asString(ocrRoot?.rawText) ??
			asString(root.rawText) ??
			asString(payload.rawText) ??
			null,
		ocrLines,
		receivedLines,
	}
}

function normalizeDiscrepancyStatus(
	value: unknown,
): ReceivingDiscrepancyStatus {
	const raw = (asString(value) ?? 'open').toLowerCase()
	return raw === 'resolved' ? 'resolved' : 'open'
}

function normalizeDiscrepancyAction(
	value: unknown,
): ReceivingDiscrepancyAction {
	const raw = (asString(value) ?? 'record_adjustment').toLowerCase()
	switch (raw) {
		case 'return_to_supplier':
		case 'reorder_required':
		case 'ignore':
			return raw
		default:
			return 'record_adjustment'
	}
}

function normalizeAuditLog(
	value: unknown,
): ReceivingDiscrepancyAuditLog | null {
	const record = asRecord(value)
	if (!record) {
		return null
	}

	return {
		id:
			asString(record.id) ??
			asString(record.auditLogId) ??
			`audit_${Math.random().toString(36).slice(2, 10)}`,
		action: normalizeDiscrepancyAction(record.action),
		note: asString(record.note),
		createdAt:
			asString(record.createdAt) ??
			asString(record.created_at) ??
			new Date().toISOString(),
	}
}

function normalizeReceivingDiscrepancy(
	value: unknown,
): ReceivingDiscrepancy | null {
	const record = asRecord(value)
	if (!record) {
		return null
	}

	const id =
		asString(record.id) ??
		asString(record.discrepancyId) ??
		asString(record.discrepancy_id)
	if (!id) {
		return null
	}

	const sku =
		asString(record.sku) ??
		asString(record.skuCode) ??
		asString(record.variantCode) ??
		'UNKNOWN-SKU'

	return {
		id,
		tenantId:
			asString(record.tenantId) ??
			asString(record.tenant_id) ??
			'unknown-tenant',
		receivingRecordId:
			asString(record.receivingRecordId) ??
			asString(record.receiving_record_id) ??
			'unknown-receiving-record',
		slipId:
			asString(record.slipId) ??
			asString(record.slip_id) ??
			asString(record.deliverySlipId) ??
			'unknown-slip',
		sku,
		expectedQuantity:
			asNumber(record.expectedQuantity ?? record.expected_quantity) ?? 0,
		actualQuantity:
			asNumber(record.actualQuantity ?? record.actual_quantity) ?? 0,
		kind:
			asString(record.kind) ??
			asString(record.discrepancyKind) ??
			'qty_mismatch',
		status: normalizeDiscrepancyStatus(record.status),
		notedAt:
			asString(record.notedAt) ??
			asString(record.noted_at) ??
			new Date().toISOString(),
		resolvedAt: asString(record.resolvedAt) ?? asString(record.resolved_at),
		resolutionNote:
			asString(record.resolutionNote) ?? asString(record.resolution_note),
		auditLogs: asArray(record.auditLogs ?? record.audit_logs)
			.map(item => normalizeAuditLog(item))
			.filter((item): item is ReceivingDiscrepancyAuditLog => item !== null),
	}
}

function normalizeLowStockAlert(value: unknown): LowStockAlert | null {
	const record = asRecord(value)
	if (!record) return null
	const stockItemId =
		asString(record.stockItemId) ?? asString(record.stock_item_id)
	const skuCode = asString(record.skuCode) ?? asString(record.sku)
	const warehouseId =
		asString(record.warehouseId) ?? asString(record.warehouse_id)
	if (!stockItemId || !skuCode || !warehouseId) return null

	const status = asString(record.decisionStatus) ?? 'pending'
	const decisionStatus: LowStockDecisionStatus =
		status === 'on_hold' || status === 'purchase_candidate' ? status : 'pending'

	return {
		stockItemId,
		stockLevelId:
			asString(record.stockLevelId) ??
			asString(record.id) ??
			`stl_${stockItemId}`,
		skuCode,
		productName:
			asString(record.productName) ?? asString(record.name) ?? skuCode,
		warehouseId,
		warehouseName:
			asString(record.warehouseName) ??
			asString(record.locationName) ??
			warehouseId,
		quantityOnHand: asNumber(record.quantityOnHand ?? record.onHand) ?? 0,
		safetyStockQuantity: asNumber(record.safetyStockQuantity) ?? 0,
		reorderPointQuantity: asNumber(record.reorderPointQuantity) ?? 0,
		replenishmentTargetQuantity:
			asNumber(record.replenishmentTargetQuantity) ?? 0,
		preferredOrderQuantity: asNumber(record.preferredOrderQuantity),
		recommendedOrderQuantity: asNumber(record.recommendedOrderQuantity) ?? 0,
		shortageQuantity: asNumber(record.shortageQuantity) ?? 0,
		decisionStatus,
		decisionNote: asString(record.decisionNote),
		decidedAt: asString(record.decidedAt),
		decidedBy: asString(record.decidedBy),
		updatedAt:
			asString(record.updatedAt) ??
			asString(record.lastUpdatedAt) ??
			new Date().toISOString(),
	}
}

function normalizeStockMovement(value: unknown): StockMovement | null {
	const record = asRecord(value)
	if (!record) return null
	const stockItemId =
		asString(record.stockItemId) ?? asString(record.stock_item_id)
	const sku = asString(record.sku) ?? asString(record.skuCode)
	const warehouseId =
		asString(record.warehouseId) ?? asString(record.warehouse_id)
	const quantity = asNumber(record.quantity)
	const signedQuantity = asNumber(
		record.signedQuantity ?? record.signed_quantity,
	)
	if (!stockItemId || !sku || !warehouseId || quantity === null) {
		return null
	}
	const direction =
		asString(record.direction) === 'decrease' ? 'decrease' : 'increase'
	const fallbackSignedQuantity = direction === 'decrease' ? -quantity : quantity
	return {
		id: asString(record.id) ?? `smv_${Math.random().toString(36).slice(2, 10)}`,
		stockItemId,
		sku,
		warehouseId,
		warehouseName:
			asString(record.warehouseName) ??
			asString(record.warehouse_name) ??
			warehouseId,
		direction,
		quantity,
		signedQuantity: signedQuantity ?? fallbackSignedQuantity,
		sourceEvent:
			asString(record.sourceEvent) ??
			asString(record.source_event) ??
			'unknown',
		sourceEventLabel:
			asString(record.sourceEventLabel) ??
			asString(record.source_event_label) ??
			asString(record.sourceEvent) ??
			asString(record.source_event) ??
			'不明',
		referenceType:
			asString(record.referenceType) ?? asString(record.reference_type),
		referenceId: asString(record.referenceId) ?? asString(record.reference_id),
		operatorId: asString(record.operatorId) ?? asString(record.operator_id),
		occurredAt:
			asString(record.occurredAt) ??
			asString(record.occurred_at) ??
			asString(record.createdAt) ??
			new Date().toISOString(),
	}
}

function normalizeStore(value: unknown): InventoryStore | null {
	const record = asRecord(value)
	if (!record) return null
	return {
		id: asString(record.id) ?? `sto_${Math.random().toString(36).slice(2, 10)}`,
		kind: asString(record.kind) ?? 'retail_store',
		name: asString(record.name) ?? '未設定',
		address: asString(record.address),
		businessHours:
			asString(record.businessHours) ?? asString(record.business_hours),
		posLocationId:
			asString(record.posLocationId) ?? asString(record.pos_location_id),
		createdAt:
			asString(record.createdAt) ??
			asString(record.created_at) ??
			new Date().toISOString(),
		updatedAt:
			asString(record.updatedAt) ??
			asString(record.updated_at) ??
			new Date().toISOString(),
	}
}

function normalizeInventoryLocation(value: unknown): InventoryLocation | null {
	const record = asRecord(value)
	if (!record) return null
	const kind = asString(record.kind) === 'store' ? 'store' : 'warehouse'
	const id = asString(record.id) ?? asString(record.referenceId)
	if (!id) return null
	return {
		id,
		kind,
		referenceId:
			asString(record.referenceId) ?? asString(record.reference_id) ?? id,
		name: asString(record.name) ?? '未設定',
		stockHolding: record.stockHolding !== false,
		createdAt:
			asString(record.createdAt) ??
			asString(record.created_at) ??
			new Date().toISOString(),
		updatedAt:
			asString(record.updatedAt) ??
			asString(record.updated_at) ??
			new Date().toISOString(),
	}
}

function normalizeStockTransfer(value: unknown): StockTransfer | null {
	const record = asRecord(value)
	if (!record) return null
	const sku = asString(record.sku)
	const fromLocationId =
		asString(record.fromLocationId) ?? asString(record.from_location_id)
	const toLocationId =
		asString(record.toLocationId) ?? asString(record.to_location_id)
	const quantity = asNumber(record.quantity)
	if (!sku || !fromLocationId || !toLocationId || quantity === null) {
		return null
	}
	return {
		id: asString(record.id) ?? `stf_${Math.random().toString(36).slice(2, 10)}`,
		sku,
		fromLocationId,
		toLocationId,
		quantity,
		reason: asString(record.reason),
		transferredAt:
			asString(record.transferredAt) ??
			asString(record.transferred_at) ??
			new Date().toISOString(),
		createdAt:
			asString(record.createdAt) ??
			asString(record.created_at) ??
			new Date().toISOString(),
		createdBy: asString(record.createdBy) ?? asString(record.created_by),
		status: asString(record.status) ?? 'completed',
	}
}

function normalizeRolloutStatus(
	value: unknown,
): TachyonFieldErpRolloutStatus | null {
	const record = asRecord(value)
	if (!record) return null

	const tenantId = asString(record.tenantId) ?? asString(record.tenant_id)
	const mode = asString(record.mode)
	const enabled = asBoolean(record.enabled)
	const allowlisted = asBoolean(record.allowlisted)

	if (
		!tenantId ||
		(mode !== 'disabled' && mode !== 'allowlist' && mode !== 'all') ||
		enabled === null ||
		allowlisted === null
	) {
		return null
	}

	return {
		tenantId,
		mode,
		enabled,
		allowlisted,
		sources: asArray(record.sources).flatMap(source =>
			typeof source === 'string' ? [source] : [],
		),
	}
}

function normalizeSalesEvent(value: unknown): AccountingSalesEvent | null {
	const record = asRecord(value)
	if (!record) return null
	const id = asString(record.id)
	const provider = asString(record.provider)
	const eventType = asString(record.eventType) ?? asString(record.event_type)
	const externalId = asString(record.externalId) ?? asString(record.external_id)
	const grossAmount =
		asString(record.grossAmount) ?? asString(record.gross_amount)
	const feeAmount = asString(record.feeAmount) ?? asString(record.fee_amount)
	const netAmount = asString(record.netAmount) ?? asString(record.net_amount)
	const taxAmount = asString(record.taxAmount) ?? asString(record.tax_amount)
	const currency = asString(record.currency) ?? 'JPY'
	const status = asString(record.status)
	const eventDate = asString(record.eventDate) ?? asString(record.event_date)
	if (
		!id ||
		!provider ||
		!eventType ||
		!externalId ||
		!grossAmount ||
		!feeAmount ||
		!netAmount ||
		!taxAmount ||
		!status ||
		!eventDate
	) {
		return null
	}
	return {
		id,
		provider,
		eventType,
		externalId,
		grossAmount,
		feeAmount,
		netAmount,
		taxAmount,
		currency,
		description: asString(record.description) ?? asString(record.memo) ?? null,
		journalEntryId:
			asString(record.journalEntryId) ??
			asString(record.journal_entry_id) ??
			null,
		status,
		eventDate,
	}
}

function normalizePaymentReconciliation(
	value: unknown,
): AccountingPaymentReconciliation | null {
	const record = asRecord(value)
	if (!record) return null
	const id = asString(record.id)
	const provider = asString(record.provider)
	const payoutId = asString(record.payoutId) ?? asString(record.payout_id)
	const depositAmount =
		asString(record.depositAmount) ?? asString(record.deposit_amount)
	const depositDate =
		asString(record.depositDate) ?? asString(record.deposit_date)
	const status = asString(record.status)
	if (
		!id ||
		!provider ||
		!payoutId ||
		!depositAmount ||
		!depositDate ||
		!status
	) {
		return null
	}
	return {
		id,
		provider,
		payoutId,
		depositAmount,
		depositDate,
		journalEntryId:
			asString(record.journalEntryId) ??
			asString(record.journal_entry_id) ??
			null,
		status,
	}
}

function normalizeMonthlyClosingIssue(
	value: unknown,
): MonthlyClosingIssue | null {
	const record = asRecord(value)
	if (!record) return null
	const id = asString(record.id)
	const kind = asString(record.kind)
	const occurredOn = asString(record.occurredOn) ?? asString(record.occurred_on)
	const status = asString(record.status)
	if (!id || !kind || !occurredOn || !status) {
		return null
	}
	return {
		id,
		kind,
		occurredOn,
		amount: asString(record.amount),
		status,
		description: asString(record.description),
	}
}

function normalizeMonthlyClosingStatus(value: unknown): MonthlyClosingStatus {
	const raw = (asString(value) ?? 'open').toLowerCase()
	if (raw === 'closed') return 'closed'
	if (raw === 'reopened') return 'reopened'
	return 'open'
}

function normalizeMonthlyClosingSummary(
	value: unknown,
	companyId: string,
	yearMonth: string,
): MonthlyClosingSummary | null {
	const record = asRecord(value)
	if (!record) return null
	const root = asRecord(record.summary) ?? record
	const issues = asArray(root.issues)
		.map(item => normalizeMonthlyClosingIssue(item))
		.filter((item): item is MonthlyClosingIssue => item !== null)

	return {
		companyId:
			asString(root.companyId) ?? asString(root.company_id) ?? companyId,
		yearMonth:
			asString(root.yearMonth) ?? asString(root.year_month) ?? yearMonth,
		periodStart:
			asString(root.periodStart) ??
			asString(root.period_start) ??
			`${yearMonth}-01`,
		periodEnd:
			asString(root.periodEnd) ??
			asString(root.period_end) ??
			`${yearMonth}-28`,
		status: normalizeMonthlyClosingStatus(root.status),
		closedAt: asString(root.closedAt) ?? asString(root.closed_at),
		reopenedAt: asString(root.reopenedAt) ?? asString(root.reopened_at),
		invoiceCount: asNumber(root.invoiceCount ?? root.invoice_count) ?? 0,
		draftInvoiceCount:
			asNumber(root.draftInvoiceCount ?? root.draft_invoice_count) ?? 0,
		journalEntryCount:
			asNumber(root.journalEntryCount ?? root.journal_entry_count) ?? 0,
		unpostedJournalEntryCount:
			asNumber(
				root.unpostedJournalEntryCount ?? root.unposted_journal_entry_count,
			) ?? 0,
		salesEventCount:
			asNumber(root.salesEventCount ?? root.sales_event_count) ?? 0,
		unjournalizedSalesEventCount:
			asNumber(
				root.unjournalizedSalesEventCount ??
					root.unjournalized_sales_event_count,
			) ?? 0,
		paymentReconciliationCount:
			asNumber(
				root.paymentReconciliationCount ?? root.payment_reconciliation_count,
			) ?? 0,
		unreconciledPaymentCount:
			asNumber(
				root.unreconciledPaymentCount ?? root.unreconciled_payment_count,
			) ?? 0,
		evidenceTransactionCount:
			asNumber(
				root.evidenceTransactionCount ?? root.evidence_transaction_count,
			) ?? 0,
		missingEvidenceCount:
			asNumber(root.missingEvidenceCount ?? root.missing_evidence_count) ?? 0,
		issueCount: asNumber(root.issueCount ?? root.issue_count) ?? issues.length,
		issues,
	}
}

function normalizeCloseReadinessBlocker(
	value: unknown,
): CloseReadinessBlocker | null {
	const record = asRecord(value)
	if (!record) return null
	const kind = asString(record.kind) ?? asString(record.category)
	const label = asString(record.label)
	const severity = asString(record.severity)
	const drilldownPath =
		asString(record.drilldownPath) ?? asString(record.drilldown_path)
	const sourceType = asString(record.sourceType) ?? asString(record.source_type)
	if (!kind || !label || !drilldownPath || !sourceType) {
		return null
	}
	return {
		kind,
		label,
		severity: severity === 'warning' ? 'warning' : 'critical',
		count: asNumber(record.count) ?? 0,
		sourceType,
		sourceId: asString(record.sourceId) ?? asString(record.source_id),
		drilldownPath,
		drilldownUrl:
			asString(record.drilldownUrl) ??
			asString(record.drilldown_url) ??
			drilldownPath,
		description: asString(record.description) ?? '',
		remediationHint:
			asString(record.remediationHint) ??
			asString(record.remediation_hint) ??
			'対象レコードを確認し、未完了の処理を解消してください。',
		sampleSourceIds: asArray(record.sampleSourceIds ?? record.sample_source_ids)
			.map(item => asString(item))
			.filter((item): item is string => item !== null),
	}
}

function normalizeCloseReadinessSummary(
	value: unknown,
	companyId: string,
	yearMonth: string,
): CloseReadinessSummary | null {
	const record = asRecord(value)
	if (!record) return null
	const root = asRecord(record.summary) ?? asRecord(record.drilldown) ?? record
	const blockers = asArray(root.blockers ?? root.categories)
		.map(item => normalizeCloseReadinessBlocker(item))
		.filter((item): item is CloseReadinessBlocker => item !== null)

	return {
		companyId:
			asString(root.companyId) ?? asString(root.company_id) ?? companyId,
		yearMonth:
			asString(root.yearMonth) ?? asString(root.year_month) ?? yearMonth,
		periodStart:
			asString(root.periodStart) ??
			asString(root.period_start) ??
			`${yearMonth}-01`,
		periodEnd:
			asString(root.periodEnd) ??
			asString(root.period_end) ??
			`${yearMonth}-28`,
		status: normalizeMonthlyClosingStatus(root.status),
		blockerCount:
			asNumber(root.blockerCount ?? root.blocker_count) ?? blockers.length,
		criticalCount:
			asNumber(root.criticalCount ?? root.critical_count) ??
			blockers
				.filter(blocker => blocker.severity === 'critical')
				.reduce((total, blocker) => total + blocker.count, 0),
		warningCount:
			asNumber(root.warningCount ?? root.warning_count) ??
			blockers
				.filter(blocker => blocker.severity === 'warning')
				.reduce((total, blocker) => total + blocker.count, 0),
		generatedFromIssueCount:
			asNumber(
				root.generatedFromIssueCount ?? root.generated_from_issue_count,
			) ?? 0,
		blockers,
	}
}

function getHeaders(tenant: string, accessToken: string) {
	const mode = getModeFromOperatorId(tenant)
	return {
		'x-platform-id': getPlatformIdForMode(mode),
		'x-operator-id': tenant,
		Authorization: `Bearer ${accessToken}`,
	}
}

async function erpFetch(
	tenant: string,
	path: string,
	init?: RequestInit,
): Promise<Response> {
	const session = await authWithCheck()
	if (!session?.accessToken) {
		throw new Error('認証セッションが見つかりません')
	}
	return fetch(joinServerBackendPath(path), {
		...init,
		headers: {
			...getHeaders(tenant, session.accessToken),
			...(init?.headers ?? {}),
		},
	})
}

async function accountingFetch(
	tenant: string,
	path: string,
): Promise<Response> {
	const session = await authWithCheck()
	if (!session?.accessToken) {
		throw new Error('認証セッションが見つかりません')
	}
	return fetch(`${ACCOUNTING_API_BASE_URL}${path}`, {
		headers: getHeaders(tenant, session.accessToken),
	})
}

async function extractErrorMessage(
	response: Response,
	fallbackMessage: string,
): Promise<string> {
	const text = await response.text()
	const json = safeParseJson<Record<string, unknown>>(text)

	if (!json) {
		return text || fallbackMessage
	}

	const errors = asArray(json.errors)
	const firstError = errors.length > 0 ? asRecord(errors[0]) : null

	return (
		asString(json.message) ??
		asString(json.error) ??
		asString(firstError?.message) ??
		text ??
		fallbackMessage
	)
}

export async function getTachyonFieldErpRolloutStatus(
	tenant: string,
): Promise<TachyonFieldErpRolloutStatusResult> {
	try {
		const response = await erpFetch(tenant, '/v1/field/rollout/status')
		if (!response.ok) {
			return {
				item: null,
				source: 'api',
				errorMessage: await extractErrorMessage(
					response,
					'ERP rollout status could not be loaded',
				),
			}
		}

		const text = await response.text()
		const item = normalizeRolloutStatus(text ? safeParseJson(text) : null)
		return { item, source: 'api', errorMessage: null }
	} catch (error) {
		return {
			item: null,
			source: 'api',
			errorMessage:
				error instanceof Error
					? error.message
					: 'ERP rollout status could not be loaded',
		}
	}
}

async function tryRequestCandidates(
	tenant: string,
	candidates: Array<{
		path: string
		method?: 'GET' | 'POST' | 'PATCH' | 'PUT'
		bodyFactory?: () => BodyInit | undefined
		headers?: HeadersInit
	}>,
	fallbackMessage: string,
): Promise<unknown | null> {
	let lastErrorMessage = fallbackMessage

	for (let index = 0; index < candidates.length; index += 1) {
		const candidate = candidates[index]
		const response = await erpFetch(tenant, candidate.path, {
			method: candidate.method,
			body: candidate.bodyFactory?.(),
			headers: candidate.headers,
		})

		if (response.ok) {
			const text = await response.text()
			return text ? (safeParseJson(text) ?? text) : null
		}

		lastErrorMessage = await extractErrorMessage(response, fallbackMessage)
		const hasNextCandidate = index < candidates.length - 1
		if (
			hasNextCandidate &&
			(response.status === 404 || response.status === 405)
		) {
			continue
		}

		throw new Error(lastErrorMessage)
	}

	throw new Error(lastErrorMessage)
}

async function tryAccountingRequest(
	tenant: string,
	path: string,
	fallbackMessage: string,
): Promise<unknown | null> {
	const response = await accountingFetch(tenant, path)
	if (response.ok) {
		const text = await response.text()
		return text ? (safeParseJson(text) ?? text) : null
	}
	throw new Error(await extractErrorMessage(response, fallbackMessage))
}

export async function listDeliveries(
	tenant: string,
): Promise<DeliveryListResult> {
	const payload = await tryRequestCandidates(
		tenant,
		[
			{ path: '/v1/field/procurement/deliveries', method: 'GET' },
			{ path: '/v1/field/procurement/delivery-slips', method: 'GET' },
		],
		'納品書一覧の取得に失敗しました',
	)

	const record = asRecord(payload)
	const items = asArray(
		record?.items ?? record?.deliveries ?? record?.deliverySlips ?? payload,
	)
		.map(item => normalizeDeliverySummary(item))
		.filter((item): item is DeliverySummary => item !== null)

	return { items, source: 'api' }
}

export async function getDeliveryDetail(
	tenant: string,
	id: string,
): Promise<DeliveryDetailResult> {
	const payload = await tryRequestCandidates(
		tenant,
		[
			{
				path: `/v1/field/procurement/deliveries/${id}`,
				method: 'GET',
			},
			{
				path: `/v1/field/procurement/delivery-slips/${id}`,
				method: 'GET',
			},
		],
		'納品書詳細の取得に失敗しました',
	)

	return {
		item: payload ? normalizeDeliveryDetail(payload) : null,
		source: 'api',
	}
}

export async function listReceivingDiscrepancies(
	tenant: string,
	status?: ReceivingDiscrepancyStatus,
): Promise<ReceivingDiscrepancyListResult> {
	const query = status ? `?status=${encodeURIComponent(status)}` : ''
	const payload = await tryRequestCandidates(
		tenant,
		[
			{
				path: `/v1/field/receiving/discrepancies${query}`,
				method: 'GET',
			},
		],
		'検収差異一覧の取得に失敗しました',
	)

	const record = asRecord(payload)
	const items = asArray(record?.items ?? record?.discrepancies ?? payload)
		.map(item => normalizeReceivingDiscrepancy(item))
		.filter((item): item is ReceivingDiscrepancy => item !== null)

	return {
		items: items.sort((a, b) => b.notedAt.localeCompare(a.notedAt)),
		source: 'api',
	}
}

export async function resolveReceivingDiscrepancy(
	tenant: string,
	id: string,
	params: {
		action: ReceivingDiscrepancyAction
		note?: string
	},
): Promise<{ source: DataSource }> {
	const requestBody = JSON.stringify({
		action: params.action,
		note: params.note?.trim() || null,
	})
	await tryRequestCandidates(
		tenant,
		[
			{
				path: `/v1/field/receiving/discrepancies/${id}/resolve`,
				method: 'POST',
				bodyFactory: () => requestBody,
				headers: { 'Content-Type': 'application/json' },
			},
		],
		'検収差異の解消に失敗しました',
	)

	return { source: 'api' }
}

export async function uploadDelivery(
	tenant: string,
	params: {
		document: File
		supplierName?: string
		warehouseName?: string
		note?: string
	},
): Promise<{ id: string; source: DataSource }> {
	const fileBytes = new Uint8Array(await params.document.arrayBuffer())
	const contentBase64 = Buffer.from(fileBytes).toString('base64')

	const payload = await tryRequestCandidates(
		tenant,
		[
			{
				path: '/v1/field/procurement/deliveries',
				method: 'POST',
				bodyFactory: () =>
					JSON.stringify({
						fileName: params.document.name || 'uploaded-delivery-slip.pdf',
						contentType: params.document.type || 'application/octet-stream',
						contentBase64,
					}),
				headers: { 'Content-Type': 'application/json' },
			},
			{
				path: '/v1/field/procurement/delivery-slips',
				method: 'POST',
				bodyFactory: () =>
					JSON.stringify({
						fileName: params.document.name || 'uploaded-delivery-slip.pdf',
						contentType: params.document.type || 'application/octet-stream',
						contentBase64,
					}),
				headers: { 'Content-Type': 'application/json' },
			},
		],
		'納品書のアップロードに失敗しました',
	)

	const record = asRecord(payload)
	const id =
		asString(record?.deliverySlipId) ??
		asString(record?.delivery_slip_id) ??
		asString(record?.id)
	if (id) {
		return { id, source: 'api' }
	}

	const detail =
		normalizeDeliveryDetail(payload) ??
		normalizeDeliveryDetail(record?.delivery)
	if (detail) {
		return { id: detail.id, source: 'api' }
	}

	throw new Error('アップロード結果から納品書IDを取得できませんでした')
}

export async function commitDeliveryReceiving(
	tenant: string,
	id: string,
	lines: Array<{
		sku: string
		quantity: number
		lotNo?: string | null
		receivedAt?: string | null
		expiresAt?: string | null
	}>,
): Promise<{ source: DataSource }> {
	const requestBody = JSON.stringify({ lines })
	await tryRequestCandidates(
		tenant,
		[
			{
				path: `/v1/field/procurement/deliveries/${id}/receipt`,
				method: 'POST',
				bodyFactory: () => requestBody,
				headers: { 'Content-Type': 'application/json' },
			},
			{
				path: `/v1/field/procurement/deliveries/${id}/receive`,
				method: 'POST',
				bodyFactory: () => requestBody,
				headers: { 'Content-Type': 'application/json' },
			},
			{
				path: `/v1/field/procurement/deliveries/${id}/confirm`,
				method: 'POST',
				bodyFactory: () => requestBody,
				headers: { 'Content-Type': 'application/json' },
			},
			{
				path: `/v1/field/procurement/delivery-slips/${id}/receive`,
				method: 'POST',
				bodyFactory: () => requestBody,
				headers: { 'Content-Type': 'application/json' },
			},
		],
		'検収確定に失敗しました',
	)

	return { source: 'api' }
}

export async function listStockLevels(
	tenant: string,
	locationId?: string,
): Promise<StockLevelListResult> {
	const query = locationId
		? `?location_id=${encodeURIComponent(locationId)}`
		: ''
	const payload = await tryRequestCandidates(
		tenant,
		[
			{ path: `/v1/bakuure/inventory/stock-levels${query}`, method: 'GET' },
			{ path: `/v1/field/inventory/stock-levels${query}`, method: 'GET' },
			{ path: '/v1/field/inventory/stock_levels', method: 'GET' },
			{ path: '/v1/field/inventory', method: 'GET' },
		],
		'在庫一覧の取得に失敗しました',
	)

	const record = asRecord(payload)
	const items = asArray(
		record?.items ?? record?.stockLevels ?? record?.data ?? payload,
	)
		.map(item => normalizeStockLevel(item))
		.filter((item): item is StockLevel => item !== null)

	return { items, source: 'api' }
}

export async function listLowStockAlerts(
	tenant: string,
	params: {
		warehouseId?: string
		sku?: string
		status?: LowStockDecisionStatus
	} = {},
): Promise<LowStockAlertListResult> {
	const query = new URLSearchParams()
	if (params.warehouseId) query.set('warehouse_id', params.warehouseId)
	if (params.sku) query.set('sku', params.sku)
	if (params.status) query.set('status', params.status)
	const suffix = query.toString() ? `?${query.toString()}` : ''

	const payload = await tryRequestCandidates(
		tenant,
		[
			{
				path: `/v1/bakuure/inventory/low-stock-alerts${suffix}`,
				method: 'GET',
			},
			{
				path: `/v1/field/inventory/low-stock-alerts${suffix}`,
				method: 'GET',
			},
		],
		'低在庫アラートの取得に失敗しました',
	)

	const record = asRecord(payload)
	const items = asArray(record?.items ?? payload)
		.map(item => normalizeLowStockAlert(item))
		.filter((item): item is LowStockAlert => item !== null)
	return { items, source: 'api' }
}

export async function updateLowStockDecision(
	tenant: string,
	stockItemId: string,
	input: { status: LowStockDecisionStatus; note?: string },
): Promise<LowStockAlert> {
	const payload = await tryRequestCandidates(
		tenant,
		[
			{
				path: `/v1/bakuure/inventory/low-stock-alerts/${encodeURIComponent(
					stockItemId,
				)}/decision`,
				method: 'PATCH',
				bodyFactory: () => JSON.stringify(input),
				headers: { 'Content-Type': 'application/json' },
			},
			{
				path: `/v1/field/inventory/low-stock-alerts/${encodeURIComponent(
					stockItemId,
				)}/decision`,
				method: 'PATCH',
				bodyFactory: () => JSON.stringify(input),
				headers: { 'Content-Type': 'application/json' },
			},
		],
		'補充判断の更新に失敗しました',
	)

	if (payload) {
		const alert = normalizeLowStockAlert(payload)
		if (alert) return alert
	}

	throw new Error('補充判断の更新結果を取得できませんでした')
}

export async function listStockMovements(
	tenant: string,
	params: {
		stockItemId?: string
		warehouseId?: string
		sku?: string
		sourceEvent?: string
		limit?: number
	} = {},
): Promise<StockMovementListResult> {
	const query = new URLSearchParams()
	if (params.stockItemId) query.set('stock_item_id', params.stockItemId)
	if (params.warehouseId) query.set('warehouse_id', params.warehouseId)
	if (params.sku) query.set('sku', params.sku)
	if (params.sourceEvent) query.set('source_event', params.sourceEvent)
	if (params.limit) query.set('limit', String(params.limit))

	const queryString = query.toString()
	const suffix = queryString ? `?${queryString}` : ''
	const payload = await tryRequestCandidates(
		tenant,
		[
			{
				path: `/v1/field/inventory/stock-movements${suffix}`,
				method: 'GET',
			},
		],
		'在庫移動履歴の取得に失敗しました',
	)

	const record = asRecord(payload)
	const items = asArray(record?.items ?? payload)
		.map(item => normalizeStockMovement(item))
		.filter((item): item is StockMovement => item !== null)
	return { items, source: 'api' }
}

export async function getMonthlyClosingSummary(
	tenant: string,
	params: { companyId: string; yearMonth: string },
): Promise<MonthlyClosingResult> {
	const query = new URLSearchParams({
		companyId: params.companyId,
		yearMonth: params.yearMonth,
	})
	const payload = await tryRequestCandidates(
		tenant,
		[
			{
				path: `/v1/erp/monthly-closes/${encodeURIComponent(params.yearMonth)}`,
				method: 'GET',
			},
			{
				path: `/v1/accounting/monthly-closing?${query.toString()}`,
				method: 'GET',
			},
		],
		'月次締めサマリーの取得に失敗しました',
	)

	if (payload) {
		const summary = normalizeMonthlyClosingSummary(
			payload,
			params.companyId,
			params.yearMonth,
		)
		if (summary) {
			return { summary, source: 'api' }
		}
	}

	throw new Error('月次締めサマリーのレスポンス形式が不正です')
}

export async function getCloseReadinessSummary(
	tenant: string,
	params: { companyId: string; yearMonth: string },
): Promise<CloseReadinessResult> {
	const payload = await tryRequestCandidates(
		tenant,
		[
			{
				path: `/v1/erp/monthly-closes/${encodeURIComponent(params.yearMonth)}/close-readiness/drilldown`,
				method: 'GET',
			},
			{
				path: `/v1/erp/monthly-closes/${encodeURIComponent(params.yearMonth)}/close-readiness`,
				method: 'GET',
			},
		],
		'締め前コックピットの取得に失敗しました',
	)

	if (payload) {
		const summary = normalizeCloseReadinessSummary(
			payload,
			params.companyId,
			params.yearMonth,
		)
		if (summary) {
			return { summary, source: 'api' }
		}
	}

	throw new Error('締め前コックピットのレスポンス形式が不正です')
}

export async function closeMonthlyClosing(
	tenant: string,
	params: { companyId: string; yearMonth: string; note?: string },
): Promise<MonthlyClosingResult> {
	const payload = await tryRequestCandidates(
		tenant,
		[
			{
				path: `/v1/erp/monthly-closes/${encodeURIComponent(params.yearMonth)}/close`,
				method: 'POST',
				bodyFactory: () =>
					JSON.stringify({
						reason: params.note,
					}),
				headers: { 'Content-Type': 'application/json' },
			},
			{
				path: '/v1/accounting/monthly-closing/close',
				method: 'POST',
				bodyFactory: () => JSON.stringify(params),
				headers: { 'Content-Type': 'application/json' },
			},
		],
		'月次締めの確定に失敗しました',
	)
	if (payload) {
		const summary = normalizeMonthlyClosingSummary(
			payload,
			params.companyId,
			params.yearMonth,
		)
		if (summary) return { summary, source: 'api' }
	}
	throw new Error('月次締め確定のレスポンス形式が不正です')
}

export async function reopenMonthlyClosing(
	tenant: string,
	params: { companyId: string; yearMonth: string; note?: string },
): Promise<MonthlyClosingResult> {
	const payload = await tryRequestCandidates(
		tenant,
		[
			{
				path: `/v1/erp/monthly-closes/${encodeURIComponent(params.yearMonth)}/reopen`,
				method: 'POST',
				bodyFactory: () =>
					JSON.stringify({
						reason: params.note,
					}),
				headers: { 'Content-Type': 'application/json' },
			},
			{
				path: '/v1/accounting/monthly-closing/reopen',
				method: 'POST',
				bodyFactory: () => JSON.stringify(params),
				headers: { 'Content-Type': 'application/json' },
			},
		],
		'月次締めの再オープンに失敗しました',
	)
	if (payload) {
		const summary = normalizeMonthlyClosingSummary(
			payload,
			params.companyId,
			params.yearMonth,
		)
		if (summary) return { summary, source: 'api' }
	}
	throw new Error('月次締め再オープンのレスポンス形式が不正です')
}

export async function listInventoryStores(
	tenant: string,
): Promise<InventoryStoreListResult> {
	const payload = await tryRequestCandidates(
		tenant,
		[{ path: '/v1/field/inventory/stores', method: 'GET' }],
		'店舗一覧の取得に失敗しました',
	)
	const record = asRecord(payload)
	const items = asArray(record?.items ?? payload)
		.map(item => normalizeStore(item))
		.filter((item): item is InventoryStore => item !== null)
	return { items, source: 'api' }
}

export async function createInventoryStore(
	tenant: string,
	params: {
		name: string
		address?: string
		businessHours?: string
		posLocationId?: string
	},
): Promise<{ source: DataSource }> {
	const body = JSON.stringify(params)
	await tryRequestCandidates(
		tenant,
		[
			{
				path: '/v1/field/inventory/stores',
				method: 'POST',
				bodyFactory: () => body,
				headers: { 'Content-Type': 'application/json' },
			},
		],
		'店舗の作成に失敗しました',
	)
	return { source: 'api' }
}

export async function listInventoryLocations(
	tenant: string,
): Promise<InventoryLocationListResult> {
	const payload = await tryRequestCandidates(
		tenant,
		[{ path: '/v1/field/inventory/locations', method: 'GET' }],
		'拠点一覧の取得に失敗しました',
	)
	const record = asRecord(payload)
	const items = asArray(record?.items ?? payload)
		.map(item => normalizeInventoryLocation(item))
		.filter((item): item is InventoryLocation => item !== null)
	return { items, source: 'api' }
}

export async function listStockTransfers(
	tenant: string,
): Promise<StockTransferListResult> {
	const payload = await tryRequestCandidates(
		tenant,
		[{ path: '/v1/field/inventory/stock-transfers', method: 'GET' }],
		'在庫移動履歴の取得に失敗しました',
	)
	const record = asRecord(payload)
	const items = asArray(record?.items ?? payload)
		.map(item => normalizeStockTransfer(item))
		.filter((item): item is StockTransfer => item !== null)
	return { items, source: 'api' }
}

export async function listAccountingCloseReview(
	tenant: string,
	companyId: string,
): Promise<AccountingCloseReviewResult> {
	if (!companyId.trim()) {
		throw new Error('Company ID が指定されていません')
	}

	const params = new URLSearchParams({
		companyId,
		limit: '100',
		offset: '0',
	})
	const [salesPayload, reconciliationPayload] = await Promise.all([
		tryAccountingRequest(
			tenant,
			`/v1/accounting/sales-events?${params}`,
			'売上イベントの取得に失敗しました',
		),
		tryAccountingRequest(
			tenant,
			`/v1/accounting/reconciliations?${params}`,
			'支払照合の取得に失敗しました',
		),
	])

	const salesRoot = asRecord(salesPayload)
	const reconciliationRoot = asRecord(reconciliationPayload)
	return {
		source: 'api',
		salesEvents: asArray(salesRoot?.items ?? salesPayload)
			.map(item => normalizeSalesEvent(item))
			.filter((item): item is AccountingSalesEvent => item !== null),
		reconciliations: asArray(reconciliationRoot?.items ?? reconciliationPayload)
			.map(item => normalizePaymentReconciliation(item))
			.filter((item): item is AccountingPaymentReconciliation => item !== null),
	}
}

export async function createStockTransfer(
	tenant: string,
	params: {
		sku: string
		fromLocationId: string
		toLocationId: string
		quantity: number
		reason?: string
		transferredAt?: string
	},
): Promise<{ source: DataSource }> {
	const body = JSON.stringify(params)
	await tryRequestCandidates(
		tenant,
		[
			{
				path: '/v1/field/inventory/stock-transfers',
				method: 'POST',
				bodyFactory: () => body,
				headers: { 'Content-Type': 'application/json' },
			},
		],
		'在庫移動の作成に失敗しました',
	)
	return { source: 'api' }
}
