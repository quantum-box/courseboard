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
import { NewOperatorOwnerMethod, type CreateOperatorInput } from 'gen/graphql'
import { Loader2 } from 'lucide-react'
import { useState } from 'react'

type CreateTenantFormProps = {
	platformId: string
	onSubmit: (input: CreateOperatorInput) => Promise<void>
	onClose?: () => void
}

export function CreateTenantForm({
	platformId,
	onSubmit,
	onClose,
}: CreateTenantFormProps) {
	const [operatorName, setOperatorName] = useState('')
	const [operatorAlias, setOperatorAlias] = useState('')
	const [isSubmitting, setIsSubmitting] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const aliasPattern = /^[a-z0-9-]+$/

	const isValid =
		operatorName.trim() !== '' &&
		(operatorAlias === '' || aliasPattern.test(operatorAlias))

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault()
		setError(null)
		setIsSubmitting(true)

		try {
			await onSubmit({
				platformId,
				operatorName: operatorName.trim(),
				operatorAlias: operatorAlias.trim() || undefined,
				newOperatorOwnerMethod: NewOperatorOwnerMethod.Inherit,
				newOperatorOwnerId: '',
			})
		} catch (err) {
			setError(err instanceof Error ? err.message : 'An error occurred')
		} finally {
			setIsSubmitting(false)
		}
	}

	return (
		<DialogContent className='sm:max-w-[425px]'>
			<DialogHeader>
				<DialogTitle>テナント作成</DialogTitle>
				<DialogDescription>
					新しいテナント（Operator）を作成します
				</DialogDescription>
			</DialogHeader>
			<form onSubmit={handleSubmit}>
				<div className='grid gap-4 py-4'>
					<div className='grid gap-2'>
						<Label htmlFor='operatorName'>組織名 *</Label>
						<Input
							id='operatorName'
							placeholder='例: My Company'
							value={operatorName}
							onChange={e => setOperatorName(e.target.value)}
						/>
					</div>
					<div className='grid gap-2'>
						<Label htmlFor='operatorAlias'>エイリアス（slug）</Label>
						<Input
							id='operatorAlias'
							placeholder='例: my-company'
							value={operatorAlias}
							onChange={e => setOperatorAlias(e.target.value)}
						/>
						{operatorAlias && !aliasPattern.test(operatorAlias) && (
							<p className='text-sm text-destructive'>
								小文字英数字とハイフンのみ使用可能です
							</p>
						)}
					</div>
					<p className='text-sm text-muted-foreground'>
						現在ログイン中のユーザーがオーナーとして設定されます
					</p>
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
