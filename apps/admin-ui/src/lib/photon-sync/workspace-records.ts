import {
	createPendingOperation,
	type CreatePendingOperationInput,
} from './operation-log'
import type {
	PendingOperation,
	PhotonSyncDomain,
	PhotonSyncMutationType,
	PhotonSyncTenantScope,
} from './types'

export type PhotonWorkspaceRecordStatus =
	| 'backlog'
	| 'todo'
	| 'in_progress'
	| 'in_review'
	| 'done'
	| 'cancelled'

export type PhotonWorkspaceRecordPriority =
	| 'urgent'
	| 'high'
	| 'medium'
	| 'low'
	| 'none'

export type PhotonWorkspaceRecord = {
	id: string
	identifier: string
	title: string
	description: string
	status: PhotonWorkspaceRecordStatus
	priority: PhotonWorkspaceRecordPriority
	assignee: string | null
	labels: string[]
	project: string
	createdAt: string
	updatedAt: string
	domain: PhotonSyncDomain
	sourcePath: string
	sourceApi: string
	raw: Record<string, unknown>
}

export type PhotonDocumentProjection = {
	id: string
	title: string
	workspaceId: string
	linkedRecordIds: string[]
	sourceApi: string
	createdAt: string
	updatedAt: string
}

export type PhotonFileProjection = {
	id: string
	filename: string
	contentType: string
	byteSize: number
	surfaceType: 'record' | 'document' | 'chat'
	surfaceId: string
	sourceApi: string
	createdAt: string
	updatedAt: string
}

export type PhotonApiMapping = {
	surface: string
	photonComponent: string
	domain: PhotonSyncDomain
	api: string
	adminRoute: string
	connected: boolean
	gap: string
}

export const PHOTON_UI_API_MAPPING: PhotonApiMapping[] = [
	{
		surface: '受注',
		photonComponent: 'TableView / KanbanView / WorkflowView / Chat context',
		domain: 'erp.orders',
		api: 'REST /v1/erp/orders, GraphQL getConsumerOrdersForAdmin + order mutations',
		adminRoute: '/orders, /consumer-orders',
		connected: true,
		gap: '既存一覧は実API接続済みだが photon-sync operation-log への投影が未接続だった',
	},
	{
		surface: '在庫',
		photonComponent: 'TableView / KanbanView / EngineSyncDashboard',
		domain: 'erp.inventory',
		api: 'REST StockLevel, GraphQL inventory/productStock + stock mutations',
		adminRoute: '/inventory',
		connected: true,
		gap: 'StockLevel は実API接続済みだが Photon DB view 形式の統合ビューがなかった',
	},
	{
		surface: 'CRM / clients',
		photonComponent: 'TableView / Docs linked records / Chat context',
		domain: 'erp.clients',
		api: 'GraphQL clientListPage, clientDetail',
		adminRoute: '/library/clients',
		connected: true,
		gap: '取引先一覧は実API接続済みだが Photon record 形式には投影されていなかった',
	},
	{
		surface: 'Docs',
		photonComponent: 'DocsView',
		domain: 'photon.documents',
		api: 'Projected docs from orders, clients, inventory, purchase orders',
		adminRoute: '/photon',
		connected: true,
		gap: 'tachyon-api に汎用 Docs CRUD は未生成のため実ERPデータから document metadata を投影',
	},
	{
		surface: 'Files',
		photonComponent: 'FileChip / FilePreviewModal',
		domain: 'photon.files',
		api: 'Quote/delivery/invoice/receipt file-capable ERP surfaces',
		adminRoute: '/photon',
		connected: true,
		gap: '汎用 attachment REST は未生成のため既存帳票・OCRファイル相当を metadata 投影',
	},
	{
		surface: 'Workflow / operation-log',
		photonComponent: 'WorkflowView / operation-log',
		domain: 'photon.workflow',
		api: 'photon-sync pending_operations projection',
		adminRoute: '/photon',
		connected: true,
		gap: 'createPendingOperation は存在したが呼び出し元がなかった',
	},
	{
		surface: 'Sync Dashboard',
		photonComponent: 'EngineSyncDashboard',
		domain: 'photon.workflow',
		api: 'photon-sync runtime state + pending operation counters',
		adminRoute: '/photon',
		connected: true,
		gap: 'Engine status を admin-ui の photon-sync domain と operation に接続して表示',
	},
]

export function createPhotonWorkspaceOperation(
	scope: PhotonSyncTenantScope,
	input: {
		domain: PhotonSyncDomain
		entityId?: string
		mutationType: PhotonSyncMutationType
		payload: Record<string, unknown>
		now?: string
	},
): PendingOperation {
	const now = input.now ?? new Date().toISOString()
	const seed = [
		scope.platformId,
		scope.tenantId,
		scope.actorUserId,
		input.domain,
		input.entityId ?? 'collection',
		input.mutationType,
		now,
	].join(':')
	const operationInput: CreatePendingOperationInput = {
		...scope,
		operationId: `op_${hashString(seed)}`,
		entityType: input.domain,
		entityId: input.entityId,
		mutationType: input.mutationType,
		payload: input.payload,
		idempotencyKey: `photon:${hashString(`${seed}:${JSON.stringify(input.payload)}`)}`,
		now,
	}
	return createPendingOperation(operationInput)
}

function hashString(value: string) {
	let hash = 0
	for (let index = 0; index < value.length; index += 1) {
		hash = (hash << 5) - hash + value.charCodeAt(index)
		hash |= 0
	}
	return Math.abs(hash).toString(36)
}
