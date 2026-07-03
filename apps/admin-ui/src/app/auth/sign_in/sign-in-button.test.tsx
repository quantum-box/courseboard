import React from 'react'
import { describe, expect, it } from 'vitest'
import { SignInButton } from './sign-in-button'

type FormElementProps = {
	action?: string
	children?: React.ReactNode
	method?: string
}

type InputElementProps = {
	name?: string
	value?: string
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

describe('SignInButton', () => {
	it('renders dedicated Google and Cognito Hosted UI buttons', () => {
		const text = collectText(SignInButton())

		expect(text).not.toContain('ローカルでログイン')
		expect(text).toContain('Google でログイン')
		expect(text).toContain('Cognito Hosted UI でログイン')
	})

	it('submits Google sign-in to the Auth.js Cognito endpoint', () => {
		const element = SignInButton()

		const forms = React.Children.toArray(element.props.children)
		const googleForm = forms[0]
		expect(React.isValidElement(googleForm)).toBe(true)
		if (!React.isValidElement(googleForm)) return
		const formProps = googleForm.props as FormElementProps
		expect(formProps.action).toBe('/api/auth/signin/tachyon')
		expect(formProps.method).toBe('get')
		const hiddenInput = React.Children.toArray(formProps.children)[0]
		expect(React.isValidElement(hiddenInput)).toBe(true)
		if (!React.isValidElement(hiddenInput)) return
		const inputProps = hiddenInput.props as InputElementProps
		expect(inputProps.name).toBe('identity_provider')
		expect(inputProps.value).toBe('Google')
	})

	it('submits default Hosted UI sign-in to the Auth.js Cognito endpoint', () => {
		const element = SignInButton()

		const forms = React.Children.toArray(element.props.children)
		const hostedUiForm = forms[1]
		expect(React.isValidElement(hostedUiForm)).toBe(true)
		if (!React.isValidElement(hostedUiForm)) return
		const formProps = hostedUiForm.props as FormElementProps
		expect(formProps.action).toBe('/api/auth/signin/tachyon')
		expect(formProps.method).toBe('get')
		const hiddenInputs = React.Children.toArray(formProps.children).filter(
			(child) =>
				React.isValidElement(child) &&
				(child.props as InputElementProps).name === 'identity_provider',
		)
		expect(hiddenInputs).toHaveLength(0)
	})
})
