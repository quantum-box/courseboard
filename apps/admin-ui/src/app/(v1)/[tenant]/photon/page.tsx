import { authWithCheck } from 'app/auth'
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbList,
	BreadcrumbPage,
} from 'components/ui/breadcrumb'
import { MainLayout, V1Layout } from 'components/v1-layout'
import type { ItemOnClientFieldFragment } from 'gen/graphql'
import { PLATFORM_ID, getGraphqlSdk } from 'lib/graphqlClient'
import {
	PHOTON_UI_API_MAPPING,
	createPhotonWorkspaceOperation,
	initPhotonSyncRuntime,
	type PhotonDocumentProjection,
	type PhotonFileProjection,
	type PhotonWorkspaceRecord,
	type PhotonWorkspaceRecordPriority,
	type PhotonWorkspaceRecordStatus,
} from 'lib/photon-sync'
import { resolvePhotonDeploymentConfig } from 'lib/photon-sync/deployment-config'
import type { PhotonSyncDomain } from 'lib/photon-sync/types'
import { fetchOrdersAction, type OrderData } from '../orders/action'
import {
	fetchPurchaseOrdersAction,
	type PurchaseOrderData,
} from '../erp/purchase-orders/actions'
import { listStockLevels } from '../procurement/_lib/erp-api'
import type { StockLevel } from '../procurement/_lib/stock-level-normalizer'
import { PhotonWorkspace } from './photon-workspace'

export const metadata = {
	title: 'Photon workspace | バクうれ',
	description: 'TACHYON Field の実APIデータを Photon UI surfaces に投影します。',
}

type ProjectionResult = {
	records: PhotonWorkspaceRecord[]
	documents: PhotonDocumentProjection[]
	files: PhotonFileProjection[]
	errors: string[]
	operationCount: number
}

export default async function PhotonPage({
	params: { tenant },
}: {
	params: { tenant: string }
}) {
	const session = await authWithCheck()
	const projection = await buildPhotonProjection(tenant, session)
	const now = new Date().toISOString()
	const photonConfig = resolvePhotonDeploymentConfig({
		tenantId: tenant,
		workspaceId: 'erp',
	})
	const scope = {
		platformId: PLATFORM_ID,
		tenantId: tenant,
		actorUserId: session.user.id,
	}
	const runtime = initPhotonSyncRuntime({
		config: {
			...scope,
			enabled: photonConfig.enabled,
			mode: photonConfig.runtimeMode,
		},
	})
	const initialOperations = projection.records.slice(0, 12).map(record =>
		createPhotonWorkspaceOperation(scope, {
			domain: record.domain,
			entityId: record.id,
			mutationType: 'update',
			payload: {
				sourceApi: record.sourceApi,
				title: record.title,
				status: record.status,
				labels: record.labels,
			},
			now,
		}),
	)

	return (
		<V1Layout
			current='photon'
			tenant={tenant}
			breadcrumbs={
				<Breadcrumb>
					<BreadcrumbList>
						<BreadcrumbItem>
							<BreadcrumbPage>Photon workspace</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>
			}
		>
			<MainLayout>
				<PhotonWorkspace
					tenant={tenant}
					userId={session.user.id}
					records={projection.records}
					documents={projection.documents}
					files={projection.files}
					mapping={PHOTON_UI_API_MAPPING}
					errors={projection.errors}
					initialOperations={initialOperations}
					sourceOperationCount={projection.operationCount}
					deploymentConfig={photonConfig}
					runtimeState={runtime.state}
				/>
			</MainLayout>
		</V1Layout>
	)
}

