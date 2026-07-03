'use client'

import { Input } from 'components/ui/input'
import { Textarea } from 'components/ui/textarea'
import * as React from 'react'
import { useState } from 'react'
import { FieldLabel, RequirementBadge } from './field-label'

type CancellationFeeSmsFieldsProps = {
	defaultEmail?: string
	defaultMessage: string
}

export function CancellationFeeSmsFields({
	defaultEmail = '',
	defaultMessage,
}: CancellationFeeSmsFieldsProps) {
	const [sendEmail, setSendEmail] = useState(true)
	const [sendSms, setSendSms] = useState(false)

	return (
		<>
			<div>
				<FieldLabel required={sendEmail} optional={!sendEmail}>
					送付先メール
				</FieldLabel>
				<Input
					name='clientEmail'
					type='email'
					defaultValue={defaultEmail}
					required={sendEmail}
					aria-required={sendEmail}
					placeholder='guest@example.com'
					onInvalid={event => {
						event.currentTarget.setCustomValidity(
							'メール送信する場合は送付先メールを入力してください',
						)
					}}
					onInput={event => {
						event.currentTarget.setCustomValidity('')
					}}
					className='mt-1 h-9'
				/>
			</div>
			<label className='flex min-h-10 items-center gap-3 border-y py-2 text-sm'>
				<input
					name='sendEmail'
					type='checkbox'
					checked={sendEmail}
					onChange={event => setSendEmail(event.currentTarget.checked)}
					className='h-4 w-4'
				/>
				<span className='space-y-0.5'>
					<span className='block'>作成後にメール送信</span>
					<span className='block text-xs text-muted-foreground'>
						OFFにすると送付先メールは任意になります。
					</span>
				</span>
			</label>
			<div>
				<FieldLabel required={sendSms} optional={!sendSms}>
					送付先電話番号
				</FieldLabel>
				<Input
					name='clientPhone'
					type='tel'
					placeholder='09012345678'
					required={sendSms}
					aria-required={sendSms}
					onInvalid={event => {
						event.currentTarget.setCustomValidity(
							'SMS送信する場合は送付先電話番号を入力してください',
						)
					}}
					onInput={event => {
						event.currentTarget.setCustomValidity('')
					}}
					className='mt-1 h-9'
				/>
			</div>
			<label className='flex min-h-10 items-center gap-3 border-y py-2 text-sm'>
				<input
					name='sendSms'
					type='checkbox'
					checked={sendSms}
					onChange={event => setSendSms(event.currentTarget.checked)}
					className='h-4 w-4'
				/>
				<span className='space-y-0.5'>
					<span className='block'>作成後にSMS送信</span>
					<span className='block text-xs text-muted-foreground'>
						OFFにすると送付先電話番号とSMS同意確認は任意になります。
					</span>
				</span>
			</label>
			<label className='flex items-start gap-2 rounded-md border bg-muted/30 p-3 text-sm leading-relaxed'>
				<input
					name='smsConsentConfirmed'
					type='checkbox'
					required={sendSms}
					disabled={!sendSms}
					className='mt-1'
				/>
				<span className='space-y-1'>
					<span className='flex items-center gap-2'>
						<span className='font-medium'>SMS同意確認</span>
						<RequirementBadge required={sendSms} />
					</span>
					<span className='block'>
						受信者が、予約・注文・請求・支払いリンク・キャンセル料・支払い確認・サポートに関する取引SMSを受信することに同意済みであることを確認しました。メッセージ頻度は取引状況により異なり、メッセージおよびデータ通信料がかかる場合があります。
					</span>
				</span>
			</label>
			<div>
				<FieldLabel optional>SMS文面</FieldLabel>
				<Textarea
					name='smsMessage'
					rows={4}
					defaultValue={defaultMessage}
					disabled={!sendSms}
					className='mt-1 min-h-24 resize-y'
				/>
			</div>
		</>
	)
}
