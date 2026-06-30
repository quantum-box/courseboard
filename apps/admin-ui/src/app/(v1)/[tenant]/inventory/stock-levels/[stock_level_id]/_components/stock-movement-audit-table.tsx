import { Badge } from 'components/ui/badge'
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
import type { StockMovement } from 'app/(v1)/[tenant]/procurement/_lib/erp-api'

function formatDateTime(value: string): string {
	return new Date(value).toLocaleString('ja-JP', {
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
	})
}

function eventBadge(movement: StockMovement) {
	const className = (() => {
		switch (movement.sourceEvent) {
			case 'received_delivery':
				return 'bg-green-100 text-green-800 hover:bg-green-100'
			case 'order_paid':
				return 'bg-blue-100 text-blue-800 hover:bg-blue-100'
			case 'return_received':
				return 'bg-orange-100 text-orange-800 hover:bg-orange-100'
			case 'inventory_adjustment':
				return 'bg-yellow-100 text-yellow-800 hover:bg-yellow-100'
			case 'stock_transfer':
				return 'bg-slate-100 text-slate-800 hover:bg-slate-100'
			default:
				return ''
		}
	})()

	return className ? (
		<Badge className={className}>{movement.sourceEventLabel}</Badge>
	) : (
		<Badge variant='outline'>{movement.sourceEventLabel}</Badge>
	)
}

export function StockMovementAuditTable({
	movements,
}: {
	movements: StockMovement[]
}) {
	return (
		<Card>
			<CardHeader className='flex flex-row items-start justify-between gap-3'>
				<div>
					<CardTitle>在庫移動台帳</CardTitle>
					<CardDescription>
						数量増減の発生元イベント、参照ID、操作者、発生時刻を追跡します。
					</CardDescription>
				</div>
			</CardHeader>
			<CardContent>
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>イベント</TableHead>
							<TableHead>方向</TableHead>
							<TableHead className='text-right'>数量</TableHead>
							<TableHead>参照ID</TableHead>
							<TableHead>操作者</TableHead>
							<TableHead>発生時刻</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{movements.length === 0 ? (
							<TableRow>
								<TableCell
									colSpan={6}
									className='h-24 text-center text-sm text-muted-foreground'
								>
									在庫移動履歴はまだありません。
								</TableCell>
							</TableRow>
						) : (
							movements.map(movement => (
								<TableRow key={movement.id}>
									<TableCell>{eventBadge(movement)}</TableCell>
									<TableCell>
										{movement.direction === 'increase' ? '増加' : '減少'}
									</TableCell>
									<TableCell className='text-right font-mono tabular-nums'>
										{movement.signedQuantity > 0
											? `+${movement.signedQuantity}`
											: movement.signedQuantity}
									</TableCell>
									<TableCell className='font-mono text-xs'>
										{movement.referenceId ? (
											<div className='flex flex-col gap-1'>
												<span>{movement.referenceId}</span>
												<span className='text-muted-foreground'>
													{movement.referenceType ?? '-'}
												</span>
											</div>
										) : (
											<span className='text-muted-foreground'>-</span>
										)}
									</TableCell>
									<TableCell className='font-mono text-xs'>
										{movement.operatorId ?? (
											<span className='text-muted-foreground'>-</span>
										)}
									</TableCell>
									<TableCell className='text-sm text-muted-foreground'>
										{formatDateTime(movement.occurredAt)}
									</TableCell>
								</TableRow>
							))
						)}
					</TableBody>
				</Table>
			</CardContent>
		</Card>
	)
}
