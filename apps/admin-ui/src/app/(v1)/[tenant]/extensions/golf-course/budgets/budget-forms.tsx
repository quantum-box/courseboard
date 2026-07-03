'use client'

import { Button } from 'components/ui/button'
import { Input } from 'components/ui/input'
import { Label } from 'components/ui/label'
import React, { useRef } from 'react'
import { importDailyBudgetsCsvAction, upsertDailyBudgetAction } from './action'

export type GolfCourseOption = {
	id: string
	name: string
}

export function BudgetUpsertForm({
	tenant,
	courseOptions,
}: {
	tenant: string
	courseOptions: GolfCourseOption[]
}) {
	const [golfCourseId, setGolfCourseId] = React.useState(
		courseOptions[0]?.id ?? '',
	)
	const [date, setDate] = React.useState('')
	const [revenue, setRevenue] = React.useState('')
	const [avgSpend, setAvgSpend] = React.useState('')
	const [ratio, setRatio] = React.useState('')
	const [pending, setPending] = React.useState(false)
	const [message, setMessage] = React.useState<string | null>(null)
	const [saved, setSaved] = React.useState(false)

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault()
		if (!golfCourseId || !date) return
		setPending(true)
		setMessage(null)
		setSaved(false)
		const result = await upsertDailyBudgetAction(tenant, {
			golfCourseId,
			date,
			targetRevenue: Number(revenue) || 0,
			targetAverageSpend: Number(avgSpend) || 0,
			targetCaddyAttachedRatio: Number(ratio) || 0,
		})
		setPending(false)
		if (result.success) {
			setSaved(true)
		} else {
			setMessage('message' in result ? result.message : '保存に失敗しました')
		}
	}

	if (courseOptions.length === 0) {
		return (
			<p className='text-sm text-muted-foreground'>
				コースが登録されていません。先にコースマスタを設定してください。
			</p>
		)
	}

	return (
		<form onSubmit={handleSubmit} className='grid gap-3 sm:grid-cols-3'>
			<div className='space-y-1'>
				<Label className='text-xs'>コース</Label>
				<select
					value={golfCourseId}
					onChange={e => setGolfCourseId(e.target.value)}
					className='h-9 w-full rounded-md border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring'
				>
					{courseOptions.map(c => (
						<option key={c.id} value={c.id}>
							{c.name}
						</option>
					))}
				</select>
			</div>
			<div className='space-y-1'>
				<Label className='text-xs'>日付</Label>
				<Input
					type='date'
					value={date}
					onChange={e => setDate(e.target.value)}
					required
					className='h-9 text-sm'
				/>
			</div>
			<div className='space-y-1'>
				<Label className='text-xs'>目標売上（円）</Label>
				<Input
					type='number'
					value={revenue}
					onChange={e => setRevenue(e.target.value)}
					min={0}
					placeholder='0'
					className='h-9 text-sm'
				/>
			</div>
			<div className='space-y-1'>
				<Label className='text-xs'>目標客単価（円）</Label>
				<Input
					type='number'
					value={avgSpend}
					onChange={e => setAvgSpend(e.target.value)}
					min={0}
					placeholder='0'
					className='h-9 text-sm'
				/>
			</div>
			<div className='space-y-1'>
				<Label className='text-xs'>キャディ付き比率目標（0〜1）</Label>
				<Input
					type='number'
					value={ratio}
					onChange={e => setRatio(e.target.value)}
					min={0}
					max={1}
					step={0.01}
					placeholder='0.70'
					className='h-9 text-sm'
				/>
			</div>
			<div className='flex items-end'>
				<Button type='submit' size='sm' disabled={pending} className='h-9 w-full'>
					{pending ? '保存中…' : saved ? '保存済み ✓' : '保存'}
				</Button>
			</div>
			{message && (
				<p className='col-span-full text-xs text-destructive'>{message}</p>
			)}
		</form>
	)
}

export function BudgetCsvImportForm({ tenant }: { tenant: string }) {
	const fileRef = useRef<HTMLInputElement>(null)
	const [pending, setPending] = React.useState(false)
	const [message, setMessage] = React.useState<string | null>(null)
	const [result, setResult] = React.useState<string | null>(null)

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault()
		const file = fileRef.current?.files?.[0]
		if (!file) return
		setPending(true)
		setMessage(null)
		setResult(null)
		const text = await file.text()
		const res = await importDailyBudgetsCsvAction(tenant, text)
		setPending(false)
		if (res.success) {
			setResult('インポートしました')
			if (fileRef.current) fileRef.current.value = ''
		} else {
			setMessage('message' in res ? res.message : 'インポートに失敗しました')
		}
	}

	return (
		<form onSubmit={handleSubmit} className='flex flex-wrap items-end gap-3'>
			<div className='space-y-1'>
				<Label className='text-xs'>CSV ファイル</Label>
				<input
					ref={fileRef}
					type='file'
					accept='.csv,text/csv'
					required
					className='text-sm'
				/>
				<p className='text-xs text-muted-foreground'>
					ヘッダ: golf_course_id,date,target_revenue,target_average_spend,target_caddy_attached_ratio
				</p>
			</div>
			<Button type='submit' size='sm' disabled={pending} className='h-9'>
				{pending ? 'インポート中…' : 'インポート'}
			</Button>
			{result && <p className='text-xs text-green-700'>{result}</p>}
			{message && <p className='text-xs text-destructive'>{message}</p>}
		</form>
	)
}
