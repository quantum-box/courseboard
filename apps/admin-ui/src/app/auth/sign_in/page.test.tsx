import React from 'react'
import { describe, expect, it } from 'vitest'
import SignInPage from './page'

function collectTypeNames(
	node: React.ReactNode,
	names: string[] = [],
): string[] {
	if (Array.isArray(node)) {
		for (const child of node) collectTypeNames(child, names)
		return names
	}

	if (React.isValidElement<{ children?: React.ReactNode }>(node)) {
		const { type } = node
		if (typeof type === 'function') {
			names.push(type.name || 'Anonymous')
		} else if (typeof type === 'string') {
			names.push(type)
		}
		collectTypeNames(node.props.children, names)
	}

	return names
}

function collectText(node: React.ReactNode): string {
	if (typeof node === 'string' || typeof node === 'number') {
		return String(node)
	}

	if (Array.isArray(node)) {
		return node.map(collectText).join('')
	}

	if (React.isValidElement<{ children?: React.ReactNode }>(node)) {
		return collectText(node.props.children)
	}

	return ''
}

describe('SignInPage', () => {
	it('renders the Cognito SSO button as the only sign-in method', async () => {
		const names = collectTypeNames(await SignInPage())

		expect(names).toContain('SignInButton')
		expect(names).not.toContain('PasswordSignInForm')
	})

	it('drops the password form and the "または" divider', async () => {
		const text = collectText(await SignInPage())

		expect(text).not.toContain('または')
		expect(text).not.toContain('IDでログイン')
		expect(text).not.toContain('パスワード')
	})

	it('renders an expired-session notice from sign-out redirects', async () => {
		const text = collectText(
			await SignInPage({
				searchParams: Promise.resolve({ error: 'expired' }),
			}),
		)

		expect(text).toContain('セッションが失効しました')
		expect(text).toContain('もう一度ログインしてください')
	})
})
