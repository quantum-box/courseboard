'use client'

import { Button } from 'components/ui/button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from 'components/ui/dialog'
import { Input } from 'components/ui/input'
import { Label } from 'components/ui/label'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from 'components/ui/select'
import { CirclePlusIcon, Loader2 } from 'lucide-react'
import { useState, useTransition } from 'react'

type Props = {
	tenant: string
	action: (formData: FormData) => Promise<void>
}

export function CreateCouponDialog({ tenant, action }: Props) {
	const [open, setOpen] = useState(false)
	const [isPending, startTransition] = useTransition()
	const [error, setError] = useState<string | null>(null)
	const [discountType, setDiscountType] = useState('PERCENTAGE')

	const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault()
		setError(null)
		const formData = new FormData(e.currentTarget)
		formData.set('tenant', tenant)
		formData.set('discountType', discountType)
		startTransition(async () => {
			try {
				await action(formData)
				setOpen(false)
			} catch (err) {
				setError(err instanceof Error ? err.message : 'エラーが発生しました')
			}
		})
	}

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button size='sm' className='gap-1'>
					<CirclePlusIcon className='h-4 w-4' />
					クーポンを作成
				</Button>
			</DialogTrigger>
			<DialogContent className='sm:max-w-[500px]'>
				<DialogHeader>
					<DialogTitle>クーポンを作成</DialogTitle>
					<DialogDescription>
						新しいクーポンコードと割引設定を入力してください。
					</DialogDescription>
				</DialogHeader>
				<form onSubmit={handleSubmit} className='grid gap-4 py-2'>
					<div className='grid gap-2'>
						<Label htmlFor='code'>クーポンコード *</Label>
						<Input
							id='code'
							name='code'
							placeholder='例: SUMMER20'
							required
							className='uppercase'
						/>
					</div>

					<div className='grid gap-2'>
						<Label htmlFor='discountType'>割引タイプ *</Label>
						<Select
							value={discountType}
							onValueChange={setDiscountType}
							name='discountType'
						>
							<SelectTrigger id='discountType'>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value='PERCENTAGE'>パーセンテージ (%)</SelectItem>
								<SelectItem value='FIXED'>固定額 (JPY)</SelectItem>
							</SelectContent>
						</Select>
					</div>

					<div className='grid gap-2'>
						<Label htmlFor='discountValue'>
							割引値 *{' '}
							<span className='text-muted-foreground text-xs'>
								{discountType === 'PERCENTAGE' ? '(1〜100の整数)' : '(円)'}
							</span>
						</Label>
						<Input
							id='discountValue'
							name='discountValue'
							type='number'
							min={discountType === 'PERCENTAGE' ? 1 : 1}
							max={discountType === 'PERCENTAGE' ? 100 : undefined}
							required
							placeholder={
								discountType === 'PERCENTAGE' ? '例: 20' : '例: 1000'
							}
						/>
					</div>

					<div className='grid gap-2'>
						<Label htmlFor='expiresAt'>
							有効期限{' '}
							<span className='text-muted-foreground text-xs'>(任意)</span>
						</Label>
						<Input id='expiresAt' name='expiresAt' type='datetime-local' />
					</div>

					<div className='grid gap-2'>
						<Label htmlFor='exclusionGroup'>
							排他グループ{' '}
							<span className='text-muted-foreground text-xs'>(任意)</span>
						</Label>
						<Input
							id='exclusionGroup'
							name='exclusionGroup'
							placeholder='例: tws_main_campaign'
						/>
					</div>

					<div className='grid grid-cols-2 gap-4'>
						<div className='grid gap-2'>
							<Label htmlFor='usageLimit'>
								使用上限{' '}
								<span className='text-muted-foreground text-xs'>(任意)</span>
							</Label>
							<Input
								id='usageLimit'
								name='usageLimit'
								type='number'
								min={1}
								placeholder='例: 100'
							/>
						</div>
						<div className='grid gap-2'>
							<Label htmlFor='minimumOrderAmountJpy'>
								最低注文金額 (円){' '}
								<span className='text-muted-foreground text-xs'>(任意)</span>
							</Label>
							<Input
								id='minimumOrderAmountJpy'
								name='minimumOrderAmountJpy'
								type='number'
								min={0}
								placeholder='例: 3000'
							/>
						</div>
					</div>

					{error && <p className='text-sm text-destructive'>{error}</p>}

					<DialogFooter>
						<Button
							type='button'
							variant='outline'
							onClick={() => setOpen(false)}
							disabled={isPending}
						>
							キャンセル
						</Button>
						<Button type='submit' disabled={isPending}>
							{isPending && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
							作成する
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}
