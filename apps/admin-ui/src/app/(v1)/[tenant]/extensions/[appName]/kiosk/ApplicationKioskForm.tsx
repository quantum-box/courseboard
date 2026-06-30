'use client'

import { Button } from 'components/ui/button'
import { Input } from 'components/ui/input'
import { Label } from 'components/ui/label'
import { Textarea } from 'components/ui/textarea'
import {
	CalendarClockIcon,
	CheckCircle2Icon,
	CreditCardIcon,
	ShieldCheckIcon,
	UserRoundIcon,
} from 'lucide-react'
import React, { useMemo, useState } from 'react'
import { useFormState } from 'react-dom'
import type {
	ExtensionApplicationConfigData,
	ExtensionApplicationCourseData,
	ExtensionApplicationFieldData,
	ReservationResourceData,
} from '../../../reservations/action'
import {
	ReservationMutationErrorAlert,
	initialReservationMutationActionState,
	type ReservationMutationFormAction,
} from '../../../reservations/reservation-mutation-action-state'

const yen = new Intl.NumberFormat('ja-JP', {
	style: 'currency',
	currency: 'JPY',
	maximumFractionDigits: 0,
})

export function ApplicationKioskForm({
	action,
	config,
	disabled,
	resources,
}: {
	action: ReservationMutationFormAction
	config: ExtensionApplicationConfigData
	disabled?: boolean
	resources: ReservationResourceData[]
}) {
	const [state, formAction] = useFormState(
		action,
		initialReservationMutationActionState,
	)
	const subjectGroup = config.subjectGroups[0]
	const [startsAt, setStartsAt] = useState(defaultStartsAt())
	const [subjectCount, setSubjectCount] = useState(1)
	const course = useMemo(
		() => selectCourse(config.courses, new Date(startsAt)),
		[config.courses, startsAt],
	)
	const price = priceForSubjectCount(course, subjectCount)
	const subjects = Array.from({ length: subjectCount }, (_, index) => index)

	return (
		<form action={formAction} className='grid gap-6 xl:grid-cols-[1fr_360px]'>
			<input type='hidden' name='durationMinutes' value='60' />
			<div className='grid gap-5'>
				<ReservationMutationErrorAlert
					state={state}
					title='受付の登録に失敗しました'
				/>
				<section className='rounded-md border bg-background p-5'>
					<SectionTitle icon={<CalendarClockIcon />} title='利用日時' />
					<div className='grid gap-4 md:grid-cols-3'>
						<Label className='grid gap-2 text-base font-semibold md:col-span-2'>
							利用開始
							<Input
								name='startsAt'
								type='datetime-local'
								required
								value={startsAt}
								onChange={event => setStartsAt(event.target.value)}
								className='h-[56px] text-lg'
							/>
						</Label>
						<Label className='grid gap-2 text-base font-semibold'>
							{subjectGroup.countLabel}
							<select
								name='subjectCount'
								value={subjectCount}
								onChange={event => setSubjectCount(Number(event.target.value))}
								className='flex h-[56px] rounded-md border border-input bg-background px-4 text-lg'
							>
								{Array.from(
									{ length: Math.max(1, Math.min(subjectGroup.maxCount, 2)) },
									(_, index) => index + 1,
								).map(count => (
									<option key={count} value={count}>
										{count}
									</option>
								))}
							</select>
						</Label>
						<Label className='grid gap-2 text-base font-semibold md:col-span-3'>
							利用エリア
							<select
								name='resourceId'
								className='flex h-[56px] rounded-md border border-input bg-background px-4 text-lg'
							>
								<option value=''>指定なし</option>
								{resources.map(resource => (
									<option key={resource.id} value={resource.id}>
										{resource.name}
									</option>
								))}
							</select>
						</Label>
					</div>
				</section>

				<section className='rounded-md border bg-background p-5'>
					<SectionTitle icon={<ShieldCheckIcon />} title='確認事項' />
					<div className='grid gap-3'>
						{config.consentItems.map(item => (
							<label
								key={item.key}
								className='flex gap-4 rounded-md border bg-muted/30 p-4 text-base leading-7'
							>
								<input
									name={item.key}
									type='checkbox'
									required={item.required}
									className='mt-0.5 h-6 w-6 shrink-0'
								/>
								<span>{item.label}</span>
							</label>
						))}
					</div>
				</section>

				<section className='rounded-md border bg-background p-5'>
					<SectionTitle icon={<UserRoundIcon />} title='申込者情報' />
					<div className='grid gap-4 md:grid-cols-2'>
						<Field name='ownerKana' label='ふりがな' required />
						<Field name='customerName' label='氏名' required />
						<Label className='grid gap-2 text-base font-semibold'>
							性別
							<select
								name='ownerGender'
								className='flex h-[56px] rounded-md border border-input bg-background px-4 text-lg'
							>
								<option value='unspecified'>未選択</option>
								<option value='male'>男性</option>
								<option value='female'>女性</option>
							</select>
						</Label>
						<Field name='customerPhone' label='連絡先' required />
						<Field name='customerEmail' label='Eメール' type='email' />
						<Field name='ownerAddress' label='住所' required wide />
					</div>
				</section>

				<section className='rounded-md border bg-background p-5'>
					<SectionTitle title={subjectGroup.label} />
					<div className='grid gap-4'>
						{subjects.map(index => (
							<div
								key={index}
								className='grid gap-4 rounded-md border bg-muted/30 p-4 md:grid-cols-2'
							>
								<p className='text-base font-semibold md:col-span-2'>
									{subjectGroup.singularLabel} {index + 1}
								</p>
								{subjectGroup.fields.map(field => (
									<ApplicationField
										key={field.key}
										field={field}
										name={`subject_${index}_${field.key}`}
										required={
											field.required ||
											(field.key === 'vaccineDate' &&
												config.vaccineCertificateRequiredOnFirstVisit)
										}
									/>
								))}
							</div>
						))}
					</div>
				</section>
			</div>

			<aside className='xl:sticky xl:top-4 xl:self-start'>
				<div className='grid gap-5 rounded-md border bg-background p-5'>
					<div className='flex items-start gap-3'>
						<div className='flex h-12 w-12 items-center justify-center rounded-md bg-primary/10 text-primary'>
							<CreditCardIcon className='h-6 w-6' />
						</div>
						<div>
							<p className='text-base text-muted-foreground'>コース</p>
							<p className='text-xl font-semibold'>{course.label}</p>
							<p className='text-base text-muted-foreground'>
								{course.startTime}-{course.endTime} / {subjectCount}
							</p>
						</div>
					</div>
					<div className='rounded-md bg-foreground p-5 text-background'>
						<p className='text-base opacity-70'>利用料金</p>
						<p className='mt-1 text-4xl font-semibold'>{yen.format(price)}</p>
					</div>
					<label className='flex gap-4 rounded-md border bg-muted/30 p-4 text-base leading-7'>
						<input
							name='staffVaccineCertificateChecked'
							type='checkbox'
							className='mt-0.5 h-6 w-6 shrink-0'
						/>
						<span>{subjectGroup.certificateLabel}</span>
					</label>
					<Label className='grid gap-2 text-base font-semibold'>
						スタッフメモ
						<Textarea name='staffMemo' className='min-h-[128px] text-lg' />
					</Label>
					<Label className='grid gap-2 text-base font-semibold'>
						お客様への控えメモ
						<Textarea name='notes' className='min-h-[128px] text-lg' />
					</Label>
					<Button
						type='submit'
						size='lg'
						disabled={disabled}
						className='h-[64px] text-lg font-semibold'
					>
						<CheckCircle2Icon className='mr-2 h-5 w-5' />
						{config.formPresentation.submitLabel}
					</Button>
				</div>
			</aside>
		</form>
	)
}

