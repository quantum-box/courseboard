'use client'

import { Button } from 'components/ui/button'
import { Input } from 'components/ui/input'
import { Label } from 'components/ui/label'
import React from 'react'
import {
	updateGolfPolicyHooksAction,
	type GolfPolicyHooks,
	type SelfLockWindow,
} from './action'

const WEEKDAYS: { key: string; label: string }[] = [
	{ key: 'mon', label: '月' },
	{ key: 'tue', label: '火' },
	{ key: 'wed', label: '水' },
	{ key: 'thu', label: '木' },
	{ key: 'fri', label: '金' },
	{ key: 'sat', label: '土' },
	{ key: 'sun', label: '日' },
]

export function GolfPolicyForm({
	tenant,
	initialHooks,
}: {
	tenant: string
	initialHooks: GolfPolicyHooks | null
}) {
	const [lockEnabled, setLockEnabled] = React.useState(
		initialHooks?.selfLock?.enabled ?? false,
	)
	const [windows, setWindows] = React.useState<SelfLockWindow[]>(
		initialHooks?.selfLock?.windows ?? [
			{ weekdays: ['sat', 'sun'], start: '07:00', end: '10:00' },
		],
	)
	const [spendEnabled, setSpendEnabled] = React.useState(
		initialHooks?.spendJudgment?.enabled ?? false,
	)
	const [minPerPlayer, setMinPerPlayer] = React.useState<string>(
		initialHooks?.spendJudgment?.minPerPlayer != null
			? String(initialHooks.spendJudgment.minPerPlayer)
			: '',
	)
	const [action, setAction] = React.useState<'reject' | 'review'>(
		initialHooks?.spendJudgment?.action === 'reject' ? 'reject' : 'review',
	)
	const [pending, setPending] = React.useState(false)
	const [saved, setSaved] = React.useState(false)
	const [error, setError] = React.useState<string | null>(null)

	function updateWindow(index: number, patch: Partial<SelfLockWindow>) {
		setWindows(prev =>
			prev.map((w, i) => (i === index ? { ...w, ...patch } : w)),
		)
		setSaved(false)
	}

	function toggleWeekday(index: number, key: string) {
		setWindows(prev =>
			prev.map((w, i) => {
				if (i !== index) return w
				const has = w.weekdays.includes(key)
				return {
					...w,
					weekdays: has
						? w.weekdays.filter(d => d !== key)
						: [...w.weekdays, key],
				}
			}),
		)
		setSaved(false)
	}

	async function handleSave() {
		setPending(true)
		setError(null)
		setSaved(false)
		const hooks: GolfPolicyHooks = {
			selfLock: {
				enabled: lockEnabled,
				windows,
			},
			spendJudgment: {
				enabled: spendEnabled,
				minPerPlayer: minPerPlayer === '' ? null : Number(minPerPlayer),
				action,
			},
		}
		const result = await updateGolfPolicyHooksAction(tenant, hooks)
		setPending(false)
		if (result.success) {
			setSaved(true)
		} else {
			setError(result.message)
		}
	}

	return (
		<div className='space-y-6'>
			<section className='rounded-md border bg-background p-4'>
				<div className='mb-1 flex items-center gap-2'>
					<input
						id='self-lock-enabled'
						type='checkbox'
						checked={lockEnabled}
						onChange={e => {
							setLockEnabled(e.target.checked)
							setSaved(false)
						}}
						className='h-4 w-4'
					/>
					<Label htmlFor='self-lock-enabled' className='text-sm font-semibold'>
						セルフロック
					</Label>
				</div>
				<p className='mb-3 text-xs text-muted-foreground'>
					指定した曜日・時間帯はセルフプレー予約を受け付けません（キャディ付き優先枠）。低単価セルフによる良枠占有を防ぎます。
				</p>
				<div className='space-y-2'>
					{windows.map((w, i) => (
						<div
							key={i}
							className='flex flex-wrap items-center gap-2 rounded border p-2'
						>
							<div className='flex items-center gap-1'>
								{WEEKDAYS.map(d => (
									<button
										key={d.key}
										type='button'
										onClick={() => toggleWeekday(i, d.key)}
										className={`h-7 w-7 rounded text-xs ${
											w.weekdays.includes(d.key)
												? 'bg-primary text-primary-foreground'
												: 'border text-muted-foreground'
										}`}
									>
										{d.label}
									</button>
								))}
							</div>
							<Input
								type='time'
								value={w.start}
								onChange={e => updateWindow(i, { start: e.target.value })}
								className='h-8 w-28 text-xs'
							/>
							<span className='text-xs text-muted-foreground'>〜</span>
							<Input
								type='time'
								value={w.end}
								onChange={e => updateWindow(i, { end: e.target.value })}
								className='h-8 w-28 text-xs'
							/>
							<Button
								type='button'
								variant='ghost'
								size='sm'
								onClick={() => {
									setWindows(prev => prev.filter((_, j) => j !== i))
									setSaved(false)
								}}
								className='h-8 px-2 text-destructive hover:text-destructive'
							>
								削除
							</Button>
						</div>
					))}
					<Button
						type='button'
						variant='outline'
						size='sm'
						onClick={() => {
							setWindows(prev => [
								...prev,
								{ weekdays: [], start: '07:00', end: '10:00' },
							])
							setSaved(false)
						}}
					>
						＋ 時間帯を追加
					</Button>
				</div>
			</section>

			<section className='rounded-md border bg-background p-4'>
				<div className='mb-1 flex items-center gap-2'>
					<input
						id='spend-enabled'
						type='checkbox'
						checked={spendEnabled}
						onChange={e => {
							setSpendEnabled(e.target.checked)
							setSaved(false)
						}}
						className='h-4 w-4'
					/>
					<Label htmlFor='spend-enabled' className='text-sm font-semibold'>
						客単価判定
					</Label>
				</div>
				<p className='mb-3 text-xs text-muted-foreground'>
					1人あたり料金が基準を下回る予約を拒否、または管理者確認待ちにします。
				</p>
				<div className='flex flex-wrap items-end gap-4'>
					<div>
						<Label className='text-xs'>基準額（円/人）</Label>
						<Input
							type='number'
							value={minPerPlayer}
							onChange={e => {
								setMinPerPlayer(e.target.value)
								setSaved(false)
							}}
							placeholder='空欄 = 当日予算の目標客単価と連動'
							className='h-8 w-64 text-xs'
							min={0}
						/>
					</div>
					<div>
						<Label className='text-xs'>基準未満のとき</Label>
						<div className='flex gap-2'>
							<Button
								type='button'
								size='sm'
								variant={action === 'review' ? 'default' : 'outline'}
								onClick={() => {
									setAction('review')
									setSaved(false)
								}}
							>
								管理者確認待ちにする
							</Button>
							<Button
								type='button'
								size='sm'
								variant={action === 'reject' ? 'default' : 'outline'}
								onClick={() => {
									setAction('reject')
									setSaved(false)
								}}
							>
								予約を拒否する
							</Button>
						</div>
					</div>
				</div>
			</section>

			<div className='flex items-center gap-3'>
				<Button type='button' disabled={pending} onClick={handleSave}>
					{pending ? '保存中…' : saved ? '保存済み ✓' : 'ポリシーを保存'}
				</Button>
				{error && <p className='text-xs text-destructive'>{error}</p>}
				<p className='text-xs text-muted-foreground'>
					※ 判定の適用（予約時の拒否/保留）はバックエンド更新後に有効になります。設定自体は今すぐ保存できます。
				</p>
			</div>
		</div>
	)
}
