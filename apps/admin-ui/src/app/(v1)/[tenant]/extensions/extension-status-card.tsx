'use client'

import { Badge } from 'components/ui/badge'
import { Button } from 'components/ui/button'
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from 'components/ui/card'
import { Input } from 'components/ui/input'
import { Label } from 'components/ui/label'
import { Textarea } from 'components/ui/textarea'
import { useAdminI18n } from 'lib/admin-i18n'
import { getExtensionDisplayKeys } from 'lib/extension-admin-registry'
import {
	BadgeCheckIcon,
	BanknoteIcon,
	CalendarClockIcon,
	CalendarDaysIcon,
	CircleSlashIcon,
	Clock3Icon,
	CreditCardIcon,
	FileTextIcon,
	PackageSearchIcon,
	PercentIcon,
	PowerIcon,
	SaveIcon,
	SettingsIcon,
} from 'lucide-react'
import type { Route } from 'next'
import Link from 'next/link'
import React from 'react'
import type { ExtensionStatusData } from './action'
import {
	ExtensionConfigSpecRenderer,
	parseExtensionConfigEditorSpec,
} from './extension-config-spec-renderer'

type ExtensionStatusCardProps = {
	extension: ExtensionStatusData
	showConfigEditor?: boolean
	updateConfigAction: string | ((formData: FormData) => void | Promise<void>)
	toggleAction: string | (() => void | Promise<void>)
	managementHref?: Route
	managementLabel?: string
}

type CatalogProductOption = {
	id: string
	name: string
	listPrice?: number | null
}

type ReservationTypeOption = {
	id: string
	code: string
	name: string
	resourceModel: string
}

const weekdayOptions = [
	{ value: 0, ja: '日', en: 'Sun' },
	{ value: 1, ja: '月', en: 'Mon' },
	{ value: 2, ja: '火', en: 'Tue' },
	{ value: 3, ja: '水', en: 'Wed' },
	{ value: 4, ja: '木', en: 'Thu' },
	{ value: 5, ja: '金', en: 'Fri' },
	{ value: 6, ja: '土', en: 'Sat' },
]

