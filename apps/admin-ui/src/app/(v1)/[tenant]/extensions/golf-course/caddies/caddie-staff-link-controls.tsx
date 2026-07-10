'use client'

import { Badge } from 'components/ui/badge'
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
import type { CaddieProfile, StaffMemberOption } from './action'
import { linkCaddieStaffMemberAction } from './action'
import {
	isCaddieStaffLinked,
	resolveStaffMemberId,
} from './caddie-payroll-helpers'
import { filterStaffMemberOptions } from './caddie-staff-helpers'

export function CaddieStaffLinkControls({
	tenant,
	profile,
	staffOptions,
}: {
	tenant: string
	profile: CaddieProfile
	staffOptions: StaffMemberOption[]
}) {
	const router = useRouter()
	const linkedStaffId = resolveStaffMemberId(profile)
	const [selectedStaffId, setSelectedStaffId] = React.useState(
		linkedStaffId ?? '',
	)
	const [staffSearch, setStaffSearch] = React.useState('')
	const [pending, setPending] = React.useState(false)
	const [message, setMessage] = React.useState<string | null>(null)
	const filteredStaffOptions = filterStaffMemberOptions(
		staffOptions,
		staffSearch,
	)

	if (isCaddieStaffLinked(profile)) {
		return (
			<div className='grid gap-1'>
				<Badge variant='outline'>紐付け済み</Badge>
				<p className='text-xs text-muted-foreground break-all'>
					{linkedStaffId}
				</p>
			</div>
		)
	}

	return (
		<div className='grid gap-2'>
			<Badge variant='destructive'>未紐付け</Badge>
			<div className='grid gap-1'>
				<Label className='text-xs'>スタッフ検索</Label>
				<Input
					className='h-8 text-xs'
					value={staffSearch}
					onChange={event => setStaffSearch(event.target.value)}
					placeholder='名前またはスタッフID'
				/>
			</div>
			<Select value={selectedStaffId} onValueChange={setSelectedStaffId}>
				<SelectTrigger className='h-8 text-xs'>
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
			<Button
				type='button'
				size='sm'
				variant='secondary'
				disabled={!selectedStaffId || pending}
				onClick={async () => {
					setPending(true)
					setMessage(null)
					const result = await linkCaddieStaffMemberAction(
						tenant,
						profile.id,
						selectedStaffId,
					)
					setPending(false)
					if (!result.success) {
						setMessage(result.message ?? 'スタッフを紐付けできませんでした。')
						return
					}
					setMessage('紐付けました。')
					router.refresh()
				}}
			>
				{pending ? '紐付け中...' : 'スタッフを紐付け'}
			</Button>
			{message ? (
				<p
					className={`text-xs ${message === '紐付けました。' ? 'text-muted-foreground' : 'text-destructive'}`}
				>
					{message}
				</p>
			) : null}
		</div>
	)
}
