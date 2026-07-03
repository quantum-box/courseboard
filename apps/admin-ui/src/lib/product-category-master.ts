export type ProductCategoryMasterOperation = 'create' | 'update' | 'delete'

export type ProductCategoryMasterField = 'category' | 'subcategory'

export type ProductCategoryMasterChange = {
	field: ProductCategoryMasterField
	operation: ProductCategoryMasterOperation
	value?: string
}

export function normalizeCategoryMasterValue(
	value: string | null | undefined,
): string | undefined {
	const trimmed = value?.trim()
	return trimmed ? trimmed : undefined
}

export function categoryMasterChanges({
	initialCategory,
	initialSubcategory,
	category,
	subcategory,
}: {
	initialCategory?: string | null
	initialSubcategory?: string | null
	category?: string | null
	subcategory?: string | null
}): ProductCategoryMasterChange[] {
	return [
		categoryMasterChange('category', initialCategory, category),
		categoryMasterChange('subcategory', initialSubcategory, subcategory),
	].filter((change): change is ProductCategoryMasterChange => change !== null)
}

function categoryMasterChange(
	field: ProductCategoryMasterField,
	initialValue: string | null | undefined,
	nextValue: string | null | undefined,
): ProductCategoryMasterChange | null {
	const initial = normalizeCategoryMasterValue(initialValue)
	const next = normalizeCategoryMasterValue(nextValue)
	if (initial === next) return null
	if (!initial && next) return { field, operation: 'create', value: next }
	if (initial && !next) return { field, operation: 'delete' }
	if (next) return { field, operation: 'update', value: next }
	return null
}
