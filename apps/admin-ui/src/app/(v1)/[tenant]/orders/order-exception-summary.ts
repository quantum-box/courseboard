import type { OrderData } from './action'

export type OrderExceptionSummary = {
	cancellationLabel: string
	cancellationDetail: string
	returnLabel: string
	returnDetail: string
	refundLabel: string
	refundDetail: string
	inventoryLabel: string
	inventoryDetail: string
	requiresOperatorReview: boolean
}

export function summarizeOrderExceptionFlow(
	order: OrderData,
): OrderExceptionSummary {
	const isTerminal =
		order.status === 'Completed' ||
		order.status === 'Shipped' ||
		order.status === 'Cancelled'
	const canCancel = order.status === 'Pending' || order.status === 'Confirmed'
	const returnCandidate =
		order.status === 'Shipped' || order.status === 'Completed'
	const hasPayment = Boolean(order.squarePaymentId)
	const inventoryDecremented = Boolean(order.inventoryDecrementedAt)

	return {
		cancellationLabel: canCancel
			? 'キャンセル可'
			: order.status === 'Cancelled'
				? 'キャンセル済'
				: '要個別確認',
		cancellationDetail: canCancel
			? 'ステータス変更で Cancelled にできます。請求書化済みの場合は請求側の状態も確認してください。'
			: order.status === 'Cancelled'
				? '既にキャンセル済みです。返金・在庫戻しの実施状況を確認してください。'
				: '出荷後または完了後のため、返品・返金フローとして扱ってください。',
		returnLabel: returnCandidate ? '返品候補' : '通常キャンセル優先',
		returnDetail: returnCandidate
			? '出荷済みまたは完了済みです。現物回収、在庫戻し、返金要否を分けて確認してください。'
			: '出荷前のため、返品ではなくキャンセルとして処理するのが基本です。',
		refundLabel: hasPayment ? 'Square 決済あり' : '決済未連携',
		refundDetail: hasPayment
			? 'Square Payment ID があるため、返金要否と外部決済側の結果確認が必要です。'
			: 'Square Payment ID がないため、返金は別経路または不要の可能性があります。',
		inventoryLabel: inventoryDecremented ? '在庫反映済' : '在庫未反映',
		inventoryDetail: inventoryDecremented
			? '出荷または手動更新で在庫減算済みです。返品時は在庫戻しの follow-up を確認してください。'
			: '在庫減算前です。キャンセルしても在庫戻しは通常不要です。',
		requiresOperatorReview:
			isTerminal ||
			hasPayment ||
			inventoryDecremented ||
			Boolean(order.convertedInvoiceId),
	}
}
