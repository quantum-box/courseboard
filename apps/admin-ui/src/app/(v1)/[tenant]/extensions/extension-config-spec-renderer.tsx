'use client'

import { JSONUIProvider, Renderer } from '@json-render/react'
import type { ComponentRegistry, Spec } from '@json-render/react'
import { Input } from 'components/ui/input'
import { Label } from 'components/ui/label'
import { Textarea } from 'components/ui/textarea'
import React, { createContext, useContext } from 'react'

type ExtensionConfigSpecRendererProps = {
	config?: Record<string, unknown> | null
	spec: Spec
}

type EditorContextValue = {
	config?: Record<string, unknown> | null
}

const EditorContext = createContext<EditorContextValue>({})

const allowedComponentTypes = new Set([
	'AdvancedJsonDetails',
	'ApplicationConsentItemsEditor',
	'ApplicationCoursesEditor',
	'ApplicationPresentationEditor',
	'ApplicationSubjectGroupEditor',
	'Section',
	'Stack',
])

const registry: ComponentRegistry = {
	AdvancedJsonDetails: ({ element }) => {
		const componentProps = propsRecord(element.props)
		const { config } = useEditorContext()
		return (
			<details className='rounded-md border bg-muted/20 p-3'>
				<summary className='cursor-pointer text-sm font-medium'>
					{stringProp(componentProps.summary, '詳細 JSON')}
				</summary>
				<Textarea
					name='configJson'
					className='mt-3 min-h-40 font-mono text-xs'
					defaultValue={JSON.stringify(config ?? {}, null, 2)}
					aria-label='advanced config JSON'
					readOnly
				/>
			</details>
		)
	},
	ApplicationConsentItemsEditor: ({ element }) => {
		const componentProps = propsRecord(element.props)
		const { config } = useEditorContext()
		return (
			<ConsentItemsFields
				config={config}
				maxItems={numberProp(componentProps.maxItems, 8)}
				title={optionalStringProp(componentProps.title)}
				description={optionalStringProp(componentProps.description)}
			/>
		)
	},
	ApplicationCoursesEditor: ({ element }) => {
		const componentProps = propsRecord(element.props)
		const { config } = useEditorContext()
		return (
			<CoursesFields
				config={config}
				maxCourses={numberProp(componentProps.maxCourses, 4)}
				title={optionalStringProp(componentProps.title)}
				description={optionalStringProp(componentProps.description)}
			/>
		)
	},
	ApplicationPresentationEditor: ({ element }) => {
		const componentProps = propsRecord(element.props)
		const { config } = useEditorContext()
		return (
			<PresentationFields
				config={config}
				title={optionalStringProp(componentProps.title)}
				description={optionalStringProp(componentProps.description)}
			/>
		)
	},
	ApplicationSubjectGroupEditor: ({ element }) => {
		const componentProps = propsRecord(element.props)
		const { config } = useEditorContext()
		return (
			<SubjectGroupFields
				config={config}
				title={optionalStringProp(componentProps.title)}
				description={optionalStringProp(componentProps.description)}
			/>
		)
	},
	Section: ({ element, children }) => {
		const componentProps = propsRecord(element.props)
		const title = optionalStringProp(componentProps.title)
		const description = optionalStringProp(componentProps.description)
		return (
			<section className='rounded-md border bg-background p-4'>
				{title || description ? (
					<div className='mb-4'>
						{title ? <h3 className='text-sm font-semibold'>{title}</h3> : null}
						{description ? (
							<p className='mt-1 text-xs leading-5 text-muted-foreground'>
								{description}
							</p>
						) : null}
					</div>
				) : null}
				<div className='space-y-4'>{children}</div>
			</section>
		)
	},
	Stack: ({ children }) => <div className='space-y-5'>{children}</div>,
}

export function ExtensionConfigSpecRenderer({
	config,
	spec,
}: ExtensionConfigSpecRendererProps) {
	if (!isAllowedSpec(spec)) {
		return (
			<div className='rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950'>
				<p className='font-medium'>設定UI specを表示できません</p>
				<p className='mt-1'>
					extension が返した configEditorSpec が Field
					の許可した部品に一致しません。
				</p>
			</div>
		)
	}

	return (
		<EditorContext.Provider value={{ config }}>
			<JSONUIProvider registry={registry}>
				<Renderer registry={registry} spec={spec} />
			</JSONUIProvider>
		</EditorContext.Provider>
	)
}

export function parseExtensionConfigEditorSpec(value: unknown): Spec | null {
	return isAllowedSpec(value) ? value : null
}

