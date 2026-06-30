'use client'

import { Badge } from 'components/ui/badge'
import { Button } from 'components/ui/button'
import React from 'react'
import { useFormState } from 'react-dom'
import type { ReservationData, StaffMemberData, StaffShiftData } from './action'
import {
	ReservationMutationErrorAlert,
	initialReservationMutationActionState,
	type ReservationMutationFormAction,
} from './reservation-mutation-action-state'

const employmentTypeLabels: Record<string, string> = {
	full_time: '常勤',
	part_time: 'パート',
	contractor: '外部委託',
}

export function ReservationStaffAssignmentControl({
	action,
	reservation,
	shiftsByStaffId = {},
	staff,
	unavailableShiftStaffIds = [],
	size,
}: {
	action: ReservationMutationFormAction
	reservation: ReservationData
	shiftsByStaffId?: Record<string, StaffShiftData[]>
	staff: StaffMemberData[]
	unavailableShiftStaffIds?: string[]
	size?: 'sm'
}) {
	const [state, formAction] = useFormState(
		action,
		initialReservationMutationActionState,
	)
	const staffById = new Map(staff.map(member => [member.id, member]))
	const unavailableShiftStaffIdSet = new Set(unavailableShiftStaffIds)
	const assignedMembers = reservation.assignedStaffIds.map(staffId => ({
		staffId,
		member: staffById.get(staffId),
		shiftFit: staffShiftFitLabel({
			reservation,
			shifts: shiftsByStaffId[staffId] ?? [],
			unavailable: unavailableShiftStaffIdSet.has(staffId),
		}),
	}))
	const hasStaff = staff.length > 0
	const compact = size === 'sm'

	return (
		<form action={formAction} className='grid min-w-48 gap-2 text-sm'>
			<ReservationMutationErrorAlert
				state={state}
				title='担当の保存に失敗しました'
			/>
			<div className='grid gap-1'>
				<p className='text-xs font-medium text-muted-foreground'>
					担当スタッフ
				</p>
				<div className='flex flex-wrap gap-1'>
					{assignedMembers.length > 0 ? (
						assignedMembers.map(({ staffId, member, shiftFit }) => (
							<Badge
								key={staffId}
								variant={member?.active === false ? 'outline' : 'secondary'}
							>
								{member?.name ?? `未登録: ${staffId}`}
								{member?.active === false ? ' / 停止中' : ''}
								{shiftFit ? ` / ${shiftFit}` : ''}
							</Badge>
						))
					) : (
						<span className='text-xs text-muted-foreground'>未割当</span>
					)}
				</div>
			</div>
			<label className='grid gap-1'>
				<span className='text-xs text-muted-foreground'>
					複数選択で担当者を保存できます。
				</span>
				<select
					name='assignedStaffIds'
					multiple
					defaultValue={reservation.assignedStaffIds}
					disabled={!hasStaff}
					className={
						compact
							? 'min-h-20 rounded-md border bg-background p-2 text-sm'
							: 'min-h-24 rounded-md border bg-background p-2 text-base sm:text-sm'
					}
				>
					{staff.map(member => (
						<option key={member.id} value={member.id}>
							{member.name}
							{member.employmentType
								? ` / ${employmentTypeLabels[member.employmentType] ?? member.employmentType}`
								: ''}
							{member.active ? '' : ' / 停止中'}
						</option>
					))}
				</select>
			</label>
			{hasStaff ? null : (
				<p className='text-xs text-muted-foreground'>
					スタッフ未登録です。先にスタッフ管理で担当者を登録してください。
				</p>
			)}
			<Button
				type='submit'
				size={size}
				variant='outline'
				disabled={!hasStaff}
				className={compact ? 'w-fit' : 'h-11 w-full'}
			>
				担当を保存
			</Button>
		</form>
	)
}

function timeKey(value: string): string {
	const match = value.match(/T(\d{2}:\d{2})/)
	if (match) {
		return match[1]
	}
	return value.slice(0, 5)
}

function dateKey(value: string): string {
	const match = value.match(/^(\d{4}-\d{2}-\d{2})/)
	if (match) {
		return match[1]
	}
	const date = new Date(value)
	if (Number.isNaN(date.getTime())) {
		return value.slice(0, 10)
	}
	return date.toISOString().slice(0, 10)
}

function shiftTimeKey(value: string): string {
	return value.slice(0, 5)
}

function staffShiftFitLabel({
	reservation,
	shifts,
	unavailable,
}: {
	reservation: ReservationData
	shifts: StaffShiftData[]
	unavailable: boolean
}): string {
	if (unavailable) {
		return 'シフト確認不可'
	}
	if (shifts.length === 0) {
		return 'シフト未登録'
	}
	const reservationDate = dateKey(reservation.startsAt)
	const reservationStart = timeKey(reservation.startsAt)
	const reservationEnd = timeKey(reservation.endsAt)
	const coversReservation = shifts.some(
		shift =>
			shift.date === reservationDate &&
			shiftTimeKey(shift.startTime) <= reservationStart &&
			shiftTimeKey(shift.endTime) >= reservationEnd,
	)
	return coversReservation ? 'シフト内' : 'シフト外'
}
