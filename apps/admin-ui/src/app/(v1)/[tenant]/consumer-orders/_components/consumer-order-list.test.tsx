import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ConsumerOrderFetchError } from './consumer-order-fetch-error'

describe('consumer order list error state', () => {
	it('renders fetch failure separately from the empty order state', () => {
		const html = renderToStaticMarkup(
			<ConsumerOrderFetchError
				message='注文データの取得に失敗しました。再読み込みするか、少し待ってから再試行してください。'
				retryHref='/tenant/consumer-orders'
			/>,
		)

		expect(html).toContain('注文データを取得できませんでした')
		expect(html).toContain('注文データの取得に失敗しました')
		expect(html).toContain('再読み込み')
		expect(html).not.toContain('注文がありません')
	})
})
