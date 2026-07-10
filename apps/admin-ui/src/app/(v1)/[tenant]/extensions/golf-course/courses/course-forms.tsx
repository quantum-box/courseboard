'use client'

import { Button } from 'components/ui/button'
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from 'components/ui/dialog'
import { Input } from 'components/ui/input'
import { Label } from 'components/ui/label'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from 'components/ui/select'
import { PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { useActionState, useState } from 'react'
import type { GolfCourse } from './action'
import {
	createGolfCourseAction,
	deleteGolfCourseAction,
	updateGolfCourseAction,
} from './action'

function CourseFormFields({
	defaultValues,
}: {
	defaultValues?: Partial<GolfCourse>
}) {
	return (
		<div className='grid gap-4'>
			<div className='grid gap-2'>
				<Label htmlFor='name'>コース名 *</Label>
				<Input
					id='name'
					name='name'
					required
					defaultValue={defaultValues?.name ?? ''}
					placeholder='真駒内カントリークラブ'
				/>
			</div>
			<div className='grid gap-2'>
				<Label htmlFor='shortName'>略称</Label>
				<Input
					id='shortName'
					name='shortName'
					defaultValue={defaultValues?.shortName ?? ''}
					placeholder='真駒内'
				/>
			</div>
			<div className='grid grid-cols-2 gap-4'>
				<div className='grid gap-2'>
					<Label htmlFor='holeCount'>ホール数</Label>
					<Select
						name='holeCount'
						defaultValue={String(defaultValues?.holeCount ?? 18)}
					>
						<SelectTrigger id='holeCount'>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value='18'>18H</SelectItem>
							<SelectItem value='9'>9H</SelectItem>
						</SelectContent>
					</Select>
				</div>
				<div className='grid gap-2'>
					<Label htmlFor='startIntervalMinutes'>スタート間隔（分）</Label>
					<Input
						id='startIntervalMinutes'
						name='startIntervalMinutes'
						type='number'
						min={1}
						max={60}
						defaultValue={defaultValues?.startIntervalMinutes ?? 10}
					/>
				</div>
			</div>
			<div className='grid gap-2'>
				<Label htmlFor='timezone'>タイムゾーン</Label>
				<Input
					id='timezone'
					name='timezone'
					defaultValue={defaultValues?.timezone ?? 'Asia/Tokyo'}
				/>
			</div>
		</div>
	)
}

export function CourseCreateForm({ tenant }: { tenant: string }) {
	const [open, setOpen] = useState(false)
	const boundAction = createGolfCourseAction.bind(null, tenant)
	const [state, formAction, pending] = useActionState(boundAction, null)

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button size='sm'>
					<PlusIcon className='mr-2 h-4 w-4' aria-hidden />
					コース追加
				</Button>
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>コース追加</DialogTitle>
				</DialogHeader>
				<form
					action={async (fd: FormData) => {
						const result = await boundAction(null, fd)
						if (result.success) {
							setOpen(false)
						}
					}}
					className='grid gap-4'
				>
					<CourseFormFields />
					{state && !state.success ? (
						<p className='text-sm text-destructive'>{state.message}</p>
					) : null}
					<Button type='submit' disabled={pending}>
						{pending ? '保存中...' : '保存'}
					</Button>
				</form>
			</DialogContent>
		</Dialog>
	)
}

export function CourseEditForm({
	tenant,
	course,
}: {
	tenant: string
	course: GolfCourse
}) {
	const [open, setOpen] = useState(false)
	const boundAction = updateGolfCourseAction.bind(null, tenant, course.id)
	const [state, , pending] = useActionState(boundAction, null)

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button size='sm' variant='outline'>
					<PencilIcon className='h-3.5 w-3.5' aria-hidden />
					<span className='sr-only'>編集</span>
				</Button>
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>コース編集</DialogTitle>
				</DialogHeader>
				<form
					action={async (fd: FormData) => {
						const result = await boundAction(null, fd)
						if (result.success) {
							setOpen(false)
						}
					}}
					className='grid gap-4'
				>
					<CourseFormFields defaultValues={course} />
					<div className='grid gap-2'>
						<Label htmlFor='isActive'>状態</Label>
						<Select
							name='isActive'
							defaultValue={course.isActive ? 'true' : 'false'}
						>
							<SelectTrigger id='isActive'>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value='true'>有効</SelectItem>
								<SelectItem value='false'>無効</SelectItem>
							</SelectContent>
						</Select>
					</div>
					{state && !state.success ? (
						<p className='text-sm text-destructive'>{state.message}</p>
					) : null}
					<Button type='submit' disabled={pending}>
						{pending ? '保存中...' : '保存'}
					</Button>
				</form>
			</DialogContent>
		</Dialog>
	)
}

export function CourseDeleteButton({
	tenant,
	course,
}: {
	tenant: string
	course: GolfCourse
}) {
	const [pending, setPending] = useState(false)

	return (
		<Button
			size='sm'
			variant='outline'
			className='text-destructive hover:text-destructive'
			disabled={pending}
			onClick={async () => {
				if (!confirm(`「${course.name}」を削除しますか？`)) return
				setPending(true)
				await deleteGolfCourseAction(tenant, course.id)
				setPending(false)
			}}
		>
			<Trash2Icon className='h-3.5 w-3.5' aria-hidden />
			<span className='sr-only'>削除</span>
		</Button>
	)
}
