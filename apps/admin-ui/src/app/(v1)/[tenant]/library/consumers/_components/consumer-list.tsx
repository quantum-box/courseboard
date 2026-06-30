import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from 'components/ui/card'
import { EmptyState } from 'components/ui/page-shell'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from 'components/ui/table'
import type { GqlCustomer } from 'gen/graphql'
import { UsersIcon } from 'lucide-react'

export function ConsumerList({
	customers,
	hasMore,
}: {
	customers: GqlCustomer[]
	hasMore: boolean
}) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>コンシューマー</CardTitle>
				<CardDescription>
					購入や予約で作成された個人顧客の連絡先を確認します。
					{hasMore ? ' 100件を超える顧客があります。' : ''}
				</CardDescription>
			</CardHeader>
			<CardContent>
				{customers.length === 0 ? (
					<EmptyState
						icon={<UsersIcon />}
						title='コンシューマーがまだありません'
						description='EC注文や予約で顧客情報が作成されると、ここに表示されます。'
					/>
				) : (
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>名前</TableHead>
								<TableHead>メール</TableHead>
								<TableHead className='hidden md:table-cell'>電話番号</TableHead>
								<TableHead className='hidden lg:table-cell'>メモ</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{customers.map(customer => (
								<TableRow key={customer.id}>
									<TableCell className='font-medium'>{customer.name}</TableCell>
									<TableCell>{customer.email}</TableCell>
									<TableCell className='hidden md:table-cell'>
										{customer.phone ?? '-'}
									</TableCell>
									<TableCell className='hidden max-w-[360px] truncate lg:table-cell'>
										{customer.description ?? '-'}
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
