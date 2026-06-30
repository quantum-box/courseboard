'use client'

import { Input } from 'components/ui/input'
import { Label } from 'components/ui/label'
import type { NewOperatorOwnerMethod } from 'gen/graphql'
import { Loader2 } from 'lucide-react'

export type BasicInfoData = {
	operatorName: string
	operatorAlias: string
	ownerMethod: NewOperatorOwnerMethod
}

export type AliasValidationState =
	| { status: 'idle' }
	| { status: 'checking' }
	| { status: 'available' }
	| { status: 'duplicate'; message: string }
	| { status: 'error'; message: string }

type Props = {
	data: BasicInfoData
	onChange: (data: BasicInfoData) => void
	aliasValidation: AliasValidationState
}

export function StepBasicInfo({ data, onChange, aliasValidation }: Props) {
	const aliasPattern = /^[a-z0-9-]*$/

	const update = (partial: Partial<BasicInfoData>) => {
		onChange({ ...data, ...partial })
	}

	return (
		<div className='grid gap-4'>
			<div className='grid gap-2'>
				<Label htmlFor='operatorName'>組織名 *</Label>
				<Input
					id='operatorName'
					placeholder='例: My Store'
					value={data.operatorName}
					onChange={e => update({ operatorName: e.target.value })}
				/>
			</div>

			<div className='grid gap-2'>
				<Label htmlFor='operatorAlias'>エイリアス（slug）</Label>
				<Input
					id='operatorAlias'
					placeholder='例: my-store'
					value={data.operatorAlias}
					onChange={e => update({ operatorAlias: e.target.value })}
				/>
				{data.operatorAlias && !aliasPattern.test(data.operatorAlias) && (
					<p className='text-sm text-destructive'>
						小文字英数字とハイフンのみ使用可能です
					</p>
				)}
				{data.operatorAlias &&
					aliasPattern.test(data.operatorAlias) &&
					aliasValidation.status === 'checking' && (
						<p className='flex items-center gap-2 text-sm text-muted-foreground'>
							<Loader2 className='h-4 w-4 animate-spin' />
							エイリアスの重複を確認中です
						</p>
					)}
				{data.operatorAlias &&
					aliasPattern.test(data.operatorAlias) &&
					aliasValidation.status === 'available' && (
						<p className='text-sm text-emerald-700'>
							このエイリアスは使用できます
						</p>
					)}
				{aliasValidation.status === 'duplicate' && (
					<p className='text-sm text-destructive'>{aliasValidation.message}</p>
				)}
				{aliasValidation.status === 'error' && (
					<p className='text-sm text-amber-700'>{aliasValidation.message}</p>
				)}
			</div>

			<p className='text-sm text-muted-foreground'>
				現在ログイン中のユーザーがオーナーとして設定されます
			</p>
		</div>
	)
}
