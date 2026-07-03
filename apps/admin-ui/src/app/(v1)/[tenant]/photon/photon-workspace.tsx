'use client'

import { Badge } from 'components/ui/badge'
import { Button } from 'components/ui/button'
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from 'components/ui/card'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from 'components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from 'components/ui/tabs'
import {
	ActivityIcon,
	BotIcon,
	DatabaseIcon,
	FileTextIcon,
	KanbanSquareIcon,
	LinkIcon,
	RefreshCwIcon,
	WorkflowIcon,
} from 'lucide-react'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import {
	createPhotonWorkspaceOperation,
	type PhotonApiMapping,
	type PhotonDocumentProjection,
	type PhotonFileProjection,
	type PhotonWorkspaceRecord,
} from 'lib/photon-sync'
import type { PhotonDeploymentConfig } from 'lib/photon-sync/deployment-config'
import type {
	PendingOperation,
	PhotonSyncDomain,
	PhotonSyncRuntimeState,
} from 'lib/photon-sync/types'

type PhotonWorkspaceProps = {
	tenant: string
	userId: string
	records: PhotonWorkspaceRecord[]
	documents: PhotonDocumentProjection[]
	files: PhotonFileProjection[]
	mapping: PhotonApiMapping[]
	errors: string[]
	initialOperations: PendingOperation[]
	sourceOperationCount: number
	deploymentConfig: PhotonDeploymentConfig
	runtimeState: PhotonSyncRuntimeState
}

const statusLabels: Record<string, string> = {
	backlog: 'Backlog',
	todo: 'Todo',
	in_progress: 'In progress',
	in_review: 'Review',
	done: 'Done',
	cancelled: 'Cancelled',
}

const domainLabels: Record<PhotonSyncDomain, string> = {
	'erp.orders': '受注',
	'erp.inventory': '在庫',
	'erp.clients': 'CRM',
	'erp.vendors': '仕入先',
	'erp.purchase_orders': '発注書',
	'photon.documents': 'Docs',
	'photon.files': 'Files',
	'photon.workflow': 'Workflow',
	'photon.chat': 'Chat',
}

const statusOrder = [
	'backlog',
	'todo',
	'in_progress',
	'in_review',
	'done',
	'cancelled',
] as const

