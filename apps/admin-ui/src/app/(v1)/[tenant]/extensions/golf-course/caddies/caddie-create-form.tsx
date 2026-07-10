'use client'

import { Button } from 'components/ui/button'
import { Input } from 'components/ui/input'
import { Label } from 'components/ui/label'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from 'components/ui/select'
import { useRouter } from 'next/navigation'
import React from 'react'
import type { StaffMemberOption } from './action'
import { createCaddieWithStaffAction } from './action'
import { filterStaffMemberOptions } from './caddie-staff-helpers'

type StaffMode = 'existing' | 'new'

export function CaddieCreateForm({
	tenant,
	staffOptions,
}: {
	tenant: string
	staffOptions: StaffMemberOption[]
}) {
	const router = useRouter()
	const [open, setOpen] = React.useState(false)
	const [staffMode, setStaffMode] = React.useState<StaffMode>('existing')
	const [staffSearch, setStaffSearch] = React.useState('')
	const [selectedStaffId, setSelectedStaffId] = React.useState('')
	const [newStaffName, setNewStaffName] = React.useState('')
	const [displayName, setDisplayName] = React.useState('')
	const [skillLevel, setSkillLevel] = React.useState<
		'rookie' | 'regular' | 'veteran'
	>('regular')
	const [rank, setRank] = React.useState<'A' | 'B' | 'C' | 'D'>('D')
	const [baseFeeAmount, setBaseFeeAmount] = React.useState('12000')
	const [pending, setPending] = React.useState(false)
	const [message, setMessage] = React.useState<string | null>(null)

	const filteredStaffOptions = filterStaffMemberOptions(
		staffOptions,
		staffSearch,
	)

	if (!open) {
		return (
			<Button type='button' size='sm' onClick={() => setOpen(true)}>
				キャディを追加
			</Button>
		)
	}

	return (
		<form
			className='grid gap-3 rounded-md border p-4'
			onSubmit={async event => {
				event.preventDefault()
				setPending(true)
				setMessage(null)
				const result = await createCaddieWithStaffAction(tenant, {
					displayName: displayName.trim(),
					skillLevel,
					rank,
					baseFeeAmount: Number.parseInt(baseFeeAmount, 10) || 0,
					staffMemberId: staffMode === 'existing' ? selectedStaffId : undefined,
					newStaffMemberName:
						staffMode === 'new' ? newStaffName.trim() : undefined,
				})
				setPending(false)
				if (!result.success) {
					setMessage(result.message ?? 'キャディを作成できませんでした。')
					return
				}
				setOpen(false)
				setDisplayName('')
				setNewStaffName('')
				setSelectedStaffId('')
				setStaffSearch('')
				router.refresh()
			}}
		>
			<div className='flex items-center justify-between gap-2'>
				<p className='text-sm font-medium'>新しいキャディプロフィール</p>
				<Button
					type='button'
					variant='ghost'
					size='sm'
					onClick={() => setOpen(false)}
				>
					キャンセル
				</Button>
			</div>
			<p className='text-xs text-muted-foreground'>
				勤怠と給与CSVで扱うため、キャディは TACHYON Field
				のスタッフと紐付けます。
			</p>
			<div className='grid gap-2'>
				<Label htmlFor='caddie-display-name'>表示名</Label>
				<Input
					id='caddie-display-name'
					value={displayName}
					onChange={event => setDisplayName(event.target.value)}
					required
				/>
			</div>
			<div className='grid gap-2 sm:grid-cols-3'>
				<div className='grid gap-2'>
					<Label>スキル</Label>
					<Select
						value={skillLevel}
						onValueChange={value =>
							setSkillLevel(value as 'rookie' | 'regular' | 'veteran')
						}
					>
						<SelectTrigger>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value='rookie'>新人</SelectItem>
							<SelectItem value='regular'>通常</SelectItem>
							<SelectItem value='veteran'>ベテラン</SelectItem>
						</SelectContent>
					</Select>
				</div>
				<div className='grid gap-2'>
					<Label>ランク</Label>
					<Select
						value={rank}
						onValueChange={value => setRank(value as 'A' | 'B' | 'C' | 'D')}
					>
						<SelectTrigger>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value='A'>A (41R/月)</SelectItem>
							<SelectItem value='B'>B (33R/月)</SelectItem>
							<SelectItem value='C'>C (25R/月)</SelectItem>
							<SelectItem value='D'>D (14R/月)</SelectItem>
						</SelectContent>
					</Select>
				</div>
				<div className='grid gap-2'>
					<Label htmlFor='caddie-base-fee'>基本費用（円）</Label>
					<Input
						id='caddie-base-fee'
						type='number'
						min={0}
						value={baseFeeAmount}
						onChange={event => setBaseFeeAmount(event.target.value)}
						required
					/>
				</div>
			</div>
			<div className='grid gap-2'>
				<Label>スタッフ</Label>
				<Select
					value={staffMode}
					onValueChange={value => setStaffMode(value as StaffMode)}
				>
					<SelectTrigger>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value='existing'>既存スタッフに紐付け</SelectItem>
						<SelectItem value='new'>新しいスタッフを作成</SelectItem>
					</SelectContent>
				</Select>
			</div>
			{staffMode === 'existing' ? (
				<div className='grid gap-2'>
					<Label htmlFor='staff-search'>スタッフ検索</Label>
					<Input
						id='staff-search'
						value={staffSearch}
						onChange={event => setStaffSearch(event.target.value)}
						placeholder='名前またはスタッフID'
					/>
					<Select value={selectedStaffId} onValueChange={setSelectedStaffId}>
						<SelectTrigger>
							<SelectValue placeholder='スタッフを選択' />
						</SelectTrigger>
						<SelectContent>
							{filteredStaffOptions.map(option => (
								<SelectItem key={option.id} value={option.id}>
									{option.name} ({option.id})
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			) : (
				<div className='grid gap-2'>
					<Label htmlFor='new-staff-name'>新しいスタッフ名</Label>
					<Input
						id='new-staff-name'
						value={newStaffName}
						onChange={event => setNewStaffName(event.target.value)}
						required
					/>
				</div>
			)}
			<Button type='submit' disabled={pending}>
				{pending ? '作成中...' : 'キャディを作成'}
			</Button>
			{message ? <p className='text-xs text-destructive'>{message}</p> : null}
		</form>
	)
}
