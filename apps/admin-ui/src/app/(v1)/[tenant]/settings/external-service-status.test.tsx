import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AdminI18nProvider } from 'lib/admin-i18n'
import { ExternalServiceFetchError } from './external-service-fetch-error'

describe('external service status error state', () => {
	it('renders provider config fetch failure separately from no providers configured', () => {
		const html = renderToStaticMarkup(
			<AdminI18nProvider>
				<ExternalServiceFetchError
					loadError='連携設定と外部サービスの状態取得に失敗しました。再読み込みするか、少し待ってから再試行してください。'
					loading={false}
				/>
			</AdminI18nProvider>,
		)

		expect(html).toContain('連携設定を取得できませんでした')
		expect(html).toContain('連携設定と外部サービスの状態取得に失敗しました')
		expect(html).toContain('再読み込み')
		expect(html).not.toContain('外部サービスが設定されていません')
	})
})
