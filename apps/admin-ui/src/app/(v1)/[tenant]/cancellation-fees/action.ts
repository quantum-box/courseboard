'use server'

import { joinServerBackendPath } from 'lib/serverBackendUrl'
import { authWithCheck, verifyAccessToken } from 'app/auth'
import { backendMutationFailureFromResponse } from 'lib/backend-mutation-error'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { normalizeSmsPhoneNumber } from './new/phone-number'

const PLATFORM_ID =
	process.env.NEXT_PUBLIC_PLATFORM_ID || 'tn_01hjjn348rn3t49zz6hvmfq67p'

type InvoiceData = {
	id: string
	status?: string
}

class UnverifiedUserAccessTokenError extends Error {}

export type CancellationFeeActionState = {
	status: 'idle' | 'error' | 'delivery_error'
	message?: string
	statusCode?: number
	invoiceId?: string
}

async function cancellationFeeFetch(
	path: string,
	tenant: string,
	accessToken: string,
	init?: RequestInit,
) {
	return fetch(joinServerBackendPath(path), {
		...init,
		headers: {
			...(init?.headers ?? {}),
			'Content-Type': 'application/json',
			'x-platform-id': PLATFORM_ID,
			'x-operator-id': tenant,
			Authorization: `Bearer ${accessToken}`,
		},
	})
}

async function verifiedUserAccessToken() {
	const session = await authWithCheck()
	const accessToken = session.accessToken?.trim()
	if (!accessToken || accessToken.startsWith('pk_')) {
		throw new UnverifiedUserAccessTokenError()
	}
	try {
		await verifyAccessToken(accessToken)
	} catch {
		throw new UnverifiedUserAccessTokenError()
	}
	return accessToken
}

function optionalText(value: FormDataEntryValue | null) {
	const text = String(value ?? '').trim()
	return text.length > 0 ? text : undefined
}

function errorState(
	message: string,
	statusCode?: number,
): CancellationFeeActionState {
	return { status: 'error', message, statusCode }
}

export async function createCancellationFeeAction(
	tenant: string,
	_prevState: CancellationFeeActionState,
	formData: FormData,
): Promise<CancellationFeeActionState> {
	const amount = Number(formData.get('amount') || 0)
	if (!Number.isFinite(amount) || amount <= 0) {
		return errorState('キャンセル料は1円以上で入力してください')
	}

	const sendEmail = formData.get('sendEmail') === 'on'
	const sendSms = formData.get('sendSms') === 'on'
	const clientEmail = optionalText(formData.get('clientEmail'))
	const clientPhone = normalizeSmsPhoneNumber(
		optionalText(formData.get('clientPhone')),
	)
	if (!sendEmail && !sendSms) {
		return errorState('メールまたはSMSの送信方法を選択してください')
	}
	if (sendEmail && !clientEmail) {
		return errorState('メール送信する場合は送付先メールを入力してください')
	}
	if (sendSms && !clientPhone) {
		return errorState('SMS送信する場合は送付先電話番号を入力してください')
	}
	if (sendSms && formData.get('smsConsentConfirmed') !== 'on') {
		return errorState('SMS送信前に受信者のSMS同意を確認してください')
	}

	const reference = optionalText(formData.get('reference'))
	const reason = optionalText(formData.get('reason'))
	const dueDate = optionalText(formData.get('dueDate'))
	if (!dueDate) {
		return errorState('支払期限を入力してください')
	}
	const clientId = optionalText(formData.get('clientId'))
	const clientName = optionalText(formData.get('clientName'))
	if (!clientId && !clientName) {
		return errorState('請求先名または取引先IDを入力してください')
	}

	const description = reference ? `キャンセル料 (${reference})` : 'キャンセル料'
	const notes = [
		'キャンセル料のご請求です。',
		reference ? `対象: ${reference}` : undefined,
		reason ? `理由: ${reason}` : undefined,
		optionalText(formData.get('notes')),
	]
		.filter(Boolean)
		.join('\n')

	const body = {
		clientId: clientId ?? clientName,
		clientName,
		clientEmail,
		clientPhone,
		dueDate,
		currency: 'JPY',
		taxAmount: Number(formData.get('taxAmount') || 0),
		notes,
		lineItems: [
			{
				description,
				quantity: 1,
				unitPrice: amount,
			},
		],
		createPaymentLink: true,
		paymentLinkProvider: 'stripe',
		sendEmail,
		sendSms,
		smsMessage: optionalText(formData.get('smsMessage')),
	}

	let accessToken: string
	try {
		accessToken = await verifiedUserAccessToken()
	} catch (error) {
		if (!(error instanceof UnverifiedUserAccessTokenError)) {
			throw error
		}
		return errorState(
			'請求書の作成に失敗しました。入力内容を確認して、時間をおいて再試行してください。',
		)
	}

	let res: Response
	try {
		res = await cancellationFeeFetch('/v1/invoices', tenant, accessToken, {
			method: 'POST',
			body: JSON.stringify(body),
		})
	} catch {
		return errorState(
			'請求書の作成に失敗しました。入力内容を確認して、時間をおいて再試行してください。',
		)
	}
	if (!res.ok) {
		const failure = await backendMutationFailureFromResponse(
			res,
			'請求書の作成に失敗しました',
		)
		return errorState(failure.message, failure.status)
	}

	const invoice = (await res.json()) as InvoiceData
	revalidatePath(`/${tenant}/invoices`)
	if (invoice.status === 'SendFailed') {
		return {
			status: 'delivery_error',
			invoiceId: invoice.id,
			message:
				'請求書は作成済みですが、メールまたはSMSの送信だけ失敗しました。請求書詳細から再送できます。',
		}
	}
	redirect(`/${tenant}/invoices/${invoice.id}`)
}
