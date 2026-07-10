'use client'

import * as React from 'react'
import { Badge } from 'components/ui/badge'
import { Button } from 'components/ui/button'
import { useFormState } from 'react-dom'
import type {
	ReservationNotificationKind,
	ReservationNotificationSettings,
} from './action'
import {
	ReservationMutationErrorAlert,
	initialReservationMutationActionState,
	type ReservationMutationFormAction,
} from './reservation-mutation-action-state'

const notificationRows: Array<{
	kind: ReservationNotificationKind
	label: string
	trigger: string
}> = [
	{
		kind: 'confirmation',
		label: '予約確認メール',
		trigger: '予約確定時',
	},
	{
		kind: 'reminder',
		label: '前日リマインダー',
		trigger: '来店前日',
	},
	{
		kind: 'change_cancellation',
		label: '変更/キャンセル通知',
		trigger: '変更・取消時',
	},
]

const templateVariables = [
	{
		label: '顧客名',
		token: '{{customerName}}',
	},
	{
		label: '予約番号',
		token: '{{reservationNumber}}',
	},
	{
		label: '日時',
		token: '{{startsAt}}',
	},
	{
		label: '状態',
		token: '{{status}}',
	},
	{
		label: '支払いURL',
		token: '{{checkoutUrl}}',
	},
]

export function ReservationNotificationSettingsPanel({
	action,
	settings,
}: {
	action: ReservationMutationFormAction
	settings: ReservationNotificationSettings
}) {
	const [state, formAction] = useFormState(
		action,
		initialReservationMutationActionState,
	)
	const inputRefs = React.useRef(
		new Map<string, HTMLInputElement | HTMLTextAreaElement>(),
	)
	const lastFocusedField = React.useRef(
		new Map<ReservationNotificationKind, string>(),
	)

	const setFieldRef =
		(key: string) =>
		(element: HTMLInputElement | HTMLTextAreaElement | null) => {
			if (element) {
				inputRefs.current.set(key, element)
			} else {
				inputRefs.current.delete(key)
			}
		}

	const rememberFocusedField =
		(kind: ReservationNotificationKind, field: 'subject' | 'body') => () => {
			lastFocusedField.current.set(kind, `${kind}.${field}`)
		}

	const insertVariable = (kind: ReservationNotificationKind, token: string) => {
		const fieldKey = lastFocusedField.current.get(kind) ?? `${kind}.body`
		const field = inputRefs.current.get(fieldKey)
		if (!field) {
			return
		}

		const start = field.selectionStart ?? field.value.length
		const end = field.selectionEnd ?? field.value.length
		const nextValue = `${field.value.slice(0, start)}${token}${field.value.slice(end)}`
		field.value = nextValue
		const nextCursor = start + token.length
		field.focus()
		field.setSelectionRange(nextCursor, nextCursor)
		field.dispatchEvent(new Event('input', { bubbles: true }))
	}

	return (
		<form action={formAction} className='grid gap-3 text-sm'>
			<h3 className='sr-only'>予約通知テンプレート</h3>
			<ReservationMutationErrorAlert
				state={state}
				title='通知設定の保存に失敗しました'
			/>
			<div className='overflow-hidden rounded-lg border bg-background'>
				{notificationRows.map(row => {
					const item = settings[row.kind]
					return (
						<section
							key={row.kind}
							className='grid gap-3 border-b p-4 last:border-b-0 sm:p-5'
						>
							<div className='grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start'>
								<div className='min-w-0'>
									<p className='font-medium'>{row.label}</p>
									<p className='text-xs text-muted-foreground'>{row.trigger}</p>
								</div>
								<Badge variant={item.enabled ? 'secondary' : 'outline'}>
									{item.enabled ? '有効' : '無効'}
								</Badge>
							</div>
							<div className='flex flex-wrap gap-x-4 gap-y-2'>
								<label className='flex items-center gap-2 text-xs'>
									<input
										type='checkbox'
										name={`${row.kind}.enabled`}
										defaultChecked={item.enabled}
									/>
									テンプレートを有効化
								</label>
								<label className='flex items-center gap-2 text-xs'>
									<input
										type='checkbox'
										name={`${row.kind}.autoSend`}
										defaultChecked={item.autoSend}
									/>
									自動送信トリガーを有効化
								</label>
							</div>
							<div className='grid gap-2 border-y bg-muted/20 px-3 py-3 text-xs sm:px-4'>
								<p className='font-medium text-muted-foreground'>
									差し込み変数
								</p>
								<div className='flex flex-wrap gap-2'>
									{templateVariables.map(variable => (
										<button
											className='inline-flex items-center rounded-md border bg-background px-2 py-1 font-mono text-[11px] font-medium text-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
											key={variable.token}
											onClick={() => insertVariable(row.kind, variable.token)}
											title={`${variable.label}を挿入`}
											type='button'
										>
											<span className='mr-1 rounded-sm bg-muted px-1 font-sans text-[10px] text-muted-foreground'>
												{variable.label}
											</span>
											{variable.token}
										</button>
									))}
								</div>
							</div>
							<label className='grid gap-1 text-xs'>
								<span className='text-muted-foreground'>件名</span>
								<input
									className='rounded-md border bg-background px-2 py-1'
									onFocus={rememberFocusedField(row.kind, 'subject')}
									name={`${row.kind}.subject`}
									ref={setFieldRef(`${row.kind}.subject`)}
									defaultValue={item.subject}
									required
								/>
							</label>
							<label
								className='grid gap-1 text-xs'
								htmlFor={`${row.kind}-body`}
							>
								<span className='text-muted-foreground'>本文</span>
								<TemplateBodyTextarea
									defaultValue={item.body}
									id={`${row.kind}-body`}
									name={`${row.kind}.body`}
									onFocus={rememberFocusedField(row.kind, 'body')}
									ref={setFieldRef(`${row.kind}.body`)}
								/>
							</label>
						</section>
					)
				})}
			</div>
			<div className='flex justify-end'>
				<Button type='submit' size='sm'>
					通知設定を保存
				</Button>
			</div>
		</form>
	)
}

