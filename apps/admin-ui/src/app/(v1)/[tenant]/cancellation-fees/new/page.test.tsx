import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CancellationFeeDeliveryErrorNotice } from './form'
import { CancellationFeeSmsFields } from './sms-fields'

describe('cancellation fee delivery fields', () => {
	it('defaults to email delivery and leaves SMS opt-in', () => {
		const html = renderToStaticMarkup(
			<CancellationFeeSmsFields
				defaultEmail='guest@example.test'
				defaultMessage='キャンセル料 {amount}{currency} {url}'
			/>,
		)

		expect(html).toContain('送付先メール')
		expect(html).toContain('value="guest@example.test"')
		expect(html).toContain('name="sendEmail"')
		expect(html).toMatch(/<input[^>]+name="sendEmail"[^>]+checked=""/)
		expect(html).toContain('作成後にメール送信')
		expect(html).toContain('OFFにすると送付先メールは任意になります。')
		expect(html).toContain('name="sendSms"')
		expect(html).toContain('作成後にSMS送信')
		expect(html).toContain(
			'OFFにすると送付先電話番号とSMS同意確認は任意になります。',
		)
		expect(html).toContain('placeholder="09012345678"')
		expect(html).not.toContain('+81')
		expect(html).not.toMatch(/<input[^>]+name="sendSms"[^>]+checked=""/)
	})

	it('shows an inline resend path when invoice creation succeeds but delivery fails', () => {
		const html = renderToStaticMarkup(
			<CancellationFeeDeliveryErrorNotice
				tenant='tn_test'
				invoiceId='inv_test'
			/>,
		)

		expect(html).toContain('請求書は作成済み')
		expect(html).toContain('送信だけ失敗')
		expect(html).toContain('請求書詳細で再送する')
		expect(html).toContain('/tn_test/invoices/inv_test')
	})
})
