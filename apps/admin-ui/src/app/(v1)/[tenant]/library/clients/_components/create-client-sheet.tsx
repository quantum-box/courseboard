'use client'

import { Button } from 'components/ui/button'
import { Input } from 'components/ui/input'
import { Label } from 'components/ui/label'
import {
	Sheet,
	SheetClose,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from 'components/ui/sheet'
import { CirclePlusIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useFormState, useFormStatus } from 'react-dom'

type CreateClientSheetProps = {
	action: (formData: FormData) => void | Promise<void>
	buttonLabel?: string
	hideLabelOnMobile?: boolean
	variant?: 'default' | 'outline'
}

export function CreateClientSheet({
	action,
	buttonLabel = '取引先を追加',
	hideLabelOnMobile = true,
	variant = 'default',
}: CreateClientSheetProps) {
	const [open, setOpen] = useState(false)
	const formRef = useRef<HTMLFormElement>(null)
	const [state, formAction] = useFormState(
		async (_state: { saved: boolean; error?: string }, formData: FormData) => {
			try {
				await action(formData)
				return { saved: true }
			} catch (error) {
				return {
					saved: false,
					error:
						error instanceof Error
							? error.message
							: '取引先の保存に失敗しました',
				}
			}
		},
		{ saved: false },
	)

	useEffect(() => {
		if (!state.saved) return
		formRef.current?.reset()
		setOpen(false)
	}, [state.saved])

	return (
		<Sheet open={open} onOpenChange={setOpen}>
			<SheetTrigger asChild>
				<Button className='h-8 gap-1' size='sm' variant={variant}>
					<CirclePlusIcon className='h-3.5 w-3.5' />
					<span
						className={
							hideLabelOnMobile
								? 'sr-only sm:not-sr-only sm:whitespace-nowrap'
								: 'whitespace-nowrap'
						}
					>
						{buttonLabel}
					</span>
				</Button>
			</SheetTrigger>
			<SheetContent className='flex w-full flex-col overflow-y-auto p-0 sm:max-w-[460px]'>
				<form
					action={formAction}
					className='flex min-h-full flex-col'
					ref={formRef}
				>
					<div className='border-b px-5 py-4'>
						<SheetHeader className='space-y-1 text-left'>
							<SheetTitle>取引先を追加</SheetTitle>
							<SheetDescription>
								見積書・請求書で使う最低限の取引先情報を登録します。
							</SheetDescription>
						</SheetHeader>
					</div>

					<div className='grid flex-1 content-start gap-4 px-5 py-4'>
						<div className='grid gap-2'>
							<Label htmlFor='client-name'>取引先名</Label>
							<Input
								id='client-name'
								name='name'
								placeholder='例: 株式会社サンプル'
								required
							/>
						</div>
						{state.error ? (
							<p className='rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive'>
								{state.error}
							</p>
						) : null}

						<div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
							<div className='grid gap-2'>
								<Label htmlFor='client-email'>メール</Label>
								<Input
									id='client-email'
									name='email'
									placeholder='billing@example.com'
									type='email'
								/>
							</div>
							<div className='grid gap-2'>
								<Label htmlFor='client-phone'>電話番号</Label>
								<Input
									id='client-phone'
									name='phoneNumber'
									placeholder='03-0000-0000'
									type='tel'
								/>
							</div>
						</div>

						<div className='grid gap-2'>
							<Label htmlFor='client-industry'>業種</Label>
							<Input
								id='client-industry'
								name='industry'
								placeholder='例: 小売 / 製造 / IT'
							/>
						</div>

						<div className='grid gap-3 border-t pt-4'>
							<div className='grid grid-cols-1 gap-3 sm:grid-cols-[120px_1fr]'>
								<div className='grid gap-2'>
									<Label htmlFor='client-postal-code'>郵便番号</Label>
									<Input
										id='client-postal-code'
										name='postalCode'
										placeholder='100-0001'
									/>
								</div>
								<div className='grid gap-2'>
									<Label htmlFor='client-state'>都道府県</Label>
									<Input id='client-state' name='state' placeholder='東京都' />
								</div>
							</div>
							<div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
								<div className='grid gap-2'>
									<Label htmlFor='client-city'>市区町村</Label>
									<Input id='client-city' name='city' placeholder='千代田区' />
								</div>
								<div className='grid gap-2'>
									<Label htmlFor='client-address1'>町名・番地</Label>
									<Input
										id='client-address1'
										name='address1'
										placeholder='丸の内1-1-1'
									/>
								</div>
							</div>
							<div className='grid gap-2'>
								<Label htmlFor='client-address2'>建物名など</Label>
								<Input
									id='client-address2'
									name='address2'
									placeholder='サンプルビル 5F'
								/>
							</div>
						</div>
					</div>

					<SheetFooter className='sticky bottom-0 gap-2 border-t bg-background px-5 py-4 sm:space-x-0'>
						<SheetClose asChild>
							<Button type='button' variant='outline'>
								キャンセル
							</Button>
						</SheetClose>
						<SubmitButton />
					</SheetFooter>
				</form>
			</SheetContent>
		</Sheet>
	)
}

function SubmitButton() {
	const { pending } = useFormStatus()
	return (
		<Button disabled={pending} type='submit'>
			{pending ? '保存中...' : '保存'}
		</Button>
	)
}
