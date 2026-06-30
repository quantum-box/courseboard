import Link from 'next/link'
import { cn } from 'lib/utils'

export const PERIODS = [
	{ key: 'today', label: '今日' },
	{ key: '7d', label: '7日間' },
	{ key: '30d', label: '30日間' },
	{ key: 'month', label: '今月' },
] as const

export type PeriodKey = (typeof PERIODS)[number]['key']

export function isPeriodKey(value: string | undefined): value is PeriodKey {
	return PERIODS.some(p => p.key === value)
}

export function PeriodSwitcher({
	tenant,
	current,
}: {
	tenant: string
	current: PeriodKey
}) {
	return (
		<div
			className='inline-flex items-center gap-1 overflow-x-auto rounded-md border bg-background p-1'
			role='tablist'
			aria-label='期間切替'
		>
			{PERIODS.map(p => {
				const active = p.key === current
				return (
					<Link
						key={p.key}
						href={`/${tenant}/home?period=${p.key}` as never}
						prefetch={false}
						role='tab'
						aria-selected={active}
						className={cn(
							'whitespace-nowrap rounded px-3 py-1.5 text-sm transition-colors',
							active
								? 'bg-primary text-primary-foreground'
								: 'text-muted-foreground hover:bg-accent',
						)}
					>
						{p.label}
					</Link>
				)
			})}
		</div>
	)
}
