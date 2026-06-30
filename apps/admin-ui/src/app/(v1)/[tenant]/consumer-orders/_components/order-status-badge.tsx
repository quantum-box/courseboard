import { Badge } from 'components/ui/badge'

export function OrderStatusBadge({ status }: { status: string }) {
	switch (status) {
		case 'pending':
			return (
				<Badge className='bg-yellow-100 text-yellow-800 hover:bg-yellow-200'>
					保留中
				</Badge>
			)
		case 'placed':
			return (
				<Badge className='bg-orange-100 text-orange-800 hover:bg-orange-200'>
					注文済み
				</Badge>
			)
		case 'confirmed':
			return (
				<Badge className='bg-blue-100 text-blue-800 hover:bg-blue-200'>
					確認済み
				</Badge>
			)
		case 'preparing':
			return (
				<Badge className='bg-indigo-100 text-indigo-800 hover:bg-indigo-200'>
					準備中
				</Badge>
			)
		case 'ready':
			return (
				<Badge className='bg-emerald-100 text-emerald-800 hover:bg-emerald-200'>
					受取準備完了
				</Badge>
			)
		case 'shipped':
			return (
				<Badge className='bg-purple-100 text-purple-800 hover:bg-purple-200'>
					発送済み
				</Badge>
			)
		case 'delivered':
			return (
				<Badge className='bg-green-100 text-green-800 hover:bg-green-200'>
					配送完了
				</Badge>
			)
		case 'picked_up':
			return (
				<Badge className='bg-teal-100 text-teal-800 hover:bg-teal-200'>
					受取完了
				</Badge>
			)
		case 'cancelled':
			return <Badge variant='destructive'>キャンセル</Badge>
		default:
			return <Badge variant='outline'>{status}</Badge>
	}
}
