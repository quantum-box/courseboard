'use client'

import type { CancellationFeeActionState } from '../action'
import type { ReactNode } from 'react'
import type { Route } from 'next'
import Link from 'next/link'
import { useFormState } from 'react-dom'

const initialState: CancellationFeeActionState = { status: 'idle' }

type CancellationFeeFormAction = (
	state: CancellationFeeActionState,
	formData: FormData,
) => Promise<CancellationFeeActionState>

type CancellationFeeFormProps = {
	action: CancellationFeeFormAction
	tenant: string
	children: ReactNode
}

export function CancellationFeeForm({
	action,
	tenant,
	children,
}: CancellationFeeFormProps) {
	const [state, formAction] = useFormState(action, initialState)

	return (
		<form action={formAction} className='min-w-0 space-y-8 lg:max-w-3xl'>
			{state.status === 'error' && state.message ? (
				<div
					role='alert'
					className='space-y-1 border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive'
				>
					<p className='font-medium'>送信に失敗しました</p>
					<p>{state.message}</p>
					{state.statusCode ? (
						<p className='text-xs'>Field API status: {state.statusCode}</p>
					) : null}
				</div>
			) : null}
			{state.status === 'delivery_error' && state.invoiceId ? (
				<CancellationFeeDeliveryErrorNotice
					tenant={tenant}
					invoiceId={state.invoiceId}
					message={state.message}
				/>
			) : null}
			{children}
		</form>
	)
}

export function CancellationFeeDeliveryErrorNotice({
	tenant,
	invoiceId,
	message,
}: {
	tenant: string
	invoiceId: string
	message?: string
}) {
	return (
		<div
			role='status'
			className='space-y-2 border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950'
		>
			<p>
				{message ??
					'請求書は作成済みですが、メールまたはSMSの送信だけ失敗しました。請求書詳細から再送できます。'}
			</p>
			<Link
				href={`/${tenant}/invoices/${invoiceId}` as Route}
				className='inline-flex font-medium underline underline-offset-4'
			>
				請求書詳細で再送する
			</Link>
		</div>
	)
}
