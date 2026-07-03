'use client'

import { Button } from 'components/ui/button'
import { Input } from 'components/ui/input'
import React from 'react'
import {
	replaceGolfProductSlotsAction,
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
}: {
	tenant: string
	serviceId: string
	initialSlots: GolfProductSlot[]
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