function SectionTitle({
	icon,
	title,
}: {
	icon?: React.ReactElement<{ className?: string }>
	title: string
}) {
	return (
		<div className='mb-4 flex items-center gap-2'>
			{icon
				? React.cloneElement(icon, {
						className: 'h-5 w-5 text-muted-foreground',
					})
				: null}
			<h2 className='text-xl font-semibold'>{title}</h2>
		</div>
	)
}

function Field({
	name,
	label,
	type = 'text',
	required = false,
	wide = false,
}: {
	name: string
	label: string
	type?: string
	required?: boolean
	wide?: boolean
}) {
	return (
		<Label
			className={`grid gap-2 text-base font-semibold ${wide ? 'md:col-span-2' : ''}`}
		>
			{label}
			<Input
				name={name}
				type={type}
				required={required}
				className='h-[56px] text-lg'
			/>
		</Label>
	)
}

function ApplicationField({
	field,
	name,
	required,
}: {
	field: ExtensionApplicationFieldData
	name: string
	required?: boolean
}) {
	if (field.type === 'select') {
		return (
			<Label className='grid gap-2 text-base font-semibold'>
				{field.label}
				<select
					name={name}
					required={required}
					className='flex h-[56px] rounded-md border border-input bg-background px-4 text-lg'
				>
					<option value=''>選択してください</option>
					{(field.options ?? []).map(option => (
						<option key={option.value} value={option.value}>
							{option.label}
						</option>
					))}
				</select>
			</Label>
		)
	}
	return (
		<Field
			name={name}
			label={field.label}
			type={field.type}
			required={required}
		/>
	)
}

function selectCourse(
	courses: ExtensionApplicationCourseData[],
	startsAt: Date,
) {
	const minutes = startsAt.getHours() * 60 + startsAt.getMinutes()
	return (
		courses.find(course => {
			const start = timeToMinutes(course.startTime)
			const end = timeToMinutes(course.endTime)
			return start <= minutes && minutes < end
		}) ?? courses[0]
	)
}

function priceForSubjectCount(
	course: ExtensionApplicationCourseData,
	subjectCount: number,
) {
	return (
		course.pricesByDogCount[String(subjectCount)] ??
		course.pricesByDogCount['1'] ??
		0
	)
}

function timeToMinutes(value: string) {
	const [hours, minutes] = value.split(':').map(Number)
	return hours * 60 + minutes
}

function defaultStartsAt() {
	const date = new Date()
	date.setMinutes(0, 0, 0)
	date.setHours(Math.max(10, date.getHours() + 1))
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:00`
}
