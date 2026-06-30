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
import { formatNanodollarAsUsd } from 'lib/format-price'

export type TopSkuRow = {
	productId: string
	productName: string | null
	totalQuantity: number
	totalNanodollar: string
}

export function TopSkusTable({ rows }: { rows: TopSkuRow[] }) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>売上上位 SKU</CardTitle>
				<CardDescription>
					期間内の確定済み注文を売上額で集計した Top {Math.max(rows.length, 10)}{' '}
					SKU
				</CardDescription>
			</CardHeader>
			<CardContent>
				{rows.length === 0 ? (
					<div className='rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground'>
						対象期間に売上はありません。
					</div>
				) : (
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead className='w-[40px] text-center'>#</TableHead>
								<TableHead>商品名</TableHead>
								<TableHead className='hidden lg:table-cell'>商品ID</TableHead>
								<TableHead className='text-right'>数量</TableHead>
								<TableHead className='text-right'>売上</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{rows.map((row, index) => (
								<TableRow key={row.productId}>
									<TableCell className='text-center text-sm text-muted-foreground'>
										{index + 1}
									</TableCell>
									<TableCell className='font-medium'>
										{row.productName ?? '(unknown product)'}
									</TableCell>
									<TableCell className='hidden lg:table-cell font-mono text-xs text-muted-foreground'>
										{row.productId}
									</TableCell>
									<TableCell className='text-right tabular-nums'>
										{row.totalQuantity.toLocaleString()}
									</TableCell>
									<TableCell className='text-right tabular-nums font-mono'>
										{formatNanodollarAsUsd(row.totalNanodollar)}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				)}
			</CardContent>
		</Card>
	)
}