const templateVariablePattern = /(\{\{[a-zA-Z][a-zA-Z0-9_]*\}\})/g

const TemplateBodyTextarea = React.forwardRef<
	HTMLTextAreaElement,
	{
		defaultValue: string
		id: string
		name: string
		onFocus: () => void
	}
>(({ defaultValue, id, name, onFocus }, ref) => {
	const [value, setValue] = React.useState(defaultValue)

	return (
		<div className='relative min-h-[12rem] rounded-md border bg-background'>
			<div
				aria-hidden='true'
				className='pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words px-3 py-2 text-sm leading-relaxed text-foreground'
			>
				{highlightTemplateVariables(value)}
			</div>
			<textarea
				className='relative z-10 min-h-[12rem] w-full resize-y rounded-md border-0 bg-transparent px-3 py-2 text-sm leading-relaxed text-transparent caret-foreground outline-none selection:bg-primary/20'
				defaultValue={defaultValue}
				id={id}
				name={name}
				onFocus={onFocus}
				onInput={event => setValue(event.currentTarget.value)}
				ref={ref}
				required
				spellCheck={false}
			/>
		</div>
	)
})
TemplateBodyTextarea.displayName = 'TemplateBodyTextarea'

function highlightTemplateVariables(value: string) {
	const parts = value.split(templateVariablePattern)

	return parts.map((part, index) => {
		if (templateVariablePattern.test(part)) {
			templateVariablePattern.lastIndex = 0
			return (
				<span
					className='inline-flex rounded-md border bg-muted px-1.5 py-0.5 font-mono text-[11px] font-semibold leading-none text-foreground'
					key={`${part}-${index}`}
				>
					{part}
				</span>
			)
		}
		templateVariablePattern.lastIndex = 0
		return <React.Fragment key={`${part}-${index}`}>{part}</React.Fragment>
	})
}
