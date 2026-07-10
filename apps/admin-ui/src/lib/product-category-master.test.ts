import { describe, expect, it } from 'vitest'

import {
	categoryMasterChanges,
	normalizeCategoryMasterValue,
} from './product-category-master'

describe('product category master write-back helpers', () => {
	it('normalizes empty category values to undefined', () => {
		expect(normalizeCategoryMasterValue('  kitchen  ')).toBe('kitchen')
		expect(normalizeCategoryMasterValue('   ')).toBeUndefined()
		expect(normalizeCategoryMasterValue(null)).toBeUndefined()
	})

	it('classifies category create, update, and delete operations', () => {
		expect(
			categoryMasterChanges({
				category: 'food',
				subcategory: 'snack',
			}),
		).toEqual([
			{ field: 'category', operation: 'create', value: 'food' },
			{ field: 'subcategory', operation: 'create', value: 'snack' },
		])

		expect(
			categoryMasterChanges({
				initialCategory: 'food',
				initialSubcategory: 'snack',
				category: 'grocery',
			}),
		).toEqual([
			{ field: 'category', operation: 'update', value: 'grocery' },
			{ field: 'subcategory', operation: 'delete' },
		])
	})

	it('classifies subcategory-only updates and clear operations', () => {
		expect(
			categoryMasterChanges({
				initialCategory: 'food',
				initialSubcategory: 'snack',
				category: 'food',
				subcategory: 'treat',
			}),
		).toEqual([{ field: 'subcategory', operation: 'update', value: 'treat' }])

		expect(
			categoryMasterChanges({
				initialCategory: 'food',
				initialSubcategory: 'snack',
				category: '',
				subcategory: '   ',
			}),
		).toEqual([
			{ field: 'category', operation: 'delete' },
			{ field: 'subcategory', operation: 'delete' },
		])
	})
})
