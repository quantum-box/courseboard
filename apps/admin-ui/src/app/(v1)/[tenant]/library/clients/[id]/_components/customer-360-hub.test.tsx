import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Customer360Hub } from '.'

describe('Customer360Hub', () => {
	it('renders retryable failed sections separately from explicit empty sections', () => {
		const html = renderToStaticMarkup(
			<Customer360Hub
				tenantId='tenant-a'
				retryHref='/tenant-a/library/clients/cl_1'
				data={{
					fetchedAt: '2026-05-23T00:00:00Z',
					sections: [
						{
							key: 'deal',
							title: '商談',
							items: [],
						},
						{
							key: 'quotation',
							title: '見積',
							items: [],
							error: 'upstream timeout',
						},
					],
				}}
			/>,
		)

		expect(html).toContain('関連する商談は未接続です。')
		expect(html).toContain('見積の取得に失敗しました: upstream timeout')
		expect(html).toContain('再試行')
		expect(html).toContain('/tenant-a/library/clients/cl_1')
	})

	it('keeps tenant route prefixes on source links', () => {
		const html = renderToStaticMarkup(
			<Customer360Hub
				tenantId='tenant-a'
				retryHref='/tenant-a/library/clients/cl_1'
				data={{
					fetchedAt: '2026-05-23T00:00:00Z',
					sections: [
						{
							key: 'invoice',
							title: '請求',
							items: [
								{
									id: 'inv_1',
									kind: 'invoice',
									title: 'INV-1',
									path: '/invoices/inv_1',
									date: '2026-05-22T00:00:00Z',
								},
							],
						},
					],
				}}
			/>,
		)

		expect(html).toContain('/tenant-a/invoices/inv_1')
		expect(html).toContain('最新アクティビティ')
	})
})
