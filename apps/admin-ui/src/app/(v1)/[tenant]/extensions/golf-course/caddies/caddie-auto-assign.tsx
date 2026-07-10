'use client'

import { Button } from 'components/ui/button'
import { Input } from 'components/ui/input'
import React from 'react'
import {
	autoAssignCaddiesAction,
	type AutoAssignResult,
} from './action'

function todayJst(): string {
	return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

export function CaddieAutoAssign({ tenant }: { tenant: string }) {
	const [date, setDate] = React.useState(todayJst())
	const [plan, setPlan] = React.useState<AutoAssignResult | null>(null)
	const [pending, setPending] = React.useState<'preview' | 'run' | null>(null)
	const [message, setMessage] = React.useState<string | null>(null)
	const [error, setError] = React.useState<string | null>(null)

	async function run(dryRun: boolean) {
		setPending(dryRun ? 'preview' : 'run')
		setError(null)
		setMessage(null)
		const result = await autoAssignCaddiesAction(tenant, date, dryRun)
		setPending(null)
		if (!result.success) {
			setPlan(null)
			setError(result.message)
			return
		}
		setPlan(result.data)
		if (!dryRun) {
			setMessage(
				`${result.data.assigned.length} 件の割当を確定しました（スキップ ${result.data.skipped.length} 件）`,
			)
		}
	}

	return (
		<div className='space-y-3'>
			<div className='flex flex-wrap items-center gap-2'>
				<Input
					type='date'
					value={date}
					onChange={e => {
						setDate(e.target.value)
						setPlan(null)
						setMessage(null)
					}}
					className='h-8 w-40 text-xs'
				/>
				<Button
					type='button'
					variant='outline'
					size='sm'
					disabled={pending !== null || !date}
					onClick={() => run(true)}
				>
					{pending === 'preview' ? '算出中…' : 'プレビュー'}
				</Button>
				<Button
					type='button'
					size='sm'
					disabled={pending !== null || !date || plan === null}
					onClick={() => run(false)}
				>
					{pending === 'run' ? '実行中…' : 'この内容で自動配置を実行'}
				</Button>
			</div>
			{error && <p className='text-xs text-destructive'>{error}</p>}
			{message && <p className='text-xs text-emerald-600'>{message}</p>}
			{plan && (
				<div className='space-y-2'>
					{plan.assigned.length > 0 ? (
						<div className='overflow-x-auto'>
							<table className='w-full text-xs'>
								<thead>
									<tr className='border-b text-left text-muted-foreground'>
										<th className='pb-1 pr-3 font-medium'>時刻</th>
										<th className='pb-1 pr-3 font-medium'>予約</th>
										<th className='pb-1 pr-3 font-medium'>キャディ</th>
										<th className='pb-1 font-medium'>選定理由</th>
									</tr>
								</thead>
								<tbody className='divide-y'>
									{plan.assigned.map(item => (
										<tr key={item.reservationId}>
											<td className='py-1 pr-3'>
												{new Date(item.scheduledAt).toLocaleTimeString(
													'ja-JP',
													{
														hour: '2-digit',
														minute: '2-digit',
														timeZone: 'Asia/Tokyo',
													},
												)}
											</td>
											<td className='py-1 pr-3 text-muted-foreground'>
												{item.reservationId.slice(0, 12)}…
											</td>
											<td className='py-1 pr-3 font-medium'>
												{item.caddieDisplayName}
											</td>
											<td className='py-1 text-muted-foreground'>
												{item.rationale.join(' / ')}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					) : (
						<p className='text-xs text-muted-foreground'>
							割当対象の予約がありません（未割当のキャディ付き予約が対象です）。
						</p>
					)}
					{plan.skipped.length > 0 && (
						<div>
							<p className='text-xs font-medium text-amber-600'>
								スキップ {plan.skipped.length} 件:
							</p>
							<ul className='ml-4 list-disc text-xs text-muted-foreground'>
								{plan.skipped.map(item => (
									<li key={item.reservationId}>
										{item.reservationId.slice(0, 12)}… — {item.reason}
									</li>
								))}
							</ul>
						</div>
					)}
				</div>
			)}
		</div>
	)
}
