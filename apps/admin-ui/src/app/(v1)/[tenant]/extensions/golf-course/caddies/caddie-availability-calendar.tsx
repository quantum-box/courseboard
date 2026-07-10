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
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import React from 'react'
import type {
	CaddieAvailabilityRecord,
	CaddieAvailabilityStatus,
} from './action'
import {
	deleteCaddieAvailabilityAction,
	upsertCaddieAvailabilityAction,
} from './action'

const STATUS_LABELS: Record<CaddieAvailabilityStatus, string> = {
	available: '勤務可',
	unavailable: '勤務不可',
	morning_only: '午前のみ',
	afternoon_only: '午後のみ',
	light_duty: '軽勤務',
}

const STATUS_COLORS: Record<CaddieAvailabilityStatus, string> = {
	available: 'bg-green-100 text-green-800',
	unavailable: 'bg-red-100 text-red-800',
	morning_only: 'bg-yellow-100 text-yellow-800',
	afternoon_only: 'bg-orange-100 text-orange-800',
	light_duty: 'bg-blue-100 text-blue-800',
}

function buildCalendarDays(year: number, month: number) {
	const firstDay = new Date(year, month - 1, 1)
	const lastDay = new Date(year, month, 0)
	const startDow = firstDay.getDay() // 0=Sun
	const days: (number | null)[] = Array(startDow).fill(null)
	for (let d = 1; d <= lastDay.getDate(); d++) {
		days.push(d)
	}
	// pad to full weeks
	while (days.length % 7 !== 0) days.push(null)
	return days
}