async function buildPhotonProjection(
	tenant: string,
	session: Awaited<ReturnType<typeof authWithCheck>>,
): Promise<ProjectionResult> {
	const sdk = getGraphqlSdk(session, tenant)
	const [ordersResult, purchaseOrdersResult, stockResult, clientsResult] =
		await Promise.allSettled([
			fetchOrdersAction(tenant, 'all'),
			fetchPurchaseOrdersAction(tenant, 'all'),
			listStockLevels(tenant),
			sdk.clientListPage(),
		])

	const errors: string[] = []
	const orders: OrderData[] =
		ordersResult.status === 'fulfilled' && ordersResult.value.success
			? ordersResult.value.data ?? []
			: collectError(errors, 'REST /v1/erp/orders', ordersResult)
	const purchaseOrders: PurchaseOrderData[] =
		purchaseOrdersResult.status === 'fulfilled' &&
		purchaseOrdersResult.value.success
			? purchaseOrdersResult.value.data ?? []
			: collectError(errors, 'REST /v1/erp/purchase-orders', purchaseOrdersResult)
	const stockLevels: StockLevel[] =
		stockResult.status === 'fulfilled'
			? stockResult.value.items
			: collectError(errors, 'REST StockLevel', stockResult)
	const clients: ItemOnClientFieldFragment[] =
		clientsResult.status === 'fulfilled'
			? clientsResult.value.clients ?? []
			: collectError(errors, 'GraphQL clientListPage', clientsResult)

	const records = [
		...orders.map(order => mapOrder(order, tenant)),
		...purchaseOrders.map(order => mapPurchaseOrder(order, tenant)),
		...stockLevels.map(stock => mapStockLevel(stock, tenant)),
		...clients.map(client => mapClient(client, tenant)),
	].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))

	const documents = buildDocuments(records, tenant)
	const files = buildFiles(records, documents)

	return {
		records,
		documents,
		files,
		errors,
		operationCount: records.length + documents.length + files.length,
	}
}

function collectError<T>(
	errors: string[],
	source: string,
	result: PromiseSettledResult<unknown>,
): T[] {
	if (result.status === 'rejected') {
		errors.push(`${source}: ${formatError(result.reason)}`)
	} else {
		errors.push(`${source}: response did not include usable data`)
	}
	return []
}

function mapOrder(order: OrderData, tenant: string): PhotonWorkspaceRecord {
	return {
		id: order.id,
		identifier: order.orderNumber,
		title: `${order.orderNumber} ${order.clientName ?? order.clientId}`,
		description: `${order.source} / ${order.items.length} items / ${order.currency} ${order.totalAmount}`,
		status: mapOrderStatus(order.status),
		priority: order.totalAmount >= 100000 ? 'high' : 'medium',
		assignee: order.clientName ?? null,
		labels: ['受注', order.source, order.status],
		project: 'Orders',
		createdAt: order.createdAt,
		updatedAt: order.updatedAt,
		domain: 'erp.orders',
		sourcePath: `/${tenant}/orders/${order.id}`,
		sourceApi: 'REST /v1/erp/orders',
		raw: {
			totalAmount: order.totalAmount,
			status: order.status,
			clientId: order.clientId,
		},
	}
}

function mapPurchaseOrder(
	order: PurchaseOrderData,
	tenant: string,
): PhotonWorkspaceRecord {
	return {
		id: order.id,
		identifier: order.purchaseOrderNumber,
		title: `${order.purchaseOrderNumber} ${order.vendorName}`,
		description: `${order.items.length} items / ${order.currency} ${order.totalAmount}`,
		status: mapPurchaseOrderStatus(order.status),
		priority: order.status === 'Draft' ? 'low' : 'medium',
		assignee: order.vendorName,
		labels: ['発注書', order.status],
		project: 'Purchase orders',
		createdAt: order.createdAt,
		updatedAt: order.updatedAt,
		domain: 'erp.purchase_orders',
		sourcePath: `/${tenant}/erp/purchase-orders/${order.id}`,
		sourceApi: 'REST /v1/erp/purchase-orders',
		raw: {
			totalAmount: order.totalAmount,
			status: order.status,
			vendorId: order.vendorId,
		},
	}
}

function mapStockLevel(stock: StockLevel, tenant: string): PhotonWorkspaceRecord {
	const quantityAvailable = stock.quantityAvailable
	return {
		id: stock.id,
		identifier: stock.skuCode,
		title: `${stock.productName} / ${stock.warehouseName}`,
		description: `手持 ${stock.quantityOnHand} / 引当 ${stock.quantityAllocated} / 利用可能 ${quantityAvailable}`,
		status: quantityAvailable <= 0 ? 'in_review' : 'done',
		priority: quantityAvailable <= 0 ? 'urgent' : quantityAvailable <= 5 ? 'high' : 'none',
		assignee: stock.warehouseName,
		labels: ['在庫', stock.skuCode, stock.warehouseName],
		project: 'Inventory',
		createdAt: stock.lastUpdatedAt ?? new Date().toISOString(),
		updatedAt: stock.lastUpdatedAt ?? new Date().toISOString(),
		domain: 'erp.inventory',
		sourcePath: `/${tenant}/inventory`,
		sourceApi: 'REST StockLevel',
		raw: {
			stockItemId: stock.stockItemId,
			quantityOnHand: stock.quantityOnHand,
			quantityAvailable,
		},
	}
}

