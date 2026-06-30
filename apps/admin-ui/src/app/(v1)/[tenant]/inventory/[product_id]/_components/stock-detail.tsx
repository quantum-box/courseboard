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
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from 'components/ui/dialog'
import { Input } from 'components/ui/input'
import { Label } from 'components/ui/label'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from 'components/ui/table'
import { ArrowDownIcon, ArrowUpIcon, PackageIcon, SettingsIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

type StockData = {
	id: string
	productId: string
	quantityOnHand: number
	quantityReserved: number
	quantityAvailable: number
	lowStockThreshold: number
	trackInventory: boolean
	createdAt: string
	updatedAt: string
}

type ProductData = {
	id: string
	name: string
	kind: string
	listPrice: number
	billingCycle: string
}

type MovementData = {
	id: string
	movementType: string
	quantity: number
	referenceType?: string | null
	referenceId?: string | null
	note?: string | null
	createdAt: string
}

function movementTypeBadge(type: string) {
	switch (type) {
		case 'received':
			return (
				<Badge className='bg-green-100 text-green-800 hover:bg-green-200'>
					入荷
				</Badge>
			)
		case 'reserved':
			return (
				<Badge className='bg-blue-100 text-blue-800 hover:bg-blue-200'>
					予約
				</Badge>
			)
		case 'released':
			return (
				<Badge className='bg-gray-100 text-gray-800 hover:bg-gray-200'>
					解放
				</Badge>
			)
		case 'sold':
			return (
				<Badge className='bg-purple-100 text-purple-800 hover:bg-purple-200'>
					販売
				</Badge>
			)
		case 'issued':
			return (
				<Badge className='bg-red-100 text-red-800 hover:bg-red-200'>
					出庫
				</Badge>
			)
		case 'adjusted':
			return (
				<Badge className='bg-yellow-100 text-yellow-800 hover:bg-yellow-200'>
					調整
				</Badge>
			)
		case 'returned':
			return (
				<Badge className='bg-orange-100 text-orange-800 hover:bg-orange-200'>
					返品
				</Badge>
			)
		default:
			return <Badge variant='outline'>{type}</Badge>
	}
}

export function StockDetail({
	product,
	stock,
	movements,
	tenant,
	onReceiveStock,
	onIssueStock,
	onAdjustStock,
	onUpdateReorderPoint,
}: {
	product: ProductData
	stock: StockData
	movements: MovementData[]
	tenant: string
	onReceiveStock: (quantity: number, note?: string) => Promise<void>
	onIssueStock: (quantity: number, note?: string) => Promise<void>
	onAdjustStock: (quantity: number, note?: string) => Promise<void>
	onUpdateReorderPoint: (reorderPoint: number) => Promise<void>
}) {
	const router = useRouter()
	const [receiveQty, setReceiveQty] = useState('')
	const [receiveNote, setReceiveNote] = useState('')
	const [issueQty, setIssueQty] = useState('')
	const [issueNote, setIssueNote] = useState('')
	const [adjustQty, setAdjustQty] = useState('')
	const [adjustNote, setAdjustNote] = useState('')
	const [reorderPoint, setReorderPoint] = useState(String(stock.lowStockThreshold))
	const [loading, setLoading] = useState(false)

	const handleReceive = async () => {
		const qty = Number.parseInt(receiveQty, 10)
		if (Number.isNaN(qty) || qty <= 0) return
		setLoading(true)
		try {
			await onReceiveStock(qty, receiveNote || undefined)
			setReceiveQty('')
			setReceiveNote('')
			router.refresh()
		} finally {
			setLoading(false)
		}
	}

	const handleAdjust = async () => {
		const qty = Number.parseInt(adjustQty, 10)
		if (Number.isNaN(qty) || qty === 0) return
		setLoading(true)
		try {
			await onAdjustStock(qty, adjustNote || undefined)
			setAdjustQty('')
			setAdjustNote('')
			router.refresh()
		} finally {
			setLoading(false)
		}
	}

	const handleIssue = async () => {
		const qty = Number.parseInt(issueQty, 10)
		if (Number.isNaN(qty) || qty <= 0) return
		setLoading(true)
		try {
			await onIssueStock(qty, issueNote || undefined)
			setIssueQty('')
			setIssueNote('')
			router.refresh()
		} finally {
			setLoading(false)
		}
	}

	const handleUpdateReorderPoint = async () => {
		const point = Number.parseInt(reorderPoint, 10)
		if (Number.isNaN(point) || point < 0) return
		setLoading(true)
		try {
			await onUpdateReorderPoint(point)
			router.refresh()
		} finally {
			setLoading(false)
		}
	}

	return (
		<div className='flex flex-col gap-6'>
			{/* Stock summary card */}
			<Card>
				<CardHeader>
					<div className='flex items-center justify-between'>
						<div>
							<CardTitle className='flex items-center gap-2'>
								<PackageIcon className='h-5 w-5' />
								{product.name}
							</CardTitle>
							<CardDescription>
								{product.kind} / {product.billingCycle}
							</CardDescription>
						</div>
						<div className='flex gap-2'>
							<Dialog>
								<DialogTrigger asChild>
									<Button size='sm'>
										<ArrowDownIcon className='mr-1 h-4 w-4' />
										入荷
									</Button>
								</DialogTrigger>
								<DialogContent>
									<DialogHeader>
										<DialogTitle>在庫入荷</DialogTitle>
										<DialogDescription>
											{product.name} の入荷数量を入力してください。
										</DialogDescription>
									</DialogHeader>
									<div className='flex flex-col gap-4 py-4'>
										<div>
											<Label htmlFor='receive-qty'>数量</Label>
											<Input
												id='receive-qty'
												type='number'
												min={1}
												value={receiveQty}
												onChange={e => setReceiveQty(e.target.value)}
												placeholder='入荷数量'
											/>
										</div>
										<div>
											<Label htmlFor='receive-note'>メモ（任意）</Label>
											<Input
												id='receive-note'
												value={receiveNote}
												onChange={e => setReceiveNote(e.target.value)}
												placeholder='例: 仕入先Aからの入荷'
											/>
										</div>
									</div>
									<DialogFooter>
										<DialogClose asChild>
											<Button variant='outline'>キャンセル</Button>
										</DialogClose>
										<DialogClose asChild>
											<Button onClick={handleReceive} disabled={loading}>
												入荷を記録
											</Button>
										</DialogClose>
									</DialogFooter>
								</DialogContent>
							</Dialog>

							<Dialog>
								<DialogTrigger asChild>
									<Button size='sm' variant='outline'>
										<ArrowUpIcon className='mr-1 h-4 w-4' />
										出庫
									</Button>
								</DialogTrigger>
								<DialogContent>
									<DialogHeader>
										<DialogTitle>在庫出庫</DialogTitle>
										<DialogDescription>
											{product.name} の出庫数量を入力してください。
										</DialogDescription>
									</DialogHeader>
									<div className='flex flex-col gap-4 py-4'>
										<div>
											<Label htmlFor='issue-qty'>数量</Label>
											<Input
												id='issue-qty'
												type='number'
												min={1}
												value={issueQty}
												onChange={e => setIssueQty(e.target.value)}
												placeholder='出庫数量'
											/>
										</div>
										<div>
											<Label htmlFor='issue-note'>メモ（任意）</Label>
											<Input
												id='issue-note'
												value={issueNote}
												onChange={e => setIssueNote(e.target.value)}
												placeholder='例: 破損廃棄、店舗出荷'
											/>
										</div>
									</div>
									<DialogFooter>
										<DialogClose asChild>
											<Button variant='outline'>キャンセル</Button>
										</DialogClose>
										<DialogClose asChild>
											<Button onClick={handleIssue} disabled={loading}>
												出庫を記録
											</Button>
										</DialogClose>
									</DialogFooter>
								</DialogContent>
							</Dialog>

							<Dialog>
								<DialogTrigger asChild>
									<Button size='sm' variant='outline'>
										<ArrowUpIcon className='mr-1 h-4 w-4' />
										調整
									</Button>
								</DialogTrigger>
								<DialogContent>
									<DialogHeader>
										<DialogTitle>在庫調整</DialogTitle>
										<DialogDescription>
											{product.name}{' '}
											の在庫を調整します。減らす場合はマイナスの値を入力してください。
										</DialogDescription>
									</DialogHeader>
									<div className='flex flex-col gap-4 py-4'>
										<div>
											<Label htmlFor='adjust-qty'>調整数量</Label>
											<Input
												id='adjust-qty'
												type='number'
												value={adjustQty}
												onChange={e => setAdjustQty(e.target.value)}
												placeholder='例: -5'
											/>
										</div>
										<div>
											<Label htmlFor='adjust-note'>メモ（任意）</Label>
											<Input
												id='adjust-note'
												value={adjustNote}
												onChange={e => setAdjustNote(e.target.value)}
												placeholder='例: 棚卸し差分'
											/>
										</div>
									</div>
									<DialogFooter>
										<DialogClose asChild>
											<Button variant='outline'>キャンセル</Button>
										</DialogClose>
										<DialogClose asChild>
											<Button onClick={handleAdjust} disabled={loading}>
												調整を記録
											</Button>
										</DialogClose>
									</DialogFooter>
								</DialogContent>
							</Dialog>

							<Dialog>
								<DialogTrigger asChild>
									<Button size='sm' variant='outline'>
										<SettingsIcon className='mr-1 h-4 w-4' />
										発注点
									</Button>
								</DialogTrigger>
								<DialogContent>
									<DialogHeader>
										<DialogTitle>発注点設定</DialogTitle>
										<DialogDescription>
											利用可能在庫が発注点以下になると、在庫一覧で低在庫として表示します。
										</DialogDescription>
									</DialogHeader>
									<div className='py-4'>
										<Label htmlFor='reorder-point'>発注点</Label>
										<Input
											id='reorder-point'
											type='number'
											min={0}
											value={reorderPoint}
											onChange={e => setReorderPoint(e.target.value)}
										/>
									</div>
									<DialogFooter>
										<DialogClose asChild>
											<Button variant='outline'>キャンセル</Button>
										</DialogClose>
										<DialogClose asChild>
											<Button
												onClick={handleUpdateReorderPoint}
												disabled={loading}
											>
												保存
											</Button>
										</DialogClose>
									</DialogFooter>
								</DialogContent>
							</Dialog>
						</div>
					</div>
				</CardHeader>
				<CardContent>
					<div className='grid grid-cols-2 gap-4 sm:grid-cols-4'>
						<div className='rounded-lg border p-3'>
							<p className='text-sm text-muted-foreground'>手持在庫</p>
							<p className='text-2xl font-bold'>{stock.quantityOnHand}</p>
						</div>
						<div className='rounded-lg border p-3'>
							<p className='text-sm text-muted-foreground'>予約在庫</p>
							<p className='text-2xl font-bold'>{stock.quantityReserved}</p>
						</div>
						<div className='rounded-lg border p-3'>
							<p className='text-sm text-muted-foreground'>利用可能</p>
							<p className='text-2xl font-bold'>{stock.quantityAvailable}</p>
						</div>
						<div className='rounded-lg border p-3'>
							<p className='text-sm text-muted-foreground'>発注点</p>
							<p className='text-2xl font-bold'>{stock.lowStockThreshold}</p>
						</div>
					</div>
				</CardContent>
			</Card>

			{/* Movement history */}
			<Card>
				<CardHeader>
					<CardTitle>在庫変動履歴</CardTitle>
				</CardHeader>
				<CardContent>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>種別</TableHead>
								<TableHead className='text-right'>数量</TableHead>
								<TableHead>メモ</TableHead>
								<TableHead>参照</TableHead>
								<TableHead>日時</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{movements.length === 0 && (
								<TableRow>
									<TableCell colSpan={5} className='text-center text-gray-500'>
										変動履歴がありません
									</TableCell>
								</TableRow>
							)}
							{movements.map(m => (
								<TableRow key={m.id}>
									<TableCell>{movementTypeBadge(m.movementType)}</TableCell>
									<TableCell className='text-right font-mono'>
										{m.quantity > 0 ? `+${m.quantity}` : m.quantity}
									</TableCell>
									<TableCell className='text-sm text-muted-foreground'>
										{m.note ?? '-'}
									</TableCell>
									<TableCell className='text-sm text-muted-foreground'>
										{m.referenceType
											? `${m.referenceType}: ${m.referenceId}`
											: '-'}
									</TableCell>
									<TableCell className='text-sm text-muted-foreground'>
										{new Date(m.createdAt).toLocaleString('ja-JP')}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</CardContent>
			</Card>
		</div>
	)
}