function PresentationFields({
	config,
	description,
	title,
}: {
	config?: Record<string, unknown> | null
	description?: string
	title?: string
}) {
	const presentation = getRecord(config?.formPresentation)
	return (
		<div className='grid gap-4 rounded-md border bg-background p-4 md:grid-cols-2'>
			<SectionHeading
				title={title ?? '受付画面の表示'}
				description={
					description ?? 'お客様向け画面と店頭iPad画面に出る文言を設定します。'
				}
			/>
			<TextField
				label='公開タイトル'
				name='presentation_publicTitle'
				value={presentation?.publicTitle}
				fallback='利用申込'
			/>
			<TextField
				label='iPadタイトル'
				name='presentation_kioskTitle'
				value={presentation?.kioskTitle}
				fallback='iPad受付'
			/>
			<TextareaField
				label='公開説明'
				name='presentation_publicDescription'
				value={presentation?.publicDescription}
				fallback=''
			/>
			<TextareaField
				label='iPad説明'
				name='presentation_kioskDescription'
				value={presentation?.kioskDescription}
				fallback=''
			/>
			<TextField
				label='ボタン文言'
				name='presentation_submitLabel'
				value={presentation?.submitLabel}
				fallback='申込する'
			/>
			<TextField
				label='バッジ'
				name='presentation_badgeLabel'
				value={presentation?.badgeLabel}
				fallback='Application'
			/>
			<TextField
				label='無効時タイトル'
				name='presentation_disabledTitle'
				value={presentation?.disabledTitle}
				fallback='受付は現在利用できません'
			/>
			<TextField
				label='無効時説明'
				name='presentation_disabledDescription'
				value={presentation?.disabledDescription}
				fallback=''
			/>
			<TextField
				label='規約バージョン'
				name='termsVersion'
				value={config?.termsVersion}
				fallback='2026-05-30'
			/>
			<label className='flex items-center gap-2 self-end rounded-md border bg-muted/30 px-3 py-2 text-sm font-medium'>
				<input
					type='checkbox'
					name='vaccineCertificateRequiredOnFirstVisit'
					defaultChecked={
						config?.vaccineCertificateRequiredOnFirstVisit !== false
					}
				/>
				初回の証明書確認を必須にする
			</label>
		</div>
	)
}

function CoursesFields({
	config,
	description,
	maxCourses,
	title,
}: {
	config?: Record<string, unknown> | null
	description?: string
	maxCourses: number
	title?: string
}) {
	const courses = getArray(config?.courses).slice(0, maxCourses)
	const subjectGroup = getRecord(getArray(config?.subjectGroups)[0])
	const maxCount = Math.max(
		1,
		Math.min(12, getNumber(subjectGroup?.maxCount ?? config?.maxDogCount, 2)),
	)
	return (
		<div className='rounded-md border bg-background p-4'>
			<SectionHeading
				title={title ?? 'コースと料金'}
				description={
					description ??
					'利用時間帯ごとの料金を数量別に設定します。空のコースは保存時に無視されます。'
				}
			/>
			<div className='space-y-4'>
				{padRows(courses, maxCourses).map((course, index) => {
					const record = getRecord(course)
					const prices = getRecord(record?.pricesByDogCount)
					return (
						<div
							key={index}
							className='grid gap-3 rounded-md border bg-muted/20 p-3 md:grid-cols-6'
						>
							<TextField
								label='コード'
								name={`course_${index}_code`}
								value={record?.code}
								fallback={`course_${index + 1}`}
							/>
							<TextField
								label='コース名'
								name={`course_${index}_label`}
								value={record?.label}
								fallback=''
							/>
							<TextField
								label='開始'
								name={`course_${index}_startTime`}
								type='time'
								value={record?.startTime}
								fallback='10:00'
							/>
							<TextField
								label='終了'
								name={`course_${index}_endTime`}
								type='time'
								value={record?.endTime}
								fallback='15:00'
							/>
							<TextField
								label='通貨'
								name={`course_${index}_currency`}
								value={record?.currency}
								fallback='JPY'
							/>
							<div className='grid gap-2 md:col-span-6'>
								<div className='text-sm font-medium'>数量別料金</div>
								<div className='grid gap-2 sm:grid-cols-2 lg:grid-cols-4'>
									{Array.from({ length: maxCount }, (_, offset) => {
										const count = offset + 1
										return (
											<TextField
												key={count}
												label={`${count}`}
												name={`course_${index}_price_${count}`}
												type='number'
												value={prices?.[String(count)]}
												fallback='0'
											/>
										)
									})}
								</div>
							</div>
						</div>
					)
				})}
			</div>
		</div>
	)
}

function SubjectGroupFields({
	config,
	description,
	title,
}: {
	config?: Record<string, unknown> | null
	description?: string
	title?: string
}) {
	const subjectGroup = getRecord(getArray(config?.subjectGroups)[0])
	return (
		<div className='grid gap-4 rounded-md border bg-background p-4 md:grid-cols-2'>
			<SectionHeading
				title={title ?? '利用対象'}
				description={
					description ??
					'申込フォームで入力する対象の呼び方と上限数を設定します。'
				}
			/>
			<input
				type='hidden'
				name='subject_key'
				value={String(subjectGroup?.key ?? 'subjects')}
			/>
			<TextField
				label='セクション名'
				name='subject_label'
				value={subjectGroup?.label}
				fallback='利用対象'
			/>
			<TextField
				label='単数表示'
				name='subject_singularLabel'
				value={subjectGroup?.singularLabel}
				fallback='対象'
			/>
			<TextField
				label='数量ラベル'
				name='subject_countLabel'
				value={subjectGroup?.countLabel}
				fallback='数量'
			/>
			<TextField
				label='上限数'
				name='subject_maxCount'
				type='number'
				value={subjectGroup?.maxCount}
				fallback='2'
			/>
			<TextField
				label='証明確認ラベル'
				name='subject_certificateLabel'
				value={subjectGroup?.certificateLabel}
				fallback='必要書類を確認済み'
			/>
		</div>
	)
}