function formatDate(year: number, month: number, day: number) {
	return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function CaddieAvailabilityCalendar({
	tenant,
	caddieProfileId,
	initialAvailabilities,
	initialYear,
	initialMonth,
}: {
	tenant: string
	caddieProfileId: string
	initialAvailabilities: CaddieAvailabilityRecord[]
	initialYear: number
	initialMonth: number
}) {
	const [year, setYear] = React.useState(initialYear)
	const [month, setMonth] = React.useState(initialMonth)
	const [records, setRecords] = React.useState<
		Map<string, CaddieAvailabilityRecord>
	>(() => {
		const m = new Map<string, CaddieAvailabilityRecord>()
		for (const r of initialAvailabilities) m.set(r.date, r)
		return m
	})
	const [selected, setSelected] = React.useState<number | null>(null)
	const [editStatus, setEditStatus] =
		React.useState<CaddieAvailabilityStatus>('available')
	const [editTwoRound, setEditTwoRound] = React.useState(false)
	const [editNote, setEditNote] = React.useState('')
	const [pending, setPending] = React.useState(false)
	const [error, setError] = React.useState<string | null>(null)

	const days = buildCalendarDays(year, month)

	function prevMonth() {
		if (month === 1) {
			setYear(y => y - 1)
			setMonth(12)
		} else {
			setMonth(m => m - 1)
		}
		setSelected(null)
	}

	function nextMonth() {
		if (month === 12) {
			setYear(y => y + 1)
			setMonth(1)
		} else {
			setMonth(m => m + 1)
		}
		setSelected(null)
	}

	function selectDay(day: number) {
		setSelected(day)
		const dateStr = formatDate(year, month, day)
		const rec = records.get(dateStr)
		setEditStatus(rec?.status ?? 'available')
		setEditTwoRound(rec?.twoRoundRequest ?? false)
		setEditNote(rec?.healthNote ?? '')
		setError(null)
	}

	async function handleSave() {
		if (!selected) return
		const dateStr = formatDate(year, month, selected)
		setPending(true)
		setError(null)
		const result = await upsertCaddieAvailabilityAction(
			tenant,
			caddieProfileId,
			dateStr,
			editStatus,
			editTwoRound,
			editNote || undefined,
		)
		setPending(false)
		if (result.success) {
			setRecords(prev => {
				const next = new Map(prev)
				next.set(dateStr, {
					id: prev.get(dateStr)?.id ?? '',
					caddieProfileId,
					date: dateStr,
					status: editStatus,
					twoRoundRequest: editTwoRound,
					healthNote: editNote || null,
					updatedAt: new Date().toISOString(),
				})
				return next
			})
		} else {
			setError('message' in result ? result.message : '保存に失敗しました')
		}
	}

	async function handleDelete() {
		if (!selected) return
		const dateStr = formatDate(year, month, selected)
		setPending(true)
		setError(null)
		const result = await deleteCaddieAvailabilityAction(
			tenant,
			caddieProfileId,
			dateStr,
		)
		setPending(false)
		if (result.success) {
			setRecords(prev => {
				const next = new Map(prev)
				next.delete(dateStr)
				return next
			})
			setSelected(null)
		} else {
			setError('message' in result ? result.message : '削除に失敗しました')
		}
	}

	const selectedDateStr = selected
		? formatDate(year, month, selected)
		: null
	const selectedRecord = selectedDateStr ? records.get(selectedDateStr) : null

	return (
		<div className='grid gap-4 md:grid-cols-[1fr_280px]'>
			{/* Calendar */}
			<div className='rounded-md border bg-background'>
				<div className='flex items-center justify-between border-b px-4 py-3'>
					<button
						type='button'
						onClick={prevMonth}
						className='rounded p-1 hover:bg-muted'
					>
						<ChevronLeftIcon className='h-4 w-4' />
					</button>
					<span className='text-sm font-semibold'>
						{year}年{month}月
					</span>
					<button
						type='button'
						onClick={nextMonth}
						className='rounded p-1 hover:bg-muted'
					>
						<ChevronRightIcon className='h-4 w-4' />
					</button>
				</div>
				<div className='grid grid-cols-7 border-b text-center text-xs font-medium text-muted-foreground'>
					{['日', '月', '火', '水', '木', '金', '土'].map(d => (
						<div key={d} className='py-2'>
							{d}
						</div>
					))}
				</div>
				<div className='grid grid-cols-7'>
					{days.map((day, i) => {
						if (day === null) {
							return <div key={`empty-${i}`} className='aspect-square' />
						}
						const dateStr = formatDate(year, month, day)
						const rec = records.get(dateStr)
						const isSelected = selected === day
						return (
							<button
								key={dateStr}
								type='button'
								onClick={() => selectDay(day)}
								className={`relative flex aspect-square flex-col items-center justify-start p-1 text-xs transition hover:bg-muted/50 ${
									isSelected ? 'ring-2 ring-inset ring-primary' : ''
								}`}
							>
								<span className='font-medium'>{day}</span>
								{rec && (
									<span
										className={`mt-0.5 rounded px-1 text-[10px] leading-4 ${STATUS_COLORS[rec.status]}`}
									>
										{STATUS_LABELS[rec.status].slice(0, 3)}
									</span>
								)}
							</button>
						)
					})}
				</div>
			</div>

			{/* Edit panel */}
			<div className='rounded-md border bg-background p-4'>
				{selected ? (
					<div className='space-y-4'>
						<p className='text-sm font-semibold'>
							{year}/{String(month).padStart(2, '0')}/{String(selected).padStart(2, '0')}
						</p>
						<div className='space-y-1'>
							<Label className='text-xs'>勤務状態</Label>
							<Select
								value={editStatus}
								onValueChange={v => setEditStatus(v as CaddieAvailabilityStatus)}
							>
								<SelectTrigger className='h-8 text-xs'>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{(
										Object.keys(STATUS_LABELS) as CaddieAvailabilityStatus[]
									).map(s => (
										<SelectItem key={s} value={s} className='text-xs'>
											{STATUS_LABELS[s]}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<div className='flex items-center gap-2'>
							<input
								id='two-round'
								type='checkbox'
								checked={editTwoRound}
								onChange={e => setEditTwoRound(e.target.checked)}
								className='h-4 w-4'
							/>
							<Label htmlFor='two-round' className='cursor-pointer text-xs'>
								2ラウンド希望
							</Label>
						</div>
						<div className='space-y-1'>
							<Label className='text-xs'>体調メモ</Label>
							<textarea
								value={editNote}
								onChange={e => setEditNote(e.target.value)}
								rows={3}
								maxLength={500}
								placeholder='任意メモ（非公開）'
								className='w-full rounded-md border bg-background px-3 py-2 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring'
							/>
						</div>
						{error && <p className='text-xs text-destructive'>{error}</p>}
						<div className='flex gap-2'>
							<Button
								size='sm'
								className='flex-1 text-xs'
								disabled={pending}
								onClick={handleSave}
							>
								{pending ? '保存中…' : '保存'}
							</Button>
							{selectedRecord && (
								<Button
									size='sm'
									variant='outline'
									className='text-xs text-destructive'
									disabled={pending}
									onClick={handleDelete}
								>
									削除
								</Button>
							)}
						</div>
					</div>
				) : (
					<p className='text-sm text-muted-foreground'>
						日付を選択して勤務状態を入力してください。
					</p>
				)}
			</div>
		</div>
	)
}