export function PhotonWorkspace({
	tenant,
	userId,
	records,
	documents,
	files,
	mapping,
	errors,
	initialOperations,
	sourceOperationCount,
	deploymentConfig,
	runtimeState,
}: PhotonWorkspaceProps) {
	const [selectedDomain, setSelectedDomain] = useState<PhotonSyncDomain | 'all'>(
		'all',
	)
	const [search, setSearch] = useState('')
	const [operations, setOperations] =
		useState<PendingOperation[]>(initialOperations)

	const visibleRecords = useMemo(() => {
		const normalizedSearch = search.trim().toLowerCase()
		return records.filter(record => {
			if (selectedDomain !== 'all' && record.domain !== selectedDomain) {
				return false
			}
			if (!normalizedSearch) return true
			return [
				record.identifier,
				record.title,
				record.description,
				record.project,
				record.assignee ?? '',
				record.labels.join(' '),
			]
				.join(' ')
				.toLowerCase()
				.includes(normalizedSearch)
		})
	}, [records, search, selectedDomain])

	const syncCounters = useMemo(() => {
		const domains = new Set(records.map(record => record.domain))
		return {
			records: records.length,
			domains: domains.size,
			documents: documents.length,
			files: files.length,
			queued: operations.filter(operation => operation.status === 'queued')
				.length,
		}
	}, [documents.length, files.length, operations, records])

	const enqueueUiOperation = (
		domain: PhotonSyncDomain,
		entityId: string | undefined,
		payload: Record<string, unknown>,
	) => {
		const operation = createPhotonWorkspaceOperation(
			{
				platformId: 'tachyon-field-admin-ui',
				tenantId: tenant,
				actorUserId: userId,
			},
			{
				domain,
				entityId,
				mutationType: 'update',
				payload,
			},
		)
		setOperations(current => [operation, ...current].slice(0, 40))
	}

	return (
		<div className='space-y-4'>
			<div className='flex flex-col gap-3 md:flex-row md:items-end md:justify-between'>
				<div>
					<h1 className='text-2xl font-semibold'>Photon workspace</h1>
					<p className='text-sm text-muted-foreground'>
						Chat / DB views / Docs / Files / Workflow / Sync Dashboard を
						tachyon-api の実データ投影に接続しています。
					</p>
				</div>
				<div className='flex flex-wrap gap-2'>
					<Button
						variant='outline'
						size='sm'
						onClick={() =>
							enqueueUiOperation('photon.workflow', undefined, {
								action: 'manual_sync_requested',
								sourceOperationCount,
							})
						}
					>
						<RefreshCwIcon className='mr-2 h-4 w-4' />
						同期ログへ記録
					</Button>
				</div>
			</div>

			{errors.length > 0 ? (
				<Card className='border-amber-300 bg-amber-50'>
					<CardHeader>
						<CardTitle className='text-sm'>部分的に取得できない API</CardTitle>
					</CardHeader>
					<CardContent className='space-y-1 text-sm text-amber-900'>
						{errors.map(error => (
							<div key={error}>{error}</div>
						))}
					</CardContent>
				</Card>
			) : null}

			<PhotonSyncConfigPanel
				deploymentConfig={deploymentConfig}
				runtimeState={runtimeState}
			/>

			<div className='grid gap-3 md:grid-cols-5'>
				<MetricCard label='Records' value={syncCounters.records} />
				<MetricCard label='Domains' value={syncCounters.domains} />
				<MetricCard label='Docs' value={syncCounters.documents} />
				<MetricCard label='Files' value={syncCounters.files} />
				<MetricCard label='Queued ops' value={syncCounters.queued} />
			</div>

			<Tabs defaultValue='table' className='space-y-4'>
				<TabsList className='flex h-auto flex-wrap justify-start'>
					<TabsTrigger value='table'>
						<DatabaseIcon className='mr-2 h-4 w-4' />
						Table
					</TabsTrigger>
					<TabsTrigger value='kanban'>
						<KanbanSquareIcon className='mr-2 h-4 w-4' />
						Kanban
					</TabsTrigger>
					<TabsTrigger value='docs'>
						<FileTextIcon className='mr-2 h-4 w-4' />
						Docs / Files
					</TabsTrigger>
					<TabsTrigger value='workflow'>
						<WorkflowIcon className='mr-2 h-4 w-4' />
						Workflow
					</TabsTrigger>
					<TabsTrigger value='sync'>
						<ActivityIcon className='mr-2 h-4 w-4' />
						Sync
					</TabsTrigger>
					<TabsTrigger value='chat'>
						<BotIcon className='mr-2 h-4 w-4' />
						Chat context
					</TabsTrigger>
				</TabsList>

				<TabsContent value='table' className='space-y-3'>
					<FilterBar
						selectedDomain={selectedDomain}
						search={search}
						onDomainChange={setSelectedDomain}
						onSearchChange={setSearch}
						records={records}
					/>
					<RecordTable
						records={visibleRecords}
						onTouchRecord={record =>
							enqueueUiOperation(record.domain, record.id, {
								action: 'table_record_selected',
								sourceApi: record.sourceApi,
							})
						}
					/>
				</TabsContent>

				<TabsContent value='kanban'>
					<KanbanBoard
						records={visibleRecords}
						onMoveIntent={record =>
							enqueueUiOperation(record.domain, record.id, {
								action: 'kanban_move_intent',
								status: record.status,
							})
						}
					/>
				</TabsContent>

				<TabsContent value='docs'>
					<DocsAndFiles documents={documents} files={files} records={records} />
				</TabsContent>

				<TabsContent value='workflow'>
					<WorkflowProjection
						records={records}
						onCreateWorkflowOperation={record =>
							enqueueUiOperation('photon.workflow', record.id, {
								action: 'workflow_node_opened',
								recordDomain: record.domain,
								title: record.title,
							})
						}
					/>
				</TabsContent>

				<TabsContent value='sync'>
					<SyncDashboard
						operations={operations}
						mapping={mapping}
						sourceOperationCount={sourceOperationCount}
					/>
				</TabsContent>

				<TabsContent value='chat'>
					<ChatContextPanel
						records={visibleRecords}
						documents={documents}
						files={files}
						onSendPrompt={prompt =>
							enqueueUiOperation('photon.chat', undefined, {
								action: 'chat_prompt_prepared',
								prompt,
								recordCount: visibleRecords.length,
							})
						}
					/>
				</TabsContent>
			</Tabs>
		</div>
	)
}

