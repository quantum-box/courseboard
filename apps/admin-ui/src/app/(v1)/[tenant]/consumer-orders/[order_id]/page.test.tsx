import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ConsumerOrderDetailFetchError } from './_components/consumer-order-detail-fetch-error'

describe('consumer order detail error state', () => {
	it('renders fetch failure without redirecting away from the page', () => {
		const html = renderToStaticMarkup(
			<ConsumerOrderDetailFetchError
				message='注文データの取得に失敗しました。再読み込みするか、少し待ってから再試行してください。'
				listHref='/tenant/consumer-orders'
				retryHref='/tenant/consumer-orders/order_1'
			/>,
		)

		expect(html).toContain('注文データを取得できませんでした')
		expect(html).toContain('再読み込み')
		expect(html).toContain('受注管理へ戻る')
	})
})