function mapClient(
	client: ItemOnClientFieldFragment,
	tenant: string,
): PhotonWorkspaceRecord {
	const updatedAt = new Date().toISOString()
	return {
		id: client.id,
		identifier: client.id,
		title: client.name,
		description: [client.industry, client.capital ? `資本金 ${client.capital}` : null]
			.filter(Boolean)
			.join(' / '),
		status: 'todo',
		priority: client.capital && client.capital >= 10000000 ? 'high' : 'medium',
		assignee: client.name,
		labels: ['CRM', client.industry ?? 'industry:unknown'],
		project: 'Clients',
		createdAt: updatedAt,
		updatedAt,
		domain: 'erp.clients',
		sourcePath: `/${tenant}/library/clients/${client.id}`,
		sourceApi: 'GraphQL clientListPage',
		raw: {
			industry: client.industry,
			capital: client.capital,
		},
	}
}

function buildDocuments(
	records: PhotonWorkspaceRecord[],
	tenant: string,
): PhotonDocumentProjection[] {
	const now = new Date().toISOString()
	return [
		{
			id: `doc-${tenant}-orders`,
			title: '受注対応メモ',
			workspaceId: tenant,
			linkedRecordIds: records
				.filter(record => record.domain === 'erp.orders')
				.slice(0, 8)
				.map(record => record.id),
			sourceApi: 'Projected from REST /v1/erp/orders',
			createdAt: now,
			updatedAt: now,
		},
		{
			id: `doc-${tenant}-inventory`,
			title: '在庫・補充ワークノート',
			workspaceId: tenant,
			linkedRecordIds: records
				.filter(record => record.domain === 'erp.inventory')
				.slice(0, 8)
				.map(record => record.id),
			sourceApi: 'Projected from StockLevel',
			createdAt: now,
			updatedAt: now,
		},
		{
			id: `doc-${tenant}-crm`,
			title: 'CRM / 取引先ノート',
			workspaceId: tenant,
			linkedRecordIds: records
				.filter(record => record.domain === 'erp.clients')
				.slice(0, 8)
				.map(record => record.id),
			sourceApi: 'Projected from GraphQL clientListPage',
			createdAt: now,
			updatedAt: now,
		},
	]
}

function buildFiles(
	records: PhotonWorkspaceRecord[],
	documents: PhotonDocumentProjection[],
): PhotonFileProjection[] {
	const now = new Date().toISOString()
	return [
		...records
			.filter(record => record.domain === 'erp.orders')
			.slice(0, 6)
			.map(record => ({
				id: `file-delivery-${record.id}`,
				filename: `${record.identifier}-delivery-note.pdf`,
				contentType: 'application/pdf',
				byteSize: 0,
				surfaceType: 'record' as const,
				surfaceId: record.id,
				sourceApi: 'CreateDeliveryNotePdf mutation surface',
				createdAt: record.createdAt,
				updatedAt: record.updatedAt,
			})),
		...documents.map(document => ({
			id: `file-export-${document.id}`,
			filename: `${document.title}.md`,
			contentType: 'text/markdown',
			byteSize: 0,
			surfaceType: 'document' as const,
			surfaceId: document.id,
			sourceApi: document.sourceApi,
			createdAt: now,
			updatedAt: now,
		})),
	]
}

function mapOrderStatus(status: string): PhotonWorkspaceRecordStatus {
	const statuses: Record<string, PhotonWorkspaceRecordStatus> = {
		Pending: 'todo',
		Confirmed: 'in_progress',
		Shipped: 'in_review',
		Completed: 'done',
		Cancelled: 'cancelled',
	}
	return statuses[status] ?? 'todo'
}

function mapPurchaseOrderStatus(status: string): PhotonWorkspaceRecordStatus {
	const statuses: Record<string, PhotonWorkspaceRecordStatus> = {
		Draft: 'backlog',
		Sent: 'in_progress',
		Received: 'done',
		Invoiced: 'done',
	}
	return statuses[status] ?? 'todo'
}

function formatError(error: unknown) {
	return error instanceof Error ? error.message : String(error)
}
