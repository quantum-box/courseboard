import { type ProductDetailOnProductFieldFragment } from 'gen/graphql'
import {
	Kind,
	ProductStatus,
	PublicationStatus,
	RecurringBillingFrequency,
} from 'lib/product-constants'
import { normalizeProductTags } from 'lib/product-tags-master'
import { stringOrNull } from 'validator/type'
import { z } from 'zod'

const IMAGE_TYPES = ['image/jpg', 'image/png']
const MAX_IMAGE_SIZE = 5 // 5MB

// バイト単位のサイズをメガバイト単位に変換する
const sizeInMB = (sizeInBytes: number, decimalsNum = 2) => {
	const result = sizeInBytes / (1024 * 1024)
	return +result.toFixed(decimalsNum)
}

export const variantValidator = z.object({
	id: z.string().optional(),
	code: z.string().min(1, 'コードは必須です。'),
	name: z.string().min(1, '名前は必須です。'),
	status: z.string().default('ACTIVE'),
	currency: z.string().default('jpy'),
	unitAmount: z.number().int().default(0),
})

export type VariantFormInput = z.infer<typeof variantValidator>

export const productValidator = z.object({
	// default(global)
	name: z.string().min(1, '必須項目です。'),
	description: stringOrNull,

	skuCode: stringOrNull,
	janCode: stringOrNull,
	upcCode: stringOrNull,

	kind: z.nativeEnum(Kind),

	// pricing
	listPrice: z.number().int(),
	billingCycle: z.nativeEnum(RecurringBillingFrequency),

	category: stringOrNull,
	subcategory: stringOrNull,
	tags: z.array(z.string()).default([]).transform(normalizeProductTags),

	status: z.nativeEnum(ProductStatus),

	// publication
	publicationStatus: z.nativeEnum(PublicationStatus),
	publicationName: stringOrNull,
	publicationDescription: stringOrNull,

	// image
	images: z
		.object({
			image: z.custom<File>().optional(),
			fileId: z.string().optional(),
			storageKey: z.string().optional(),
			previewUrl: z.string().optional(),
		})
		.array()
		.optional(),

	// variants
	variants: variantValidator.array().optional(),
})

export type ProductValidatorType = z.infer<typeof productValidator>

export function convertToFormValues(
	data: ProductDetailOnProductFieldFragment,
): ProductValidatorType {
	return {
		name: data.name,
		description: data.description,
		skuCode: data.skuCode,
		janCode: data.janCode,
		upcCode: data.upcCode,
		kind: data.kind as Kind,
		listPrice: data.listPrice,
		billingCycle: data.billingCycle as RecurringBillingFrequency,
		category: data.category,
		subcategory: data.subcategory,
		tags: data.tags,
		status: data.status as ProductStatus,
		publicationStatus: data.publicationStatus as PublicationStatus,
		publicationName: data.publicationName,
		publicationDescription: data.publicationDescription,
		images:
			data.imageStorageKeys && data.imageStorageKeys.length > 0
				? data.imageStorageUrls.map((url, i) => ({
						storageKey: data.imageStorageKeys![i],
						previewUrl: url,
					}))
				: data.imageFiles.map(file => ({ fileId: file })),
		variants: data.variants.map(v => ({
			id: v.id,
			code: v.code,
			name: v.name,
			status: v.status,
			currency: 'jpy',
			unitAmount: 0,
		})),
	}
}
