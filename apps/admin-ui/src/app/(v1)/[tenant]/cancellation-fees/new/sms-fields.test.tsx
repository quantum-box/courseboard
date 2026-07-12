// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CancellationFeeSmsFields } from './sms-fields'

describe('CancellationFeeSmsFields validation', () => {
	let container: HTMLDivElement
	let root: ReturnType<typeof createRoot>

	beforeEach(() => {
		Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
		container = document.createElement('div')
		document.body.append(container)
		root = createRoot(container)
		act(() => {
			root.render(
				<form>
					<CancellationFeeSmsFields
						defaultMessage='キャンセル料 {amount}{currency} {url}'
					/>
				</form>,
			)
		})
	})

	afterEach(() => {
		act(() => root.unmount())
		container.remove()
	})

	it('allows an empty email after email delivery is toggled off', () => {
		const email = container.querySelector<HTMLInputElement>(
			'input[name="clientEmail"]',
		)
		const toggle = container.querySelector<HTMLInputElement>(
			'input[name="sendEmail"]',
		)

		expect(email).not.toBeNull()
		expect(toggle).not.toBeNull()
		expect(email?.checkValidity()).toBe(false)
		expect(email?.validationMessage).toBe(
			'メール送信する場合は送付先メールを入力してください',
		)

		act(() => toggle?.click())

		expect(email?.required).toBe(false)
		expect(email?.validationMessage).toBe('')
		expect(email?.checkValidity()).toBe(true)
	})

	it('allows an empty phone after SMS delivery is toggled off', () => {
		const phone = container.querySelector<HTMLInputElement>(
			'input[name="clientPhone"]',
		)
		const toggle = container.querySelector<HTMLInputElement>(
			'input[name="sendSms"]',
		)

		expect(phone).not.toBeNull()
		expect(toggle).not.toBeNull()

		act(() => toggle?.click())
		expect(phone?.checkValidity()).toBe(false)
		expect(phone?.validationMessage).toBe(
			'SMS送信する場合は送付先電話番号を入力してください',
		)

		act(() => toggle?.click())

		expect(phone?.required).toBe(false)
		expect(phone?.validationMessage).toBe('')
		expect(phone?.checkValidity()).toBe(true)
	})
})
