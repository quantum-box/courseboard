'use client'

import { Input } from 'components/ui/input'
import { Label } from 'components/ui/label'
import React from 'react'
import { type CaddieSupply, fetchCaddieSupplyAction } from './action'

function todayInJst() {
	// ブラウザのローカル日付（倶楽部は JST 運用）を YYYY-MM-DD で。
	const d = new Date()
	const y = d.getFullYear()
	const m = String(d.getMonth() + 1).padStart(2, '0')
	const day = String(d.getDate()).padStart(2, '0')
	return `${y}-${m}-${day}`
}

function Stat({
	label,
	value,
	sub,
	tone,
}: {
	label: string
	value: string
	sub?: string
	tone?: 'default' | 'good' | 'warn'
}) {
	const valueClass =
		tone === 'warn'
			? 'text-destructive'
			: tone === 'good'
				? 'text-green-600'
				: 'text-foreground'
	return (
		<div className='rounded-md border bg-background px-3 py-2.5'>
			<div className='text-xs text-muted-foreground'>{label}</div>
			<div className={`text-2xl font-semibold ${valueClass}`}>{value}</div>
			{sub ? (
				<div className='mt-0.5 text-xs text-muted-foreground'>{sub}</div>
			) : null}
		</div>
	)
}

export function CaddieSupplyCard({ tenant }: { tenant: string }) {
	const [date, setDate] = React.useState(todayInJst)
	const [buffer, setBuffer] = React.useState(0)
	const [data, setData] = React.useState<CaddieSupply | null>(null)
	const [pending, setPending] = React.useState(false)
	const [error, setError] = React.useState<string | null>(null)

	const load = React.useCallback(
		async (d: string, b: number) => {
			if (!d) return
			setPending(true)
			setError(null)
			const result = await fetchCaddieSupplyAction(tenant, d, b)
			setPending(false)
			if (result.success) {
				setData(result.data)
			} else {
				setData(null)
				setError(
					'キャディ付枠を算出できませんでした（バックエンド更新後に有効になります）',
				)
			}
		},
		[tenant],
	)

	React.useEffect(() => {
		void load(date, buffer)
	}, [date, buffer, load])

	return (
		<div className='rounded-md border bg-background p-4'>
			<div className='mb-1 flex flex-wrap items-end justify-between gap-3'>
				<div>
					<h2 className='text-lg font-semibold'>キャディ付枠（自動算出）</h2>
					<p className='text-sm text-muted-foreground'>
						当日のキャディ供給力から、キャディ付で受けられる安全上限を自動で算出します。
					</p>
				</div>
				<div className='flex items-end gap-3'>
					<div className='space-y-1'>
						<Label className='text-xs'>対象日</Label>
						<Input
							type='date'
							value={date}
							onChange={e => setDate(e.target.value)}
							className='h-8 w-40 text-sm'
						/>
					</div>
					<div className='space-y-1'>
						<Label className='text-xs'>安全予備（組）</Label>
						<Input
							type='number'
							min={0}
							value={buffer}
							onChange={e =>
								setBuffer(Math.max(0, Math.trunc(Number(e.target.value) || 0)))
							}
							className='h-8 w-24 text-sm'
						/>
					</div>
				</div>
			</div>

			{error ? (
				<p className='py-3 text-sm text-muted-foreground'>{error}</p>
			) : data ? (
				<div className='mt-3 space-y-3'>
					<div className='grid gap-2 sm:grid-cols-4'>
						<Stat
							label='キャディ供給力（組）'
							value={String(data.caddieSupply)}
							sub={`勤務可能 ${data.availableCaddies}人・2R可 ${data.twoRoundCapable}人`}
						/>
						<Stat
							label='キャディ付上限（組）'
							value={String(data.caddieAttachedCap)}
							sub={
								data.safetyBuffer > 0
									? `安全予備 ${data.safetyBuffer} を控除`
									: undefined
							}
						/>
						<Stat
							label='現在のキャディ付き予約'
							value={String(data.currentCaddieAttached)}
						/>
						<Stat
							label='残枠'
							value={String(data.remaining)}
							tone={data.remaining < 0 ? 'warn' : 'good'}
							sub={data.remaining < 0 ? '上限を超過' : '受付可'}
						/>
					</div>
					<p className='text-xs text-muted-foreground'>
						午前対応 {data.morningCapacity}人 ・ 午後対応 {data.afternoonCapacity}
						人（2ラウンドは供給力に2組換算）。
						{pending ? '　更新中…' : ''}
					</p>
				</div>
			) : (
				<p className='py-3 text-sm text-muted-foreground'>
					{pending ? '算出中…' : '対象日を選択してください。'}
				</p>
			)}
		</div>
	)
}