function PhotonSyncConfigPanel({
	deploymentConfig,
	runtimeState,
}: {
	deploymentConfig: PhotonDeploymentConfig
	runtimeState: PhotonSyncRuntimeState
}) {
	const runtimeEnabled = runtimeState.enabled
	const warnings = [
		...deploymentConfig.warnings,
		...(!runtimeState.enabled && runtimeState.errorSummary
			? [runtimeState.errorSummary]
			: []),
	]
	return (
		<Card>
			<CardHeader>
				<div className='flex flex-wrap items-center justify-between gap-2'>
					<div>
						<CardTitle>Photon Engine / Live config</CardTitle>
						<CardDescription>
							ERP API、durable sync、Yjs Live room の接続先を環境変数から決定します。
						</CardDescription>
					</div>
					<div className='flex flex-wrap gap-2'>
						<Badge variant={deploymentConfig.enabled ? 'default' : 'outline'}>
							{deploymentConfig.deploymentMode}
						</Badge>
						<Badge variant={runtimeEnabled ? 'default' : 'outline'}>
							{runtimeEnabled ? runtimeState.mode : runtimeState.reason}
						</Badge>
					</div>
				</div>
			</CardHeader>
			<CardContent className='space-y-3'>
				<div className='grid gap-2 md:grid-cols-2 xl:grid-cols-4'>
					<ConfigItem label='Tenant' value={deploymentConfig.tenantName} />
					<ConfigItem label='Workspace' value={deploymentConfig.workspaceName} />
					<ConfigItem
						label='App server'
						value={deploymentConfig.appServerBackend}
					/>
					<ConfigItem label='Live backend' value={deploymentConfig.syncBackend} />
				</div>
				<div className='grid gap-2 text-xs md:grid-cols-2'>
					<ConfigItem
						label='GraphQL'
						value={deploymentConfig.endpoints.graphqlUrl}
					/>
					<ConfigItem
						label='REST'
						value={deploymentConfig.endpoints.restBaseUrl}
					/>
					<ConfigItem
						label='Engine push'
						value={deploymentConfig.endpoints.enginePushUrl}
					/>
					<ConfigItem
						label='Engine pull'
						value={deploymentConfig.endpoints.enginePullUrl}
					/>
					<ConfigItem
						label='Live websocket'
						value={deploymentConfig.endpoints.liveWebSocketUrl ?? 'not configured'}
					/>
					<ConfigItem
						label='Agent stream'
						value={deploymentConfig.endpoints.agentStreamUrl}
					/>
				</div>
				{warnings.length > 0 ? (
					<div className='rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900'>
						{warnings.map(warning => (
							<div key={warning}>{warning}</div>
						))}
					</div>
				) : null}
			</CardContent>
		</Card>
	)
}

function ConfigItem({ label, value }: { label: string; value: string }) {
	return (
		<div className='min-w-0 rounded-md border bg-background p-2'>
			<div className='text-[11px] uppercase text-muted-foreground'>{label}</div>
			<div className='mt-1 truncate font-mono text-xs'>{value}</div>
		</div>
	)
}

