'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { Badge } from 'components/ui/badge'
import { Button } from 'components/ui/button'
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from 'components/ui/card'
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
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
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from 'components/ui/table'
import { Textarea } from 'components/ui/textarea'
import {
	ChevronLeftIcon,
	Loader2Icon,
	PencilIcon,
	PlusIcon,
	Trash2Icon,
	UploadIcon,
	XIcon,
} from 'lucide-react'
import type { Route } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import {
	type ChangeEvent,
	useEffect,
	useRef,
	useState,
	useTransition,
} from 'react'
import { type SubmitHandler, useForm } from 'react-hook-form'

import {
	type ProductValidatorType,
	type VariantFormInput,
	convertToFormValues,
	productValidator,
} from 'app/(v1)/[tenant]/library/products/_components/product-detail/validator'
import {
	Form,
	FormControl,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from 'components/ui/form'
import {
	PaymentProviderProductDetailFieldFragment,
	type ProductDetailOnProductFieldFragment,
} from 'gen/graphql'
import {
	useConfirmProductImageUploadMutation,
	useCreateProductMutation,
	useGetProductImageUploadUrlMutation,
	useUpdateProductMutation,
} from 'gen/graphql-urql'
import { useModePrefix } from 'hooks/useMode'
import { revalidatePathAction } from 'lib/action'
import { libraryMasterErrorDetails } from 'lib/library-master-errors'
import {
	Kind,
	ProductStatus,
	ProviderName,
	PublicationStatus,
	RecurringBillingFrequency,
} from 'lib/product-constants'
import { normalizeProductTags } from 'lib/product-tags-master'
import { categoryMasterChanges } from 'lib/product-category-master'
import { useMutationError } from 'lib/utils/mutationError'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'

/** Generate a valid pv_[ulid] style ID for new variants */
function generateVariantId(): string {
	const chars = '0123456789abcdefghjkmnpqrstvwxyz'
	let ulid = ''
	for (let i = 0; i < 26; i++) {
		ulid += chars[Math.floor(Math.random() * chars.length)]
	}
	return `pv_${ulid}`
}

const VARIANT_STATUS_LABELS: Record<string, string> = {
	ACTIVE: '販売中',
	DRAFT: '下書き',
	ARCHIVED: 'アーカイブ',
}

const MAX_IMAGE_SIZE_MB = 5
const ACCEPTED_TYPES = ['image/jpeg', 'image/png']
const MAX_IMAGE_COUNT = 10

const CATEGORY_FIELD_LABELS = {
	category: 'カテゴリ',
	subcategory: 'サブカテゴリ',
}

const CATEGORY_OPERATION_LABELS = {
	create: '新規作成',
	update: '更新',
	delete: '削除',
}

export function ProductDetails({
	data,
	backLink,
	tenantId,
	paymentProviders,
}: {
	data?: ProductDetailOnProductFieldFragment
	backLink: Route
	tenantId: string
	paymentProviders?: PaymentProviderProductDetailFieldFragment[]
}) {
	const { data: session } = useSession()
	const router = useRouter()
	const modePrefix = useModePrefix()
	const { toast, errorToast } = useMutationError()
	const [createProductMutationResult, createProductMutation] =
		useCreateProductMutation()
	// Idempotency key for product creation. Generated once per logical "save"
	// intent and reused across user-driven retries (re-clicking Save after an
	// error), so the backend returns the original product instead of inserting
	// a duplicate. Reset only after a successful create.
	const createIdempotencyKeyRef = useRef<string | null>(null)
	const [updateProductMutationResult, updateProductMutation] =
		useUpdateProductMutation()
	const [, getProductImageUploadUrlMutation] =
		useGetProductImageUploadUrlMutation()
	const [, confirmProductImageUploadMutation] =
		useConfirmProductImageUploadMutation()
	const form = useForm<ProductValidatorType>({
		resolver: zodResolver(
			productValidator as unknown as Parameters<typeof zodResolver>[0],
		),
		defaultValues: data
			? convertToFormValues(data)
			: {
					name: '',
					kind: Kind.Plan,
					listPrice: 0,
					billingCycle: RecurringBillingFrequency.Once,
					status: ProductStatus.Draft,
					publicationStatus: PublicationStatus.Private,
					tags: [],
				},
	})
	const {
		control,
		register,
		watch,
		handleSubmit,
		formState: { errors },
	} = form

	const [isPending, startTransition] = useTransition()

	// Variant dialog state
	const [variantDialogOpen, setVariantDialogOpen] = useState(false)
	const [editingVariantIndex, setEditingVariantIndex] = useState<number | null>(
		null,
	)
	const [variantForm, setVariantForm] = useState<VariantFormInput>({
		code: '',
		name: '',
		status: 'ACTIVE',
		currency: 'jpy',
		unitAmount: 0,
	})

	const currentVariants = form.watch('variants') ?? []
	const currentTags = form.watch('tags') ?? []
	const [tagInput, setTagInput] = useState('')
	const categoryChanges = categoryMasterChanges({
		initialCategory: data?.category,
		initialSubcategory: data?.subcategory,
		category: watch('category'),
		subcategory: watch('subcategory'),
	})

	const clearCategoryField = (field: 'category' | 'subcategory') => {
		form.setValue(field, null, {
			shouldDirty: true,
			shouldTouch: true,
			shouldValidate: true,
		})
	}

	const addTag = () => {
		const tags = normalizeProductTags([...currentTags, tagInput])
		if (tags.length === currentTags.length) {
			setTagInput('')
			return
		}
		form.setValue('tags', tags, {
			shouldDirty: true,
			shouldTouch: true,
			shouldValidate: true,
		})
		setTagInput('')
	}

	const removeTag = (tag: string) => {
		form.setValue(
			'tags',
			currentTags.filter(currentTag => currentTag !== tag),
			{
				shouldDirty: true,
				shouldTouch: true,
				shouldValidate: true,
			},
		)
	}

	const openAddVariantDialog = () => {
		setEditingVariantIndex(null)
		setVariantForm({
			code: '',
			name: '',
			status: 'ACTIVE',
			currency: 'jpy',
			unitAmount: form.getValues('listPrice') ?? 0,
		})
		setVariantDialogOpen(true)
	}

	const openEditVariantDialog = (index: number) => {
		const variant = currentVariants[index]
		if (!variant) return
		setEditingVariantIndex(index)
		setVariantForm({ ...variant })
		setVariantDialogOpen(true)
	}

	const saveVariant = () => {
		if (!variantForm.code.trim() || !variantForm.name.trim()) return
		const updated = [...currentVariants]
		if (editingVariantIndex !== null) {
			updated[editingVariantIndex] = variantForm
		} else {
			updated.push(variantForm)
		}
		form.setValue('variants', updated)
		setVariantDialogOpen(false)
	}

	const removeVariant = (index: number) => {
		const updated = currentVariants.filter((_, i) => i !== index)
		form.setValue('variants', updated)
	}

	const onSubmit: SubmitHandler<ProductValidatorType> = async input => {
		startTransition(async () => {
			if (Object.keys(errors).length > 0) {
				for (const error of Object.values(errors)) {
					toast({
						title: 'フォームの入力に問題があります',
						description: (error?.message ?? 'エラーが発生しました') as string,
						variant: 'destructive',
					})
				}
			}

			if (data) {
				await handleUpdate(data.id, input)
			} else {
				await handleCreate(input)
			}
		})
	}

	const handleCreate = async (input: ProductValidatorType) => {
		try {
			if (!session) {
				throw new Error('Unauthorized')
			}

			const { images: _images, variants, ...rest } = input

			const imageStorageKeys = await uploadNewImages()

			const variations =
				variants && variants.length > 0
					? variants.map(v => ({
							name: v.name,
							currency: v.currency,
							unitAmount: v.unitAmount,
							code: v.code,
							status: v.status,
						}))
					: undefined

			// Reuse the same key across retries of this save intent; only
			// generate a new one when there is no in-flight attempt.
			if (createIdempotencyKeyRef.current === null) {
				createIdempotencyKeyRef.current = crypto.randomUUID()
			}

			const result = await createProductMutation({
				input: {
					...rest,
					variations,
					imageStorageKeys:
						imageStorageKeys.length > 0 ? imageStorageKeys : undefined,
					idempotencyKey: createIdempotencyKeyRef.current,
				},
			})
			if (result.error) throw result.error
			if (!result.data?.createProduct) {
				throw new Error('製品の作成結果を取得できませんでした')
			}

			// Success: clear the key so the next product gets a fresh one.
			createIdempotencyKeyRef.current = null

			toast({
				title: '製品が正常に作成されました',
				variant: 'default',
			})
			revalidatePathAction(`${modePrefix}/${tenantId}/library/products`)
			router.push(`${modePrefix}/${tenantId}/library/products`)
		} catch (error: unknown) {
			const details = libraryMasterErrorDetails(error)
			if (details) {
				toast({
					title: details.title,
					description: details.message,
					variant: 'destructive',
				})
				return
			}
			errorToast('製品の作成に失敗しました', error)
		}
	}

	const handleUpdate = async (id: string, input: ProductValidatorType) => {
		try {
			const { images: _images, variants, ...rest } = input

			const imageStorageKeys = await uploadNewImages()

			const variations =
				variants !== undefined
					? variants.map(v => ({
							id: v.id ?? generateVariantId(),
							name: v.name,
							currency: v.currency,
							unitAmount: v.unitAmount,
							code: v.code,
							status: v.status,
						}))
					: undefined

			const result = await updateProductMutation({
				input: {
					...rest,
					id,
					expectedUpdatedAt: data?.updatedAt,
					variations,
					imageStorageKeys:
						imageStorageKeys.length > 0 ? imageStorageKeys : undefined,
				},
			})
			if (result.error) throw result.error
			if (!result.data?.updateProduct) {
				throw new Error('製品の更新結果を取得できませんでした')
			}

			toast({
				title: '製品が正常に更新されました',
				variant: 'default',
			})
			revalidatePathAction(`${modePrefix}/${tenantId}/library/products`)
			router.push(`${modePrefix}/${tenantId}/library/products`)
		} catch (error: unknown) {
			const details = libraryMasterErrorDetails(error)
			if (details) {
				toast({
					title: details.title,
					description: details.message,
					variant: 'destructive',
				})
				return
			}
			errorToast('製品の更新に失敗しました', error)
		}
	}

	const fileInputRef = useRef<HTMLInputElement>(null)
	const [selectedImages, setSelectedImages] = useState<File[]>([])
	const [previewUrls, setPreviewUrls] = useState<string[]>(
		data?.imageStorageUrls && data.imageStorageUrls.length > 0
			? data.imageStorageUrls
			: (data?.imageFiles ?? []),
	)
	// null = new file (not yet uploaded), string = existing storage key
	const [storageKeys, setStorageKeys] = useState<(string | null)[]>(
		data?.imageStorageKeys && data.imageStorageKeys.length > 0
			? data.imageStorageKeys
			: (data?.imageFiles ?? []).map(() => null),
	)

	const uploadNewImages = async (): Promise<string[]> => {
		const result: string[] = []
		let newFileIdx = 0
		for (let i = 0; i < storageKeys.length; i++) {
			const existingKey = storageKeys[i]
			if (existingKey !== null) {
				result.push(existingKey)
				continue
			}
			const file = selectedImages[newFileIdx++]
			if (!file) continue
			const ext = file.name.split('.').pop() ?? 'jpg'
			const urlResult = await getProductImageUploadUrlMutation({
				contentType: file.type,
				extension: ext,
			})
			if (urlResult.error || !urlResult.data) {
				throw new Error(urlResult.error?.message ?? 'Failed to get upload URL')
			}
			const { uploadUrl, storageKey } = urlResult.data.getProductImageUploadUrl
			await fetch(uploadUrl, {
				method: 'PUT',
				body: file,
				headers: { 'Content-Type': file.type },
			})
			const confirmResult = await confirmProductImageUploadMutation({
				storageKey,
			})
			if (confirmResult.error || !confirmResult.data) {
				throw new Error(
					confirmResult.error?.message ?? 'Failed to confirm upload',
				)
			}
			result.push(confirmResult.data.confirmProductImageUpload.storageKey)
		}
		return result
	}

	const handleImageSelect = (event: ChangeEvent<HTMLInputElement>) => {
		const fileList = event.target.files
		if (!fileList || fileList.length === 0) return

		const fileArray = Array.from(fileList)

		const validFiles: File[] = []
		const errors: string[] = []

		for (const file of fileArray) {
			if (!ACCEPTED_TYPES.includes(file.type)) {
				errors.push(`${file.name}: JPEG または PNG のみアップロード可能です`)
				continue
			}
			if (file.size > MAX_IMAGE_SIZE_MB * 1024 * 1024) {
				errors.push(
					`${file.name}: ファイルサイズが ${MAX_IMAGE_SIZE_MB}MB を超えています`,
				)
				continue
			}
			validFiles.push(file)
		}

		const currentCount = previewUrls.length
		const remaining = MAX_IMAGE_COUNT - currentCount
		if (validFiles.length > remaining) {
			errors.push(
				`画像は最大 ${MAX_IMAGE_COUNT} 枚までです（あと ${remaining} 枚追加可能）`,
			)
		}
		const filesToAdd = validFiles.slice(0, remaining)

		if (errors.length > 0) {
			for (const msg of errors) {
				toast({
					title: '画像アップロードエラー',
					description: msg,
					variant: 'destructive',
				})
			}
		}

		if (filesToAdd.length === 0) return

		const urls = filesToAdd.map((file: File) => URL.createObjectURL(file))

		setPreviewUrls(prev => [...prev, ...urls])
		setSelectedImages(prev => [...prev, ...filesToAdd])
		setStorageKeys(prev => [...prev, ...filesToAdd.map(() => null)])

		form.setValue('images', [
			...(form.getValues('images') ?? []),
			...filesToAdd.map(file => ({ image: file })),
		])
	}

	const handleImageRemove = (index: number) => {
		setPreviewUrls(prev => prev.filter((_, i) => i !== index))
		setStorageKeys(prev => {
			const updated = prev.filter((_, i) => i !== index)
			// also remove from selectedImages for null slots
			const removedKey = prev[index]
			if (removedKey === null) {
				// count how many nulls before this index to find selectedImages slot
				const newFileSlot = prev.slice(0, index).filter(k => k === null).length
				setSelectedImages(imgs => imgs.filter((_, i) => i !== newFileSlot))
			}
			return updated
		})
	}

	useEffect(() => {
		return () => {
			for (const url of previewUrls) {
				URL.revokeObjectURL(url)
			}
		}
	}, [previewUrls])

	return (
		<main className='grid flex-1 items-start gap-4 p-4 sm:px-6 sm:py-0 md:gap-8'>
			<Form {...form}>
				<form
					onSubmit={handleSubmit(onSubmit)}
					className='mx-auto grid flex-1 auto-rows-max gap-4'
				>
					<div className='flex items-center gap-4'>
						<Button className='h-7 w-7' size='icon' variant='outline' asChild>
							<Link href={backLink}>
								<ChevronLeftIcon className='h-4 w-4' />
								<span className='sr-only'>戻る</span>
							</Link>
						</Button>
						<h1 className='flex-1 shrink-0 whitespace-nowrap text-xl font-semibold tracking-tight sm:grow-0'>
							{watch('name') || '製品名を入力'}
						</h1>
						<Badge className='ml-auto sm:ml-0' variant='outline'>
							販売中
						</Badge>
						<div className='hidden items-center gap-2 md:ml-auto md:flex'>
							<Button size='sm' variant='outline' disabled={isPending}>
								変更を破棄
							</Button>
							<Button size='sm' type='submit' disabled={isPending}>
								{isPending ? (
									<>
										<Loader2Icon className='mr-2 h-4 w-4 animate-spin' />
										保存中...
									</>
								) : (
									'製品を保存する'
								)}
							</Button>
						</div>
					</div>
					<div className='grid gap-4 md:grid-cols-[2fr_1fr] lg:gap-8'>
						<div className='grid auto-rows-max items-start gap-4 lg:gap-8'>
							<Card>
								<CardHeader>
									<CardTitle>製品詳細</CardTitle>
									<CardDescription>
										このセクションでは、製品の詳細情報を提供します。
									</CardDescription>
								</CardHeader>
								<CardContent>
									<div className='grid gap-6'>
										<div className='grid gap-3'>
											<Label htmlFor='product-name'>製品名</Label>
											<Input
												className='w-full'
												{...register('name')}
												id='product-name'
												type='text'
												placeholder='製品名を入力'
											/>
											{errors.name && (
												<p className='text-sm text-destructive'>
													{errors.name.message}
												</p>
											)}
										</div>
										<div className='grid gap-3'>
											<Label htmlFor='description'>説明</Label>
											<Textarea
												className='min-h-32'
												{...register('description')}
												id='description'
												rows={4}
												placeholder='説明をここに入力する'
											/>
										</div>
										<FormField
											control={form.control}
											name='kind'
											render={({ field }) => (
												<FormItem>
													<FormLabel>商品種別</FormLabel>
													<Select
														onValueChange={field.onChange}
														defaultValue={field.value}
													>
														<FormControl>
															<SelectTrigger>
																<SelectValue placeholder='商品種別を選択' />
															</SelectTrigger>
														</FormControl>
														<SelectContent>
															<SelectItem value={Kind.Plan}>
																非在庫商品
															</SelectItem>
															<SelectItem value={Kind.Product}>
																在庫商品
															</SelectItem>
															<SelectItem value={Kind.Option}>
																オプション
															</SelectItem>
														</SelectContent>
													</Select>
													<p className='text-xs text-muted-foreground'>
														{field.value === Kind.Plan &&
															'サービスやサブスクリプションなど、在庫管理が不要な商品です。'}
														{field.value === Kind.Product &&
															'物理的な在庫を持ち、在庫数を追跡する商品です。'}
														{field.value === Kind.Option &&
															'他の商品に付帯するオプション商品です。'}
													</p>
													<FormMessage />
												</FormItem>
											)}
										/>
										<div className='grid gap-3'>
											<Label htmlFor='skuCode'>SKUコード</Label>
											<Input
												className='w-full'
												{...register('skuCode')}
												id='skuCode'
												placeholder='SKUコードをここに入力する'
											/>
										</div>
										<div className='grid gap-3'>
											<Label htmlFor='janCode'>JANコード</Label>
											<Input
												className='w-full'
												{...register('janCode')}
												id='janCode'
												placeholder='JANコードをここに入力する'
											/>
										</div>
										<div className='grid gap-3'>
											<Label htmlFor='upcCode'>UPCコード</Label>
											<Input
												className='w-full'
												{...register('upcCode')}
												id='upcCode'
												placeholder='UPCコードをここに入力する'
											/>
										</div>
									</div>
								</CardContent>
							</Card>
							<Card>
								<CardHeader>
									<CardTitle>値段</CardTitle>
									<CardDescription>
										製品の価格情報を入力してください。
									</CardDescription>
								</CardHeader>
								<CardContent>
									<div className='grid gap-6'>
										<div className='grid gap-3'>
											<Label htmlFor='price'>定価（税込）</Label>
											<Input
												className='w-full'
												{...register('listPrice', {
													valueAsNumber: true,
												})}
												id='listPrice'
												type='number'
												placeholder='2000'
											/>
											{errors.listPrice && (
												<p className='text-sm text-destructive'>
													{errors.listPrice.message}
												</p>
											)}
										</div>
										<FormField
											control={form.control}
											name='billingCycle'
											render={({ field }) => (
												<FormItem>
													<FormLabel>請求サイクル</FormLabel>
													<Select
														onValueChange={field.onChange}
														defaultValue={field.value}
													>
														<FormControl>
															<SelectTrigger>
																<SelectValue placeholder='請求サイクルを選択' />
															</SelectTrigger>
														</FormControl>
														<SelectContent>
															<SelectItem
																value={RecurringBillingFrequency.Once}
															>
																一回のみ
															</SelectItem>
															<SelectItem
																value={RecurringBillingFrequency.Monthly}
															>
																毎月
															</SelectItem>
															<SelectItem
																value={RecurringBillingFrequency.Yearly}
															>
																毎年
															</SelectItem>
														</SelectContent>
													</Select>
													<FormMessage />
												</FormItem>
											)}
										/>
									</div>
								</CardContent>
							</Card>
							<Card>
								<CardHeader>
									<CardTitle>製品カテゴリ</CardTitle>
								</CardHeader>
								<CardContent>
									<div className='grid gap-6'>
										{categoryChanges.length > 0 && (
											<div className='flex flex-wrap gap-2'>
												{categoryChanges.map(change => (
													<Badge
														key={`${change.field}-${change.operation}`}
														variant='outline'
													>
														{CATEGORY_FIELD_LABELS[change.field]}:
														{CATEGORY_OPERATION_LABELS[change.operation]}
													</Badge>
												))}
											</div>
										)}
										<FormField
											control={form.control}
											name='category'
											render={({ field }) => (
												<FormItem>
													<FormLabel>カテゴリ</FormLabel>
													<div className='flex gap-2'>
														<FormControl>
															<Input
																placeholder='例: electronics'
																value={field.value ?? ''}
																onChange={event =>
																	field.onChange(event.target.value)
																}
																onBlur={field.onBlur}
															/>
														</FormControl>
														<Button
															type='button'
															variant='outline'
															size='icon'
															aria-label='カテゴリを削除'
															disabled={!field.value}
															onClick={() => clearCategoryField('category')}
														>
															<XIcon className='h-4 w-4' />
														</Button>
													</div>
													<FormMessage />
												</FormItem>
											)}
										/>
										<FormField
											control={form.control}
											name='subcategory'
											render={({ field }) => (
												<FormItem>
													<FormLabel>サブカテゴリ（任意）</FormLabel>
													<div className='flex gap-2'>
														<FormControl>
															<Input
																placeholder='例: audio'
																value={field.value ?? ''}
																onChange={event =>
																	field.onChange(event.target.value)
																}
																onBlur={field.onBlur}
															/>
														</FormControl>
														<Button
															type='button'
															variant='outline'
															size='icon'
															aria-label='サブカテゴリを削除'
															disabled={!field.value}
															onClick={() => clearCategoryField('subcategory')}
														>
															<XIcon className='h-4 w-4' />
														</Button>
													</div>
													<FormMessage />
												</FormItem>
											)}
										/>
									</div>
								</CardContent>
							</Card>
							<Card>
								<CardHeader>
									<CardTitle>商品タグ</CardTitle>
								</CardHeader>
								<CardContent>
									<FormField
										control={form.control}
										name='tags'
										render={() => (
											<FormItem>
												<FormLabel>タグ</FormLabel>
												<div className='grid gap-3'>
													<div className='flex gap-2'>
														<FormControl>
															<Input
																placeholder='例: seasonal'
																value={tagInput}
																onChange={event =>
																	setTagInput(event.target.value)
																}
																onKeyDown={event => {
																	if (event.key !== 'Enter') return
																	event.preventDefault()
																	addTag()
																}}
															/>
														</FormControl>
														<Button
															type='button'
															variant='outline'
															size='icon'
															aria-label='タグを追加'
															disabled={!tagInput.trim()}
															onClick={addTag}
														>
															<PlusIcon className='h-4 w-4' />
														</Button>
													</div>
													{currentTags.length > 0 && (
														<div className='flex flex-wrap gap-2'>
															{currentTags.map(tag => (
																<Badge
																	key={tag}
																	variant='secondary'
																	className='gap-1 pr-1'
																>
																	<span>{tag}</span>
																	<button
																		type='button'
																		className='rounded-sm p-0.5 hover:bg-background/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
																		aria-label={`タグを削除: ${tag}`}
																		onClick={() => removeTag(tag)}
																	>
																		<XIcon className='h-3 w-3' />
																	</button>
																</Badge>
															))}
														</div>
													)}
												</div>
												<FormMessage />
											</FormItem>
										)}
									/>
								</CardContent>
							</Card>
							<Card>
								<CardHeader>
									<CardTitle>公開情報</CardTitle>
									<CardDescription>
										公開情報は、製品を外部公開する場合の情報です。
									</CardDescription>
								</CardHeader>
								<CardContent>
									<div className='grid gap-6'>
										<FormField
											control={form.control}
											name='publicationStatus'
											render={({ field }) => (
												<FormItem>
													<FormLabel>公開ステータス</FormLabel>
													<Select
														onValueChange={field.onChange}
														defaultValue={field.value}
													>
														<FormControl>
															<SelectTrigger>
																<SelectValue placeholder='公開ステータスを選択' />
															</SelectTrigger>
														</FormControl>
														<SelectContent>
															<SelectItem value={PublicationStatus.Public}>
																公開
															</SelectItem>
															<SelectItem value={PublicationStatus.Private}>
																非公開
															</SelectItem>
															<SelectItem
																value={PublicationStatus.PublicUseDefault}
															>
																製品詳細の内容で公開
															</SelectItem>
														</SelectContent>
													</Select>
													<FormMessage />
												</FormItem>
											)}
										/>

										<div className='grid gap-3'>
											<Label htmlFor='publicationName'>製品名</Label>
											<Input
												className='w-full'
												{...register('publicationName')}
												id='publicationName'
												type='text'
												placeholder='公開用の製品名'
											/>
										</div>
										<div className='grid gap-3'>
											<Label htmlFor='publicDescription'>説明</Label>
											<Textarea
												className='min-h-32'
												{...register('publicationDescription')}
												id='publicationDescription'
												rows={4}
												placeholder='公開用の製品説明'
											/>
										</div>
									</div>
								</CardContent>
							</Card>
							<Card>
								<CardHeader>
									<div className='flex items-center justify-between'>
										<div>
											<CardTitle>バリアント管理</CardTitle>
											<CardDescription>
												サイズ・カラー等のバリアントを管理します。
											</CardDescription>
										</div>
										<Button
											type='button'
											size='sm'
											variant='outline'
											onClick={openAddVariantDialog}
										>
											<PlusIcon className='h-4 w-4 mr-1' />
											バリアントを追加
										</Button>
									</div>
								</CardHeader>
								<CardContent>
									{currentVariants.length === 0 ? (
										<p className='text-sm text-muted-foreground text-center py-4'>
											バリアントがありません。「バリアントを追加」から追加してください。
										</p>
									) : (
										<Table>
											<TableHeader>
												<TableRow>
													<TableHead>コード</TableHead>
													<TableHead>名前</TableHead>
													<TableHead>ステータス</TableHead>
													<TableHead className='w-20' />
												</TableRow>
											</TableHeader>
											<TableBody>
												{currentVariants.map((variant, index) => (
													<TableRow key={variant.id ?? `new-${index}`}>
														<TableCell className='font-mono text-sm'>
															{variant.code}
														</TableCell>
														<TableCell>{variant.name}</TableCell>
														<TableCell>
															<Badge variant='outline'>
																{VARIANT_STATUS_LABELS[variant.status] ??
																	variant.status}
															</Badge>
														</TableCell>
														<TableCell>
															<div className='flex gap-1'>
																<Button
																	type='button'
																	size='icon'
																	variant='ghost'
																	className='h-7 w-7'
																	onClick={() => openEditVariantDialog(index)}
																>
																	<PencilIcon className='h-3 w-3' />
																	<span className='sr-only'>編集</span>
																</Button>
																<Button
																	type='button'
																	size='icon'
																	variant='ghost'
																	className='h-7 w-7 text-destructive hover:text-destructive'
																	onClick={() => removeVariant(index)}
																>
																	<Trash2Icon className='h-3 w-3' />
																	<span className='sr-only'>削除</span>
																</Button>
															</div>
														</TableCell>
													</TableRow>
												))}
											</TableBody>
										</Table>
									)}
								</CardContent>
							</Card>
						</div>
						<div className='grid auto-rows-max items-start gap-4 lg:gap-8'>
							<Card>
								<CardHeader>
									<CardTitle>外部連携</CardTitle>
								</CardHeader>
								<CardContent>
									<div className='grid gap-6'>
										{data?.providers?.map(provider => (
											<div
												key={provider.providerPrimaryId}
												className='flex items-center justify-between p-4 border rounded-lg shadow-sm'
											>
												<div>
													<p className='text-sm font-medium text-gray-900'>
														{provider.providerName}
													</p>
													<p className='text-sm text-gray-500'>
														{provider.providerPrimaryId}
													</p>
												</div>
												{provider.providerName === ProviderName.HubSpot && (
													<Link
														href={`https://app.hubspot.com/contacts/${provider.providerTenantId}/record/0-7/${provider.providerPrimaryId}/properties`}
														target='_blank'
														rel='noopener noreferrer'
														className='text-blue-600 hover:underline text-sm'
													>
														HubSpotで開く
													</Link>
												)}
												{provider.providerName === ProviderName.Salesforce && (
													<Link
														href={`https://login.salesforce.com/${provider.providerTenantId}/record/${provider.providerPrimaryId}`}
														target='_blank'
														rel='noopener noreferrer'
														className='text-blue-600 hover:underline'
													>
														Salesforceで開く
													</Link>
												)}
											</div>
										))}
										{paymentProviders?.map(provider => (
											<div
												key={provider.providerId}
												className='flex items-center justify-between p-4 border rounded-lg shadow-sm'
											>
												<div>
													<p className='text-sm font-medium text-gray-900'>
														{provider.providerName}
													</p>
													<p className='text-sm text-gray-500'>
														{provider.providerId}
													</p>
												</div>
												{provider.providerName === 'SQUARE' && (
													<Link
														href={`https://app.squareupsandbox.com/dashboard/items/library/${provider.providerId}`}
														target='_blank'
														rel='noopener noreferrer'
														className='text-blue-600 hover:underline text-sm'
													>
														Squareで開く
													</Link>
												)}
												{provider.providerName === 'STRIPE' && (
													<Link
														// href={`https://dashboard.stripe.com/test/products/d/pd_01jdccp8xv873mj15b1x4ftrfk?active=true`}
														href={`https://dashboard.stripe.com/test/products/d/${provider.providerId}?active=true`}
														target='_blank'
														rel='noopener noreferrer'
														className='text-blue-600 hover:underline text-sm'
													>
														Stripeで開く
													</Link>
												)}
											</div>
										))}
									</div>
								</CardContent>
							</Card>
							<Card>
								<CardHeader>
									<CardTitle>製品ステータス</CardTitle>
								</CardHeader>
								<CardContent>
									<div className='grid gap-6'>
										<FormField
											control={form.control}
											name='status'
											render={({ field }) => (
												<FormItem>
													<FormLabel>ステータス</FormLabel>
													<Select
														onValueChange={field.onChange}
														defaultValue={field.value}
													>
														<FormControl>
															<SelectTrigger>
																<SelectValue placeholder='ステータスを選択' />
															</SelectTrigger>
														</FormControl>
														<SelectContent>
															<SelectItem value={ProductStatus.Active}>
																販売中
															</SelectItem>
															<SelectItem value={ProductStatus.Draft}>
																下書き
															</SelectItem>
															<SelectItem value={ProductStatus.Archived}>
																アーカイブ済み
															</SelectItem>
														</SelectContent>
													</Select>
													<FormMessage />
												</FormItem>
											)}
										/>
									</div>
								</CardContent>
							</Card>
							<Card className='overflow-hidden'>
								<CardHeader>
									<CardTitle>製品画像</CardTitle>
									<CardDescription>
										製品の画像をアップロードしてください。
									</CardDescription>
								</CardHeader>
								<CardContent>
									<div className='grid gap-2'>
										{previewUrls[0] ? (
											<div className='relative'>
												<Image
													alt='メイン製品画像'
													className='aspect-square w-full rounded-md object-cover'
													height='300'
													src={previewUrls[0]}
													width='300'
												/>
												<button
													type='button'
													onClick={() => handleImageRemove(0)}
													className='absolute top-2 right-2 p-1 rounded-full bg-black/50 hover:bg-black/70 transition-colors'
												>
													<XIcon className='h-4 w-4 text-white' />
													<span className='sr-only'>画像を削除</span>
												</button>
											</div>
										) : (
											<button
												type='button'
												className='flex aspect-square w-full items-center justify-center rounded-md border-2 border-dashed bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer'
												onClick={() => fileInputRef.current?.click()}
											>
												<div className='flex flex-col items-center gap-2 text-muted-foreground'>
													<UploadIcon className='h-8 w-8' />
													<span className='text-sm font-medium'>
														クリックして画像を追加
													</span>
													<span className='text-xs'>
														JPEG / PNG（最大 5MB）
													</span>
												</div>
											</button>
										)}
										<div className='grid grid-cols-3 gap-2'>
											{previewUrls.slice(1).map((url, index) => (
												<div key={url} className='relative'>
													<Image
														alt={`製品画像 ${index + 2}`}
														className='aspect-square w-full rounded-md object-cover'
														height='84'
														src={url}
														width='84'
													/>
													<button
														type='button'
														onClick={() => handleImageRemove(index + 1)}
														className='absolute top-1 right-1 p-0.5 rounded-full bg-black/50 hover:bg-black/70 transition-colors'
													>
														<XIcon className='h-3 w-3 text-white' />
														<span className='sr-only'>画像を削除</span>
													</button>
												</div>
											))}
											<input
												ref={fileInputRef}
												type='file'
												accept='image/jpeg,image/png'
												multiple
												className='hidden'
												onChange={handleImageSelect}
											/>
											{previewUrls.length > 0 &&
												previewUrls.length < MAX_IMAGE_COUNT && (
													<button
														type='button'
														className='flex aspect-square w-full items-center justify-center rounded-md border border-dashed hover:bg-muted/50 transition-colors'
														onClick={() => fileInputRef.current?.click()}
													>
														<UploadIcon className='h-4 w-4 text-muted-foreground' />
														<span className='sr-only'>アップロード</span>
													</button>
												)}
										</div>
									</div>
									<p className='mt-3 text-xs text-muted-foreground'>
										JPEG / PNG 形式、1ファイル最大 5MB、最大 {MAX_IMAGE_COUNT}{' '}
										枚まで。
										{previewUrls.length > 0 && (
											<span className='font-medium'>
												{' '}
												現在 {previewUrls.length} 枚選択中
											</span>
										)}
									</p>
								</CardContent>
							</Card>
							<Card>
								<CardHeader>
									<CardTitle>製品をアーカイブ</CardTitle>
									<CardDescription>
										この製品をアーカイブします。アーカイブされた製品は販売されません。
									</CardDescription>
								</CardHeader>
								<CardContent>
									<Button size='sm' variant='secondary'>
										製品をアーカイブ
									</Button>
								</CardContent>
							</Card>
						</div>
					</div>
					<div className='flex items-center justify-center gap-2 md:hidden'>
						<Button size='sm' variant='outline' disabled={isPending}>
							変更を破棄
						</Button>
						<Button size='sm' disabled={isPending}>
							{isPending ? (
								<>
									<Loader2Icon className='mr-2 h-4 w-4 animate-spin' />
									保存中...
								</>
							) : (
								'製品を保存する'
							)}
						</Button>
					</div>
				</form>
			</Form>

			{/* Variant add/edit dialog */}
			<Dialog open={variantDialogOpen} onOpenChange={setVariantDialogOpen}>
				<DialogContent className='sm:max-w-md'>
					<DialogHeader>
						<DialogTitle>
							{editingVariantIndex !== null
								? 'バリアントを編集'
								: 'バリアントを追加'}
						</DialogTitle>
					</DialogHeader>
					<div className='grid gap-4 py-2'>
						<div className='grid gap-2'>
							<Label htmlFor='variant-code'>
								コード <span className='text-destructive'>*</span>
							</Label>
							<Input
								id='variant-code'
								placeholder='例: S, M, L, BLACK'
								value={variantForm.code}
								onChange={e =>
									setVariantForm(prev => ({
										...prev,
										code: e.target.value,
									}))
								}
							/>
							<p className='text-xs text-muted-foreground'>
								サイズコード（S/M/L）やカラーコード（BLACK）など
							</p>
						</div>
						<div className='grid gap-2'>
							<Label htmlFor='variant-name'>
								名前 <span className='text-destructive'>*</span>
							</Label>
							<Input
								id='variant-name'
								placeholder='例: Sサイズ, ブラック'
								value={variantForm.name}
								onChange={e =>
									setVariantForm(prev => ({
										...prev,
										name: e.target.value,
									}))
								}
							/>
						</div>
						<div className='grid gap-2'>
							<Label htmlFor='variant-status'>ステータス</Label>
							<Select
								value={variantForm.status}
								onValueChange={v =>
									setVariantForm(prev => ({ ...prev, status: v }))
								}
							>
								<SelectTrigger id='variant-status'>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value='ACTIVE'>販売中</SelectItem>
									<SelectItem value='DRAFT'>下書き</SelectItem>
									<SelectItem value='ARCHIVED'>アーカイブ</SelectItem>
								</SelectContent>
							</Select>
						</div>
						<div className='grid gap-2'>
							<Label htmlFor='variant-unit-amount'>金額（円）</Label>
							<Input
								id='variant-unit-amount'
								type='number'
								value={variantForm.unitAmount}
								onChange={e =>
									setVariantForm(prev => ({
										...prev,
										unitAmount: Number.parseInt(e.target.value, 10) || 0,
									}))
								}
							/>
						</div>
					</div>
					<DialogFooter>
						<Button
							type='button'
							variant='outline'
							onClick={() => setVariantDialogOpen(false)}
						>
							キャンセル
						</Button>
						<Button
							type='button'
							onClick={saveVariant}
							disabled={!variantForm.code.trim() || !variantForm.name.trim()}
						>
							{editingVariantIndex !== null ? '更新' : '追加'}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</main>
	)
}
