import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DataFetchError } from './data-fetch-error'

describe('orders page error state', () => {
	it('renders a visible fetch failure instead of the empty state', () => {
		const html = renderToStaticMarkup(
			<DataFetchError
				title='受注一覧を取得できませんでした'
				message='注文データの取得に失敗しました。再読み込みするか、少し待ってから再試行してください。'
				retryHref='/tenant/orders'
			/>,
		)

		expect(html).toContain('受注一覧を取得できませんでした')
		expect(html).toContain('注文データの取得に失敗しました')
		expect(html).toContain('再読み込み')
		expect(html).not.toContain('受注はありません')
	})
})