function MetricCard({ label, value }: { label: string; value: number }) {
	return (
		<Card>
			<CardContent className='pt-4'>
				<div className='text-xs uppercase text-muted-foreground'>{label}</div>
				<div className='mt-1 text-2xl font-semibold tabular-nums'>{value}</div>
			</CardContent>
		</Card>
	)
}

function FilterBar({
	selectedDomain,
	search,
	records,
	onDomainChange,
	onSearchChange,
}: {
	selectedDomain: PhotonSyncDomain | 'all'
	search: string
	records: PhotonWorkspaceRecord[]
	onDomainChange: (domain: PhotonSyncDomain | 'all') => void
	onSearchChange: (search: string) => void
}) {
	const domains = Array.from(new Set(records.map(record => record.domain)))
	return (
		<Card>
			<CardContent className='flex flex-col gap-2 pt-4 md:flex-row'>
				<select
					className='h-9 rounded-md border bg-background px-3 text-sm'
					value={selectedDomain}
					onChange={event =>
						onDomainChange(event.target.value as PhotonSyncDomain | 'all')
					}
				>
					<option value='all'>すべての domain</option>
					{domains.map(domain => (
						<option key={domain} value={domain}>
							{domainLabels[domain]}
						</option>
					))}
				</select>
				<input
					className='h-9 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm'
					value={search}
					onChange={event => onSearchChange(event.target.value)}
					placeholder='ID、タイトル、ラベル、担当で検索'
				/>
			</CardContent>
		</Card>
	)
}

