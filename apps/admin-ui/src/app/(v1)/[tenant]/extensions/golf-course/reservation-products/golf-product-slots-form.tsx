'use client'

import { Button } from 'components/ui/button'
import { Input } from 'components/ui/input'
import React from 'react'
import {
	fetchCaddieSlotCapacityAction,
	replaceGolfProductSlotsAction,
	type CaddieSlotCapacity,
	type GolfProductSlot,
} from './golf-product-slots-action'

const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土']

type SlotRow = {
	weekday: number
	startTime: string
	endTime: string
	maxGroups: number
	maxPlayers: number
}

function slotsToRows(slots: GolfProductSlot[]): SlotRow[] {
	return slots.map(s => ({
		weekday: s.weekday,
		startTime: s.startTime.slice(0, 5),
		endTime: s.endTime.slice(0, 5),
		maxGroups: s.maxGroups,
		maxPlayers: s.maxPlayers,
	}))
}

function emptyRow(): SlotRow {
	return { weekday: 1, startTime: '07:00', endTime: '14:00', maxGroups: 0, maxPlayers: 0 }
}

export function GolfProductSlotsForm({
	tenant,
	serviceId,
	initialSlots,
	playType,
}: {
	tenant: string
	serviceId: string
	initialSlots: GolfProductSlot[]
	playType?: 'caddie' | 'self'
}) {
	const [rows, setRows] = React.useState<SlotRow[]>(
		initialSlots.length > 0 ? slotsToRows(initialSlots) : [],
	)
	const [pending, setPending] = React.useState(false)
	const [saved, setSaved] = React.useState(false)
	const [error, setError] = React.useState<string | null>(null)

	function updateRow(index: number, patch: Partial<SlotRow>) {
		setRows(prev => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)))
		setSaved(false)
	}

	function addRow() {
		setRows(prev => [...prev, emptyRow()])
		setSaved(false)
	}

	function removeRow(index: number) {
		setRows(prev => prev.filter((_, i) => i !== index))
		setSaved(false)
	}

	// T09: キャディ稼働からの自動算出
	const [capacityDate, setCapacityDate] = React.useState('')
	const [capacity, setCapacity] = React.useState<CaddieSlotCapacity | null>(
		null,
	)
	const [capacityPending, setCapacityPending] = React.useState(false)
	const [capacityError, setCapacityError] = React.useState<string | null>(null)

	async function handleAutoCalc() {
		if (!capacityDate) return
		setCapacityPending(true)
		setCapacityError(null)
		setCapacity(null)
		const result = await fetchCaddieSlotCapacityAction(tenant, capacityDate)
		setCapacityPending(false)
		if (result.success) {
			setCapacity(result.data)
		} else {
			setCapacityError(result.message)
		}
	}

	function applyCapacity() {
		if (!capacity || !capacityDate) return
		const weekday = new Date(`${capacityDate}T00:00:00+09:00`).getUTCDay()
		const noon = '12:00'
		setRows(prev => {
			const matching = prev.filter(r => r.weekday === weekday)
			if (matching.length === 0) {
				return [
					...prev,
					{
						weekday,
						startTime: '07:00',
						endTime: noon,
						maxGroups: capacity.morningCapacity,
						maxPlayers: 0,
					},
					{
						weekday,
						startTime: noon,
						endTime: '15:00',
						maxGroups: capacity.afternoonCapacity,
						maxPlayers: 0,
					},
				]
			}
			return prev.map(r =>
				r.weekday === weekday
					? {
							...r,
							maxGroups:
								r.startTime < noon
									? capacity.morningCapacity
									: capacity.afternoonCapacity,
						}
					: r,
			)
		})
		setSaved(false)
	}

	async function handleSave() {
		setPending(true)
		setError(null)
		setSaved(false)
		const result = await replaceGolfProductSlotsAction(tenant, serviceId, rows)
		setPending(false)
		if (result.success) {
			setSaved(true)
		} else {
			setError('message' in result ? result.message : '保存に失敗しました')
		}
	}

	return (
		<div className='space-y-3'>
			{rows.length > 0 ? (
				<div className='overflow-x-auto'>
					<table className='w-full text-xs'>
						<thead>
							<tr className='border-b text-left text-muted-foreground'>
								<th className='pb-2 pr-3 font-medium'>曜日</th>
								<th className='pb-2 pr-3 font-medium'>開始</th>
								<th className='pb-2 pr-3 font-medium'>終了</th>
								<th className='pb-2 pr-3 font-medium'>最大組数</th>
								<th className='pb-2 pr-3 font-medium'>最大人数</th>
								<th className='pb-2 font-medium' />
							</tr>
						</thead>
						<tbody className='divide-y'>
							{rows.map((row, i) => (
								<tr key={i}>
									<td className='py-1.5 pr-3'>
										<select
											value={row.weekday}
											onChange={e =>
												updateRow(i, { weekday: Number(e.target.value) })
											}
											className='h-8 rounded-md border bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring'
										>
											{WEEKDAY_LABELS.map((label, d) => (
												<option key={d} value={d}>
													{label}
												</option>
											))}
										</select>
									</td>
									<td className='py-1.5 pr-3'>
										<Input
											type='time'
											value={row.startTime}
											onChange={e => updateRow(i, { startTime: e.target.value })}
											className='h-8 w-28 text-xs'
										/>
									</td>
									<td className='py-1.5 pr-3'>
										<Input
											type='time'
											value={row.endTime}
											onChange={e => updateRow(i, { endTime: e.target.value })}
											className='h-8 w-28 text-xs'
										/>
									</td>
									<td className='py-1.5 pr-3'>
										<Input
											type='number'
											value={row.maxGroups}
											onChange={e =>
												updateRow(i, { maxGroups: Number(e.target.value) || 0 })
											}
											min={0}
											placeholder='0'
											className='h-8 w-20 text-xs'
										/>
									</td>
									<td className='py-1.5 pr-3'>
										<Input
											type='number'
											value={row.maxPlayers}
											onChange={e =>
												updateRow(i, { maxPlayers: Number(e.target.value) || 0 })
											}
											min={0}
											placeholder='0'
											className='h-8 w-20 text-xs'
										/>
									</td>
									<td className='py-1.5'>
										<Button
											type='button'
											variant='ghost'
											size='sm'
											onClick={() => removeRow(i)}
											className='h-8 px-2 text-destructive hover:text-destructive'
										>
											削除
										</Button>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			) : (
				<p className='text-xs text-muted-foreground'>
					スロットがありません。追加ボタンで受付枠を設定してください。（0=制限なし）
				</p>
			)}
			{playType !== 'self' && (
				<div className='rounded-md border border-dashed p-3'>
					<p className='mb-2 text-xs font-medium'>
						キャディ稼働から枠数を自動算出
					</p>
					<div className='flex flex-wrap items-center gap-2'>
						<Input
							type='date'
							value={capacityDate}
							onChange={e => setCapacityDate(e.target.value)}
							className='h-8 w-40 text-xs'
						/>
						<Button
							type='button'
							variant='outline'
							size='sm'
							disabled={capacityPending || !capacityDate}
							onClick={handleAutoCalc}
						>
							{capacityPending ? '算出中…' : '算出'}
						</Button>
						{capacity && (
							<>
								<span className='text-xs text-muted-foreground'>
									午前 {capacity.morningCapacity} 組 / 午後{' '}
									{capacity.afternoonCapacity} 組（計 {capacity.totalRounds}{' '}
									ラウンド、稼働 {capacity.activeCaddies - capacity.unavailable}
									/{capacity.activeCaddies} 名
									{capacity.assumedAvailable > 0 &&
										`、うち${capacity.assumedAvailable}名は希望休未登録=稼働扱い`}
									）
								</span>
								<Button type='button' size='sm' onClick={applyCapacity}>
									この日の曜日の枠に反映
								</Button>
							</>
						)}
					</div>
					{capacityError && (
						<p className='mt-1 text-xs text-destructive'>{capacityError}</p>
					)}
				</div>
			)}
			<div className='flex items-center gap-2'>
				<Button type='button' variant='outline' size='sm' onClick={addRow}>
					＋ 追加
				</Button>
				<Button
					type='button'
					size='sm'
					disabled={pending}
					onClick={handleSave}
				>
					{pending ? '保存中…' : saved ? '保存済み ✓' : '保存'}
				</Button>
				{error && <p className='text-xs text-destructive'>{error}</p>}
			</div>
		</div>
	)
}