export function ExtensionStatusCard({
	extension,
	showConfigEditor = true,
	updateConfigAction,
	toggleAction,
	managementHref,
	managementLabel,
}: ExtensionStatusCardProps) {
	const { t } = useAdminI18n()
	const enabled = extension.tenantStatus === 'enabled'
	const displayKeys = getExtensionDisplayKeys(extension.extensionKey)
	const hasDedicatedConfigEditor = Boolean(displayKeys)
	const isApplicationIntakeSettings = hasApplicationIntakeConfig(
		extension.configJson,
	)
	const title = displayKeys ? t(displayKeys.titleKey) : extension.name
	const description = displayKeys
		? t(displayKeys.descriptionKey)
		: `${extension.extensionKey} / ${extension.industry} / v${extension.version}`

	return (
		<Card>
			<CardHeader>
				<div className='flex items-start justify-between gap-3'>
					<div>
						<CardTitle className='text-base'>{title}</CardTitle>
						<CardDescription>{description}</CardDescription>
					</div>
					<Badge variant={enabled ? 'default' : 'secondary'}>
						{enabled ? t('common.enabled') : t('common.disabled')}
					</Badge>
				</div>
			</CardHeader>
			<CardContent className='space-y-4'>
				<div className='grid gap-2 text-sm sm:grid-cols-2'>
					<div>
						<div className='text-muted-foreground'>
							{t('extensions.enabledAt')}
						</div>
						<div>{formatDateTime(extension.enabledAt)}</div>
					</div>
					<div>
						<div className='text-muted-foreground'>
							{t('extensions.disabledAt')}
						</div>
						<div>{formatDateTime(extension.disabledAt)}</div>
					</div>
					<div>
						<div className='text-muted-foreground'>
							{t('extensions.configVersion')}
						</div>
						<div>{extension.configVersion ?? t('common.default')}</div>
					</div>
					<div>
						<div className='text-muted-foreground'>
							{t('extensions.validation')}
						</div>
						<div
							className={extension.validation.valid ? '' : 'text-destructive'}
						>
							{extension.validation.valid
								? t('common.valid')
								: t('common.needsChanges')}
						</div>
					</div>
				</div>

				{!extension.validation.valid && (
					<div className='rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive'>
						<div className='font-medium'>
							{t('extensions.validationErrors')}
						</div>
						<ul className='mt-2 list-disc space-y-1 pl-5'>
							{extension.validation.errors.map(error => (
								<li key={error}>{error}</li>
							))}
						</ul>
					</div>
				)}

				{showConfigEditor ? (
					hasDedicatedConfigEditor ? null : isApplicationIntakeSettings ? (
						<ApplicationIntakeConfigForm
							config={extension.configJson}
							updateConfigAction={updateConfigAction}
						/>
					) : (
						<details className='rounded-md border bg-muted/20 p-3'>
							<summary className='cursor-pointer text-sm font-medium'>
								詳細 JSON を編集
							</summary>
							<form action={updateConfigAction} className='mt-3 space-y-2'>
								<Textarea
									name='configJson'
									className='min-h-48 font-mono text-xs'
									defaultValue={JSON.stringify(
										extension.configJson ?? {},
										null,
										2,
									)}
									aria-label={`${extension.name} config JSON`}
								/>
								<Button type='submit' variant='outline'>
									<SettingsIcon className='mr-2 h-4 w-4' />
									{t('extensions.saveConfig')}
								</Button>
							</form>
						</details>
					)
				) : null}

				<form action={toggleAction}>
					<Button type='submit' variant={enabled ? 'outline' : 'default'}>
						<PowerIcon className='mr-2 h-4 w-4' />
						{enabled ? t('extensions.disablePlan') : t('extensions.enablePlan')}
					</Button>
				</form>
				{managementHref && managementLabel ? (
					<Button asChild size='sm' variant='outline'>
						<Link href={managementHref}>{managementLabel}</Link>
					</Button>
				) : null}
			</CardContent>
		</Card>
	)
}