function RecordTable({
	records,
	onTouchRecord,
}: {
	records: PhotonWorkspaceRecord[]
	onTouchRecord: (record: PhotonWorkspaceRecord) => void
}) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>Photon DB Table</CardTitle>
				<CardDescription>
					photon の TableView が期待する record shape に REST/GraphQL
					データを投影しています。
				</CardDescription>
			</CardHeader>
			<CardContent>
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>ID</TableHead>
							<TableHead>Title</TableHead>
							<TableHead>Domain</TableHead>
							<TableHead>Status</TableHead>
							<TableHead>Priority</TableHead>
							<TableHead>API</TableHead>
							<TableHead className='text-right'>Source</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{records.length === 0 ? (
							<TableRow>
								<TableCell colSpan={7} className='h-24 text-center'>
									表示できる Photon record はありません。
								</TableCell>
							</TableRow>
						) : null}
						{records.map(record => (
							<TableRow key={`${record.domain}:${record.id}`}>
								<TableCell className='font-mono text-xs'>
									{record.identifier}
								</TableCell>
								<TableCell>
									<button
										type='button'
										className='text-left font-medium hover:underline'
										onClick={() => onTouchRecord(record)}
									>
										{record.title}
									</button>
									<div className='line-clamp-1 text-xs text-muted-foreground'>
										{record.description}
									</div>
								</TableCell>
								<TableCell>
									<Badge variant='outline'>{domainLabels[record.domain]}</Badge>
								</TableCell>
								<TableCell>{statusLabels[record.status]}</TableCell>
								<TableCell>{record.priority}</TableCell>
								<TableCell className='text-xs text-muted-foreground'>
									{record.sourceApi}
								</TableCell>
								<TableCell className='text-right'>
									<Link className='text-sm text-blue-600 hover:underline' href={record.sourcePath}>
										開く
									</Link>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</CardContent>
		</Card>
	)
}

function KanbanBoard({
	records,
	onMoveIntent,
}: {
	records: PhotonWorkspaceRecord[]
	onMoveIntent: (record: PhotonWorkspaceRecord) => void
}) {
	return (
		<div className='grid gap-3 xl:grid-cols-6'>
			{statusOrder.map(status => {
				const columnRecords = records.filter(record => record.status === status)
				return (
					<Card key={status} className='min-h-64'>
						<CardHeader className='pb-3'>
							<CardTitle className='text-sm'>{statusLabels[status]}</CardTitle>
							<CardDescription>{columnRecords.length} records</CardDescription>
						</CardHeader>
						<CardContent className='space-y-2'>
							{columnRecords.map(record => (
								<button
									type='button'
									key={`${record.domain}:${record.id}`}
									className='w-full rounded-md border bg-background p-3 text-left hover:bg-muted'
									onClick={() => onMoveIntent(record)}
								>
									<div className='text-xs text-muted-foreground'>
										{record.identifier}
									</div>
									<div className='mt-1 line-clamp-2 text-sm font-medium'>
										{record.title}
									</div>
									<div className='mt-2 flex flex-wrap gap-1'>
										{record.labels.slice(0, 2).map(label => (
											<Badge key={label} variant='secondary'>
												{label}
											</Badge>
										))}
									</div>
								</button>
							))}
						</CardContent>
					</Card>
				)
			})}
		</div>
	)
}

function DocsAndFiles({
	documents,
	files,
	records,
}: {
	documents: PhotonDocumentProjection[]
	files: PhotonFileProjection[]
	records: PhotonWorkspaceRecord[]
}) {
	return (
		<div className='grid gap-4 lg:grid-cols-[1fr_1fr]'>
			<Card>
				<CardHeader>
					<CardTitle>Docs projection</CardTitle>
					<CardDescription>
						DocsView の metadata と linked records を実ERPデータから生成します。
					</CardDescription>
				</CardHeader>
				<CardContent className='space-y-3'>
					{documents.map(document => (
						<div key={document.id} className='rounded-md border p-3'>
							<div className='font-medium'>{document.title}</div>
							<div className='mt-1 text-xs text-muted-foreground'>
								{document.sourceApi}
							</div>
							<div className='mt-2 flex flex-wrap gap-1'>
								{document.linkedRecordIds.map(recordId => {
									const record = records.find(candidate => candidate.id === recordId)
									return (
										<Badge key={recordId} variant='outline'>
											{record?.identifier ?? recordId}
										</Badge>
									)
								})}
							</div>
						</div>
					))}
				</CardContent>
			</Card>
			<Card>
				<CardHeader>
					<CardTitle>Files projection</CardTitle>
					<CardDescription>
						FileChip 相当の attachment metadata を帳票・Docs export
						surfaces へ接続します。
					</CardDescription>
				</CardHeader>
				<CardContent className='space-y-2'>
					{files.map(file => (
						<div
							key={file.id}
							className='flex items-center justify-between gap-3 rounded-md border p-3'
						>
							<div className='min-w-0'>
								<div className='truncate text-sm font-medium'>{file.filename}</div>
								<div className='truncate text-xs text-muted-foreground'>
									{file.contentType} / {file.sourceApi}
								</div>
							</div>
							<Badge variant='secondary'>{file.surfaceType}</Badge>
						</div>
					))}
				</CardContent>
			</Card>
		</div>
	)
}

function WorkflowProjection({
	records,
	onCreateWorkflowOperation,
}: {
	records: PhotonWorkspaceRecord[]
	onCreateWorkflowOperation: (record: PhotonWorkspaceRecord) => void
}) {
	const workflowRecords = records.slice(0, 12)
	return (
		<Card>
			<CardHeader>
				<CardTitle>Workflow projection</CardTitle>
				<CardDescription>
					WorkflowView の node data として、受注・在庫・CRM・発注書を同じ
					canvas に配置します。
				</CardDescription>
			</CardHeader>
			<CardContent>
				<div className='grid gap-3 md:grid-cols-3'>
					{workflowRecords.map((record, index) => (
						<button
							type='button'
							key={`${record.domain}:${record.id}`}
							className='rounded-md border bg-background p-3 text-left hover:bg-muted'
							onClick={() => onCreateWorkflowOperation(record)}
						>
							<div className='flex items-center justify-between gap-2'>
								<Badge variant='outline'>{domainLabels[record.domain]}</Badge>
								<span className='text-xs text-muted-foreground'>
									Node {index + 1}
								</span>
							</div>
							<div className='mt-2 font-medium'>{record.title}</div>
							<div className='mt-1 line-clamp-2 text-xs text-muted-foreground'>
								{record.description}
							</div>
						</button>
					))}
				</div>
			</CardContent>
		</Card>
	)
}

function SyncDashboard({
	operations,
	mapping,
	sourceOperationCount,
}: {
	operations: PendingOperation[]
	mapping: PhotonApiMapping[]
	sourceOperationCount: number
}) {
	return (
		<div className='grid gap-4 xl:grid-cols-[1fr_1fr]'>
			<Card>
				<CardHeader>
					<CardTitle>Operation log</CardTitle>
					<CardDescription>
						createPendingOperation で redaction 済み payload を同期キュー形式にします。
					</CardDescription>
				</CardHeader>
				<CardContent className='space-y-2'>
					{operations.map(operation => (
						<div key={operation.operationId} className='rounded-md border p-3'>
							<div className='flex flex-wrap items-center justify-between gap-2'>
								<div className='font-mono text-xs'>{operation.operationId}</div>
								<Badge>{operation.status}</Badge>
							</div>
							<div className='mt-1 text-sm'>
								{domainLabels[operation.entityType]} / {operation.mutationType}
							</div>
							<div className='mt-1 text-xs text-muted-foreground'>
								{operation.entityId ?? 'collection'} / {operation.createdAt}
							</div>
						</div>
					))}
				</CardContent>
			</Card>
			<Card>
				<CardHeader>
					<CardTitle>API mapping</CardTitle>
					<CardDescription>
						{sourceOperationCount} source projections are connected to Photon
						surfaces.
					</CardDescription>
				</CardHeader>
				<CardContent className='space-y-2'>
					{mapping.map(item => (
						<div key={`${item.domain}:${item.surface}`} className='rounded-md border p-3'>
							<div className='flex items-center justify-between gap-2'>
								<div className='font-medium'>{item.surface}</div>
								<Badge variant={item.connected ? 'default' : 'outline'}>
									{item.connected ? 'connected' : 'gap'}
								</Badge>
							</div>
							<div className='mt-1 text-xs text-muted-foreground'>
								{item.photonComponent}
							</div>
							<div className='mt-2 flex items-start gap-2 text-xs'>
								<LinkIcon className='mt-0.5 h-3 w-3 shrink-0' />
								<span>{item.api}</span>
							</div>
						</div>
					))}
				</CardContent>
			</Card>
		</div>
	)
}

function ChatContextPanel({
	records,
	documents,
	files,
	onSendPrompt,
}: {
	records: PhotonWorkspaceRecord[]
	documents: PhotonDocumentProjection[]
	files: PhotonFileProjection[]
	onSendPrompt: (prompt: string) => void
}) {
	const prompt = `TACHYON Field tenant context: ${records.length} records, ${documents.length} docs, ${files.length} files. Prioritize urgent inventory and in-progress orders.`
	return (
		<Card>
			<CardHeader>
				<CardTitle>Chat context bridge</CardTitle>
				<CardDescription>
					photon Chat が参照する workspace context を admin-ui
					実データから構成します。
				</CardDescription>
			</CardHeader>
			<CardContent className='space-y-4'>
				<div className='rounded-md border bg-muted p-3 text-sm'>{prompt}</div>
				<div className='grid gap-2 md:grid-cols-3'>
					{records.slice(0, 9).map(record => (
						<div key={`${record.domain}:${record.id}`} className='rounded-md border p-3'>
							<div className='text-xs text-muted-foreground'>
								{domainLabels[record.domain]}
							</div>
							<div className='mt-1 line-clamp-2 text-sm font-medium'>
								{record.title}
							</div>
						</div>
					))}
				</div>
				<Button onClick={() => onSendPrompt(prompt)}>
					<BotIcon className='mr-2 h-4 w-4' />
					Chat operation を記録
				</Button>
			</CardContent>
		</Card>
	)
}
