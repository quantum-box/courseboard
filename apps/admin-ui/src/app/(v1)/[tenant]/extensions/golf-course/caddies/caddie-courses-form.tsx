'use client'

import { Button } from 'components/ui/button'
import { Label } from 'components/ui/label'
import React from 'react'
import type { CaddieCourseMembership } from './action'
import { replaceCaddieCourseMembershipsAction } from './action'

export type GolfCourseOption = {
	id: string
	name: string
}

export function CaddieCoursesForm({
	tenant,
	caddieProfileId,
	courseOptions,
	initialMemberships,
}: {
	tenant: string
	caddieProfileId: string
	courseOptions: GolfCourseOption[]
	initialMemberships: CaddieCourseMembership[]
}) {
	const [selectedIds, setSelectedIds] = React.useState<Set<string>>(
		() => new Set(initialMemberships.map(m => m.golfCourseId)),
	)
	const [primaryId, setPrimaryId] = React.useState<string | null>(
		() =>
			initialMemberships.find(m => m.isPrimary)?.golfCourseId ?? null,
	)
	const [pending, setPending] = React.useState(false)
	const [message, setMessage] = React.useState<string | null>(null)
	const [saved, setSaved] = React.useState(false)

	function toggleCourse(courseId: string) {
		setSelectedIds(prev => {
			const next = new Set(prev)
			if (next.has(courseId)) {
				next.delete(courseId)
				if (primaryId === courseId) setPrimaryId(null)
			} else {
				next.add(courseId)
			}
			return next
		})
		setSaved(false)
	}

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault()
		setPending(true)
		setMessage(null)
		setSaved(false)
		const result = await replaceCaddieCourseMembershipsAction(
			tenant,
			caddieProfileId,
			Array.from(selectedIds),
			primaryId ?? undefined,
		)
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
		<form onSubmit={handleSubmit} className='space-y-4'>
			<div className='space-y-2'>
				{courseOptions.map(course => {
					const checked = selectedIds.has(course.id)
					return (
						<div key={course.id} className='flex items-center gap-3 rounded-md border p-3'>
							<input
								type='checkbox'
								id={`course-${course.id}`}
								checked={checked}
								onChange={() => toggleCourse(course.id)}
								className='h-4 w-4'
							/>
							<Label
								htmlFor={`course-${course.id}`}
								className='flex-1 cursor-pointer text-sm font-medium'
							>
								{course.name}
							</Label>
							{checked && (
								<div className='flex items-center gap-2'>
									<input
										type='radio'
										id={`primary-${course.id}`}
										name='primaryCourse'
										checked={primaryId === course.id}
										onChange={() => setPrimaryId(course.id)}
										className='h-4 w-4'
									/>
									<Label
										htmlFor={`primary-${course.id}`}
										className='cursor-pointer text-xs text-muted-foreground'
									>
										メイン拠点
									</Label>
								</div>
							)}
						</div>
					)
				})}
			</div>
			{message && <p className='text-xs text-destructive'>{message}</p>}
			<Button type='submit' size='sm' disabled={pending}>
				{pending ? '保存中…' : saved ? '保存済み ✓' : '対応コースを保存'}
			</Button>
		</form>
	)
}