function ConsentItemsFields({
	config,
	description,
	maxItems,
	title,
}: {
	config?: Record<string, unknown> | null
	description?: string
	maxItems: number
	title?: string
}) {
	const consentItems = getArray(config?.consentItems).slice(0, maxItems)
	return (
		<div className='rounded-md border bg-background p-4'>
			<SectionHeading
				title={title ?? '確認事項'}
				description={
					description ??
					'空欄の行は保存時に無視されます。文脈固有の文章はアプリ設定だけに保存されます。'
				}
			/>
			<div className='space-y-3'>
				{padRows(consentItems, maxItems).map((item, index) => {
					const record = getRecord(item)
					return (
						<div
							key={index}
							className='grid gap-3 rounded-md border bg-muted/20 p-3 md:grid-cols-[12rem_1fr_auto]'
						>
							<TextField
								label='キー'
								name={`consent_${index}_key`}
								value={record?.key}
								fallback={`consent_${index + 1}`}
							/>
							<TextField
								label='文言'
								name={`consent_${index}_label`}
								value={record?.label}
								fallback=''
							/>
							<label className='flex items-end gap-2 pb-2 text-sm font-medium'>
								<input
									type='checkbox'
									name={`consent_${index}_required`}
									defaultChecked={record?.required !== false}
								/>
								必須
							</label>
						</div>
					)
				})}
			</div>
		</div>
	)
}

function SectionHeading({
	description,
	title,
}: {
	description: string
	title: string
}) {
	return (
		<div className='mb-4 md:col-span-2'>
			<h3 className='text-sm font-semibold'>{title}</h3>
			<p className='mt-1 text-xs leading-5 text-muted-foreground'>
				{description}
			</p>
		</div>
	)
}

function TextField({
	fallback,
	label,
	name,
	type = 'text',
	value,
}: {
	fallback: string
	label: string
	name: string
	type?: React.HTMLInputTypeAttribute
	value: unknown
}) {
	return (
		<Label htmlFor={name} className='grid gap-2 text-sm font-medium'>
			{label}
			<Input
				id={name}
				name={name}
				type={type}
				defaultValue={String(value ?? fallback)}
			/>
		</Label>
	)
}

function TextareaField({
	fallback,
	label,
	name,
	value,
}: {
	fallback: string
	label: string
	name: string
	value: unknown
}) {
	return (
		<Label htmlFor={name} className='grid gap-2 text-sm font-medium'>
			{label}
			<Textarea
				id={name}
				name={name}
				className='min-h-20'
				defaultValue={String(value ?? fallback)}
			/>
		</Label>
	)
}

function useEditorContext() {
	return useContext(EditorContext)
}

function isAllowedSpec(value: unknown): value is Spec {
	const spec = getRecord(value)
	if (!spec || typeof spec.root !== 'string') return false
	const elements = getRecord(spec.elements)
	if (!elements || !elements[spec.root]) return false

	return Object.entries(elements).every(([key, rawElement]) => {
		const element = getRecord(rawElement)
		if (!element || !allowedComponentTypes.has(String(element.type))) {
			return false
		}
		const children = element.children
		if (children != null) {
			if (!Array.isArray(children)) return false
			if (
				!children.every(
					child => typeof child === 'string' && Boolean(elements[child]),
				)
			) {
				return false
			}
		}
		if (!getRecord(element.props)) return false
		return typeof key === 'string'
	})
}

function propsRecord(value: unknown) {
	return getRecord(value) ?? {}
}

function optionalStringProp(value: unknown) {
	return typeof value === 'string' && value.trim() ? value : undefined
}

function stringProp(value: unknown, fallback: string) {
	return optionalStringProp(value) ?? fallback
}

function numberProp(value: unknown, fallback: number) {
	const parsed = Number(value)
	return Number.isFinite(parsed) ? parsed : fallback
}

function getRecord(value: unknown) {
	return value && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null
}

function getArray(value: unknown): unknown[] {
	return Array.isArray(value) ? value : []
}

function padRows<T>(items: T[], length: number): Array<T | null> {
	return Array.from({ length }, (_, index) => items[index] ?? null)
}

function getNumber(value: unknown, fallback: number) {
	const parsed = Number(value)
	return Number.isFinite(parsed) ? parsed : fallback
}
