'use client'

import { Button } from 'components/ui/button'
import { Label } from 'components/ui/label'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from 'components/ui/select'
import React, { useActionState } from 'react'
import type { GolfReservationProduct } from './golf-product-action'
import { upsertGolfReservationProductAction } from './golf-product-action'

type PlayType = 'caddie' | 'self'

const PLAY_TYPE_LABELS: Record<PlayType, string> = {
	caddie: 'キャディ付き',
	self: 'セルフ',
}

const HOLE_OPTIONS = [
	{ value: 18, label: '18ホール' },
	{ value: 9, label: '9ホール' },
]

const DURATION_OPTIONS = [
	{ value: 240, label: '240分 (4h)' },
	{ value: 210, label: '210分 (3.5h)' },
	{ value: 180, label: '180分 (3h)' },
	{ value: 150, label: '150分 (2.5h)' },
	{ value: 120, label: '120分 (2h)' },
]

function defaultDuration(playType: PlayType, holeCount: number) {
	if (playType === 'caddie') return holeCount === 18 ? 240 : 150
	return holeCount === 18 ? 180 : 120
}

export function GolfProductConfigForm({
	tenant,
	serviceId,
	serviceName,
	existing,
}: {
	tenant: string
	serviceId: string
	serviceName: string
	existing: GolfReservationProduct | null
}) {
	const [playType, setPlayType] = React.useState<PlayType>(
		existing?.playType ?? 'caddie',
	)
	const [holeCount, setHoleCount] = React.useState(
		existing?.holeCount ?? 18,
	)
	const [duration, setDuration] = React.useState(
		existing?.expectedDurationMinutes ?? defaultDuration('caddie', 18),
	)
	const [pending, setPending] = React.useState(false)
	const [message, setMessage] = React.useState<string | null>(null)
	const [saved, setSaved] = React.useState(false)

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault()
		setPending(true)
		setMessage(null)
		setSaved(false)
		const result = await upsertGolfReservationProductAction(
			tenant,
			serviceId,
			playType,
			holeCount,
			duration,
		)
		setPending(false)
		if (result.success) {
			setSaved(true)
		} else {
			setMessage('message' in result ? result.message : '保存に失敗しました')
		}
	}

	function handlePlayTypeChange(val: string) {
		const pt = val as PlayType
		setPlayType(pt)
		setDuration(defaultDuration(pt, holeCount))
	}

	function handleHoleCountChange(val: string) {
		const hc = Number(val)
		setHoleCount(hc)
		setDuration(defaultDuration(playType, hc))
	}

	return (
		<form
			onSubmit={handleSubmit}
			className='flex flex-wrap items-end gap-3 rounded-md border bg-background px-4 py-3'
		>
			<div className='min-w-0 flex-1'>
				<p className='text-sm font-medium'>{serviceName}</p>
				<p className='text-xs text-muted-foreground'>{serviceId}</p>
			</div>
			<div className='flex flex-wrap items-end gap-2'>
				<div className='space-y-1'>
					<Label className='text-xs'>プレー区分</Label>
					<Select value={playType} onValueChange={handlePlayTypeChange}>
						<SelectTrigger className='h-8 w-32 text-xs'>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{(Object.keys(PLAY_TYPE_LABELS) as PlayType[]).map(pt => (
								<SelectItem key={pt} value={pt} className='text-xs'>
									{PLAY_TYPE_LABELS[pt]}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<div className='space-y-1'>
					<Label className='text-xs'>ホール数</Label>
					<Select
						value={String(holeCount)}
						onValueChange={handleHoleCountChange}
					>
						<SelectTrigger className='h-8 w-28 text-xs'>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{HOLE_OPTIONS.map(opt => (
								<SelectItem key={opt.value} value={String(opt.value)} className='text-xs'>
									{opt.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<div className='space-y-1'>
					<Label className='text-xs'>所要時間</Label>
					<Select
						value={String(duration)}
						onValueChange={val => setDuration(Number(val))}
					>
						<SelectTrigger className='h-8 w-36 text-xs'>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{DURATION_OPTIONS.map(opt => (
								<SelectItem key={opt.value} value={String(opt.value)} className='text-xs'>
									{opt.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<Button type='submit' size='sm' disabled={pending} className='h-8 text-xs'>
					{pending ? '保存中…' : saved ? '保存済み ✓' : '保存'}
				</Button>
			</div>
			{message && (
				<p className='w-full text-xs text-destructive'>{message}</p>
			)}
		</form>
	)
}
