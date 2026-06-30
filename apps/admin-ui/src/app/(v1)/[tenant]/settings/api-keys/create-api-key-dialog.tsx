'use client'

import { Button } from 'components/ui/button'
import {
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from 'components/ui/dialog'
import { Input } from 'components/ui/input'
import { Label } from 'components/ui/label'
import { Loader2 } from 'lucide-react'
import { useState } from 'react'

const AVAILABLE_USE_CASES = [
	{
		value: 'field_public_payment',
		label: '公開決済',
	},
] as const

type CreateApiKeyDialogProps = {
	onSubmit: (name: string, useCases: string[]) => Promise<void>
	onClose: () => void
}

export function CreateApiKeyDialog({
	onSubmit,
	onClose,
}: CreateApiKeyDialogProps) {
	const [name, setName] = useState('')
	const [useCases, setUseCases] = useState<string[]>(['field_public_payment'])
	const [isSubmitting, setIsSubmitting] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const toggleUseCase = (useCase: string) => {
		setUseCases(prev =>
			prev.includes(useCase)
				? prev.filter(value => value !== useCase)
				: [...prev, useCase],
		)
	}

	const isValid = name.trim() !== '' && useCases.length > 0

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault()
		setError(null)
		setIsSubmitting(true)

		try {
			await onSubmit(name.trim(), useCases)
		} catch (err) {
			setError(err instanceof Error ? err.message : 'エラーが発生しました')
		} finally {
			setIsSubmitting(false)
		}
	}

	return (
		<DialogContent className='sm:max-w-[425px]'>
			<DialogHeader>
				<DialogTitle>APIキーを作成</DialogTitle>
				<DialogDescription>
					Tachyon API用のキーを作成します。
				</DialogDescription>
			</DialogHeader>
			<form onSubmit={handleSubmit}>
				<div className='grid gap-4 py-4'>
					<div className='grid gap-2'>
						<Label htmlFor='apiKeyName'>名前 *</Label>
						<Input
							id='apiKeyName'
							placeholder='例: field-public-payment'
							value={name}
							onChange={e => setName(e.target.value)}
						/>
					</div>
					<div className='grid gap-2'>
						<Label>ユースケース *</Label>
						<div className='flex flex-col gap-2'>
							{AVAILABLE_USE_CASES.map(useCase => (
								<label
									key={useCase.value}
									className='flex cursor-pointer items-center gap-2 rounded-md border p-3 text-sm'
								>
									<input
										type='checkbox'
										checked={useCases.includes(useCase.value)}
										onChange={() => toggleUseCase(useCase.value)}
										className='h-4 w-4 rounded border-gray-300'
									/>
									<span className='font-medium'>{useCase.label}</span>
								</label>
							))}
						</div>
						{useCases.length === 0 && (
							<p className='text-sm text-destructive'>
								少なくとも1つのユースケースを選択してください
							</p>
						)}
					</div>
					{error && <p className='text-sm text-destructive'>{error}</p>}
				</div>
				<DialogFooter>
					<Button type='button' variant='outline' onClick={onClose}>
						キャンセル
					</Button>
					<Button type='submit' disabled={!isValid || isSubmitting}>
						{isSubmitting && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
						作成
					</Button>
				</DialogFooter>
			</form>
		</DialogContent>
	)
}
