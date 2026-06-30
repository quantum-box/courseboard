'use client'

import { Badge } from 'components/ui/badge'
import { Button } from 'components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from 'components/ui/card'
import { type DataTableColumn, DataTable } from 'components/ui/data-table'
import { Input } from 'components/ui/input'
import { Label } from 'components/ui/label'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from 'components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from 'components/ui/tabs'
import { Textarea } from 'components/ui/textarea'
import {
	CheckCircleIcon,
	FilePlus2Icon,
	RouteIcon,
	SendIcon,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import type React from 'react'
import { useMemo, useState } from 'react'
import { useTransition } from 'react'
import type { ActionResult } from './action'
import type {
	SaasChangeRequest,
	SaasSubscription,
	SaasSubscriptionStatus,
} from './types'

const statusLabels: Record<SaasSubscriptionStatus, string> = {
	active: '利用中',
	trial: 'トライアル',
	change_requested: '変更申請中',
	renewal_review: '更新確認',
	cancelled: '解約済み',
}

const requestTypeLabels: Record<SaasChangeRequest['changeType'], string> = {
	new: '新規契約',
	plan_change: 'プラン変更',
	seat_change: '席数変更',
	cancel: '解約',
}

const requestStateLabels: Record<SaasChangeRequest['state'], string> = {
	draft: '下書き',
	waiting_approval: '承認待ち',
	approved: '承認済み',
	returned: '差し戻し',
}

const approvalLabels: Record<SaasSubscription['approvalState'], string> = {
	approved: '承認済み',
	pending: '承認待ち',
	needs_review: '要確認',
}

function formatAmount(value: number) {
	return new Intl.NumberFormat('ja-JP', {
		currency: 'JPY',
		maximumFractionDigits: 0,
		style: 'currency',
	}).format(value)
}

function formatDate(value: string) {
	return new Intl.DateTimeFormat('ja-JP', {
		day: '2-digit',
		month: '2-digit',
		year: 'numeric',
	}).format(new Date(value))
}

function statusVariant(status: SaasSubscriptionStatus) {
	if (status === 'cancelled') return 'destructive' as const
	if (status === 'change_requested') return 'outline' as const
	if (status === 'renewal_review') return 'secondary' as const
	return 'default' as const
}

function requestVariant(state: SaasChangeRequest['state']) {
	if (state === 'returned') return 'destructive' as const
	if (state === 'waiting_approval') return 'outline' as const
	return 'secondary' as const
}

export function SaasSubscriptionWorkspace({
	approveRequest,
	createRequest,
	returnRequest,
	requests,
	summary,
	subscriptions,
}: {
	approveRequest: (
		id: string,
		note?: string,
	) => Promise<ActionResult<SaasChangeRequest>>
	createRequest: (input: {
		subscriptionId?: string
		serviceName: string
		changeType: SaasChangeRequest['changeType']
		fromPlan?: string
		toPlan?: string
		reason: string
		estimatedDeltaYen: number
		approver: string
	}) => Promise<ActionResult<SaasChangeRequest>>
	requests: SaasChangeRequest[]
	returnRequest: (
		id: string,
		note: string,
	) => Promise<ActionResult<SaasChangeRequest>>
	summary: {
		subscriptionCount: number
		monthlyTotalYen: number
		pendingDeltaYen: number
		renewalReviewCount: number
	}
	subscriptions: SaasSubscription[]
}) {
	const [requestType, setRequestType] =
		useState<SaasChangeRequest['changeType']>('plan_change')
	const [selectedSubscriptionId, setSelectedSubscriptionId] = useState('none')
	const [rowMessage, setRowMessage] = useState<Record<string, string>>({})
	const [formMessage, setFormMessage] = useState<string | null>(null)
	const [isPending, startTransition] = useTransition()
	const router = useRouter()

	const selectedSubscription = subscriptions.find(
		item => item.id === selectedSubscriptionId,
	)

	function submitRequest(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault()
		const form = event.currentTarget
		const formData = new FormData(form)
		const serviceName = String(formData.get('serviceName') ?? '').trim()
		const fromPlan = String(formData.get('fromPlan') ?? '').trim()
		const toPlan = String(formData.get('toPlan') ?? '').trim()
		const reason = String(formData.get('reason') ?? '').trim()
		const approver = String(formData.get('approver') ?? '').trim()
		const estimatedDeltaYen = Number(formData.get('estimatedDeltaYen') ?? 0)

		setFormMessage(null)
		startTransition(async () => {
			const result = await createRequest({
				subscriptionId:
					selectedSubscriptionId === 'none'
						? undefined
						: selectedSubscriptionId,
				serviceName,
				changeType: requestType,
				fromPlan: fromPlan || undefined,
				toPlan: toPlan || undefined,
				reason,
				estimatedDeltaYen: Number.isFinite(estimatedDeltaYen)
					? estimatedDeltaYen
					: 0,
				approver,
			})
			if (!result.success) {
				setFormMessage(result.message ?? '申請に失敗しました')
				return
			}
			form.reset()
			setSelectedSubscriptionId('none')
			setRequestType('plan_change')
			setFormMessage('申請を作成しました')
			router.refresh()
		})
	}

	function decideRequest(id: string, decision: 'approve' | 'return') {
		const note =
			decision === 'return' ? '理由または承認者を確認してください' : undefined
		setRowMessage(current => ({ ...current, [id]: '更新中' }))
		startTransition(async () => {
			const result =
				decision === 'approve'
					? await approveRequest(id)
					: await returnRequest(id, note ?? '')
			setRowMessage(current => ({
				...current,
				[id]: result.success
					? decision === 'approve'
						? '承認しました'
						: '差し戻しました'
					: (result.message ?? '更新に失敗しました'),
			}))
			if (result.success) {
				router.refresh()
			}
		})
	}

	const subscriptionColumns = useMemo<DataTableColumn<SaasSubscription>[]>(
		() => [
			{
				accessorKey: 'serviceName',
				header: 'SaaS',
				cell: ({ row }) => (
					<div>
						<div className='font-medium'>{row.original.serviceName}</div>
						<div className='text-xs text-muted-foreground'>
							{row.original.ownerTeam}
						</div>
					</div>
				),
				meta: {
					cellClassName: 'min-w-[180px]',
				},
			},
			{
				accessorKey: 'currentPlan',
				header: '契約プラン',
				cell: ({ row }) => (
					<div>
						<div>{row.original.currentPlan}</div>
						{row.original.nextPlan ? (
							<div className='text-xs text-muted-foreground'>
								次回: {row.original.nextPlan}
							</div>
						) : null}
					</div>
				),
				meta: {
					cellClassName: 'min-w-[160px]',
				},
			},
			{
				accessorKey: 'status',
				header: '状態',
				cell: ({ row }) => (
					<Badge variant={statusVariant(row.original.status)}>
						{statusLabels[row.original.status]}
					</Badge>
				),
			},
			{
				accessorKey: 'monthlyAmount',
				header: '月額換算',
				cell: ({ row }) => (
					<span className='tabular-nums'>
						{formatAmount(row.original.monthlyAmount)}
					</span>
				),
				meta: {
					cellClassName: 'text-right',
					headerClassName: 'text-right',
				},
			},
			{
				accessorKey: 'seats',
				header: '席数',
				cell: ({ row }) => `${row.original.seats}席`,
			},
			{
				accessorKey: 'renewalDate',
				header: '更新日',
				cell: ({ row }) => formatDate(row.original.renewalDate),
			},
			{
				accessorKey: 'approvalState',
				header: '承認',
				cell: ({ row }) => approvalLabels[row.original.approvalState],
			},
			{
				accessorKey: 'reason',
				header: '利用理由',
				cell: ({ row }) => (
					<span className='block max-w-[280px] truncate'>
						{row.original.reason}
					</span>
				),
				meta: {
					cellClassName: 'min-w-[220px]',
				},
			},
		],
		[],
	)

	const requestColumns = useMemo<DataTableColumn<SaasChangeRequest>[]>(
		() => [
			{
				accessorKey: 'serviceName',
				header: '申請対象',
				cell: ({ row }) => (
					<div>
						<div className='font-medium'>{row.original.serviceName}</div>
						<div className='text-xs text-muted-foreground'>
							{requestTypeLabels[row.original.changeType]}
						</div>
					</div>
				),
				meta: {
					cellClassName: 'min-w-[180px]',
				},
			},
			{
				accessorKey: 'toPlan',
				header: '変更内容',
				cell: ({ row }) => (
					<span>
						{row.original.fromPlan ? `${row.original.fromPlan} -> ` : ''}
						{row.original.toPlan ?? '-'}
					</span>
				),
				meta: {
					cellClassName: 'min-w-[180px]',
				},
			},
			{
				accessorKey: 'state',
				header: '状態',
				cell: ({ row }) => (
					<Badge variant={requestVariant(row.original.state)}>
						{requestStateLabels[row.original.state]}
					</Badge>
				),
			},
			{
				accessorKey: 'requester',
				header: '申請者',
			},
			{
				accessorKey: 'approver',
				header: '承認者',
			},
			{
				accessorKey: 'estimatedDelta',
				header: '月額差分',
				cell: ({ row }) => (
					<span className='tabular-nums'>
						{formatAmount(row.original.estimatedDelta)}
					</span>
				),
				meta: {
					cellClassName: 'text-right',
					headerClassName: 'text-right',
				},
			},
			{
				accessorKey: 'reason',
				header: '理由',
				cell: ({ row }) => (
					<div>
						<span className='block max-w-[320px] truncate'>
							{row.original.reason}
						</span>
						{rowMessage[row.original.id] ? (
							<span className='mt-1 block text-xs text-muted-foreground'>
								{rowMessage[row.original.id]}
							</span>
						) : null}
					</div>
				),
				meta: {
					cellClassName: 'min-w-[260px]',
				},
			},
			{
				id: 'actions',
				header: '操作',
				cell: ({ row }) =>
					row.original.state === 'waiting_approval' ? (
						<div className='flex gap-2'>
							<Button
								disabled={isPending}
								onClick={() => decideRequest(row.original.id, 'approve')}
								size='sm'
								type='button'
							>
								承認
							</Button>
							<Button
								disabled={isPending}
								onClick={() => decideRequest(row.original.id, 'return')}
								size='sm'
								type='button'
								variant='outline'
							>
								差し戻し
							</Button>
						</div>
					) : (
						<span className='text-sm text-muted-foreground'>-</span>
					),
				meta: {
					cellClassName: 'min-w-[180px]',
				},
			},
		],
		[isPending, rowMessage],
	)

	return (
		<div className='grid gap-4'>
			<div className='grid gap-3 md:grid-cols-4'>
				<MetricCard
					label='契約中SaaS'
					value={`${summary.subscriptionCount}件`}
				/>
				<MetricCard
					label='月額換算'
					value={formatAmount(summary.monthlyTotalYen)}
				/>
				<MetricCard
					label='承認待ち差分'
					value={formatAmount(summary.pendingDeltaYen)}
				/>
				<MetricCard
					label='更新確認'
					value={`${summary.renewalReviewCount}件`}
				/>
			</div>

			<div className='grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]'>
				<Tabs defaultValue='subscriptions' className='min-w-0'>
					<TabsList className='grid w-full grid-cols-2 sm:w-[360px]'>
						<TabsTrigger value='subscriptions'>契約台帳</TabsTrigger>
						<TabsTrigger value='requests'>申請キュー</TabsTrigger>
					</TabsList>
					<TabsContent value='subscriptions'>
						<Card>
							<CardHeader>
								<CardTitle className='text-base'>契約台帳</CardTitle>
								<p className='text-sm text-muted-foreground'>
									現在のプラン、利用理由、承認状態、次回更新日を確認します。
								</p>
							</CardHeader>
							<CardContent>
								<DataTable
									columns={subscriptionColumns}
									data={subscriptions}
									getRowId={row => row.id}
									pageSize={8}
									tableClassName='min-w-[1080px]'
								/>
							</CardContent>
						</Card>
					</TabsContent>
					<TabsContent value='requests'>
						<Card>
							<CardHeader>
								<CardTitle className='text-base'>申請キュー</CardTitle>
								<p className='text-sm text-muted-foreground'>
									新規契約、プラン変更、席数変更、解約の理由と承認者を追跡します。
								</p>
							</CardHeader>
							<CardContent>
								<DataTable
									columns={requestColumns}
									data={requests}
									getRowId={row => row.id}
									pageSize={8}
									tableClassName='min-w-[980px]'
								/>
							</CardContent>
						</Card>
					</TabsContent>
				</Tabs>

				<Card className='self-start'>
					<CardHeader>
						<CardTitle className='text-base'>変更申請</CardTitle>
						<p className='text-sm text-muted-foreground'>
							理由、費用影響、承認者を揃えて申請します。
						</p>
					</CardHeader>
					<CardContent>
						<form className='grid gap-4' onSubmit={submitRequest}>
							<div className='grid gap-2'>
								<Label>既存契約</Label>
								<Select
									value={selectedSubscriptionId}
									onValueChange={value => {
										setSelectedSubscriptionId(value)
									}}
								>
									<SelectTrigger>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value='none'>新規または未紐付け</SelectItem>
										{subscriptions.map(subscription => (
											<SelectItem key={subscription.id} value={subscription.id}>
												{subscription.serviceName}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
							<div className='grid gap-2'>
								<Label htmlFor='saas-service'>SaaS名</Label>
								<Input
									id='saas-service'
									name='serviceName'
									placeholder='例: Slack'
									defaultValue={selectedSubscription?.serviceName}
									key={selectedSubscription?.id ?? 'none-service'}
									required
								/>
							</div>
							<div className='grid gap-2'>
								<Label>申請種別</Label>
								<Select
									value={requestType}
									onValueChange={value =>
										setRequestType(value as SaasChangeRequest['changeType'])
									}
								>
									<SelectTrigger>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value='new'>新規契約</SelectItem>
										<SelectItem value='plan_change'>プラン変更</SelectItem>
										<SelectItem value='seat_change'>席数変更</SelectItem>
										<SelectItem value='cancel'>解約</SelectItem>
									</SelectContent>
								</Select>
							</div>
							<div className='grid grid-cols-2 gap-3'>
								<div className='grid gap-2'>
									<Label htmlFor='from-plan'>現在</Label>
									<Input
										id='from-plan'
										name='fromPlan'
										placeholder='Pro'
										defaultValue={selectedSubscription?.currentPlan}
										key={selectedSubscription?.id ?? 'none-from'}
									/>
								</div>
								<div className='grid gap-2'>
									<Label htmlFor='to-plan'>変更後</Label>
									<Input id='to-plan' name='toPlan' placeholder='Business+' />
								</div>
							</div>
							<div className='grid gap-2'>
								<Label htmlFor='reason'>理由</Label>
								<Textarea
									id='reason'
									name='reason'
									placeholder='なぜ契約・変更が必要か、代替案、期待効果を記録'
									required
								/>
							</div>
							<div className='grid gap-2'>
								<Label htmlFor='estimated-delta'>月額差分</Label>
								<Input
									id='estimated-delta'
									name='estimatedDeltaYen'
									placeholder='例: 68000'
									type='number'
								/>
							</div>
							<div className='grid gap-2'>
								<Label htmlFor='approver'>承認者</Label>
								<Input
									id='approver'
									name='approver'
									placeholder='部門長または経理責任者'
									required
								/>
							</div>
							{formMessage ? (
								<p className='text-sm text-muted-foreground'>{formMessage}</p>
							) : null}
							<div className='grid grid-cols-2 gap-3'>
								<Button type='button' variant='outline'>
									<FilePlus2Icon className='mr-2 h-4 w-4' />
									下書き
								</Button>
								<Button disabled={isPending} type='submit'>
									<SendIcon className='mr-2 h-4 w-4' />
									申請
								</Button>
							</div>
						</form>
					</CardContent>
				</Card>
			</div>

			<Card>
				<CardHeader>
					<CardTitle className='text-base'>申請フロー</CardTitle>
				</CardHeader>
				<CardContent>
					<div className='grid gap-3 md:grid-cols-3'>
						<FlowStep
							icon={<FilePlus2Icon className='h-4 w-4' />}
							title='理由を添えて申請'
							body='契約目的、代替案、費用差分、更新日を同じ申請にまとめます。'
						/>
						<FlowStep
							icon={<RouteIcon className='h-4 w-4' />}
							title='部門と経理が承認'
							body='プラン変更や席数増加は費用影響に応じて承認者を切り替えます。'
						/>
						<FlowStep
							icon={<CheckCircleIcon className='h-4 w-4' />}
							title='請求と台帳へ反映'
							body='承認済みの変更を契約台帳と請求見通しへ反映します。'
						/>
					</div>
				</CardContent>
			</Card>
		</div>
	)
}

function MetricCard({ label, value }: { label: string; value: string }) {
	return (
		<Card>
			<CardHeader className='pb-2'>
				<CardTitle className='text-sm font-medium text-muted-foreground'>
					{label}
				</CardTitle>
			</CardHeader>
			<CardContent>
				<div className='text-2xl font-semibold'>{value}</div>
			</CardContent>
		</Card>
	)
}

function FlowStep({
	body,
	icon,
	title,
}: {
	body: string
	icon: React.ReactNode
	title: string
}) {
	return (
		<div className='grid gap-2 rounded-lg border p-4'>
			<div className='flex items-center gap-2 text-sm font-medium'>
				<span className='inline-flex h-8 w-8 items-center justify-center rounded-md border bg-muted'>
					{icon}
				</span>
				{title}
			</div>
			<p className='text-sm text-muted-foreground'>{body}</p>
		</div>
	)
}