export function ApplicationIntakeConfigForm({
	config,
	updateConfigAction,
}: {
	config?: Record<string, unknown> | null
	updateConfigAction: string | ((formData: FormData) => void | Promise<void>)
}) {
	const presentation = getRecord(config?.formPresentation)
	const spec = parseExtensionConfigEditorSpec(config?.configEditorSpec)
	const courses = getArray(config?.courses).slice(0, 4)
	const consentItems = getArray(config?.consentItems).slice(0, 8)
	const subjectGroup = getRecord(getArray(config?.subjectGroups)[0])
	const maxCount = Math.max(
		1,
		Math.min(12, getNumber(subjectGroup?.maxCount ?? config?.maxDogCount, 2)),
	)

	if (spec) {
		return (
			<form action={updateConfigAction} className='space-y-5'>
				<input type='hidden' name='applicationIntakeConfigForm' value='true' />
				<input
					type='hidden'
					name='baseConfigJson'
					value={JSON.stringify(config ?? {})}
				/>
				<ExtensionConfigSpecRenderer config={config} spec={spec} />
				<div className='flex justify-end border-t pt-4'>
					<Button type='submit'>
						<SaveIcon className='mr-2 h-4 w-4' />
						設定を保存
					</Button>
				</div>
			</form>
		)
	}

	return (
		<form action={updateConfigAction} className='space-y-5'>
			<input type='hidden' name='applicationIntakeConfigForm' value='true' />
			<input
				type='hidden'
				name='baseConfigJson'
				value={JSON.stringify(config ?? {})}
			/>
			<div className='grid gap-4 rounded-md border bg-background p-4 md:grid-cols-2'>
				<div className='md:col-span-2'>
					<h3 className='text-sm font-semibold'>受付画面の表示</h3>
					<p className='mt-1 text-xs leading-5 text-muted-foreground'>
						お客様向け画面と店頭iPad画面に出る文言を設定します。
					</p>
				</div>
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

			<div className='rounded-md border bg-background p-4'>
				<div className='mb-4'>
					<h3 className='text-sm font-semibold'>コースと料金</h3>
					<p className='mt-1 text-xs leading-5 text-muted-foreground'>
						利用時間帯ごとの料金を数量別に設定します。空のコースは保存時に無視されます。
					</p>
				</div>
				<div className='space-y-4'>
					{padRows(courses, 4).map((course, index) => {
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

			<div className='grid gap-4 rounded-md border bg-background p-4 md:grid-cols-2'>
				<div className='md:col-span-2'>
					<h3 className='text-sm font-semibold'>利用対象</h3>
					<p className='mt-1 text-xs leading-5 text-muted-foreground'>
						申込フォームで入力する対象の呼び方と上限数を設定します。
					</p>
				</div>
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

			<div className='rounded-md border bg-background p-4'>
				<div className='mb-4'>
					<h3 className='text-sm font-semibold'>確認事項</h3>
					<p className='mt-1 text-xs leading-5 text-muted-foreground'>
						空欄の行は保存時に無視されます。文脈固有の文章はアプリ設定だけに保存されます。
					</p>
				</div>
				<div className='space-y-3'>
					{padRows(consentItems, 8).map((item, index) => {
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

			<details className='rounded-md border bg-muted/20 p-3'>
				<summary className='cursor-pointer text-sm font-medium'>
					詳細 JSON
				</summary>
				<Textarea
					name='configJson'
					className='mt-3 min-h-40 font-mono text-xs'
					defaultValue={JSON.stringify(config ?? {}, null, 2)}
					aria-label='advanced config JSON'
					readOnly
				/>
			</details>

			<div className='flex justify-end border-t pt-4'>
				<Button type='submit'>
					<SaveIcon className='mr-2 h-4 w-4' />
					設定を保存
				</Button>
			</div>
		</form>
	)
}

export function ReservationProductConfigForm({
	config,
	catalogProducts = [],
	catalogProductsError,
	reservationTypes = [],
	catalogProductsHref,
	updateConfigAction,
}: {
	config?: Record<string, unknown> | null
	catalogProducts?: CatalogProductOption[]
	catalogProductsError?: string | null
	reservationTypes?: ReservationTypeOption[]
	catalogProductsHref?: Route
	updateConfigAction: string | ((formData: FormData) => void | Promise<void>)
}) {
	const { locale, t } = useAdminI18n()
	const publicProductDescription = String(
		config?.publicProductDescription ??
			'日時と人数を指定して予約できる標準プランです。',
	)
	const reservationProducts = config?.reservationProducts
	const products = Array.isArray(reservationProducts)
		? (reservationProducts as Record<string, unknown>[])
		: []
	const productRows = reservationProductRows(products, catalogProducts)
	const defaultDurationMinutes = getNumber(config?.defaultDurationMinutes, 60)
	const prepaymentOptions = [
		{
			value: 'deposit_required',
			label: t('extensions.prepaymentDepositRequired'),
			icon: CreditCardIcon,
			hint: '予約時に一部金額を回収',
		},
		{
			value: 'full_required',
			label: t('extensions.prepaymentFullRequired'),
			icon: BadgeCheckIcon,
			hint: '予約時に全額を回収',
		},
		{
			value: 'optional',
			label: t('extensions.prepaymentOptional'),
			icon: BanknoteIcon,
			hint: '現地支払いも許可',
		},
		{
			value: 'none',
			label: t('extensions.prepaymentNone'),
			icon: CircleSlashIcon,
			hint: '予約時決済を使わない',
		},
	]

	return (
		<form action={updateConfigAction} className='space-y-5'>
			<input type='hidden' name='reservationProductConfigForm' value='true' />
			<input type='hidden' name='productCount' value={productRows.length} />
			<div className='rounded-md border bg-background px-4 py-3'>
				<div className='flex items-start gap-3'>
					<div className='flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary'>
						<PackageSearchIcon className='h-4 w-4' />
					</div>
					<div>
						<h3 className='text-sm font-semibold'>
							{t('extensions.productsMaster')}
						</h3>
						<p className='mt-1 text-xs leading-5 text-muted-foreground'>
							{t('extensions.productsMasterDescription')}
						</p>
					</div>
				</div>
				{catalogProductsError ? (
					<div className='mt-4 flex flex-col gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-3 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between'>
						<div className='font-medium'>
							商品マスタを読み込めませんでした
							<p className='mt-1 font-normal leading-5'>
								{catalogProductsError}
							</p>
						</div>
						{catalogProductsHref ? (
							<Button asChild size='sm' variant='outline'>
								<Link href={catalogProductsHref}>
									{t('extensions.openCatalogProducts')}
								</Link>
							</Button>
						) : null}
					</div>
				) : catalogProducts.length === 0 ? (
					<div className='mt-4 flex flex-col gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-950 sm:flex-row sm:items-center sm:justify-between'>
						<div className='font-medium'>
							{t('extensions.noCatalogProductsTitle')}
							<p className='mt-1 font-normal leading-5'>
								{t('extensions.noCatalogProductsDescription')}
							</p>
						</div>
						{catalogProductsHref ? (
							<Button asChild size='sm' variant='outline'>
								<Link href={catalogProductsHref}>
									{t('extensions.openCatalogProducts')}
								</Link>
							</Button>
						) : null}
					</div>
				) : null}
			</div>
			<div className='grid gap-4'>
				{productRows.map(({ product, catalogProduct }, index) => {
					const enabled =
						typeof product.enabled === 'boolean' ? product.enabled : false
					const selectedPrepaymentPolicy = normalizePrepaymentPolicyOption(
						String(
							product.prepaymentPolicy ??
								product.paymentRequirement ??
								'deposit_required',
						),
					)
					const bookingMode = product.bookingMode === 'slot' ? 'slot' : 'time'
					const slots = productSlots(product)
					const availability = productAvailability(product)
					const selectedReservationTypeId = String(
						product.reservationTypeId ?? '',
					)
					return (
						<div
							key={catalogProduct.id}
							className='overflow-hidden rounded-md border bg-background shadow-sm'
						>
							<div className='flex items-center justify-between gap-3 border-b bg-muted/30 px-4 py-3'>
								<div>
									<p className='text-sm font-semibold'>{catalogProduct.name}</p>
									<p className='mt-0.5 text-xs text-muted-foreground'>
										商品マスタ /{' '}
										{catalogProduct.listPrice != null
											? `${catalogProduct.listPrice.toLocaleString()} 円`
											: '価格未設定'}
									</p>
								</div>
								<label className='inline-flex items-center gap-2 text-xs font-medium text-muted-foreground'>
									<input
										type='checkbox'
										name={`product_${index}_enabled`}
										defaultChecked={enabled}
									/>
									{t('extensions.productEnabled')}
								</label>
							</div>
							<div className='grid gap-4 p-4 md:grid-cols-6'>
								<Label
									htmlFor={`product_${index}_catalogProduct`}
									className='grid gap-2 text-sm font-medium md:col-span-3'
								>
									{t('extensions.catalogProduct')}
									<input
										type='hidden'
										name={`product_${index}_catalogProduct`}
										value={JSON.stringify({
											id: catalogProduct.id,
											name: catalogProduct.name,
											priceAmount: catalogProduct.listPrice ?? 0,
										})}
									/>
									<div
										id={`product_${index}_catalogProduct`}
										className='flex min-h-10 w-full items-center rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground'
									>
										{catalogProduct.name}
									</div>
								</Label>
								<Label
									htmlFor={`product_${index}_reservationTypeId`}
									className='grid gap-2 text-sm font-medium md:col-span-3'
								>
									予約タイプ
									<select
										id={`product_${index}_reservationTypeId`}
										name={`product_${index}_reservationTypeId`}
										defaultValue={selectedReservationTypeId}
										className='flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
									>
										<option value=''>自動（表示順に紐づけ）</option>
										{reservationTypes.map(reservationType => (
											<option
												key={reservationType.id}
												value={reservationType.id}
											>
												{reservationType.name} / {reservationType.code}
											</option>
										))}
									</select>
								</Label>
								<Label
									htmlFor={`product_${index}_durationMinutes`}
									className='grid gap-2 text-sm font-medium md:col-span-2'
								>
									<span className='inline-flex items-center gap-2'>
										<Clock3Icon className='h-4 w-4 text-muted-foreground' />
										{t('extensions.duration')}
									</span>
									<Input
										id={`product_${index}_durationMinutes`}
										name={`product_${index}_durationMinutes`}
										type='number'
										min={15}
										step={15}
										defaultValue={getNumber(
											product.durationMinutes,
											defaultDurationMinutes,
										)}
									/>
								</Label>
								{catalogProducts.length > 0 ? (
									<div className='grid gap-2 text-sm font-medium md:col-span-2'>
										<div className='inline-flex items-center gap-2'>
											<BanknoteIcon className='h-4 w-4 text-muted-foreground' />
											{t('extensions.price')}
										</div>
										<div className='flex h-10 items-center rounded-md border bg-muted/40 px-3 text-sm text-muted-foreground'>
											{t('extensions.usesCatalogPrice')}
										</div>
									</div>
								) : (
									<Label
										htmlFor={`product_${index}_priceAmount`}
										className='grid gap-2 text-sm font-medium md:col-span-2'
									>
										<span className='inline-flex items-center gap-2'>
											<BanknoteIcon className='h-4 w-4 text-muted-foreground' />
											{t('extensions.price')}
										</span>
										<Input
											id={`product_${index}_priceAmount`}
											name={`product_${index}_priceAmount`}
											type='number'
											min={0}
											step={100}
											defaultValue={getNumber(product.priceAmount, 0)}
										/>
									</Label>
								)}
								<div className='grid gap-2 text-sm font-medium md:col-span-6'>
									<div className='inline-flex items-center gap-2'>
										<CreditCardIcon className='h-4 w-4 text-muted-foreground' />
										{t('extensions.prepaymentPolicy')}
									</div>
									<div className='grid gap-2 sm:grid-cols-2 xl:grid-cols-4'>
										{prepaymentOptions.map(option => {
											const Icon = option.icon
											return (
												<label key={option.value} className='cursor-pointer'>
													<input
														type='radio'
														name={`product_${index}_prepaymentPolicy`}
														value={option.value}
														defaultChecked={
															selectedPrepaymentPolicy === option.value
														}
														className='peer sr-only'
													/>
													<span className='grid min-h-20 gap-1 rounded-md border bg-background p-3 text-xs transition peer-checked:border-primary peer-checked:bg-primary/5 peer-checked:text-primary'>
														<span className='inline-flex items-center gap-2 font-semibold'>
															<Icon className='h-4 w-4' />
															{option.label}
														</span>
														<span className='font-normal text-muted-foreground'>
															{option.hint}
														</span>
													</span>
												</label>
											)
										})}
									</div>
								</div>
								<Label
									htmlFor={`product_${index}_depositRatioPercent`}
									className='grid gap-2 text-sm font-medium md:col-span-2'
								>
									<span className='inline-flex items-center gap-2'>
										<PercentIcon className='h-4 w-4 text-muted-foreground' />
										{t('extensions.depositRatio')}
									</span>
									<Input
										id={`product_${index}_depositRatioPercent`}
										name={`product_${index}_depositRatioPercent`}
										type='number'
										min={0}
										max={100}
										step={1}
										defaultValue={Math.round(
											getNumber(product.depositRatio, 0.3) * 100,
										)}
									/>
								</Label>
								<Label
									htmlFor={`product_${index}_description`}
									className='grid gap-2 text-sm font-medium md:col-span-4'
								>
									<span className='inline-flex items-center gap-2'>
										<FileTextIcon className='h-4 w-4 text-muted-foreground' />
										{t('extensions.productItemDescription')}
									</span>
									<Textarea
										id={`product_${index}_description`}
										name={`product_${index}_description`}
										className='min-h-16'
										defaultValue={String(
											product.description ?? publicProductDescription,
										)}
									/>
								</Label>
								<div className='space-y-2 md:col-span-6'>
									<div className='text-sm font-medium'>
										{t('extensions.formFields')}
									</div>
									<div className='flex flex-wrap gap-2'>
										{[
											t('extensions.fieldPartySize'),
											t('extensions.fieldContact'),
											t('extensions.fieldNotes'),
										].map(field => (
											<span
												key={field}
												className='rounded-md border bg-muted/50 px-2 py-1 text-xs text-muted-foreground'
											>
												{field}
											</span>
										))}
									</div>
								</div>
								<div className='space-y-3 border-t pt-4 md:col-span-6'>
									<div>
										<div className='inline-flex items-center gap-2 text-sm font-medium'>
											<CalendarDaysIcon className='h-4 w-4 text-muted-foreground' />
											{t('extensions.availabilityCalendar')}
										</div>
										<p className='mt-1 text-xs leading-5 text-muted-foreground'>
											{t('extensions.availabilityCalendarDescription')}
										</p>
									</div>
									<div className='grid gap-3 rounded-md border bg-muted/20 p-3 md:grid-cols-6'>
										<Label
											htmlFor={`product_${index}_availability_startDate`}
											className='grid gap-2 text-sm font-medium md:col-span-2'
										>
											{t('extensions.availabilityStartDate')}
											<Input
												id={`product_${index}_availability_startDate`}
												name={`product_${index}_availability_startDate`}
												type='date'
												defaultValue={String(availability.startDate ?? '')}
											/>
										</Label>
										<Label
											htmlFor={`product_${index}_availability_endDate`}
											className='grid gap-2 text-sm font-medium md:col-span-2'
										>
											{t('extensions.availabilityEndDate')}
											<Input
												id={`product_${index}_availability_endDate`}
												name={`product_${index}_availability_endDate`}
												type='date'
												defaultValue={String(availability.endDate ?? '')}
											/>
										</Label>
										<div className='grid gap-2 text-sm font-medium md:col-span-2'>
											{t('extensions.availabilityWeekdays')}
											<div className='flex min-h-10 flex-wrap items-center gap-1.5'>
												{weekdayOptions.map(option => (
													<label
														key={option.value}
														className='inline-flex h-8 items-center gap-1 rounded-md border bg-background px-2 text-xs font-medium'
													>
														<input
															type='checkbox'
															name={`product_${index}_availability_weekday`}
															value={option.value}
															defaultChecked={availability.weekdays.includes(
																option.value,
															)}
														/>
														{option[locale]}
													</label>
												))}
											</div>
										</div>
										<Label
											htmlFor={`product_${index}_availability_includedDates`}
											className='grid gap-2 text-sm font-medium md:col-span-3'
										>
											{t('extensions.availabilityIncludedDates')}
											<Textarea
												id={`product_${index}_availability_includedDates`}
												name={`product_${index}_availability_includedDates`}
												className='min-h-16 font-mono text-xs'
												placeholder='2026-06-15, 2026-06-22'
												defaultValue={availability.includedDates.join('\n')}
											/>
										</Label>
										<Label
											htmlFor={`product_${index}_availability_excludedDates`}
											className='grid gap-2 text-sm font-medium md:col-span-3'
										>
											{t('extensions.availabilityExcludedDates')}
											<Textarea
												id={`product_${index}_availability_excludedDates`}
												name={`product_${index}_availability_excludedDates`}
												className='min-h-16 font-mono text-xs'
												placeholder='2026-06-10, 2026-06-17'
												defaultValue={availability.excludedDates.join('\n')}
											/>
										</Label>
									</div>
								</div>
								<div className='space-y-3 border-t pt-4 md:col-span-6'>
									<div>
										<div className='inline-flex items-center gap-2 text-sm font-medium'>
											<CalendarClockIcon className='h-4 w-4 text-muted-foreground' />
											{t('extensions.bookingMode')}
										</div>
										<p className='mt-1 text-xs leading-5 text-muted-foreground'>
											{t('extensions.bookingModeDescription')}
										</p>
									</div>
									<div className='grid gap-2 sm:grid-cols-2'>
										<label className='cursor-pointer'>
											<input
												type='radio'
												name={`product_${index}_bookingMode`}
												value='time'
												defaultChecked={bookingMode === 'time'}
												className='peer sr-only'
											/>
											<span className='grid min-h-16 gap-1 rounded-md border bg-background p-3 text-xs transition peer-checked:border-primary peer-checked:bg-primary/5 peer-checked:text-primary'>
												<span className='font-semibold'>
													{t('extensions.bookingModeTime')}
												</span>
												<span className='font-normal text-muted-foreground'>
													{t('extensions.bookingModeTimeDescription')}
												</span>
											</span>
										</label>
										<label className='cursor-pointer'>
											<input
												type='radio'
												name={`product_${index}_bookingMode`}
												value='slot'
												defaultChecked={bookingMode === 'slot'}
												className='peer sr-only'
											/>
											<span className='grid min-h-16 gap-1 rounded-md border bg-background p-3 text-xs transition peer-checked:border-primary peer-checked:bg-primary/5 peer-checked:text-primary'>
												<span className='font-semibold'>
													{t('extensions.bookingModeSlot')}
												</span>
												<span className='font-normal text-muted-foreground'>
													{t('extensions.bookingModeSlotDescription')}
												</span>
											</span>
										</label>
									</div>
									<div className='grid gap-2'>
										<div className='hidden grid-cols-[1fr_1fr_110px_90px_120px] gap-2 text-xs font-medium text-muted-foreground md:grid'>
											<span>{t('extensions.slotName')}</span>
											<span>{t('extensions.slotStartsAt')}</span>
											<span>{t('extensions.slotDurationMinutes')}</span>
											<span>{t('extensions.slotRemainingQuantity')}</span>
											<span>{t('extensions.slotRepeats')}</span>
										</div>
										{[0, 1, 2].map(slotIndex => {
											const slot = slots[slotIndex] ?? {}
											return (
												<div
													key={slotIndex}
													className='grid gap-2 md:grid-cols-[1fr_1fr_110px_90px_120px]'
												>
													<Input
														name={`product_${index}_slot_${slotIndex}_label`}
														aria-label={`${t('extensions.slotName')} ${slotIndex + 1}`}
														placeholder={
															slotIndex === 0
																? 'OUT 08:00'
																: t('extensions.slotName')
														}
														defaultValue={String(slot.label ?? '')}
													/>
													<Input
														name={`product_${index}_slot_${slotIndex}_startsAt`}
														aria-label={`${t('extensions.slotStartsAt')} ${slotIndex + 1}`}
														type='datetime-local'
														defaultValue={formatDateTimeLocalInput(
															slot.startsAt,
														)}
													/>
													<Input
														name={`product_${index}_slot_${slotIndex}_durationMinutes`}
														aria-label={`${t('extensions.slotDurationMinutes')} ${slotIndex + 1}`}
														type='number'
														min={15}
														step={15}
														defaultValue={String(
															getNumber(slot.durationMinutes, 120),
														)}
													/>
													<Input
														name={`product_${index}_slot_${slotIndex}_remainingQuantity`}
														aria-label={`${t('extensions.slotRemainingQuantity')} ${slotIndex + 1}`}
														type='number'
														min={0}
														step={1}
														defaultValue={
															slot.remainingQuantity === undefined &&
															slot.capacity === undefined
																? ''
																: String(
																		getNumber(
																			slot.remainingQuantity ?? slot.capacity,
																			0,
																		),
																	)
														}
													/>
													<label className='inline-flex min-h-10 items-center gap-2 rounded-md border bg-background px-3 text-xs font-medium text-muted-foreground'>
														<input
															type='checkbox'
															name={`product_${index}_slot_${slotIndex}_repeatsWeekly`}
															defaultChecked={slot.repeatsWeekly === true}
														/>
														{t('extensions.slotRepeatsWeekly')}
													</label>
												</div>
											)
										})}
									</div>
								</div>
							</div>
						</div>
					)
				})}
			</div>
			{productRows.length > 0 ? (
				<div className='flex justify-end border-t pt-4'>
					<Button type='submit'>
						<SaveIcon className='mr-2 h-4 w-4' />
						{t('extensions.savePlan')}
					</Button>
				</div>
			) : null}
		</form>
	)
}

function normalizePrepaymentPolicyOption(value: string) {
	switch (value) {
		case 'deposit':
		case 'partial':
			return 'deposit_required'
		case 'full':
		case 'full_prepayment':
			return 'full_required'
		case 'optional':
		case 'none':
		case 'deposit_required':
		case 'full_required':
			return value
		default:
			return 'deposit_required'
	}
}

function productSlots(product: Record<string, unknown>) {
	return Array.isArray(product.slots)
		? (product.slots as Record<string, unknown>[])
		: []
}

function productAvailability(product: Record<string, unknown>) {
	const availability = getRecord(product.availability)
	return {
		startDate: normalizeDateValue(availability?.startDate),
		endDate: normalizeDateValue(availability?.endDate),
		weekdays: normalizeWeekdays(availability?.weekdays),
		includedDates: normalizeDateList(availability?.includedDates),
		excludedDates: normalizeDateList(availability?.excludedDates),
	}
}

function normalizeDateValue(value: unknown) {
	if (typeof value !== 'string') return ''
	const text = value.trim()
	return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : ''
}

function normalizeDateList(value: unknown) {
	return Array.isArray(value)
		? value
				.map(item => normalizeDateValue(item))
				.filter((item): item is string => Boolean(item))
		: []
}

function normalizeWeekdays(value: unknown) {
	if (!Array.isArray(value)) return []
	return value
		.map(item => Number(item))
		.filter(item => Number.isInteger(item) && item >= 0 && item <= 6)
}

function formatDateTimeLocalInput(value: unknown) {
	if (typeof value !== 'string' || !value.trim()) return ''
	const date = new Date(value)
	if (Number.isNaN(date.getTime())) return value.slice(0, 16)
	const year = date.getFullYear()
	const month = String(date.getMonth() + 1).padStart(2, '0')
	const day = String(date.getDate()).padStart(2, '0')
	const hours = String(date.getHours()).padStart(2, '0')
	const minutes = String(date.getMinutes()).padStart(2, '0')
	return `${year}-${month}-${day}T${hours}:${minutes}`
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

function hasApplicationIntakeConfig(config?: Record<string, unknown> | null) {
	return Boolean(
		getRecord(config?.formPresentation) &&
			Array.isArray(config?.courses) &&
			Array.isArray(config?.consentItems) &&
			Array.isArray(config?.subjectGroups),
	)
}

function getRecord(value: unknown) {
	return value && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null
}

function getArray(value: unknown): unknown[] {
	return Array.isArray(value) ? value : []
}

function reservationProductRows(
	products: Record<string, unknown>[],
	catalogProducts: CatalogProductOption[],
): Array<{
	catalogProduct: CatalogProductOption
	product: Record<string, unknown>
}> {
	const productsByCatalogId = new Map<string, Record<string, unknown>>(
		products
			.map(
				product =>
					[
						String(product.productId ?? product.catalogProductId ?? ''),
						product,
					] as const,
			)
			.filter(([productId]) => productId),
	)

	return catalogProducts.map(catalogProduct => ({
		catalogProduct,
		product: productsByCatalogId.get(catalogProduct.id) ?? {},
	}))
}

function padRows<T>(items: T[], length: number): Array<T | null> {
	return Array.from({ length }, (_, index) => items[index] ?? null)
}

function getNumber(value: unknown, fallback: number) {
	const parsed = Number(value)
	return Number.isFinite(parsed) ? parsed : fallback
}

function formatDateTime(value?: string | null) {
	if (!value) return '-'
	return new Intl.DateTimeFormat('ja-JP', {
		dateStyle: 'medium',
		timeStyle: 'short',
	}).format(new Date(value))
}
