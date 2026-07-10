'use client'

import { Badge } from 'components/ui/badge'
import { Button } from 'components/ui/button'
import React from 'react'
import { clockInCaddieStaffAction, clockOutCaddieStaffAction } from './action'
import type { CaddieAttendanceSnapshot } from './caddie-payroll-helpers'

const statusLabels: Record<
	CaddieAttendanceSnapshot['attendanceStatus'],
	string
> = {
	not_linked: 'スタッフ未紐付け',
	not_clocked: '未打刻',
	working: '勤務中',
	clocked_out: '退勤済み',
}

const statusVariant: Record<
	CaddieAttendanceSnapshot['attendanceStatus'],
	'default' | 'secondary' | 'outline' | 'destructive'
> = {
	not_linked: 'secondary',
	not_clocked: 'outline',
	working: 'default',
	clocked_out: 'secondary',
}

export function CaddieAttendanceControls({
	snapshot,
	tenant,
}: {
	snapshot: CaddieAttendanceSnapshot | undefined
	tenant: string
}) {
	if (!snapshot) {
		return <span className='text-xs text-muted-foreground'>—</span>
	}

	const staffId = snapshot.staffId
	const canClock = Boolean(staffId)
	const mismatch = snapshot.roundsWithoutClockInToday > 0

	return (
		<div className='grid gap-2'>
			<Badge variant={statusVariant[snapshot.attendanceStatus]}>
				{statusLabels[snapshot.attendanceStatus]}
			</Badge>
			{snapshot.todayAssignments > 0 ? (
				<p className='text-xs text-muted-foreground'>
					本日ラウンド: {snapshot.todayAssignments}
				</p>
			) : null}
			{mismatch ? (
				<p className='text-xs text-destructive'>
					打刻なしラウンド {snapshot.roundsWithoutClockInToday} 件
				</p>
			) : null}
			{canClock ? (
				<div className='flex flex-wrap gap-2'>
					<form action={clockInCaddieStaffAction.bind(null, tenant, staffId!)}>
						<Button
							type='submit'
							size='sm'
							variant='outline'
							disabled={snapshot.attendanceStatus === 'working'}
						>
							出勤
						</Button>
					</form>
					<form action={clockOutCaddieStaffAction.bind(null, tenant, staffId!)}>
						<Button
							type='submit'
							size='sm'
							variant='outline'
							disabled={snapshot.attendanceStatus !== 'working'}
						>
							退勤
						</Button>
					</form>
				</div>
			) : (
				<p className='text-xs text-muted-foreground'>
					勤怠記録にはスタッフ紐付けが必要です。
				</p>
			)}
		</div>
	)
}
