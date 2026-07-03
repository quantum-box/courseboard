import { Badge } from 'components/ui/badge'
import type { DeliveryStatus } from '../../_lib/erp-api'

export function DeliveryStatusBadge({
	status,
}: {
	status: DeliveryStatus
}) {
	switch (status) {
		case 'received':
			return (
				<Badge className='bg-emerald-100 text-emerald-800 hover:bg-emerald-200'>
					検収済み
				</Badge>
			)
		case 'ocr_completed':
			return (
				<Badge className='bg-sky-100 text-sky-800 hover:bg-sky-200'>
					OCR完了
				</Badge>
			)
		case 'needs_review':
			return (
				<Badge className='bg-amber-100 text-amber-800 hover:bg-amber-200'>
					要確認
				</Badge>
			)
		case 'processing':
			return (
				<Badge className='bg-amber-100 text-amber-800 hover:bg-amber-200'>
					処理中
				</Badge>
			)
		case 'failed':
			return <Badge variant='destructive'>失敗</Badge>
		default:
			return <Badge variant='secondary'>下書き</Badge>
	}
}
